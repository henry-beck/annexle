import { useEffect, useMemo, useRef, useState } from "react";
import { geoPath, geoArea, geoGraticule10 } from "d3-geo";
import { select } from "d3-selection";
import { drag as d3drag } from "d3-drag";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { createProjection } from "./projection.js";
import { useSwallowedWorld } from "./useSwallowedWorld.js";
import Tooltip from "./Tooltip.jsx";

const SPHERE = { type: "Sphere" };

// Renders the swallowed world for one puzzle, flat (geoNaturalEarth1) or as a
// rotatable globe (geoOrthographic) — same GeoJSON, projection chosen in
// projection.js. Uniform fill on every country so absorbers are indistinguishable;
// the only tell is hovering to read a name.
//
// Interaction differs by mode so the gestures don't fight:
//   flat  — d3.zoom: drag pans, wheel zooms, applied as a <g> transform.
//   globe — d3.drag rotates the projection (re-paths), while d3.zoom filtered to
//           WHEEL ONLY scales the <g> about centre. Drag and wheel are handled by
//           separate behaviours, so they coexist cleanly.
export default function MissingCountryMap({
  slug,
  projectionType = "naturalEarth1",
  width = 960,
  height = 600,
}) {
  const { fc, loading, error } = useSwallowedWorld(slug);
  const isGlobe = projectionType === "orthographic";
  const svgRef = useRef(null);

  const [transform, setTransform] = useState(zoomIdentity); // flat pan/zoom
  const [rotation, setRotation] = useState([0, -15]); // globe [lambda, phi]
  const [globeK, setGlobeK] = useState(1); // globe wheel scale
  const [hover, setHover] = useState({ name: null, x: 0, y: 0 });

  // Refs so the d3 drag/zoom handlers read live values without re-binding.
  const rotRef = useRef(rotation);
  rotRef.current = rotation;
  const kRef = useRef(globeK);
  kRef.current = globeK;

  // Projection re-fits on data/size/mode change, and on rotation while on the
  // globe (rotation only changes in globe mode).
  const projection = useMemo(() => {
    if (!fc) return null;
    return createProjection(projectionType, width, height, fc, { rotate: rotation });
  }, [fc, projectionType, width, height, rotation]);

  const pathGen = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  // Country path strings, largest-area first so enclaves/micro-states paint on
  // top and win the hover hit-test (unchanged from stage 1/2). On the globe,
  // far-side countries produce empty `d` and are filtered out — not drawn, not
  // hoverable. Re-runs when the projection (incl. rotation) changes.
  const shapes = useMemo(() => {
    if (!fc || !pathGen) return [];
    return fc.features
      .slice()
      .sort((a, b) => geoArea(b) - geoArea(a))
      .map((f) => ({ name: f.properties.name, d: pathGen(f) }))
      .filter((s) => s.d);
  }, [fc, pathGen]);

  // Globe backdrop: ocean disk + graticule. pointer-events disabled so hover
  // only ever hits countries.
  const backdrop = useMemo(() => {
    if (!isGlobe || !pathGen) return null;
    return { sphere: pathGen(SPHERE), graticule: pathGen(geoGraticule10()) };
  }, [isGlobe, pathGen]);

  // Wire interaction, rebound when the mode (or size/data) changes.
  useEffect(() => {
    if (!fc || !svgRef.current) return;
    const sel = select(svgRef.current);

    if (!isGlobe) {
      const z = d3zoom()
        .scaleExtent([1, 2000])
        .on("zoom", (e) => setTransform(e.transform));
      sel.call(z);
      sel.call(z.transform, zoomIdentity);
      return () => sel.on(".zoom", null);
    }

    // Entering globe mode: reset to a neutral, unzoomed view.
    setTransform(zoomIdentity);
    setGlobeK(1);
    setRotation([0, -15]);

    // Wheel-only zoom -> scale the <g> about centre.
    const z = d3zoom()
      .scaleExtent([1, 12])
      .filter((e) => e.type === "wheel")
      .on("zoom", (e) => setGlobeK(e.transform.k));
    sel.call(z);
    sel.call(z.transform, zoomIdentity);

    // Drag -> rotate. Throttle to one update per frame so a fast drag stays 60fps.
    let start = null;
    let startRot = null;
    let raf = null;
    let pending = null;
    const dragBehaviour = d3drag()
      .on("start", (e) => {
        start = [e.x, e.y];
        startRot = rotRef.current;
      })
      .on("drag", (e) => {
        const sens = 0.4 / kRef.current; // finer when zoomed in
        const lambda = startRot[0] + (e.x - start[0]) * sens;
        const phi = Math.max(-90, Math.min(90, startRot[1] - (e.y - start[1]) * sens));
        pending = [lambda, phi];
        if (!raf) {
          raf = requestAnimationFrame(() => {
            raf = null;
            if (pending) setRotation(pending);
          });
        }
      });
    sel.call(dragBehaviour);

    return () => {
      sel.on(".zoom", null);
      sel.on(".drag", null);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [fc, isGlobe, width, height]);

  if (loading) return <MapFrame width={width} height={height} note="loading map…" />;
  if (error)
    return (
      <MapFrame width={width} height={height} note={`failed to load: ${error.message}`} />
    );

  const cx = width / 2;
  const cy = height / 2;
  const gTransform = isGlobe
    ? `translate(${cx},${cy}) scale(${globeK}) translate(${-cx},${-cy})`
    : `translate(${transform.x},${transform.y}) scale(${transform.k})`;

  return (
    <div style={{ position: "relative", width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{
          display: "block",
          background: isGlobe ? "#0b1220" : "var(--sea)",
          cursor: "grab",
          borderRadius: 12,
        }}
        onMouseLeave={() => setHover((h) => ({ ...h, name: null }))}
      >
        <g transform={gTransform}>
          {backdrop && (
            <>
              <path
                d={backdrop.sphere}
                fill="var(--sea)"
                stroke="#1e3a5f"
                strokeWidth={1}
                style={{ pointerEvents: "none", vectorEffect: "non-scaling-stroke" }}
              />
              <path
                d={backdrop.graticule}
                fill="none"
                stroke="#ffffff"
                strokeOpacity={0.18}
                strokeWidth={0.5}
                style={{ pointerEvents: "none", vectorEffect: "non-scaling-stroke" }}
              />
            </>
          )}
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
