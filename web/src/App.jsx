import { lazy, Suspense, useState } from "react";
import MissingCountryMap from "./map/MissingCountryMap.jsx";
import GuessPanel from "./game/GuessPanel.jsx";
import { useDailyPuzzle } from "./game/useDailyPuzzle.js";
import { loadPref, savePref } from "./game/storage.js";

// Dev-only QC surface. Gated by TWO locks: (1) import.meta.env.DEV, which Vite
// hard-replaces with `false` in `vite build` so this whole branch is dead code,
// and (2) it's pulled in by a dynamic import() living INSIDE that dead branch,
// so the src/dev/* module tree is never emitted into a production chunk. A
// `?dev` query trigger then decides whether to show it during development, so
// plain localhost still plays the normal daily game.
const DEV_ENABLED =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("dev");
const DevApp = DEV_ENABLED ? lazy(() => import("./dev/DevApp.jsx")) : null;

// The daily puzzle (deterministic via the manifest), the map (flat or globe),
// and the guessing game.
export default function App() {
  if (DevApp) {
    return (
      <Suspense fallback={<Note>Loading dev mode…</Note>}>
        <DevApp />
      </Suspense>
    );
  }
  return <DailyGame />;
}

function DailyGame() {
  const puzzle = useDailyPuzzle();
  const [view, setView] = useState("flat"); // "flat" | "globe"
  const globe = view === "globe";

  // Distinct-country coloring is an opt-in accessibility/difficulty aid, free to
  // all players and remembered across sessions (localStorage). `palette` picks
  // the colorblind-safe (okabe) or normal hue set; it only matters when on.
  const [colorize, setColorize] = useState(() => loadPref("colorize", false));
  const [palette, setPalette] = useState(() => loadPref("palette", "okabe"));
  const setColorizePref = (v) => { setColorize(v); savePref("colorize", v); };
  const setPalettePref = (v) => { setPalette(v); savePref("palette", v); };

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: 24,
        color: "#e2e8f0",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Annexle</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
          {puzzle.status === "ready" ? (
            <>
              Daily puzzle for <code>{puzzle.date}</code>
              {puzzle.dayIndex != null && <> (day #{puzzle.dayIndex})</>} ·{" "}
              {globe
                ? "drag to rotate, scroll to zoom, hover to read a country’s name."
                : "scroll to zoom, drag to pan, hover to read a country’s name."}
            </>
          ) : (
            "One country is gone — its land now belongs to its neighbours."
          )}
        </p>
      </div>

      {puzzle.status === "loading" && <Note>Loading today’s puzzle…</Note>}
      {puzzle.status === "error" && (
        <Note>Failed to load: {String(puzzle.error?.message || puzzle.error)}</Note>
      )}
      {puzzle.status === "before-launch" && (
        <Note>The game launches {puzzle.launch}. Try ?date=2026-10-02.</Note>
      )}
      {puzzle.status === "past-horizon" && (
        <Note>Past the {puzzle.days}-day manifest horizon — regenerate it.</Note>
      )}

      {puzzle.status === "ready" && (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <ViewToggle view={view} setView={setView} />
              <Toggle
                options={[["off", "Off"], ["on", "On"]]}
                value={colorize ? "on" : "off"}
                onChange={(v) => setColorizePref(v === "on")}
                label="Colors"
              />
              {colorize && (
                <Toggle
                  options={[["normal", "Normal"], ["okabe", "Colorblind"]]}
                  value={palette}
                  onChange={setPalettePref}
                />
              )}
            </div>
            <MissingCountryMap
              slug={puzzle.slug}
              projectionType={globe ? "orthographic" : "naturalEarth1"}
              width={840}
              height={560}
              colorize={colorize}
              palette={palette}
            />
          </div>
          <GuessPanel
            date={puzzle.date}
            countries={puzzle.countries}
            target={puzzle.target}
            targetCentroid={puzzle.targetCentroid}
          />
        </div>
      )}
    </div>
  );
}

function ViewToggle({ view, setView }) {
  const opt = (value, label) => {
    const active = view === value;
    return (
      <button
        onClick={() => setView(value)}
        aria-pressed={active}
        style={{
          padding: "5px 14px",
          border: "1px solid #334155",
          background: active ? "#334155" : "transparent",
          color: active ? "#f8fafc" : "#94a3b8",
          fontSize: 13,
          cursor: "pointer",
          borderRadius: value === "flat" ? "8px 0 0 8px" : "0 8px 8px 0",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: "flex", width: "fit-content" }}>
      {opt("flat", "2D")}
      {opt("globe", "Globe")}
    </div>
  );
}

// Reusable segmented toggle. `options` is [value, label] pairs; `label` renders
// a small caption before the control (e.g. "Colors").
function Toggle({ options, value, onChange, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {label && <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>}
      <div style={{ display: "flex", width: "fit-content" }}>
        {options.map(([val, lbl], i) => {
          const active = value === val;
          return (
            <button
              key={val}
              onClick={() => onChange(val)}
              aria-pressed={active}
              style={{
                padding: "5px 14px",
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
              {lbl}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Note({ children }) {
  return (
    <div style={{ fontSize: 14, color: "#94a3b8", padding: 24 }}>{children}</div>
  );
}
