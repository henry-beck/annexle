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
python missing_country.py adjacency         # dump full neighbor graph + areas -> out/adjacency.json
python missing_country.py build-auto 30     # auto-pick 30 clean puzzles -> out/
python missing_country.py build "Nepal" "Bolivia" "Laos"   # build specific puzzles
python missing_country.py build-daily        # build today's deterministic puzzle
```

There is no build/lint/test tooling in this repo (no package.json, no test
suite) — `missing_country.py` is invoked directly, and the `.jsx` file is a
standalone prototype component (Tailwind classes, no build config present).

## Pipeline architecture (`missing_country.py`)

Input is Natural Earth's 50m admin-0 countries GeoJSON (`ne_50m_admin0.geojson`,
fetched locally, not committed). `load()` reads it into `{name: shapely geometry}`
and `{name: ISO code}` dicts keyed by country name (`ADMIN`/`ADM0_A3` fields).

**Architecture B**: the pipeline emits **GeoJSON** (a shared world base + a small
per-puzzle diff) for a D3 client to render live; it does *not* pre-render images.
Output geometry is lon/lat (projection-independent), so the client renders flat
now and a `geoOrthographic` globe later from the same data.

Per-puzzle flow (`build_puzzles` → `swallow` → GeoJSON diff):

1. **`find_neighbors`** — land-adjacency by buffered intersection + shared
   boundary length (catches near-touching borders/river gaps).
2. **`enclosure`** — fraction of the target's border shared with land
   neighbors. `1.0` = fully landlocked; low = coastal. Now a difficulty
   *label* carried on each puzzle, no longer an eligibility gate.
3. **`split_pieces`** — splits the target into disconnected landmass pieces
   by single-linkage clustering polygons within ~150 km (tight archipelagos
   collapse into one piece; true exclaves like French Guiana stay separate).
4. **`swallow`** — the core trick, run **per piece**. For each piece the
   candidate absorbers are the countries that border *that piece*
   (`piece_borderers`, over all countries — not the target's global neighbor
   set), with a nearest-country fallback (`nearest_country`, with a
   sibling-piece tie-break) if none border it. The piece is partitioned by a
   Voronoi diagram (`_voronoi_slices`) in a projection centered on *that
   piece*, and each slice is inverse-projected to lon/lat and merged into the
   bordering country. Returns `{country → new lon/lat geometry}` for changed
   countries only; the target's name is never a key. Per-piece scoping is what
   routes far-flung territory locally (French Guiana → Suriname/Brazil) and
   fixes the cross-ocean crashes (Canada/France/US/Peru) the old whole-target
   single-projection swallow hit.

`build_puzzles` writes: `out/world.geojson` (shared base — every country
unmodified, `properties:{name,code}`, coordinates rounded via `round_coords` so
diff features stay border-aligned with the base); `out/puzzles/<slug>.json` per
puzzle (`{target, removed, changed:[Feature…]}` — delete `removed`, replace
`changed` by name); `out/puzzles.json` (ordered index: `id`, `slug`, `target`,
`targetCode`, `neighbors`, `absorbers`, `enclosure`, `diff`); and
`out/countries.json` (every guessable country's centroid via `main_centroid`,
representative point of the *largest* polygon, as `{name, code, lat, lng}`).
`cmd_build_auto` draws from `eligible_pool` (puzzle_selector's ≥1-real-neighbor
rule) ordered by enclosure descending.

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

The map area is currently a placeholder `div` with pulsing "?" — not yet
wired to the pipeline. Under architecture B the integration point is a D3
component (not SVG injection): load `out/world.geojson` once, apply the
puzzle's `out/puzzles/<slug>.json` diff (delete `removed`, replace `changed`
by name), and render the resulting FeatureCollection with `d3.geoPath`
(uniform fill, hover name from `feature.properties.name`). See README.md
"Wiring into the React client (D3)".

## Known refinements (from README)

- `countries.json` includes some Natural Earth dependencies/territories
  (Greenland, Falklands, etc.) — filter by `TYPE`/`SOVEREIGNT` for a
  sovereign-states-only guess pool if needed.
- Fake borders can occasionally throw a small sliver; a light `simplify()`
  pass on merged neighbor geometry cleans it up.
- Swap `DATA` to `ne_10m_admin_0_countries.geojson` for higher border detail
  (bigger files) if the 50m data looks too blocky at high zoom.
