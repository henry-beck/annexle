import { lazy, Suspense, useState } from "react";
import MissingCountryMap from "./map/MissingCountryMap.jsx";
import GuessPanel from "./game/GuessPanel.jsx";
import { useDailyPuzzle } from "./game/useDailyPuzzle.js";

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
            <ViewToggle view={view} setView={setView} />
            <MissingCountryMap
              slug={puzzle.slug}
              projectionType={globe ? "orthographic" : "naturalEarth1"}
              width={840}
              height={560}
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

function Note({ children }) {
  return (
    <div style={{ fontSize: 14, color: "#94a3b8", padding: 24 }}>{children}</div>
  );
}
