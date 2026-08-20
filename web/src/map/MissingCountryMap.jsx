import { useSwallowedWorld } from "./useSwallowedWorld.js";
import FlatMap from "./FlatMap.jsx";
import GlobeMap from "./GlobeMap.jsx";

// Loads the swallowed world for a puzzle and renders it flat (SVG) or as a
// rotatable globe (canvas). Same GeoJSON; the two renderers differ because a
// spinning globe re-paths every frame (canvas) while the flat map pans/zooms
// with a cheap transform (SVG). See FlatMap / GlobeMap.
export default function MissingCountryMap({
  slug,
  projectionType = "naturalEarth1",
  width = 960,
  height = 600,
}) {
  const { fc, loading, error } = useSwallowedWorld(slug);

  if (loading) return <MapFrame width={width} height={height} note="loading map…" />;
  if (error)
    return (
      <MapFrame width={width} height={height} note={`failed to load: ${error.message}`} />
    );

  return projectionType === "orthographic" ? (
    <GlobeMap fc={fc} width={width} height={height} />
  ) : (
    <FlatMap fc={fc} width={width} height={height} />
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
