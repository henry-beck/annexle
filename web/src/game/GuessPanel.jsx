import { useMemo, useState } from "react";
import GuessInput from "./GuessInput.jsx";
import { haversine, bearing } from "./geo.js";

// Owns the guess list. On each guess it computes distance (haversine) and
// direction (bearing) from the guessed country's centroid to the target's,
// using the real centroids from countries.json.
//
// Stage 2a scope: the guess MECHANIC only — compute + record. No win/lose, no
// proximity/feedback styling, no persistence (deferred). The list below shows
// the raw computed values so the mechanic is verifiable.
export default function GuessPanel({ countries, target, targetCentroid }) {
  const [guesses, setGuesses] = useState([]);
  const used = useMemo(() => new Set(guesses.map((g) => g.name)), [guesses]);
  const ready = Boolean(targetCentroid);

  function handleGuess(name) {
    const from = countries.find((c) => c.name === name);
    if (!from || !targetCentroid) return;
    const distKm = Math.round(haversine(from, targetCentroid));
    const bearingDeg = Math.round(bearing(from, targetCentroid));
    setGuesses((prev) => [...prev, { name, distKm, bearingDeg }]);
  }

  return (
    <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 6 }}>
          Which country was swallowed? Guess by name.
        </div>
        <GuessInput
          countries={countries}
          used={used}
          onGuess={handleGuess}
          disabled={!ready}
        />
        {!ready && (
          <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 6 }}>
            Target centroid unavailable — can’t score guesses.
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {guesses.length === 0 && (
          <div style={{ fontSize: 12, color: "#64748b" }}>No guesses yet.</div>
        )}
        {guesses.map((g, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 10px",
              borderRadius: 8,
              background: "#0f172a",
              border: "1px solid #1e293b",
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600 }}>{g.name}</span>
            <span style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
              {g.distKm.toLocaleString()} km · {g.bearingDeg}°
            </span>
          </div>
        ))}
      </div>

      {/* Dev-only: reveal the answer so the mechanic is easy to verify. Removed
          when the real feedback/win-lose stage lands. */}
      <details style={{ fontSize: 12, color: "#475569" }}>
        <summary style={{ cursor: "pointer" }}>dev: answer</summary>
        <div style={{ marginTop: 4 }}>
          target: <code>{target ?? "—"}</code>
          {targetCentroid && (
            <> @ {targetCentroid.lat}, {targetCentroid.lng}</>
          )}
        </div>
      </details>
    </div>
  );
}
