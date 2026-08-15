import MissingCountryMap from "./map/MissingCountryMap.jsx";

// Stage 1: render ONE hardcoded puzzle so we can see the map, pan/zoom, and
// hover working. No guessing UI, no daily selection — that's the next stage.
// Try "haiti" to see the hover giveaway (Hispaniola reads "Dominican Republic").
const DEMO_SLUG = "switzerland";

export default function App() {
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
        <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Missing Country — map (stage 1)</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
          Puzzle: <code>{DEMO_SLUG}</code>. Scroll to zoom, drag to pan, hover a
          country to read its name. One country is gone — its land now belongs to
          its neighbours.
        </p>
      </div>
      <MissingCountryMap slug={DEMO_SLUG} width={960} height={600} />
    </div>
  );
}
