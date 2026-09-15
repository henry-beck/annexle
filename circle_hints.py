"""Shrinking-circle guess-hint sequences.

Pre-baked per puzzle: a deterministic sequence of 6 geodesic circles (small-
circles on the sphere), one revealed per attempt, that narrow the search toward
the target. The circle CENTER is offset from the true centroid — far early,
converging to 0 by the final reveal — so a player can't shortcut by reading the
center until the end. The offset is a fraction (<1) of the radius, so the target
is strictly inside every circle BY CONSTRUCTION (margin = (1-f)*radius).

Pure stdlib on purpose: circles depend only on the target centroid, the puzzle
slug (deterministic seed, same sha256 discipline as the organic seams), and a
fixed curve — none of the GEOS/numpy stack. Same spherical model as d3.geoCircle
on the client, so build-time verification matches what renders.

Each circle is emitted as [lng, lat, radiusDeg] — exactly d3's
geoCircle().center([lng,lat]).radius(radiusDeg).
"""
import hashlib, math, json, sys

N = 6
R_MAX, R_MIN = 22.0, 4.0                                  # angular radius, degrees
_ratio = (R_MIN / R_MAX) ** (1 / (N - 1))                 # geometric decay
RADII = [round(R_MAX * _ratio ** i, 4) for i in range(N)]  # 22 -> 4 over 6 reveals
OFFSET_FRAC = [0.75, 0.60, 0.45, 0.30, 0.15, 0.0]          # offset / radius, linear -> 0
MARGIN_EPS = 0.05                                          # deg slack for the strict-inside assert

def _bearing(slug, i):
    h = hashlib.sha256(f"{slug}:circle:{i}".encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64 * 360.0

def _dest(lat, lng, brg, dist_deg):
    """Spherical destination point: from (lat,lng) along bearing `brg` for an
    angular distance of `dist_deg` degrees."""
    la1, lo1, th, d = map(math.radians, (lat, lng, brg, dist_deg))
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(th))
    lo2 = lo1 + math.atan2(math.sin(th) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return round(math.degrees(la2), 4), round((math.degrees(lo2) + 540) % 360 - 180, 4)

def _central_angle(a_lat, a_lng, b_lat, b_lng):
    la1, lo1, la2, lo2 = map(math.radians, (a_lat, a_lng, b_lat, b_lng))
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2)
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(h))))

def build_sequence(slug, lat, lng):
    """The 6 circles [[lng, lat, radiusDeg], ...] for a target centroid."""
    out = []
    for i in range(N):
        r = RADII[i]
        clat, clng = _dest(lat, lng, _bearing(slug, i), OFFSET_FRAC[i] * r)
        out.append([clng, clat, r])
    return out

def verify(seq, lat, lng):
    """Non-negotiable invariant: the centroid is STRICTLY inside every circle."""
    return all(_central_angle(clat, clng, lat, lng) < r - MARGIN_EPS
               for clng, clat, r in seq)

def patch_index(puzzles_path, countries_path):
    """Add a `circles` field to every entry in puzzles.json, verifying each.
    Aborts (nonzero) if any puzzle fails the strict-inside invariant."""
    puzzles = json.load(open(puzzles_path))
    centroids = {c["name"]: c for c in json.load(open(countries_path))}
    failures = []
    for e in puzzles:
        c = centroids.get(e["target"])
        if not c:
            failures.append((e["slug"], "no centroid"))
            continue
        seq = build_sequence(e["slug"], c["lat"], c["lng"])
        if not verify(seq, c["lat"], c["lng"]):
            failures.append((e["slug"], "verify failed"))
        e["circles"] = seq
    if failures:
        print(f"CIRCLE VERIFICATION FAILED for {len(failures)} puzzle(s): {failures[:10]}")
        sys.exit(1)
    with open(puzzles_path, "w") as fh:
        json.dump(puzzles, fh, indent=2, ensure_ascii=False)
    print(f"circles: patched + verified {len(puzzles)} puzzles "
          f"(radii {RADII[0]}°..{RADII[-1]}°) -> {puzzles_path}")

if __name__ == "__main__":
    patch_index(sys.argv[1], sys.argv[2])
