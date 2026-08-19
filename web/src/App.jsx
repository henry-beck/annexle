import MissingCountryMap from "./map/MissingCountryMap.jsx";
import GuessPanel from "./game/GuessPanel.jsx";
import { useDailyPuzzle } from "./game/useDailyPuzzle.js";

// Stage 2a: deterministic daily puzzle (via the precomputed manifest) + the
// guess mechanic, wired around the stage-1 map. No win/lose, feedback, or
// persistence yet.
export default function App() {
  const puzzle = useDailyPuzzle();

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
        <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Missing Country</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
          {puzzle.status === "ready" ? (
            <>
              Daily puzzle for <code>{puzzle.date}</code>
              {puzzle.dayIndex != null && <> (day #{puzzle.dayIndex})</>} · scroll
              to zoom, drag to pan, hover to read a country’s name.
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
        <Note>The game launches {puzzle.launch}. Try ?date=2026-02-15.</Note>
      )}
      {puzzle.status === "past-horizon" && (
        <Note>Past the {puzzle.days}-day manifest horizon — regenerate it.</Note>
      )}

      {puzzle.status === "ready" && (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <MissingCountryMap slug={puzzle.slug} width={840} height={560} />
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

function Note({ children }) {
  return (
    <div style={{ fontSize: 14, color: "#94a3b8", padding: 24 }}>{children}</div>
  );
}
