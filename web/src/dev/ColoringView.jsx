import { useMemo } from "react";
import { useSwallowedWorld } from "../map/useSwallowedWorld.js";
import FlatMap from "../map/FlatMap.jsx";
import { colorMapFor } from "../map/coloring.js";

// DEV-ONLY distinct-country coloring preview. Always renders the ORGANIC
// variant geometry (the base being evaluated) with a graph coloring applied so
// no two bordering countries share a color. Adjacency + coloring are derived
// from the rendered FeatureCollection itself (see coloring.js), so the colors
// reflect exactly what's drawn — including the post-swallow absorber seams.
export default function ColoringView({ slug, organicDiffUrl, palette, width = 760, height = 520 }) {
  const { fc, loading, error } = useSwallowedWorld(slug, organicDiffUrl);

  const { map, used } = useMemo(
    () => (fc ? colorMapFor(fc, palette) : { map: null, used: 0 }),
    [fc, palette]
  );

  if (loading) return <Note width={width} height={height}>computing coloring…</Note>;
  if (error) return <Note width={width} height={height}>failed: {String(error.message || error)}</Note>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FlatMap fc={fc} colors={map} width={width} height={height} />
      <span style={{ fontSize: 12, color: "#64748b" }}>
        organic geometry · {used} colors · no bordering pair shares one
      </span>
    </div>
  );
}

function Note({ width, height, children }) {
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--sea)",
        borderRadius: 12,
        color: "#0f172a",
        font: "14px system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
