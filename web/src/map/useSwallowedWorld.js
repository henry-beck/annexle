import { useEffect, useState } from "react";

// Base world map (every country, unmodified) is fetched once and cached across
// every puzzle — this is the whole point of the shared-base + per-puzzle-diff
// output format. Per puzzle we fetch only the small diff and apply it.
const DATA_ROOT = import.meta.env.BASE_URL + "data";

let _basePromise = null;
function loadBase() {
  if (!_basePromise) {
    _basePromise = fetch(`${DATA_ROOT}/world.geojson`).then((r) => {
      if (!r.ok) throw new Error(`world.geojson: HTTP ${r.status}`);
      return r.json();
    });
  }
  return _basePromise;
}

// Apply a puzzle diff to the base: delete the removed target, replace each
// changed absorber feature by name. Absorbed territory already carries the
// absorbing country's name in the diff, so the target's name is gone entirely.
export function applyDiff(base, diff) {
  const byName = new Map(base.features.map((f) => [f.properties.name, f]));
  byName.delete(diff.removed);
  for (const f of diff.changed) byName.set(f.properties.name, f);
  return { type: "FeatureCollection", features: [...byName.values()] };
}

// Returns { fc, loading, error } for the swallowed world of a puzzle.
//
// By default a slug maps to exactly one diff at `puzzles/<slug>.json` (the
// current per-piece swallow). `diffUrl` overrides that, which is the seam for
// puzzle GEOMETRY VARIANTS: later each puzzle will also have a distorted-mode
// diff, and comparing the current swallow vs. the distorted version is just two
// calls with two diff URLs for the same slug — no assumption that a slug owns a
// single diff file is baked in here.
export function useSwallowedWorld(slug, diffUrl) {
  const [state, setState] = useState({ fc: null, loading: true, error: null });

  const url = diffUrl || `${DATA_ROOT}/puzzles/${slug}.json`;
  useEffect(() => {
    let cancelled = false;
    setState({ fc: null, loading: true, error: null });

    Promise.all([
      loadBase(),
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url.split("/").pop()}: HTTP ${r.status}`);
        return r.json();
      }),
    ])
      .then(([base, diff]) => {
        if (cancelled) return;
        setState({ fc: applyDiff(base, diff), loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ fc: null, loading: false, error });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
