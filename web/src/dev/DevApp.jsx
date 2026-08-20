import { useEffect, useMemo, useState } from "react";
import MissingCountryMap from "../map/MissingCountryMap.jsx";
import GuessPanel from "../game/GuessPanel.jsx";
import { createStorage } from "../game/storage.js";
import { listVariants } from "./variants.js";

// DEV-ONLY QC/polish surface. This module is loaded via a dynamic import that
// only runs when import.meta.env.DEV is true (see App.jsx), so it is dead code
// in a production build and never emitted into any chunk.
//
// It lists all puzzles and lets you jump straight to any one — bypassing the
// daily date lock, the manifest, and LAUNCH_DATE entirely — to eyeball the map
// and exercise the guess UI. All play here is namespaced under
// "missing-country:dev:*" so it can NEVER read or write real daily-play data.
const DATA_ROOT = import.meta.env.BASE_URL + "data";

// One isolated store for the whole dev surface, created once.
const DEV_NS = "missing-country:dev";
const devStorage = createStorage(DEV_NS);

function clearDevData() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`${DEV_NS}:`)) localStorage.removeItem(key);
  }
}

export default function DevApp() {
  const [data, setData] = useState({ status: "loading" });
  const [slug, setSlug] = useState(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("flat"); // "flat" | "globe"
  const [variantKey, setVariantKey] = useState("swallow");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${DATA_ROOT}/puzzles.json`).then((r) => {
        if (!r.ok) throw new Error(`puzzles.json: HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`${DATA_ROOT}/countries.json`).then((r) => {
        if (!r.ok) throw new Error(`countries.json: HTTP ${r.status}`);
        return r.json();
      }),
    ])
      .then(([puzzles, countries]) => {
        if (cancelled) return;
        setData({ status: "ready", puzzles, countries });
      })
      .catch((error) => {
        if (!cancelled) setData({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const puzzles = data.status === "ready" ? data.puzzles : [];
  const countries = data.status === "ready" ? data.countries : [];
  const byName = useMemo(() => new Map(countries.map((c) => [c.name, c])), [countries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return puzzles;
    return puzzles.filter((p) => p.target.toLowerCase().includes(q));
  }, [puzzles, query]);

  const entry = useMemo(() => puzzles.find((p) => p.slug === slug) || null, [puzzles, slug]);
  const variants = useMemo(() => (entry ? listVariants(entry) : []), [entry]);
  const variant = variants.find((v) => v.key === variantKey) || variants[0] || null;
  const globe = view === "globe";

  if (data.status === "loading") return <Shell><Muted>Loading dev index…</Muted></Shell>;
  if (data.status === "error")
    return (
      <Shell>
        <Muted>
          Couldn’t load <code>puzzles.json</code>: {String(data.error?.message || data.error)}.
          <br />
          Dev mode needs the full generated data — run <code>npm run sync-data</code> first
          (only the two demo diffs are committed).
        </Muted>
      </Shell>
    );

  return (
    <Shell>
      {/* Sidebar: searchable list of all puzzles by target name. */}
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: 13 }}>Puzzles ({puzzles.length})</strong>
          <button onClick={clearDevData} title="Wipe all missing-country:dev:* keys" style={miniBtn}>
            reset dev data
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by country…"
          style={{
            padding: "7px 9px",
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#e2e8f0",
            fontSize: 13,
            outline: "none",
          }}
        />
        <div
          style={{
            overflowY: "auto",
            maxHeight: 560,
            border: "1px solid #1e293b",
            borderRadius: 8,
          }}
        >
          {filtered.map((p) => {
            const active = p.slug === slug;
            return (
              <button
                key={p.slug}
                onClick={() => {
                  setSlug(p.slug);
                  setVariantKey("swallow");
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 10px",
                  border: "none",
                  borderBottom: "1px solid #111827",
                  background: active ? "#334155" : "transparent",
                  color: active ? "#f8fafc" : "#cbd5e1",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {p.target}
              </button>
            );
          })}
          {filtered.length === 0 && <Muted style={{ padding: 10 }}>No match.</Muted>}
        </div>
      </div>

      {/* Detail: map + guess UI for the picked puzzle, isolated storage. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!entry ? (
          <Muted>Pick a puzzle to load its map and guess UI.</Muted>
        ) : (
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Toggle
                  options={[["flat", "2D"], ["globe", "Globe"]]}
                  value={view}
                  onChange={setView}
                />
                {/* Variant toggle: hidden while a puzzle has only one variant,
                    appears automatically once a distorted diff is added. */}
                {variants.length > 1 && (
                  <Toggle
                    options={variants.map((v) => [v.key, v.label])}
                    value={variant?.key}
                    onChange={setVariantKey}
                  />
                )}
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  {entry.target} · {variant?.label}
                </span>
              </div>
              <MissingCountryMap
                key={`${entry.slug}:${variant?.key}`}
                slug={entry.slug}
                diffUrl={variant?.diffUrl}
                projectionType={globe ? "orthographic" : "naturalEarth1"}
                width={760}
                height={520}
              />
            </div>
            <GuessPanel
              // Key the game by slug so switching puzzles resets it; the
              // "date" is the slug (dev has no calendar), scoped to the dev store.
              key={entry.slug}
              date={`dev-${entry.slug}`}
              countries={countries}
              target={entry.target}
              targetCentroid={byName.get(entry.target) || null}
              storage={devStorage}
            />
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100%", padding: 20, color: "#e2e8f0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 14,
          paddingBottom: 10,
          borderBottom: "1px solid #1e293b",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18 }}>Annexle</h1>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            color: "#fca5a5",
            border: "1px solid #7f1d1d",
            borderRadius: 6,
            padding: "1px 6px",
          }}
        >
          DEV MODE
        </span>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          isolated storage · not reachable in production
        </span>
        <a href={location.pathname} style={{ marginLeft: "auto", fontSize: 12, color: "#60a5fa" }}>
          ← exit to daily game
        </a>
      </div>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>{children}</div>
    </div>
  );
}

const miniBtn = {
  fontSize: 11,
  color: "#94a3b8",
  background: "transparent",
  border: "1px solid #334155",
  borderRadius: 6,
  padding: "2px 6px",
  cursor: "pointer",
};

function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", width: "fit-content" }}>
      {options.map(([val, label], i) => {
        const active = value === val;
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            aria-pressed={active}
            style={{
              padding: "5px 12px",
              border: "1px solid #334155",
              background: active ? "#334155" : "transparent",
              color: active ? "#f8fafc" : "#94a3b8",
              fontSize: 13,
              cursor: "pointer",
              borderRadius:
                i === 0
                  ? "8px 0 0 8px"
                  : i === options.length - 1
                  ? "0 8px 8px 0"
                  : 0,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Muted({ children, style }) {
  return <div style={{ fontSize: 14, color: "#94a3b8", ...style }}>{children}</div>;
}
