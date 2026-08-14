"""
Missing Country — map generation pipeline.

Given a source of country polygons (Natural Earth), this:
  1. picks a TARGET country,
  2. finds its land NEIGHBORS,
  3. "swallows" the target: its territory is partitioned among the neighbors
     (each point goes to the nearest neighbor) and merged in, so the outer
     silhouette is untouched but the target vanishes behind plausible fake
     borders,
  4. renders a clean SVG of the altered region (uniform styling, so you can't
     tell the expanded neighbors apart by eye), and
  5. exports the metadata + centroids your game needs.

Design notes
------------
* All geometry ops for a given puzzle happen in a local Azimuthal-Equidistant
  projection centered on the target, so distances/areas are locally accurate
  and the Voronoi partition is undistorted.
* The rendered map is clipped to a viewport around the target, which also
  disposes of far-flung overseas territories (e.g. French Guiana under "France").
* Country fills are UNIFORM on purpose — the whole game is that the map looks
  normal, so neighbors must not be visually distinguishable.

Usage
-----
    python missing_country.py candidates          # score countries for puzzle quality
    python missing_country.py adjacency           # dump full neighbor graph + areas
    python missing_country.py build "Nepal" ...   # build specific puzzles
    python missing_country.py build-auto 30       # auto-pick 30 good puzzles
    python missing_country.py build-daily [DATE]  # build today's (or DATE's) deterministic puzzle
    python missing_country.py preview "Nepal"     # write a PNG to eyeball it

Outputs land in ./out/ :
    out/adjacency.json         every country's neighbors + geodesic area (km^2)
    out/countries.json         all guessable countries + centroids (lat/lng)
    out/puzzles.json           ordered puzzle list (target, neighbors, viewBox, svg file)
    out/maps/<slug>.svg        one map per puzzle
"""

import json, math, os, sys, re
from shapely.geometry import shape, Point, MultiPoint, Polygon, MultiPolygon, box
from shapely.ops import unary_union, voronoi_diagram, transform
from shapely.strtree import STRtree
from pyproj import Transformer, Geod
import puzzle_selector

DATA = "ne_50m_admin0.geojson"
OUT = "out"
NAME_FIELD = "ADMIN"
CODE_FIELD = "ADM0_A3"

# ---------------------------------------------------------------- load & index
def load():
    data = json.load(open(DATA))
    geoms, codes = {}, {}
    for f in data["features"]:
        p = f["properties"]
        # skip Antarctica & anything without a real sovereign land border game-wise
        name = p[NAME_FIELD]
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        geoms[name] = g
        codes[name] = p.get(CODE_FIELD, "")
    return geoms, codes

# ------------------------------------------------------------- neighbor lookup
def find_neighbors(geoms, name):
    g = geoms[name]
    probe = g.buffer(0.02)  # ~2km fuzz, catches near-touching borders / river gaps
    out = []
    for other, og in geoms.items():
        if other == name:
            continue
        if not probe.intersects(og):
            continue
        shared = g.boundary.intersection(og.boundary).length
        if shared > 0.05 or g.buffer(0.03).intersection(og).area > 0.001:
            out.append(other)
    return out

# --------------------------------------------------- coastline / enclosure stat
def enclosure(geoms, name, neighbors):
    """Fraction of the target's border shared with land neighbors.
    ~1.0 => landlocked / cleanly enclosed (great puzzle).
    low  => lots of coastline (messy, ambiguous swallow)."""
    g = geoms[name]
    total = g.boundary.length
    if total == 0:
        return 0.0
    shared = 0.0
    for n in neighbors:
        shared += g.boundary.intersection(geoms[n].boundary).length
    return min(1.0, shared / total)

# -------------------------------------------------------------- projection util
def local_proj(target_geom):
    c = target_geom.centroid
    tr = Transformer.from_crs(
        "EPSG:4326", f"+proj=aeqd +lat_0={c.y} +lon_0={c.x} +units=m",
        always_xy=True,
    )
    fwd = lambda geom: transform(lambda xs, ys: tr.transform(xs, ys), geom)
    return fwd, tr

def densify(line, step):
    pts = []
    parts = line.geoms if line.geom_type.startswith("Multi") else [line]
    for ls in parts:
        L = ls.length
        if L == 0:
            continue
        n = max(2, int(L / step))
        for i in range(n + 1):
            pts.append(ls.interpolate(i / n, normalized=True))
    return pts

# ------------------------------------------------------------------- the swallow
def swallow(geoms, target_name, neighbors, step=6000, reach=70000):
    """Return dict neighbor -> expanded projected geom, plus the projector."""
    tgt = geoms[target_name]
    fwd, tr = local_proj(tgt)
    holeP = fwd(tgt)
    nbrP = {n: fwd(geoms[n]) for n in neighbors}

    near = holeP.buffer(reach)
    pts, tags = [], []
    for n, g in nbrP.items():
        b = g.boundary.intersection(near)
        if b.is_empty:
            continue
        for p in densify(b, step):
            pts.append(p)
            tags.append(n)
    if not pts:
        raise RuntimeError(f"no generator points for {target_name}")

    cells = voronoi_diagram(MultiPoint(pts), envelope=holeP.buffer(step * 2))
    tree = STRtree(pts)

    slices = {n: [] for n in neighbors}
    for cell in cells.geoms:
        piece = cell.intersection(holeP)
        if piece.is_empty or piece.area < 1:
            continue
        tag = None
        for i in tree.query(cell):
            if cell.contains(pts[i]):
                tag = tags[i]
                break
        if tag is None:  # fallback: nearest generator to the cell centroid
            cc = cell.centroid
            tag = tags[min(range(len(pts)), key=lambda i: cc.distance(pts[i]))]
        slices[tag].append(piece)

    expanded = {}
    for n in neighbors:
        add = unary_union(slices[n]) if slices[n] else None
        merged = unary_union([nbrP[n]] + ([add] if add else []))
        expanded[n] = merged.buffer(0)  # heal any slivers
    return expanded, fwd, tr

# ----------------------------------------------------------------- SVG rendering
def polys_of(geom):
    if geom.is_empty:
        return []
    gs = geom.geoms if geom.geom_type.startswith("Multi") else [geom]
    return [p for p in gs if p.geom_type == "Polygon"]

def ring_to_path(coords, sx, sy):
    d = ""
    for i, (x, y) in enumerate(coords):
        d += ("M" if i == 0 else "L") + f"{sx(x):.1f},{sy(y):.1f}"
    return d + "Z"

def poly_to_path(poly, sx, sy):
    d = ring_to_path(poly.exterior.coords, sx, sy)
    for hole in poly.interiors:
        d += ring_to_path(hole.coords, sx, sy)
    return d

def render_svg(geoms, target_name, neighbors, expanded, fwd,
               W=820, pad_frac=0.45, min_km=140, style=None):
    """Uniform-styled SVG of the region with the target swallowed."""
    style = style or {}
    land = style.get("land", "#e8e4da")
    stroke = style.get("stroke", "#ffffff")
    sea = style.get("sea", "#a8c4d4")
    sw = style.get("stroke_w", 1.1)

    tgtP = fwd(geoms[target_name])
    minx, miny, maxx, maxy = tgtP.bounds
    w, h = maxx - minx, maxy - miny
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    half = max(w, h, min_km * 1000) * (1 + pad_frac) / 2
    minx, maxx, miny, maxy = cx - half, cx + half, cy - half, cy + half
    view = box(minx, miny, maxx, maxy)

    H = W  # square viewport
    sx = lambda x: (x - minx) / (maxx - minx) * W
    sy = lambda y: H - (y - miny) / (maxy - miny) * H  # flip Y for SVG

    # which geometries to draw: every country overlapping the viewport,
    # with neighbors swapped for their expanded versions and target removed.
    draw = {}
    view_ll = view  # already projected
    for name, g in geoms.items():
        if name == target_name:
            continue
        gg = expanded.get(name)
        if gg is None:
            gp = fwd(g)
            if not gp.intersects(view_ll):
                continue
            gg = gp
        clipped = gg.intersection(view)
        if not clipped.is_empty:
            draw[name] = clipped

    paths = []
    for name, g in draw.items():
        for poly in polys_of(g):
            if poly.area < (half * 0.004) ** 2:  # drop specks
                continue
            paths.append(
                f'<path d="{poly_to_path(poly, sx, sy)}" '
                f'fill="{land}" stroke="{stroke}" stroke-width="{sw}" '
                f'stroke-linejoin="round"/>'
            )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}">'
        f'<rect x="0" y="0" width="{W}" height="{H}" fill="{sea}"/>'
        + "".join(paths)
        + "</svg>"
    )
    return svg, [0, 0, W, H]

# ----------------------------------------------------------------- centroid util
def main_centroid(geom):
    """Representative point of the LARGEST polygon (avoids overseas-territory pull)."""
    ps = polys_of(geom)
    if not ps:
        rp = geom.representative_point()
        return rp.y, rp.x
    big = max(ps, key=lambda p: p.area)
    rp = big.representative_point()
    return rp.y, rp.x

_GEOD = Geod(ellps="WGS84")

def geodesic_area_km2(geom, main_only=True):
    """True (geodesic) area in km^2. main_only restricts to the LARGEST
    polygon, same rationale as main_centroid: an overseas territory
    shouldn't inflate a country's footprint for the puzzle-size heuristic."""
    g = geom
    if main_only:
        ps = polys_of(geom)
        if ps:
            g = max(ps, key=lambda p: p.area)
    if g.is_empty:
        return 0.0
    area, _ = _GEOD.geometry_area_perimeter(g)
    return abs(area) / 1e6

def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

# ------------------------------------------------------------------- CLI: candidates
def cmd_candidates(geoms, codes):
    rows = []
    for name in geoms:
        if name in ("Antarctica",):
            continue
        nbrs = find_neighbors(geoms, name)
        if not nbrs:
            continue
        enc = enclosure(geoms, name, nbrs)
        area = geoms[name].area
        rows.append((name, len(nbrs), round(enc, 3), round(area, 2)))
    # good puzzles: high enclosure (clean swallow), a few neighbors, not micro
    rows.sort(key=lambda r: (-r[2], r[1]))
    print(f"{'country':22} {'nbrs':>4} {'enclosed':>8}  quality")
    print("-" * 52)
    for name, nn, enc, area in rows:
        if enc >= 0.999:
            q = "PERFECT (fully enclosed)"
        elif enc >= 0.9:
            q = "great (landlocked)"
        elif enc >= 0.6:
            q = "ok"
        else:
            q = "coastal — skip"
        print(f"{name:22} {nn:>4} {enc:>8.2f}  {q}")

# ---------------------------------------------------------------- CLI: adjacency
def build_adjacency(geoms, codes):
    """Full country adjacency graph:
        { name: { code, neighbors: [name, ...], area_km2, enclosure } }
    Consumed by puzzle_selector.py to decide which countries are fair
    daily-puzzle targets, independent of which puzzles get their SVG built.
    `enclosure` is included (not just neighbors/area) because puzzle_selector's
    single-neighbor carve-out (Lesotho/San Marino) needs it to distinguish
    "fully enclosed" from "coastal with one land neighbor"."""
    adjacency = {}
    for name, g in geoms.items():
        if name == "Antarctica":
            continue
        nbrs = find_neighbors(geoms, name)
        adjacency[name] = {
            "code": codes.get(name, ""),
            "neighbors": nbrs,
            "area_km2": round(geodesic_area_km2(g), 1),
            "enclosure": round(enclosure(geoms, name, nbrs), 3),
        }
    return adjacency

def cmd_adjacency(geoms, codes):
    os.makedirs(OUT, exist_ok=True)
    adjacency = build_adjacency(geoms, codes)
    with open(f"{OUT}/adjacency.json", "w") as fh:
        json.dump(adjacency, fh, indent=2, ensure_ascii=False)
    print(f"wrote {len(adjacency)} countries -> {OUT}/adjacency.json")

# ------------------------------------------------------------------- CLI: build
def build_puzzles(geoms, codes, targets, preview=False):
    os.makedirs(f"{OUT}/maps", exist_ok=True)
    puzzles = []
    for i, name in enumerate(targets):
        if name not in geoms:
            print(f"  !! '{name}' not found, skipping")
            continue
        nbrs = find_neighbors(geoms, name)
        if not nbrs:
            print(f"  !! '{name}' has no land neighbors, skipping")
            continue
        expanded, fwd, tr = swallow(geoms, name, nbrs)
        svg, viewBox = render_svg(geoms, name, nbrs, expanded, fwd)
        s = slug(name)
        with open(f"{OUT}/maps/{s}.svg", "w") as fh:
            fh.write(svg)
        puzzles.append({
            "id": i + 1,
            "slug": s,
            "target": name,
            "targetCode": codes.get(name, ""),
            "neighbors": nbrs,
            "enclosure": round(enclosure(geoms, name, nbrs), 3),
            "viewBox": viewBox,
            "map": f"maps/{s}.svg",
        })
        print(f"  ok  {name:20} neighbors={len(nbrs)} enclosure={puzzles[-1]['enclosure']}")
    with open(f"{OUT}/puzzles.json", "w") as fh:
        json.dump(puzzles, fh, indent=2, ensure_ascii=False)

    # centroids for every guessable country (land countries only)
    countries = []
    for name, g in geoms.items():
        if name == "Antarctica":
            continue
        lat, lng = main_centroid(g)
        countries.append({"name": name, "code": codes.get(name, ""),
                          "lat": round(lat, 2), "lng": round(lng, 2)})
    countries.sort(key=lambda c: c["name"])
    with open(f"{OUT}/countries.json", "w") as fh:
        json.dump(countries, fh, indent=2, ensure_ascii=False)
    print(f"\nwrote {len(puzzles)} puzzles -> {OUT}/puzzles.json")
    print(f"wrote {len(countries)} countries -> {OUT}/countries.json")

def eligible_pool(geoms, codes):
    """Adjacency graph + the subset of countries fair to use as puzzle
    targets: puzzle_selector's widest rule (>=1 real land-border neighbor),
    nothing else. `enclosure` is still computed in the adjacency graph but
    is no longer a gate here -- it's carried through to each built puzzle
    as a difficulty label (see build_puzzles). Shared by build-auto and
    build-daily so both draw from the same eligible set."""
    adjacency = build_adjacency(geoms, codes)
    pool = puzzle_selector.eligible_targets(adjacency)
    return adjacency, pool

def cmd_build_auto(geoms, codes, n):
    adjacency, pool = eligible_pool(geoms, codes)
    # order by enclosure descending -- highest first as the "cleanest
    # swallow" difficulty signal; not a filter, just a build/pick order
    scored = [(name, adjacency[name]["enclosure"]) for name in pool]
    scored.sort(key=lambda r: (-r[1], r[0]))
    targets = [s[0] for s in scored[:n]]
    print(f"auto-selected {len(targets)} puzzles:\n  " + ", ".join(targets) + "\n")
    build_puzzles(geoms, codes, targets)

def cmd_build_daily(geoms, codes, date_str=None):
    """Build the single deterministic puzzle for a given date (default:
    today, UTC), for wiring into the daily rotation. Same date -> same
    target for every player and every run."""
    from datetime import date as _date, datetime as _datetime, timezone as _timezone
    d = _date.fromisoformat(date_str) if date_str else _datetime.now(_timezone.utc).date()
    adjacency, pool = eligible_pool(geoms, codes)
    target = puzzle_selector.pick_for_date(d, pool)
    print(f"daily target for {d}: {target}  ({len(pool)} eligible countries)")
    build_puzzles(geoms, codes, [target])

# ------------------------------------------------------------------- CLI: preview
def cmd_preview(geoms, name):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon as MP
    nbrs = find_neighbors(geoms, name)
    expanded, fwd, tr = swallow(geoms, name, nbrs)
    svg, vb = render_svg(geoms, name, nbrs, expanded, fwd)
    # crude SVG->PNG via re-render in mpl from the same geoms
    tgtP = fwd(geoms[name]); minx, miny, maxx, maxy = tgtP.bounds
    cx, cy = (minx+maxx)/2, (miny+maxy)/2
    half = max(maxx-minx, maxy-miny, 140000) * 1.45 / 2
    fig, ax = plt.subplots(figsize=(7, 7))
    for nm, g in geoms.items():
        if nm == name: continue
        gg = expanded.get(nm) or fwd(g)
        for poly in polys_of(gg):
            xs, ys = poly.exterior.xy
            ax.add_patch(MP(list(zip(xs, ys)), fc="#e8e4da", ec="white", lw=1.1))
    ax.set_xlim(cx-half, cx+half); ax.set_ylim(cy-half, cy+half)
    ax.set_aspect("equal"); ax.set_facecolor("#a8c4d4"); ax.axis("off")
    ax.set_title(f"{name} — swallowed (as the player sees it)")
    fn = f"preview_{slug(name)}.png"
    plt.savefig(fn, dpi=95, bbox_inches="tight"); print("wrote", fn)

# ------------------------------------------------------------------------- main
if __name__ == "__main__":
    geoms, codes = load()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "candidates"
    if cmd == "candidates":
        cmd_candidates(geoms, codes)
    elif cmd == "adjacency":
        cmd_adjacency(geoms, codes)
    elif cmd == "build":
        build_puzzles(geoms, codes, sys.argv[2:])
    elif cmd == "build-auto":
        cmd_build_auto(geoms, codes, int(sys.argv[2]) if len(sys.argv) > 2 else 30)
    elif cmd == "build-daily":
        cmd_build_daily(geoms, codes, sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "preview":
        cmd_preview(geoms, sys.argv[2])
    else:
        print(__doc__)
