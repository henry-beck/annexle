import { useEffect, useMemo, useRef, useState } from "react";
import { geoPath, geoArea } from "d3-geo";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { createProjection } from "./projection.js";
import Tooltip from "./Tooltip.jsx";

// Flat map (geoNaturalEarth1), rendered as SVG. Paths are generated once and
// pan/zoom is a cheap <g> transform, so there's no per-frame re-path — the DOM
// hover hit-test (incl. the largest-area-first ordering for enclaves) stays
// exact. The rotatable globe uses a separate canvas renderer (GlobeMap) because
// rotation re-paths every frame, which SVG can't do smoothly for ~240 countries.
export default function FlatMap({ fc, width, height }) {
  const svgRef = useRef(null);
  const [transform, setTransform] = useState(zoomIdentity);
  const [hover, setHover] = useState({ name: null, x: 0, y: 0 });

  const pathGen = useMemo(() => {
    const projection = createProjection("naturalEarth1", width, height, fc);
    return geoPath(projection);
  }, [fc, width, height]);

  const shapes = useMemo(
    () =>
      fc.features
        .slice()
        .sort((a, b) => geoArea(b) - geoArea(a))
        .map((f) => ({ name: f.properties.name, d: pathGen(f) }))
        .filter((s) => s.d),
    [fc, pathGen]
  );

  useEffect(() => {
    if (!svgRef.current) return;
    const behaviour = d3zoom()
      .scaleExtent([1, 2000])
      .on("zoom", (e) => setTransform(e.transform));
    const sel = select(svgRef.current);
    sel.call(behaviour);
    sel.call(behaviour.transform, zoomIdentity);
    return () => sel.on(".zoom", null);
  }, [fc, width, height]);

  return (
    <div style={{ position: "relative", width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: "block", background: "var(--sea)", cursor: "grab", borderRadius: 12 }}
        onMouseLeave={() => setHover((h) => ({ ...h, name: null }))}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
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
              onMouseLeave={() =>
                setHover((h) => (h.name === s.name ? { ...h, name: null } : h))
              }
            />
          ))}
        </g>
      </svg>
      <Tooltip name={hover.name} x={hover.x} y={hover.y} />
    </div>
  );
}
