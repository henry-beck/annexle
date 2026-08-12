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
python missing_country.py build-auto 30     # auto-pick 30 clean puzzles -> out/
python missing_country.py build "Nepal" "Bolivia" "Laos"   # build specific ones
python missing_country.py preview "Nepal"   # write a PNG to eyeball the result
```

## What it outputs (in `out/`)

- **`countries.json`** — every guessable country with a real centroid
  `{ name, code, lat, lng }`. This replaces the hardcoded `COUNTRIES` array in
  your demo and drives the distance/direction math for *any* guess.
- **`puzzles.json`** — ordered puzzle list
  `{ id, slug, target, targetCode, neighbors, enclosure, viewBox, map }`.
- **`maps/<slug>.svg`** — one map per puzzle, the target already swallowed.

## Wiring into the React demo

Three swaps:

1. **Countries** — replace the inline `COUNTRIES` array with `countries.json`
   (the centroids are exact now, so distances/bearings are correct).
2. **Puzzles** — replace `PUZZLES` with `puzzles.json`.
3. **The map** — drop the SVG into your map placeholder. Fetch it and inject:

   ```jsx
   const [svg, setSvg] = useState("");
   useEffect(() => {
     fetch(`/${puzzle.map}`).then(r => r.text()).then(setSvg);
   }, [puzzle.map]);
   // ...
   <div className="..." dangerouslySetInnerHTML={{ __html: svg }} />
   ```

Your daily selection (`Math.floor(Date.now()/8.64e7) % PUZZLES.length`) is already
deterministic and UTC-day based, so everyone sees the same puzzle each day. For a
fixed launch order, index into `puzzles.json` by *days since a launch epoch*
instead of modulo, so puzzle N always lands on a known date.

## Theming

`render_svg(..., style=...)` takes `{land, stroke, sea, stroke_w}`. Example dark
theme matching your `slate-950` UI is in `example_dark_switzerland.svg`:

```python
dark = {"land": "#334155", "stroke": "#0f172a", "sea": "#1e293b", "stroke_w": 1.3}
```

## How the "swallow" works

For a puzzle, everything is reprojected to a local azimuthal-equidistant frame
centered on the target (so distances/areas are locally accurate). The target's
polygon is partitioned by a Voronoi diagram built from densified neighbor
boundary points — every point in the gap is assigned to the nearest neighbor —
and each slice is merged into that neighbor. Only *internal* borders are redrawn;
the coastline and outer shape are untouched.

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
