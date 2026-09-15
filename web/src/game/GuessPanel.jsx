import { useMemo, useState } from "react";
import GuessInput from "./GuessInput.jsx";
import { buildShareText } from "./share.js";

// The guess column: input + Skip, per-attempt history (guessed country or a
// skip), win/lose end state (always revealing the target), remaining count, and
// streak. Presentational — the game brain (useGameState) is owned by the parent
// so the map can react to the same reveal level. Feedback is spatial now (the
// shrinking circle / continent shown on the map), so rows carry no distance.
export default function GuessPanel({
  date,
  dayIndex,
  target,
  countries,
  attempts,
  status,
  remaining,
  streak,
  submitGuess,
  submitSkip,
}) {
  // already-guessed country names (skips have no name) — filtered from suggestions
  const used = useMemo(
    () => new Set(attempts.filter((a) => a.type === "guess").map((a) => a.name)),
    [attempts]
  );
  const over = status !== "playing";
  const [toast, setToast] = useState(null);

  // Share the result: native share sheet where available (best on mobile), else
  // copy to clipboard with a confirmation toast. The whole string (including the
  // site URL as its last line) goes in `text` so the format is preserved.
  async function handleShare() {
    const text = buildShareText({
      dayNumber: dayIndex == null ? null : dayIndex + 1, // 1-based (launch day = #1)
      date,
      status,
      attempts,
      streak,
      url: window.location.origin + import.meta.env.BASE_URL,
    });
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // user dismissed — not an error
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
          <GuessInput countries={countries} used={used} onGuess={submitGuess} />
          <button
            onClick={submitSkip}
            style={{
              minHeight: 40,
              padding: "9px 14px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "transparent",
              color: "#94a3b8",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Skip — reveal more of the map
          </button>
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {attempts.length === 0 && !over && (
          <div style={{ fontSize: 12, color: "#64748b" }}>
            No guesses yet — each miss or skip shrinks the search area.
          </div>
        )}
        {attempts.map((a, i) => (
          <AttemptRow key={i} a={a} />
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

function AttemptRow({ a }) {
  const skip = a.type === "skip";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 8,
        background: a.correct ? "rgba(5,150,105,0.18)" : "#0f172a",
        border: `1px solid ${a.correct ? "#059669" : "#1e293b"}`,
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 600, color: skip ? "#64748b" : "#e2e8f0", fontStyle: skip ? "italic" : "normal" }}>
        {skip ? "Skipped" : a.name}
      </span>
      {a.correct ? (
        <span style={{ color: "#34d399", fontWeight: 600 }}>Correct! 🎯</span>
      ) : (
        <span style={{ color: "#64748b" }}>{skip ? "⬛" : "🟥"}</span>
      )}
    </div>
  );
}
