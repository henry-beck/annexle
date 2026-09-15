// Text-only reveal banner over the map: the continent name (reveal 1) or the
// Russia special case. Circle reveals are drawn inside the map, not here.
// Rendered inside a position:relative map wrapper; pointer-events:none so it
// never blocks pan/zoom/hover.
export default function HintBanner({ text }) {
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "90%",
        padding: "8px 16px",
        borderRadius: 999,
        background: "rgba(15,23,42,0.92)",
        border: "1px solid #334155",
        color: "#f8fafc",
        fontSize: 15,
        fontWeight: 600,
        textAlign: "center",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}
