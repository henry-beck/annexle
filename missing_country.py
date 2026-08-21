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

import json, math, os, sys, re, hashlib
import numpy as np
import shapely
from shapely.geometry import shape, mapping, MultiPoint, Polygon
from shapely.ops import unary_union, voronoi_diagram, transform
from shapely import make_valid, set_precision
from shapely.errors import GEOSException
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

def _dedup_points(pts, tags, grid):
    """Drop generator points that collide on a `grid`-metre lattice, keeping
    the first tag at each cell. Exact/near-duplicate sites -- produced where two
    neighbours' boundaries meet at a tripoint and both get sampled at the same
    coordinate -- are the classic trigger for GEOS voronoi_diagram 'side
    location conflict' crashes, and whether a given GEOS build tolerates them
    varies (which is why the same data builds on GEOS 3.11/3.13 but crashed on
    another build). Removing the degenerate sites makes the diagram robust
    across GEOS versions; duplicate sites are redundant, so the partition is
    unchanged."""
    seen, op, ot = set(), [], []
    for p, t in zip(pts, tags):
        key = (round(p.x / grid), round(p.y / grid))
        if key in seen:
            continue
        seen.add(key)
        op.append(p)
        ot.append(t)
    return op, ot

def _voronoi_cells(pts, tags, holeP, step):
    """Build the Voronoi diagram robustly: dedupe coincident generator points
    first, and if GEOS still fails on this build, retry once with coarser
    snapping. Returns (cells, pts, tags) with the points actually used, or None
    if even the coarse retry fails (caller then falls back)."""
    env = make_valid(holeP.buffer(step * 2))
    for grid in (1.0, step / 20):
        dp, dt = _dedup_points(pts, tags, grid)
        if len(dp) < 2:
            continue
        try:
            return voronoi_diagram(MultiPoint(dp), envelope=env), dp, dt
        except (GEOSException, ValueError):
            continue
    return None

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

    result = _voronoi_cells(pts, tags, holeP, step)
    if result is None:  # voronoi unrecoverable on this GEOS build: whole-piece fallback
        best = max(candP, key=lambda n: holeP.boundary.intersection(candP[n].boundary).length)
        print(f"    !! voronoi failed; assigning whole piece to {best}")
        return {best: holeP}
    cells, pts, tags = result
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
    healed = _heal_target_footprint(expanded, geoms[target_name])
    return _declutter_absorbers(healed, geoms)

# tiny fragments of the target, detached from an absorber's real body and far
# from it, are Voronoi/heal artifacts that get mis-tagged to a distant country
# (e.g. slivers of Chile's coast landing on Pitcairn 5000 km away), which renders
# as that country "swallowing the ocean". Distinguish them from LEGITIMATE
# far-flung fallback territory (Easter Island -> Pitcairn, Socotra -> Somalia):
# the artifacts are microscopic, the real islands are not — so a size gate keeps
# the real ones and only reassigns the noise.
DECLUTTER_MAX_KM2 = 2.0    # a fragment bigger than this is real territory, kept
DECLUTTER_MIN_DEG = 1.5    # ...and one nearer than this to its absorber is kept

def _declutter_absorbers(expanded, geoms):
    """Reassign orphaned micro-slivers to the absorber they actually belong to.
    A part is an orphan if it's detached from its absorber's OWN base geometry,
    smaller than DECLUTTER_MAX_KM2, and more than DECLUTTER_MIN_DEG from that
    base. Each orphan is moved to the other absorber it shares the most boundary
    with (nearest by centroid if it touches none), so the target footprint stays
    fully tiled — nothing is dropped, only re-tagged. Legit far-flung fallback
    islands are above the size gate and stay put."""
    kept, orphans = {}, []
    for name, g in expanded.items():
        b = geoms.get(name)
        keep = []
        for p in polys_of(g):
            detached = b is None or not p.intersects(b)
            if (detached and geodesic_area_km2(p, main_only=False) < DECLUTTER_MAX_KM2
                    and (b is None or p.distance(b) > DECLUTTER_MIN_DEG)):
                orphans.append(p)
            else:
                keep.append(p)
        kept[name] = unary_union(keep) if keep else None
    live = [n for n, g in kept.items() if g is not None and not g.is_empty]
    for frag in orphans:
        best, best_len = None, -1.0
        for n in live:
            shared = kept[n].boundary.intersection(frag.boundary).length
            if shared > best_len:
                best_len, best = shared, n
        if best_len <= 0:
            # touches no absorber's boundary (an isolated speck): give it to the
            # absorber whose TERRITORY is physically nearest — the one it visually
            # sits amongst — not the nearest centroid (which mispicks big far
            # countries). This routes a stray Chilean-coast speck to Argentina's
            # expanded coast, not to Pitcairn 5000 km away.
            best = min(live, key=lambda n: frag.distance(kept[n]))
        kept[best] = make_valid(unary_union([kept[best], frag]))
    return {n: g for n, g in kept.items() if g is not None and not g.is_empty}

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

def cmd_manifest(geoms, codes, days=1100):
    """Precompute the deterministic date -> puzzle lookup the JS client uses.
    pick_for_date lives in Python (puzzle_selector), so rather than reproduce
    its seeded shuffle in JS we emit the whole sequence: entries[i] is the
    puzzle for LAUNCH_DATE + i days, and the client just array-indexes by
    days-since-launch. Writes out/manifest.json; sync-data copies it to the
    app. Covers `days` days from LAUNCH_DATE (~3 years by default)."""
    from datetime import timedelta
    adjacency, pool = eligible_pool(geoms, codes)
    launch = puzzle_selector.LAUNCH_DATE
    entries = []
    for i in range(days):
        target = puzzle_selector.pick_for_date(launch + timedelta(days=i), pool)
        entries.append({"slug": slug(target), "target": target})
    os.makedirs(OUT, exist_ok=True)
    manifest = {"launchDate": launch.isoformat(), "days": days, "entries": entries}
    with open(f"{OUT}/manifest.json", "w") as fh:
        json.dump(manifest, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote manifest: launch {launch}, {days} days, "
          f"{len(pool)} eligible -> {OUT}/manifest.json")

# ============================================================================
# Distributed distortion (xkcd-style) difficulty mode  — SEPARATE path.
# ----------------------------------------------------------------------------
# A selectable variant, NOT the default. On top of the ordinary per-piece
# swallow it also perturbs the borders BETWEEN the target's surrounding
# non-target countries, so the whole neighbourhood wobbles and there is no
# single clean patch that reveals where the target was (the "Contiguous 41
# States" effect, https://xkcd.com/1902/).
#
# Method: one deterministic, smooth vector displacement field applied
# IDENTICALLY to every polygon in a local region. A single-valued continuous
# warp is a homeomorphism of the plane — it bends shared borders but cannot
# open gaps, create overlaps, or move a name off its land — so the client's
# by-name hover/tiling keeps working unchanged. See ROADMAP.md.
#
# It writes an ALTERNATE diff (out/puzzles/<slug>-distorted.json) alongside the
# ordinary one and patches only diffDistorted in the puzzle index. The swallow
# output and every other command are untouched.

# defaults (all overridable on the CLI)
DIST_PROP_DEPTH = 2       # BFS hops out from the target that may be perturbed
DIST_RADIUS_KM = 700.0    # metric window: nothing past this from the target moves
DIST_AMP_KM = 3.5         # peak border excursion (bounded vs wavelength: no fold)
DIST_TAPER_KM = 60.0      # ramp width from the pinned region boundary inward
DIST_WAVES = 6            # sinusoidal components in the noise field
DIST_LAM_KM = (40.0, 160.0)  # wavelength range of those components
DIST_STEP_KM = 4.0        # densify step so straight borders can bend

def _region_members(geoms, target, depth, radius_m):
    """Countries eligible to be perturbed: within `depth` land-adjacency hops
    of the target AND whose polygon comes within `radius_m` of the target's
    principal piece. The metric window is essential, not cosmetic: depth alone
    pulls in far exclave-neighbours (France borders Brazil/Suriname via French
    Guiana) and continent-sized neighbours, which a single local projection
    can't warp sanely. The window keeps the region local and the projection
    accurate."""
    # BFS to `depth` over the neighbour graph.
    frontier, seen = {target}, {target}
    for _ in range(depth):
        nxt = set()
        for name in frontier:
            for nb in find_neighbors(geoms, name):
                if nb not in seen:
                    nxt.add(nb)
        seen |= nxt
        frontier = nxt
    seen.discard(target)
    # metric gate against the target's principal (largest) piece
    tps = polys_of(geoms[target])
    tmain = max(tps, key=lambda p: p.area) if tps else geoms[target]
    fwd, _ = local_proj(tmain)
    tmainP = fwd(tmain)
    members = []
    for name in seen:
        try:
            if fwd(geoms[name]).distance(tmainP) <= radius_m:
                members.append(name)
        except Exception:
            continue
    return members, fwd, _region_inverse(tmain)

def _region_inverse(center_geom):
    _, inv = local_proj(center_geom)
    return inv

def _seeded_waves(slug, k, lam_min_m, lam_max_m):
    """Deterministic band-limited noise basis for a slug. Seeded from a SHA-256
    of the slug (NOT Python's per-process-salted hash()), so the field — and
    thus the whole distorted puzzle — is byte-identical on every run and for
    every player. Returns a list of (unit push direction, wave vector, phase,
    weight); the field is a weighted sum of sinusoids of those wave vectors."""
    seed = int.from_bytes(hashlib.sha256(slug.encode()).digest()[:8], "big")
    rng = np.random.default_rng(seed)
    waves = []
    for _ in range(k):
        ang_dir = rng.uniform(0, 2 * np.pi)       # push direction
        ang_k = rng.uniform(0, 2 * np.pi)         # wavefront orientation
        lam = rng.uniform(lam_min_m, lam_max_m)   # wavelength (m)
        phase = rng.uniform(0, 2 * np.pi)
        weight = rng.uniform(0.5, 1.0)
        d = np.array([np.cos(ang_dir), np.sin(ang_dir)])
        kvec = np.array([np.cos(ang_k), np.sin(ang_k)]) * (2 * np.pi / lam)
        waves.append((d, kvec, phase, weight))
    return waves

def _field(pts, waves):
    """Raw (untapered, unit-ish) displacement vectors for Nx2 array `pts`,
    the weighted sum of the sinusoidal components, normalised so the peak
    magnitude is ~1. Vectorised over all points at once."""
    disp = np.zeros_like(pts, dtype=float)
    wsum = 0.0
    for d, kvec, phase, weight in waves:
        s = np.sin(pts @ kvec + phase)            # (N,)
        disp += weight * np.outer(s, d)           # (N,2)
        wsum += weight
    disp /= max(wsum, 1e-9)
    return disp

def _smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)

def _warp_fn(regionP_union, boundaryP, waves, amp_m, taper_m):
    """Build the point warp used for the whole region. taper(p) is per-POINT:
    0 outside the region union and on its boundary, ramping (smoothstep) to 1
    once you're `taper_m` inside. Because it's distance-to-boundary evaluated
    at each vertex, one country's extent tapers smoothly across itself, shared
    internal borders (far from the boundary) move fully and identically on both
    sides, and everything on the region's outer edge — coast, the border with
    the untouched exterior, the metric-window rim — is pinned, so the warped
    region stitches back onto the base with no seam."""
    prep = shapely.prepare(regionP_union) or regionP_union  # prepare() returns None
    def warp(coords):
        pts = np.asarray(coords, dtype=float)
        if pts.ndim != 2 or len(pts) == 0:
            return coords
        P = shapely.points(pts)
        inside = shapely.contains(regionP_union, P)
        dist = shapely.distance(P, boundaryP)
        taper = np.where(inside, _smoothstep(dist / taper_m), 0.0)
        disp = _field(pts, waves) * amp_m * taper[:, None]
        return pts + disp
    return warp

def _warp_geom(geomP, warp, step_m):
    """Densify (so straight borders bend) then apply `warp` to every vertex of a
    projected polygon/multipolygon, rebuilding valid geometry."""
    dens = shapely.segmentize(geomP, max_segment_length=step_m)
    out = []
    for poly in polys_of(dens):
        ext = warp(list(poly.exterior.coords))
        ints = [warp(list(r.coords)) for r in poly.interiors]
        try:
            p = Polygon(ext, ints)
            out.append(p if p.is_valid else make_valid(p).buffer(0))
        except Exception:
            out.append(make_valid(poly))
    return unary_union(out) if out else geomP

def distort(geoms, target_name, depth=DIST_PROP_DEPTH, radius_km=DIST_RADIUS_KM,
            amp_km=DIST_AMP_KM, taper_km=DIST_TAPER_KM, step_km=DIST_STEP_KM,
            waves_k=DIST_WAVES, lam_km=DIST_LAM_KM):
    """Distorted variant of a puzzle. Returns {country -> warped lon/lat geom}
    for every REGION country whose shape actually changed (absorbers, warped
    from their swallowed shape; plus surrounding non-absorber neighbours). The
    target is not a key. The ordinary swallow runs first and is unmodified."""
    # enforce the no-fold bound: a warp only stays gap/overlap-free while it
    # doesn't fold, i.e. 2*pi*amp/lambda_min < 1. Clamp amplitude if needed.
    amp_cap_km = lam_km[0] / (2 * np.pi) * 0.95
    amp_km = min(amp_km, amp_cap_km)

    radius_m, amp_m, taper_m, step_m = (radius_km * 1000, amp_km * 1000,
                                        taper_km * 1000, step_km * 1000)
    members, fwd, inv = _region_members(geoms, target_name, depth, radius_m)

    # post-swallow geometry for the region: absorbers take their swallowed
    # shape, everyone else their base shape. Force EVERY absorber into the
    # region even if the metric gate/BFS missed one (a nearest-country fallback
    # absorber can sit just outside): otherwise the target footprint isn't fully
    # covered and its old outline would resurface in the pinned boundary.
    expanded = swallow(geoms, target_name)
    members = list(set(members) | set(expanded))
    if not members:
        return {}
    region_geom = {n: expanded.get(n, geoms[n]) for n in members}

    # Everything past `work` (the window plus a couple of taper widths) has
    # taper 0 — distortion is the identity there — so it need not be projected,
    # unioned or warped. Excluding it is both an optimisation and a robustness
    # fix: a huge absorber (Russia's neighbours span ~4000 km and cross the
    # antimeridian) projects to far-flung, near-degenerate geometry that made the
    # region union throw a GEOS non-noded-intersection. We only ever touch the
    # near neighbourhood; the far remainder ships unchanged.
    window = shapely.Point(0, 0).buffer(radius_m)   # AEQD centres target at origin
    work = shapely.Point(0, 0).buffer(radius_m + 2 * taper_m)
    regionP = {n: make_valid(fwd(g)) for n, g in region_geom.items()}

    # Taper boundary from the near geometry only, snapped to a 1 m grid so the
    # union is noded (kills the non-noded-intersection crash) then clipped to the
    # window.
    near_clips = []
    for gP in regionP.values():
        c = make_valid(gP).intersection(work)
        if not c.is_empty:
            near_clips.append(set_precision(c, 1.0))
    try:
        unionP = unary_union(near_clips)
    except GEOSException:
        unionP = unary_union([g.buffer(0) for g in near_clips])
    unionP = make_valid(unionP.intersection(window))
    boundaryP = unionP.boundary

    waves = _seeded_waves(slug(target_name), waves_k, lam_km[0] * 1000, lam_km[1] * 1000)
    warp = _warp_fn(unionP, boundaryP, waves, amp_m, taper_m)

    out = {}
    for name, gP in regionP.items():
        inside = make_valid(gP).intersection(work)
        if inside.is_empty:
            # entirely beyond taper reach: warp is the identity here. Far
            # absorbers still must ship their swallowed shape (it differs from
            # base, and dropping it would reopen the target's footprint); far
            # non-absorbers are unchanged, so the client keeps their base.
            if name in expanded:
                out[name] = region_geom[name]
            continue
        outside = make_valid(gP).difference(work)
        warped_inside = _warp_geom(inside, warp, step_m)
        # skip non-absorber members the warp never actually moved (>1 m), so the
        # diff only carries genuinely changed features and untouched neighbours
        # keep their pristine base feature. Absorbers always changed via swallow.
        if name not in expanded and inside.hausdorff_distance(warped_inside) < 1.0:
            continue
        combinedP = warped_inside if outside.is_empty else unary_union([warped_inside, outside])
        out[name] = make_valid(inv(combinedP)).buffer(0)
    return out

def build_distorted_puzzles(geoms, codes, targets, **kw):
    """Emit the distorted variant diff for each target and register it in the
    puzzle index (diffDistorted). Requires out/puzzles.json + out/world.geojson
    to already exist (run an ordinary build first); does NOT rewrite them or the
    ordinary per-puzzle diffs."""
    os.makedirs(f"{OUT}/puzzles", exist_ok=True)
    idx_path = f"{OUT}/puzzles.json"
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    by_slug = {e["slug"]: e for e in index}

    for name in targets:
        if name not in geoms:
            print(f"  !! '{name}' not found, skipping")
            continue
        changed = distort(geoms, name, **kw)
        assert name not in changed, f"target {name!r} present in distorted output"
        s = slug(name)
        absorbers = sorted(changed)
        diff = {
            "target": name,
            "removed": name,
            "changed": [feature(a, codes.get(a, ""), changed[a]) for a in absorbers],
        }
        with open(f"{OUT}/puzzles/{s}-distorted.json", "w") as fh:
            json.dump(diff, fh, separators=(",", ":"), ensure_ascii=False)
        if s in by_slug:
            by_slug[s]["diffDistorted"] = f"puzzles/{s}-distorted.json"
        print(f"  ok  {name:16} region={len(changed):2} -> puzzles/{s}-distorted.json")

    with open(idx_path, "w") as fh:
        json.dump(index, fh, indent=2, ensure_ascii=False)
    print(f"patched diffDistorted in {idx_path}")

def cmd_build_distorted(geoms, codes, targets):
    if not targets:
        print("usage: build-distorted <country> [<country> ...]")
        return
    build_distorted_puzzles(geoms, codes, targets)

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
    elif cmd == "manifest":
        cmd_manifest(geoms, codes, int(sys.argv[2]) if len(sys.argv) > 2 else 1100)
    elif cmd == "build-distorted":
        cmd_build_distorted(geoms, codes, sys.argv[2:])
    else:
        print(__doc__)
