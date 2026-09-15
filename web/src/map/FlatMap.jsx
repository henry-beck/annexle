import { useEffect, useMemo, useRef, useState } from "react";
import { geoPath, geoArea, geoCircle } from "d3-geo";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { createProjection } from "./projection.js";
import Tooltip from "./Tooltip.jsx";
import TouchBanner from "./TouchBanner.jsx";

// Flat map (geoNaturalEarth1), rendered as SVG. Paths are generated once and
// pan/zoom is a cheap <g> transform, so there's no per-frame re-path — the DOM
// hover hit-test (incl. the largest-area-first ordering for enclaves) stays
// exact. The rotatable globe uses a separate canvas renderer (GlobeMap) because
// rotation re-paths every frame, which SVG can't do smoothly for ~240 countries.
export default function FlatMap({ fc, width, height, colors = null, circle = null }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [transform, setTransform] = useState(zoomIdentity);
  const [hover, setHover] = useState({ name: null, x: 0, y: 0 });
  const [touchName, setTouchName] = useState(null);

  // Touch name-readout: the country directly under the primary finger, reported
  // live on start AND move — including mid-pan. Attached as NATIVE listeners in
  // the CAPTURE phase on the container (an ancestor of the svg), not via React
  // props: d3-zoom sits on the svg and stops touch propagation to handle the
  // gesture, which would otherwise swallow the event before React's delegated
  // root listener ever sees it. Capture on an ancestor runs first, so we get the
  // readout while d3-zoom still fully owns pan/pinch — we never preventDefault or
  // stopPropagation, so the gesture is untouched. The hit-test is the browser's
  // own elementFromPoint against the rendered paths (each carries data-name) —
  // the exact geometry desktop hover uses, so enclaves resolve identically. The
  // TouchBanner overlay is pointer-events:none, so it never shadows the element.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const report = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const named = el && el.closest ? el.closest("[data-name]") : null;
      setTouchName(named ? named.getAttribute("data-name") : null);
    };
    const clear = () => setTouchName(null);
    const opts = { capture: true, passive: true };
    node.addEventListener("touchstart", report, opts);
    node.addEventListener("touchmove", report, opts);
    node.addEventListener("touchend", clear, opts);
    node.addEventListener("touchcancel", clear, opts);
    return () => {
      node.removeEventListener("touchstart", report, opts);
      node.removeEventListener("touchmove", report, opts);
      node.removeEventListener("touchend", clear, opts);
      node.removeEventListener("touchcancel", clear, opts);
    };
  }, []);

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

  // Shrinking-circle hint: the search region for the current reveal. `circle` is
  // [lng, lat, radiusDeg] (exactly d3.geoCircle args). We draw two things, both
  // pointer-events:none so pan/zoom/hover stay live everywhere:
  //   - a "donut" that shades the world OUTSIDE the circle: one path of Sphere +
  //     the circle polygon, filled fill-rule:evenodd so the circle punches a hole;
  //   - the circle outline itself.
  // geoCircle is a true spherical small-circle, so it projects correctly here
  // (naturalEarth1) and on the globe from the same [lng,lat,radius] data.
  const circlePaths = useMemo(() => {
    if (!circle) return null;
    const [lng, lat, radiusDeg] = circle;
    const poly = geoCircle().center([lng, lat]).radius(radiusDeg)();
    const circleD = pathGen(poly);
    if (!circleD) return null;
    const sphereD = pathGen({ type: "Sphere" });
    return { shadeD: sphereD + circleD, outlineD: circleD };
  }, [circle, pathGen]);

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
    <div ref={containerRef} style={{ position: "relative", width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{
          display: "block",
          background: "var(--sea)",
          cursor: "grab",
          borderRadius: 12,
          touchAction: "none", // let d3-zoom own pan/pinch; stop the browser hijacking the gesture
        }}
        onMouseLeave={() => setHover((h) => ({ ...h, name: null }))}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {shapes.map((s) => (
            <path
              key={s.name}
              data-name={s.name}
              d={s.d}
              className="country"
              // dev distinct-country coloring: an INLINE style fill, which
              // outranks the `.country { fill }` author rule in the cascade (a
              // presentation `fill` attribute would not — the class rule wins).
              // Absent in production, so the daily map keeps its uniform fill.
              style={colors ? { fill: colors.get(s.name) || "var(--land)" } : undefined}
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
          {circlePaths && (
            <>
              <path
                d={circlePaths.shadeD}
                fillRule="evenodd"
                fill="rgba(2,6,23,0.55)"
                pointerEvents="none"
              />
              <path
                d={circlePaths.outlineD}
                fill="none"
                stroke="#f8fafc"
                strokeWidth={1.5 / transform.k}
                pointerEvents="none"
              />
            </>
          )}
        </g>
      </svg>
      <Tooltip name={hover.name} x={hover.x} y={hover.y} />
      <TouchBanner name={touchName} />
    </div>
  );
}
