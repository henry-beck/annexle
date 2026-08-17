import { useEffect, useState } from "react";

const DATA_ROOT = import.meta.env.BASE_URL + "data";

// Resolve the deterministic daily puzzle for a date by array-indexing the
// precomputed manifest (entries[i] = the puzzle for launchDate + i days, from
// Python's pick_for_date). No shuffle logic lives in the client.
//
// Testing overrides (query string):
//   ?date=YYYY-MM-DD  resolve that date instead of today
//   ?slug=<slug>      force a specific puzzle (target taken from countries.json
//                     if the slug matches a country, else from the manifest)
// Only the switzerland/haiti diffs are committed, so on a fresh clone "today"
// usually points at a slug whose diff isn't synced — the map component surfaces
// that; use ?date=2026-02-15 (switzerland) or ?date=2026-04-10 (haiti) to
// exercise the real manifest path with committed data.
function utcMidnight(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function useDailyPuzzle() {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${DATA_ROOT}/manifest.json`).then((r) => {
        if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`${DATA_ROOT}/countries.json`).then((r) => {
        if (!r.ok) throw new Error(`countries.json: HTTP ${r.status}`);
        return r.json();
      }),
    ])
      .then(([manifest, countries]) => {
        if (cancelled) return;
        const byName = new Map(countries.map((c) => [c.name, c]));
        const params = new URLSearchParams(window.location.search);

        // resolve the date (today UTC, or ?date= override)
        const dateStr = params.get("date");
        const when = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
        const launch = new Date(`${manifest.launchDate}T00:00:00Z`);
        const dayIndex = Math.floor(
          (utcMidnight(when) - utcMidnight(launch)) / 86400000
        );

        let slug, target;
        const slugOverride = params.get("slug");
        if (slugOverride) {
          slug = slugOverride;
          const hit = manifest.entries.find((e) => e.slug === slugOverride);
          target = hit ? hit.target : null;
        } else if (dayIndex < 0) {
          return setState({ status: "before-launch", launch: manifest.launchDate });
        } else if (dayIndex >= manifest.entries.length) {
          return setState({ status: "past-horizon", days: manifest.entries.length });
        } else {
          ({ slug, target } = manifest.entries[dayIndex]);
        }

        setState({
          status: "ready",
          slug,
          target,
          dayIndex: slugOverride ? null : dayIndex,
          date: dateStr || new Date().toISOString().slice(0, 10),
          targetCentroid: target ? byName.get(target) || null : null,
          countries,
        });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", error });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
