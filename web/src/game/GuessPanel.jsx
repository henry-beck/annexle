import { useMemo } from "react";
import GuessInput from "./GuessInput.jsx";
import { useGameState } from "./useGameState.js";

// The guess column: input + per-guess feedback (distance, direction, proximity),
// win/lose end state (always revealing the target), remaining count, and streak.
// Game logic + persistence live in useGameState; this is presentation.
export default function GuessPanel({ date, target, targetCentroid, countries }) {
  const { guesses, status, remaining, streak, submitGuess } = useGameState({
    date,
    target,
    targetCentroid,
    countries,
  });
  const used = useMemo(() => new Set(guesses.map((g) => g.name)), [guesses]);
  const over = status !== "playing";

  return (
    <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>
          {over ? "Game over" : `Guess the missing country · ${remaining} left`}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>🔥 streak {streak}</div>
      </div>

      {!over && (
        <>
          <GuessInput
            countries={countries}
            used={used}
            onGuess={submitGuess}
            disabled={!targetCentroid}
          />
          {!targetCentroid && (
            <div style={{ fontSize: 12, color: "#f59e0b" }}>
              Target centroid unavailable — can’t score guesses.
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {guesses.length === 0 && !over && (
          <div style={{ fontSize: 12, color: "#64748b" }}>No guesses yet.</div>
        )}
        {guesses.map((g, i) => (
          <GuessRow key={i} g={g} />
        ))}
      </div>

      {over && (
        <div
          style={{
            marginTop: 4,
            padding: 14,
            borderRadius: 10,
            textAlign: "center",
            background: status === "won" ? "rgba(5,150,105,0.15)" : "#0f172a",
            border: `1px solid ${status === "won" ? "#059669" : "#1e293b"}`,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            {status === "won" ? "Nice — you got it!" : "Out of guesses."}
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>
            The missing country was{" "}
            <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{target}</span>.
          </div>
        </div>
      )}
    </div>
  );
}

function GuessRow({ g }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 8,
        background: g.correct ? "rgba(5,150,105,0.18)" : "#0f172a",
        border: `1px solid ${g.correct ? "#059669" : "#1e293b"}`,
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 600 }}>{g.name}</span>
      {g.correct ? (
        <span style={{ color: "#34d399", fontWeight: 600 }}>Correct! 🎯</span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
            {g.distKm.toLocaleString()} km
          </span>
          {/* Direction: a single up-arrow rotated to the bearing, matching the
              prototype's guess-history style. */}
          <span
            title={`${g.bearingDeg}°`}
            style={{ display: "inline-block", transform: `rotate(${g.bearingDeg}deg)`, fontSize: 16 }}
          >
            ⬆️
          </span>
          <span style={{ color: "#34d399", fontVariantNumeric: "tabular-nums", width: 34, textAlign: "right" }}>
            {g.pct}%
          </span>
        </div>
      )}
    </div>
  );
}
