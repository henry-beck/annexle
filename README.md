# Missing Country — map generator

Generates the daily puzzles for the game: pick a country, delete it, and let its
neighbors "swallow" the empty space behind plausible fake borders. The outer
silhouette of the landmass never changes, so the map looks normal — you have to
know the political geography to spot what's gone.

## Setup

```bash
pip install shapely pyproj          # cairosvg + matplotlib only needed for previews
# one-time: fetch Natural Earth 50m admin-0 countries next to the script
curl -sL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson \
  -o ne_50m_admin0.geojson
```

## Commands

```bash
python missing_country.py candidates        # rank every country by puzzle quality
python missing_country.py adjacency         # dump the full neighbor graph + areas
python missing_country.py build-auto 30     # auto-pick 30 clean puzzles -> out/
python missing_country.py build "Nepal" "Bolivia" "Laos"   # build specific ones
python missing_country.py build-daily        # build today's deterministic puzzle
```

## What it outputs (in `out/`)

Architecture B: the pipeline emits **GeoJSON** for a D3 client to render live
(flat projection now, `geoOrthographic` globe later — a projection swap, not a
rewrite). Output geometry is lon/lat, so it's projection-independent.

- **`countries.json`** — every guessable country with a real centroid
  `{ name, code, lat, lng }`. Replaces the hardcoded `COUNTRIES` array and
  drives the distance/direction math for *any* guess.
- **`world.geojson`** — the shared base map: every country, unmodified, one
  `Feature` each with `properties: { name, code }`. Loaded **once** and cached
  across all puzzles.
- **`puzzles.json`** — ordered puzzle index
  `{ id, slug, target, targetCode, neighbors, absorbers, enclosure, diff }`.
- **`puzzles/<slug>.json`** — the small per-puzzle **diff** against the base:
  `{ target, removed, changed: [ Feature, … ] }`. `removed` is the target
  feature to delete; `changed` are the absorbing countries whose geometry grew.
  Absorbed territory carries the **absorbing** country's name; the target's name
  appears on no feature.

## Wiring into the React client (D3)

1. **Countries** — replace the inline `COUNTRIES` array with `countries.json`.
2. **Puzzles** — replace `PUZZLES` with `puzzles.json`.
3. **The map** — load `world.geojson` once; per puzzle, fetch its `diff`, delete
   the `removed` feature, replace each `changed` feature by name, and render the
   resulting `FeatureCollection` with `d3.geoPath`. Uniform fill/stroke on every
   country (so absorbers are indistinguishable — the puzzle); country name on
   hover from `feature.properties.name`. Switching `d3.geoNaturalEarth1()` →
   `d3.geoOrthographic()` turns the flat map into a rotatable globe on the same
   data.

For a fixed launch order, index into the eligible pool by *days since a launch
epoch* (see `puzzle_selector.pick_for_date`) so puzzle N always lands on a known
date.

## How the "swallow" works

Each puzzle's target is first split into its disconnected landmass **pieces**.
Each piece is swallowed independently, in a local azimuthal-equidistant frame
centered on *that piece*: the piece is partitioned by a Voronoi diagram built
from densified boundary points of the countries that border **that piece**
(nearest-country fallback if none border it), and each slice is merged into the
bordering country. Far-flung territory therefore routes to *local* absorbers
(French Guiana → Suriname/Brazil, not France's European neighbors), and no
single projection ever spans a target's extremes. Only *internal* borders are
redrawn; the coastline and outer shape are untouched.

## Choosing puzzles / difficulty

`candidates` reports an **enclosure** score = fraction of the target's border
shared with land neighbors:

- **1.0** — fully landlocked/enclosed → cleanest swallow (Nepal, Bolivia, Czechia,
  Zambia, Afghanistan, Mongolia…). Start here.
- **0.9–1.0** — landlocked, still clean.
- **< 0.9** — coastal. The swallow gets ambiguous (does a neighbor cross the coast,
  or the sea?) and often looks faked. `build-auto` skips these.

`build-auto` also deprioritizes single-neighbor countries, whose resulting shape
is a dead giveaway. Fully-enclosed one-neighbor cases (Lesotho, San Marino) are
the exception — the hole just fills solid and they're clean, if easy.

## Known refinements for later

- `countries.json` includes some dependencies/territories from Natural Earth
  (Greenland, Falklands, etc.). Filter to sovereign states if you want a tighter
  guess pool — the `TYPE`/`SOVEREIGNT` fields in the source support this.
- Fake borders occasionally throw a small sliver; a light `simplify()` pass on the
  merged neighbor geometry cleans it up if you spot one.
- Switch the source to `ne_10m` for higher border detail (bigger files).
