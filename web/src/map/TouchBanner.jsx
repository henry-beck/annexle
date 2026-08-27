// Top-of-map name readout for touch devices. Unlike the desktop Tooltip (which
// follows the cursor and would sit under the fingertip on a phone), this is a
// fixed banner pinned to the top of the map, shown while a finger is down and
// updated live as it moves. MUST be pointer-events:none so it never intercepts
// the touch or the elementFromPoint hit-test underneath it.
export default function TouchBanner({ name }) {
  if (!name) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        pointerEvents: "none",
        maxWidth: "90%",
        background: "rgba(15,23,42,0.92)",
        color: "#f8fafc",
        font: "600 15px system-ui, sans-serif",
        padding: "7px 14px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
      }}
    >
      {name}
    </div>
  );
}
