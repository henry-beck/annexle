import { useEffect, useMemo, useRef, useState } from "react";
import { geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { createProjection } from "./projection.js";
import { useSwallowedWorld } from "./useSwallowedWorld.js";
import Tooltip from "./Tooltip.jsx";

// Renders the swallowed world for one puzzle. Uniform fill/stroke on every
// country so absorbers are visually indistinguishable — the whole point of the
// game; the only way to tell what's gone is to hover and read the name.
//
// Pattern: React owns the DOM (it renders every <path>), D3 only does the math
// — projection + path generation, and the zoom *behaviour* (which reports a
// transform we apply to the <g> via state).
export default function MissingCountryMap({
  slug,
  projectionType = "naturalEarth1",
  width = 960,
  height = 600,
}) {
  const { fc, loading, error } = useSwallowedWorld(slug);
  const svgRef = useRef(null);
  const [transform, setTransform] = useState(zoomIdentity);
  const [hover, setHover] = useState({ name: null, x: 0, y: 0 });

  // Projection + path generator, refit whenever the data or projection changes.
  const pathGen = useMemo(() => {
    if (!fc) return null;
    const projection = createProjection(projectionType, width, height, fc);
    return geoPath(projection);
  }, [fc, projectionType, width, height]);

  // Precompute each feature's path string once (not per render/hover).
  const shapes = useMemo(() => {
    if (!fc || !pathGen) return [];
    return fc.features
      .map((f) => ({ name: f.properties.name, d: pathGen(f) }))
      .filter((s) => s.d);
  }, [fc, pathGen]);

  // Attach the d3.zoom behaviour to the svg; it reports transforms we store in
  // state and apply to the <g>. Depends on `fc` so it (re)attaches once the
  // data has loaded and the <svg> is actually in the DOM — during loading the
  // component renders a placeholder frame and svgRef is null.
  useEffect(() => {
    if (!fc || !svgRef.current) return;
    const behaviour = d3zoom()
      .scaleExtent([1, 40])
      .on("zoom", (event) => setTransform(event.transform));
    const sel = select(svgRef.current);
    sel.call(behaviour);
    sel.call(behaviour.transform, zoomIdentity);
    return () => sel.on(".zoom", null);
  }, [fc, projectionType, width, height]);

  if (loading) return <MapFrame width={width} height={height} note="loading map…" />;
  if (error)
    return (
      <MapFrame width={width} height={height} note={`failed to load: ${error.message}`} />
    );

  return (
    <div style={{ position: "relative", width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: "block", background: "var(--sea)", cursor: "grab", borderRadius: 12 }}
        onMouseLeave={() => setHover((h) => ({ ...h, name: null }))}
      >
        <g
          transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
        >
          {shapes.map((s) => (
            <path
              key={s.name}
              data-name={s.name}
              d={s.d}
              className="country"
              onMouseEnter={() => setHover((h) => ({ ...h, name: s.name }))}
              onMouseMove={(e) => {
                const r = svgRef.current.getBoundingClientRect();
                setHover({ name: s.name, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
            />
          ))}
        </g>
      </svg>
      <Tooltip name={hover.name} x={hover.x} y={hover.y} />
    </div>
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
