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

// Returns { fc, loading, error } for the swallowed world of a given puzzle slug.
export function useSwallowedWorld(slug) {
  const [state, setState] = useState({ fc: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ fc: null, loading: true, error: null });

    Promise.all([
      loadBase(),
      fetch(`${DATA_ROOT}/puzzles/${slug}.json`).then((r) => {
        if (!r.ok) throw new Error(`${slug}.json: HTTP ${r.status}`);
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
  }, [slug]);

  return state;
}
