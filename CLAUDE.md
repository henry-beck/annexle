# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Concept

Missing Country is a daily geography puzzle game (Wordle-style). Each puzzle
erases one country from the map and "swallows" its territory into its
neighbors behind plausible fake borders — the outer coastline/landmass
silhouette never changes, so the map still looks normal. The player has to
know political geography to spot which country is gone, guessing repeatedly
(guesses get distance-km and compass-bearing feedback toward the real
answer, like Wordle's proximity hints) within `MAX_GUESSES`.

The repo has two halves that are not yet wired together:

- `missing_country.py` — a Python geometry pipeline that generates puzzle
  data and map art from real country borders.
- `missing-country-game.jsx` — a React prototype UI that currently runs on
  small hardcoded `COUNTRIES`/`PUZZLES` arrays (a handful of countries) with
  a placeholder in place of real map art.

Wiring them together (per README.md) means: replace the hardcoded
`COUNTRIES` array with generated `countries.json`, replace `PUZZLES` with
generated `puzzles.json`, and fetch+inject each puzzle's SVG
(`dangerouslySetInnerHTML`) into the map placeholder.

## Commands

```bash
# setup (one-time)
pip install shapely pyproj          # cairosvg + matplotlib only needed for `preview`
curl -sL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson \
  -o ne_50m_admin0.geojson

# pipeline
python missing_country.py candidates        # rank every country by puzzle quality (enclosure score)
python missing_country.py build-auto 30     # auto-pick 30 clean puzzles -> out/
python missing_country.py build "Nepal" "Bolivia" "Laos"   # build specific puzzles
python missing_country.py preview "Nepal"   # write a PNG to eyeball a puzzle (needs matplotlib)
```

There is no build/lint/test tooling in this repo (no package.json, no test
suite) — `missing_country.py` is invoked directly, and the `.jsx` file is a
standalone prototype component (Tailwind classes, no build config present).

## Pipeline architecture (`missing_country.py`)

Input is Natural Earth's 50m admin-0 countries GeoJSON (`ne_50m_admin0.geojson`,
fetched locally, not committed). `load()` reads it into `{name: shapely geometry}`
and `{name: ISO code}` dicts keyed by country name (`ADMIN`/`ADM0_A3` fields).

Per-puzzle flow (`build_puzzles` → `swallow` → `render_svg`):

1. **`find_neighbors`** — land-adjacency by buffered intersection + shared
   boundary length (catches near-touching borders/river gaps).
2. **`enclosure`** — fraction of the target's border shared with land
   neighbors. `1.0` = fully landlocked (cleanest swallow, e.g. Nepal,
   Bolivia, Czechia); `<0.9` = coastal, gets skipped by `build-auto` since
   the swallow becomes ambiguous (does a neighbor cross the coast, or the
   sea?).
3. **`swallow`** — the core trick. Everything is reprojected into a local
   azimuthal-equidistant frame centered on the target (via `local_proj`, so
   distances/areas are locally accurate). The target polygon is partitioned
   by a Voronoi diagram (`voronoi_diagram`) built from densified neighbor
   boundary points; every point in the gap is assigned to its nearest
   neighbor via `STRtree`, and each slice is merged into that neighbor's
   geometry. Only internal borders move — the outer coastline/silhouette is
   untouched.
4. **`render_svg`** — draws the region with **uniform styling** on purpose
   (same fill/stroke for every country) so expanded neighbors can't be
   visually distinguished from their original shape — that's the whole
   puzzle. Clips to a viewport around the target (which also drops
   far-flung overseas territories like French Guiana under France).
   `style={land, stroke, sea, stroke_w}` is overridable for theming (see
   `example_dark_switzerland.svg` for a dark-theme sample matching a
   `slate-950` UI).

`build_puzzles` writes `out/puzzles.json` (ordered puzzle list: `id`, `slug`,
`target`, `targetCode`, `neighbors`, `enclosure`, `viewBox`, `map`) and
`out/countries.json` (every guessable country's real centroid — via
`main_centroid`, representative point of the *largest* polygon of a country
to avoid overseas territories skewing it — as `{name, code, lat, lng}`),
plus `out/maps/<slug>.svg` per puzzle. `cmd_build_auto` selects targets by
sorting on enclosure ≥ 0.9 and preferring 2+ neighbors (single-neighbor
countries are a dead giveaway, except fully-enclosed ones like Lesotho/San
Marino, which stay clean).

Note: root-level `countries.json` / `puzzles.json` in this repo are sample
outputs of a prior pipeline run, not `out/` (which is gitignored/generated).

## Game UI architecture (`missing-country-game.jsx`)

Single-file React component (`MissingCountryGame`), Tailwind for styling,
no external geo library — all distance/bearing math is inline:

- `haversine(a, b)` — great-circle distance in km between two `{lat,lng}`.
- `bearing(a, b)` — initial compass bearing a→b in degrees, rendered as a
  rotated arrow emoji (`arrowEmoji`) and used for the directional hint.
- `proximityPct(distKm)` — turns distance into a 0–100% "hot/cold" score
  against `MAX_DIST` (20000 km).

State: `puzzleIdx` picks the day's puzzle deterministically —
`Math.floor(Date.now()/8.64e7) % PUZZLES.length` (UTC-day based, same
puzzle for everyone globally that day). Per README, switching to indexing
by *days since a launch epoch* (instead of modulo) keeps puzzle N pinned to
a fixed date once real puzzles are wired in. `guesses` accumulates
`{name, dist, bng, pct}` per submitted guess; win/lose state derives from
whether the target is among them or `MAX_GUESSES` (6) is reached. A
Wordle-style emoji share string is built by `shareText()` (🟩/⬜ blocks +
directional arrows per guess, 🎯 on the correct one) and copied via
`navigator.clipboard`.

The map area is currently a placeholder `div` with pulsing "?" — the
integration point noted in README.md is to `fetch` the puzzle's `map` SVG
path and inject it via `dangerouslySetInnerHTML` once `puzzles.json` is
wired in.

## Known refinements (from README)

- `countries.json` includes some Natural Earth dependencies/territories
  (Greenland, Falklands, etc.) — filter by `TYPE`/`SOVEREIGNT` for a
  sovereign-states-only guess pool if needed.
- Fake borders can occasionally throw a small sliver; a light `simplify()`
  pass on merged neighbor geometry cleans it up.
- Swap `DATA` to `ne_10m_admin_0_countries.geojson` for higher border detail
  (bigger files) if the 50m data looks too blocky at high zoom.
