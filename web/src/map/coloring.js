// Distinct-country map coloring for the dev preview.
//
// Reads adjacency straight off the RENDERED geometry (the world base with a
// puzzle's organic diff applied) rather than the real-world neighbour graph:
// after a swallow the absorbers meet each other along the organic seams and
// inherit the vanished target's borders, and those are exactly the adjacencies
// a distinct coloring has to separate to look intentional. The pipeline snaps
// every shared border to identical quantized vertices, so two features that
// share a border also share the SAME edge (an ordered pair of vertices) — which
// makes adjacency exact and cheap to detect (verified against find_neighbors
// with zero missed neighbours). Point-only touches (tripoints / four-corners)
// are deliberately NOT treated as adjacency: only a shared segment counts, the
// standard map-coloring convention.

function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

// key an undirected edge by its two endpoints (order-independent), rounded to
// the pipeline's ~1e-4 grid so shared borders collide exactly.
function edgeKey(a, b) {
  const pa = `${a[0].toFixed(4)},${a[1].toFixed(4)}`;
  const pb = `${b[0].toFixed(4)},${b[1].toFixed(4)}`;
  return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
}

// { name -> Set(neighbourName) } from shared border segments.
export function buildAdjacency(featureCollection) {
  const owners = new Map(); // edgeKey -> Set(name)
  for (const f of featureCollection.features) {
    const name = f.properties?.name;
    if (!name) continue;
    for (const ring of ringsOf(f.geometry)) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i], b = ring[i + 1];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const k = edgeKey(a, b);
        let s = owners.get(k);
        if (!s) owners.set(k, (s = new Set()));
        s.add(name);
      }
    }
  }
  const adj = new Map();
  const link = (x, y) => {
    if (!adj.has(x)) adj.set(x, new Set());
    adj.get(x).add(y);
  };
  for (const set of owners.values()) {
    if (set.size < 2) continue;
    const names = [...set];
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        link(names[i], names[j]);
        link(names[j], names[i]);
      }
  }
  return adj;
}

// Welsh–Powell greedy coloring: countries ordered by descending degree get the
// lowest color index no already-colored neighbour uses. Deterministic tie-break
// (degree desc, then name) keeps colors stable across renders. Returns
// { name -> colorIndex } plus the number of colors used.
export function colorGraph(featureCollection, adjacency) {
  const names = featureCollection.features
    .map((f) => f.properties?.name)
    .filter(Boolean);
  const order = [...new Set(names)].sort((a, b) => {
    const da = adjacency.get(a)?.size || 0;
    const db = adjacency.get(b)?.size || 0;
    return db - da || (a < b ? -1 : a > b ? 1 : 0);
  });
  const color = new Map();
  let used = 0;
  for (const name of order) {
    const taken = new Set();
    for (const nb of adjacency.get(name) || []) {
      if (color.has(nb)) taken.add(color.get(nb));
    }
    let c = 0;
    while (taken.has(c)) c++;
    color.set(name, c);
    used = Math.max(used, c + 1);
  }
  return { color, used };
}

// Okabe–Ito is the established 8-hue colorblind-safe categorical set; its black
// is swapped for a mid grey so every hue reads as a map fill. The normal set is
// a Tableau-style categorical palette. Both are long enough that planar maps
// (4–6 colors under greedy) never exhaust them; if a graph somehow needs more,
// colorFor falls back to distinct golden-angle HSL so the coloring stays proper.
export const PALETTES = {
  okabe: {
    label: "Colorblind",
    colors: ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#999999"],
  },
  normal: {
    label: "Normal",
    colors: ["#4E79A7", "#F28E2B", "#59A14F", "#E15759", "#B07AA1", "#EDC948", "#76B7B2", "#FF9DA7", "#9C755F", "#BAB0AC"],
  },
};

export function colorFor(index, paletteKey) {
  const pal = PALETTES[paletteKey] || PALETTES.okabe;
  if (index < pal.colors.length) return pal.colors[index];
  const hue = (index * 137.508) % 360; // golden angle -> distinct extra hues
  return `hsl(${hue.toFixed(1)}, 62%, 60%)`;
}

// Convenience: FeatureCollection -> { name -> hex } for a given palette.
export function colorMapFor(featureCollection, paletteKey) {
  const adjacency = buildAdjacency(featureCollection);
  const { color, used } = colorGraph(featureCollection, adjacency);
  const map = new Map();
  for (const [name, idx] of color) map.set(name, colorFor(idx, paletteKey));
  return { map, used };
}
