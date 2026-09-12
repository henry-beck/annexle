import { useMemo, useState } from "react";
import GuessInput from "./GuessInput.jsx";
import { useGameState } from "./useGameState.js";
import { buildShareText } from "./share.js";

// The guess column: input + per-guess feedback (distance, direction, proximity),
// win/lose end state (always revealing the target), remaining count, and streak.
// Game logic + persistence live in useGameState; this is presentation.
export default function GuessPanel({ date, dayIndex, target, targetCentroid, countries, storage }) {
  const { guesses, status, remaining, streak, submitGuess } = useGameState({
    date,
    target,
    targetCentroid,
    countries,
    storage,
  });
  const used = useMemo(() => new Set(guesses.map((g) => g.name)), [guesses]);
  const over = status !== "playing";
  const [toast, setToast] = useState(null);

  // Share the result: native share sheet where available (best on mobile —
  // Messages, etc.), else copy to clipboard with a confirmation toast. The whole
  // Worldle-style string (including the site URL as its last line) goes in
  // `text` so the exact multi-line format is preserved on every target.
  async function handleShare() {
    const text = buildShareText({
      dayNumber: dayIndex == null ? null : dayIndex + 1, // 1-based (launch day = #1)
      date,
      status,
      guesses,
      streak,
      url: window.location.origin + import.meta.env.BASE_URL,
    });
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        // user dismissed the share sheet — not an error, don't fall back
        if (e && e.name === "AbortError") return;
        // any other failure: fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      flashToast("Copied to clipboard");
    } catch {
      flashToast("Couldn’t copy — long-press to select");
    }
  }

  function flashToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
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
          <button
            onClick={handleShare}
            style={{
              marginTop: 12,
              width: "100%",
              minHeight: 44,
              padding: "11px 16px",
              borderRadius: 8,
              border: "none",
              background: "#059669",
              color: "#f8fafc",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Share
          </button>
        </div>
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 60,
            background: "rgba(15,23,42,0.95)",
            border: "1px solid #334155",
            color: "#f8fafc",
            fontSize: 14,
            padding: "10px 16px",
            borderRadius: 999,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        >
          {toast}
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
              prototype's guess-history style. No title/tooltip — the exact angle
              is intentionally not exposed. */}
          <span
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
