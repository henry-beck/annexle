import { useEffect } from "react";
import { MAX_GUESSES } from "./constants.js";

// How-to-play modal. Styled to match the current dark UI (navy card, slate
// borders, rounded corners). Closes on the X, on a click outside the card, or
// on Escape. Auto-show-once-per-player and the "?" reopen live in App.
export default function HowToPlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How to play"
      onClick={onClose} // click on the backdrop closes
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(2,6,23,0.7)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()} // clicks inside the card don't close
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 14,
          padding: "22px 22px 24px",
          color: "#e2e8f0",
          boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid #334155",
            borderRadius: 8,
            background: "transparent",
            color: "#94a3b8",
            fontSize: 18,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ×
        </button>

        <h2 style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 700 }}>How to Play</h2>

        <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          <li style={{ fontSize: 14, lineHeight: 1.5 }}>
            Each day, one country vanishes — swallowed by its neighbors. The outer
            map shape never changes, only the internal borders.
          </li>
          <li style={{ fontSize: 14, lineHeight: 1.5 }}>Guess which country is missing.</li>
          <li style={{ fontSize: 14, lineHeight: 1.5 }}>
            Each guess shows how far away and in which direction the real country
            is from your guess.
          </li>
          <li style={{ fontSize: 14, lineHeight: 1.5 }}>
            You get {MAX_GUESSES} guesses per day.
          </li>
        </ol>
      </div>
    </div>
  );
}
