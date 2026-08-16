"""
Missing Country — map generation pipeline.

Given a source of country polygons (Natural Earth), this:
  1. picks a TARGET country,
  2. splits it into disconnected landmass PIECES,
  3. "swallows" the target PER PIECE: each piece's territory is partitioned
     among the countries that border THAT piece (nearest-country fallback if
     none border it) via a Voronoi diagram, and merged into them, so the
     outer silhouette is untouched but the target vanishes behind plausible
     fake borders, and
  4. exports the swallowed world as GeoJSON (a shared world base + a small
     per-puzzle diff) for a D3 client to render, plus the metadata +
     centroids the game needs.

Design notes
------------
* Each PIECE is swallowed in its own local Azimuthal-Equidistant projection
  centered on that piece, so distances/areas are locally accurate, the
  Voronoi partition is undistorted, and no single projection ever spans a
  target's far-flung extremes (France <-> French Guiana) -- which is what
  keeps the geometry ops from degenerating/crashing.
* Absorbed territory carries the ABSORBING country's name; the target's name
  appears on no output feature. Output geometry is lon/lat (projection-
  independent), so the client can render flat today and a geoOrthographic
  globe later from the SAME data. Uniform fill is a client concern now.

Usage
-----
    python missing_country.py candidates          # score countries for puzzle quality
    python missing_country.py adjacency           # dump full neighbor graph + areas
    python missing_country.py build "Nepal" ...   # build specific puzzles
    python missing_country.py build-auto 30       # auto-pick 30 good puzzles
    python missing_country.py build-daily [DATE]  # build today's (or DATE's) deterministic puzzle

Outputs land in ./out/ :
    out/adjacency.json         every country's neighbors + geodesic area (km^2)
    out/countries.json         all guessable countries + centroids (lat/lng)
    out/world.geojson          shared base map: every country, unmodified
    out/puzzles.json           ordered puzzle index (target, absorbers, diff path)
    out/puzzles/<slug>.json    per-puzzle diff (removed target + changed absorbers)
"""

import json, math, os, sys, re
from shapely.geometry import shape, mapping, MultiPoint, Polygon
from shapely.ops import unary_union, voronoi_diagram, transform
from shapely import make_valid, set_precision
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
def local_proj(center_geom):
    """Local Azimuthal-Equidistant projector centered on `center_geom`'s
    centroid. Returns (fwd, inv): fwd maps lon/lat geometry -> local meters,
    inv maps back. Distances/areas near the center are locally accurate;
    only ever project geometry that lives near the center (far/antipodal
    geometry degenerates under AEQD -- that was the render crash)."""
    c = center_geom.centroid
    tr = Transformer.from_crs(
        "EPSG:4326", f"+proj=aeqd +lat_0={c.y} +lon_0={c.x} +units=m",
        always_xy=True,
    )
    fwd = lambda geom: transform(lambda xs, ys: tr.transform(xs, ys), geom)
    inv = lambda geom: transform(
        lambda xs, ys: tr.transform(xs, ys, direction="INVERSE"), geom)
    return fwd, inv

_GEOD_GC = Geod(ellps="WGS84")
def _gc_km(a, b):
    """Great-circle km between two lon/lat points (for coarse nearest ranking)."""
    return _GEOD_GC.inv(a.x, a.y, b.x, b.y)[2] / 1000.0

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

# ----------------------------------------------------------- piece splitting
def split_pieces(target_geom, cluster_km=150):
    """Split the target into disconnected landmass PIECES. Polygons are
    single-linkage clustered by projected boundary-to-boundary distance:
    two polygons join the same piece if they come within `cluster_km`.
    Tight archipelagos (Denmark's Zealand+Funen+Jutland) collapse into one
    piece; true exclaves (French Guiana, Aruba, Bornholm) stay separate.
    Returns lon/lat geometries (one per piece). Safe near antipode: every
    target polygon is near the target's own centroid, so the projection
    used only for the distance metric never degenerates."""
    polys = polys_of(target_geom)
    if len(polys) <= 1:
        return list(polys)
    fwd, _ = local_proj(target_geom)
    proj = [fwd(p) for p in polys]
    n = len(polys)
    parent = list(range(n))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    thr = cluster_km * 1000
    for i in range(n):
        for j in range(i + 1, n):
            if proj[i].distance(proj[j]) <= thr:
                parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(polys[i])
    return [unary_union(g) for g in groups.values()]

# ------------------------------------------------------ per-piece absorbers
def piece_borderers(piece, geoms, exclude):
    """Countries (by name) that share a land border with `piece`. Same
    adjacency test as find_neighbors, but scoped to one piece and run
    against every country except `exclude` (so a piece can be absorbed by
    a country that isn't in the target's *global* neighbor set -- French
    Guiana -> Suriname/Brazil, not France's European neighbors)."""
    probe = piece.buffer(0.02)
    probe3 = piece.buffer(0.03)
    pb = piece.boundary
    out = []
    for other, og in geoms.items():
        if other in exclude:
            continue
        if not probe.intersects(og):
            continue
        if pb.intersection(og.boundary).length > 0.05 or probe3.intersection(og).area > 0.001:
            out.append(other)
    return out

def nearest_country(piece, geoms, exclude, prefer=None, tie_km=150):
    """Nearest country to `piece` over ALL countries (not just the target's
    neighbors) -- the fallback absorber when nothing borders the piece.
    `prefer` is the set of countries already absorbing some sibling piece
    of the same target; among candidates within `tie_km` of the closest,
    one of those wins the tie. That's what routes UK's Great Britain (which
    borders nobody) to Ireland -- Ireland already takes Northern Ireland --
    rather than to whatever coastline happens to be marginally closest."""
    pc = piece.centroid
    ranked = sorted(
        ((_gc_km(pc, og.centroid), other) for other, og in geoms.items()
         if other not in exclude),
        key=lambda t: t[0],
    )
    shortlist = [name for _, name in ranked[:15]]
    fwd, _ = local_proj(piece)
    pieceP = fwd(piece)
    dists = []
    for name in shortlist:
        try:
            dists.append((pieceP.distance(fwd(geoms[name])), name))
        except Exception:
            continue
    if not dists:
        return None
    dists.sort()
    best_d, best = dists[0]
    if prefer:
        window = best_d + tie_km * 1000
        for dm, name in dists:
            if dm <= window and name in prefer:
                return name
    return best

def _voronoi_slices(holeP, candP, step=6000, reach=70000):
    """Partition projected piece `holeP` among projected candidate geoms
    `candP` (name -> geom) by a Voronoi diagram of densified candidate
    boundary points. Returns name -> projected slice geometry."""
    near = holeP.buffer(reach)
    pts, tags = [], []
    for name, g in candP.items():
        b = g.boundary.intersection(near)
        if b.is_empty:
            continue
        for p in densify(b, step):
            pts.append(p)
            tags.append(name)
    if not pts:
        return {}
    cells = voronoi_diagram(MultiPoint(pts), envelope=holeP.buffer(step * 2))
    slices = {name: [] for name in candP}
    for cell in cells.geoms:
        sl = cell.intersection(holeP)
        if sl.is_empty or sl.area < 1:
            continue
        tag = None
        for i in range(len(pts)):
            if cell.contains(pts[i]):
                tag = tags[i]
                break
        if tag is None:
            cc = cell.centroid
            tag = tags[min(range(len(pts)), key=lambda i: cc.distance(pts[i]))]
        slices[tag].append(sl)
    return {name: unary_union(ss) for name, ss in slices.items() if ss}

# ------------------------------------------------------------------- the swallow
def swallow(geoms, target_name):
    """Per-piece swallow. Returns {country_name -> new lon/lat geometry}
    for every country whose shape changed (the absorbers); the target is
    not a key. Each disconnected piece of the target is absorbed only by
    countries bordering THAT piece (nearest-country fallback if none), so
    far-flung territory routes locally and no single projection ever spans
    the target's extremes -- which is what fixes the cross-ocean crashes."""
    exclude = {target_name}
    pieces = split_pieces(geoms[target_name])

    # candidates per piece; collect the "connected" set (borders some piece)
    # first so the nearest-country fallback can prefer it as a tie-break.
    piece_borders = [piece_borderers(p, geoms, exclude) for p in pieces]
    connected = set().union(*piece_borders) if piece_borders else set()

    absorbed = {}  # absorber name -> list of lon/lat slice geoms
    for piece, borders in zip(pieces, piece_borders):
        cands = borders
        if not cands:
            nb = nearest_country(piece, geoms, exclude, prefer=connected)
            cands = [nb] if nb else []
        if not cands:
            continue
        if len(cands) == 1:
            absorbed.setdefault(cands[0], []).append(piece)
            continue
        fwd, inv = local_proj(piece)
        holeP = fwd(piece)
        for name, projslice in _voronoi_slices(holeP, {c: fwd(geoms[c]) for c in cands}).items():
            absorbed.setdefault(name, []).append(inv(projslice))

    expanded = {}
    for name, adds in absorbed.items():
        add = unary_union([make_valid(a) for a in adds])
        expanded[name] = make_valid(unary_union([geoms[name], add])).buffer(0)
    return _heal_target_footprint(expanded, geoms[target_name])

def _heal_target_footprint(expanded, target):
    """The absorbers should tile the vanished target's footprint EXACTLY.
    Independent per-absorber unions plus projection round-trips can leave
    hairline GAPS between adjacent absorbers (sea shows through) and tiny
    HOLES inside an absorber -- both render as phantom seam strokes right
    where the target used to be, outlining the answer. Close them:
      1. reassign any uncovered leftover within the target to the absorber
         it shares the most boundary with (fills gaps), and
      2. drop interior rings that fall inside the target footprint (fills
         holes). Real enclaves like San Marino lie OUTSIDE the footprint,
         so they're untouched.
    Without this, set_precision alone fixes validity but leaves ~0.1 km^2
    of sliver gaps/holes visible at high zoom."""
    names = list(expanded)
    out = dict(expanded)
    leftover = target.difference(unary_union(list(out.values())))
    for frag in (polys_of(leftover) if not leftover.is_empty else []):
        best, best_len = None, -1.0
        for n in names:
            shared = out[n].boundary.intersection(frag.boundary).length
            if shared > best_len:
                best_len, best = shared, n
        if best is not None:
            out[best] = make_valid(unary_union([out[best], frag]))
    for n in names:
        rebuilt = [Polygon(p.exterior,
                           [r for r in p.interiors
                            if not target.contains(Polygon(r).representative_point())])
                   for p in polys_of(out[n])]
        if rebuilt:
            out[n] = unary_union(rebuilt)
    return out

# ------------------------------------------------------------- geometry util
def polys_of(geom):
    if geom.is_empty:
        return []
    gs = geom.geoms if geom.geom_type.startswith("Multi") else [geom]
    return [p for p in gs if p.geom_type == "Polygon"]

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

# --------------------------------------------------------- GeoJSON emission
GRID = 1e-4  # coordinate quantization, ~11m — the client renders a world map,
             # not a cadastre, so 11m is plenty and it keeps the JSON small.

def quantize(geom):
    """Snap coordinates to a fixed `GRID` via shapely.set_precision, which —
    unlike naive per-coordinate rounding — guarantees VALID output topology
    and snaps every feature to the SAME global grid. That matters twice over:
    (1) a swallowed absorber stays a clean single polygon instead of a
    self-intersecting one (naive rounding made every absorber invalid, and
    geoPath then stroked the self-intersection artifacts as phantom seam
    lines exactly where the target used to be); (2) an edge shared between a
    diff feature and an unchanged base feature snaps identically in both, so
    no sea-coloured slivers open up between them."""
    return set_precision(geom, GRID)

def feature(name, code, geom):
    return {"type": "Feature",
            "properties": {"name": name, "code": code},
            "geometry": mapping(quantize(geom))}

def write_world_base(geoms, codes):
    """The shared, unmodified world -- written once, cached by the client
    across every puzzle. Each puzzle ships only a small diff against this."""
    feats = [feature(name, codes.get(name, ""), g)
             for name, g in geoms.items() if name != "Antarctica"]
    fc = {"type": "FeatureCollection", "features": feats}
    with open(f"{OUT}/world.geojson", "w") as fh:
        json.dump(fc, fh, separators=(",", ":"), ensure_ascii=False)
    return len(feats)

# ------------------------------------------------------------------- CLI: build
def build_puzzles(geoms, codes, targets):
    os.makedirs(f"{OUT}/puzzles", exist_ok=True)
    nbase = write_world_base(geoms, codes)

    puzzles = []
    for i, name in enumerate(targets):
        if name not in geoms:
            print(f"  !! '{name}' not found, skipping")
            continue
        nbrs = find_neighbors(geoms, name)
        if not nbrs:
            print(f"  !! '{name}' has no land neighbors, skipping")
            continue
        expanded = swallow(geoms, name)
        # invariant: the swallowed target's name must appear on NO feature.
        assert name not in expanded, f"target {name!r} absorbed itself"
        absorbers = sorted(expanded)
        s = slug(name)
        diff = {
            "target": name,
            "removed": name,   # client deletes this feature from the base
            "changed": [feature(a, codes.get(a, ""), expanded[a]) for a in absorbers],
        }
        with open(f"{OUT}/puzzles/{s}.json", "w") as fh:
            json.dump(diff, fh, separators=(",", ":"), ensure_ascii=False)
        puzzles.append({
            "id": i + 1,
            "slug": s,
            "target": name,
            "targetCode": codes.get(name, ""),
            "neighbors": nbrs,
            "absorbers": absorbers,
            "enclosure": round(enclosure(geoms, name, nbrs), 3),
            "diff": f"puzzles/{s}.json",
        })
        print(f"  ok  {name:22} absorbers={len(absorbers):2} enclosure={puzzles[-1]['enclosure']}")
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
    print(f"\nwrote world base ({nbase} countries) -> {OUT}/world.geojson")
    print(f"wrote {len(puzzles)} puzzle diffs -> {OUT}/puzzles/ (+ {OUT}/puzzles.json index)")
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
    else:
        print(__doc__)
