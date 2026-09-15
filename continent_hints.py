"""Continent labels for the first guess-hint reveal.

Reveal 1 shows ONLY the target's continent as text — no circle, no map shading.
The continent is Natural Earth's CONTINENT field, carried on each country (in
countries.json) and each puzzle (in puzzles.json). Standalone + pure-stdlib
(only the geojson properties, none of the GEOS stack), so it can patch an
already-emitted index the same way circle_hints does, and the pipeline reuses
load_continents() rather than growing a second parse path.

Note on transcontinental targets (Türkiye, Kazakhstan, Egypt, the South
Caucasus, Cyprus, Panama): we take Natural Earth's default CONTINENT
classification as-is. Russia is handled separately by the client (a hardcoded
"It's literally Russia" reveal), so its label here is never shown.
"""
import json, sys

CONTINENT_FIELD = "CONTINENT"

def load_continents(data_path, name_field="ADMIN", rename=None):
    """{display name -> Natural Earth CONTINENT} from the admin-0 geojson. Applies
    the same RENAME the pipeline's load() does so keys match every other artifact."""
    rename = rename or {}
    data = json.load(open(data_path))
    out = {}
    for f in data["features"]:
        p = f["properties"]
        name = rename.get(p[name_field], p[name_field])
        out[name] = p.get(CONTINENT_FIELD, "")
    return out

def patch_index(puzzles_path, countries_path, data_path, name_field="ADMIN", rename=None):
    """Add a `continent` field to every countries.json + puzzles.json entry.
    Aborts (nonzero) if any entry has no continent in the source."""
    conts = load_continents(data_path, name_field, rename)
    countries = json.load(open(countries_path))
    puzzles = json.load(open(puzzles_path))
    missing = set()
    for c in countries:
        cont = conts.get(c["name"])
        if cont is None:
            missing.add(c["name"])
            continue
        c["continent"] = cont
    for e in puzzles:
        cont = conts.get(e["target"])
        if cont is None:
            missing.add(e["target"])
            continue
        e["continent"] = cont
    if missing:
        print(f"CONTINENT: no data for {len(missing)} entries: {sorted(missing)[:10]}")
        sys.exit(1)
    with open(countries_path, "w") as fh:
        json.dump(countries, fh, indent=2, ensure_ascii=False)
    with open(puzzles_path, "w") as fh:
        json.dump(puzzles, fh, indent=2, ensure_ascii=False)
    print(f"continents: patched {len(countries)} countries + {len(puzzles)} puzzles")

if __name__ == "__main__":
    # argv: <puzzles.json> <countries.json> <geojson>
    patch_index(sys.argv[1], sys.argv[2], sys.argv[3])
