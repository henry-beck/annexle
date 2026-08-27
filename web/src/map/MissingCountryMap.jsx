import { useMemo } from "react";
import { useSwallowedWorld } from "./useSwallowedWorld.js";
import { colorMapFor } from "./coloring.js";
import FlatMap from "./FlatMap.jsx";
import GlobeMap from "./GlobeMap.jsx";

// Loads the swallowed world for a puzzle and renders it flat (SVG) or as a
// rotatable globe (canvas). Same GeoJSON; the two renderers differ because a
// spinning globe re-paths every frame (canvas) while the flat map pans/zooms
// with a cheap transform (SVG). See FlatMap / GlobeMap.
//
// `colorize` turns on the distinct-country coloring (no two bordering countries
// share a color); `palette` picks the hue set ("okabe" colorblind-safe or
// "normal"). The coloring is computed from the loaded FeatureCollection here —
// where the geometry lives — and handed to whichever renderer is active.
export default function MissingCountryMap({
  slug,
  diffUrl,
  projectionType = "naturalEarth1",
  width = 960,
  height = 600,
  colorize = false,
  palette = "okabe",
}) {
  const { fc, loading, error } = useSwallowedWorld(slug, diffUrl);

  const colors = useMemo(
    () => (fc && colorize ? colorMapFor(fc, palette).map : null),
    [fc, colorize, palette]
  );

  if (loading) return <MapFrame width={width} height={height} note="loading map…" />;
  if (error)
    return (
      <MapFrame width={width} height={height} note={`failed to load: ${error.message}`} />
    );

  return projectionType === "orthographic" ? (
    <GlobeMap fc={fc} width={width} height={height} colors={colors} />
  ) : (
    <FlatMap fc={fc} width={width} height={height} colors={colors} />
  );
}

function MapFrame({ width, height, note }) {
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
      {note}
    </div>
  );
}
