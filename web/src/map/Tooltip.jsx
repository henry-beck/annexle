// Floating country-name label. The hover name is the intended giveaway: after
// Haiti is swallowed, hovering Hispaniola reads "Dominican Republic".
export default function Tooltip({ name, x, y }) {
  if (!name) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x + 12,
        top: y + 12,
        pointerEvents: "none",
        background: "rgba(15,23,42,0.92)",
        color: "#f8fafc",
        font: "13px system-ui, sans-serif",
        padding: "4px 8px",
        borderRadius: 6,
        whiteSpace: "nowrap",
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
      }}
    >
      {name}
    </div>
  );
}
