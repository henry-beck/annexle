import { useEffect, useMemo, useRef, useState } from "react";
import { geoPath, geoGraticule10, geoContains } from "d3-geo";
import { select } from "d3-selection";
import { drag as d3drag } from "d3-drag";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { createProjection } from "./projection.js";
import Tooltip from "./Tooltip.jsx";

const SPHERE = { type: "Sphere" };
// Match index.css tokens (canvas needs concrete colours, not CSS vars).
const SEA = "#a8c4d4";
const LAND = "#e8e4da";
const LAND_HOVER = "#d7d0c0";
const STROKE = "#ffffff";
const SPACE = "#0b1220";
const GRATICULE = "rgba(255,255,255,0.18)";
const LIMB = "#1e3a5f";

// Rotatable globe (geoOrthographic) rendered to a CANVAS. Rotation re-paths all
// ~240 countries every frame; doing that through ~1 MB of SVG <path> elements +
// React reconciliation stutters, so we draw imperatively to a canvas instead —
// immediate mode, no DOM churn, comfortably 60fps. Hover uses projection.invert
// + geoContains (spherical, so it's correct at any rotation), giving the same
// name-tooltip behaviour as the flat map.
export default function GlobeMap({ fc, width, height }) {
  const canvasRef = useRef(null);
  const [rotation, setRotation] = useState([0, -15]);
  const [globeK, setGlobeK] = useState(1);
  const [hover, setHover] = useState({ feature: null, name: null, x: 0, y: 0 });

  const rotRef = useRef(rotation);
  rotRef.current = rotation;
  const kRef = useRef(globeK);
  kRef.current = globeK;
  const draggingRef = useRef(false);

  // Orthographic fit to the sphere (constant disk), rotated, then scaled by the
  // wheel-zoom factor — so zoom enlarges the globe about centre.
  const projection = useMemo(() => {
    const proj = createProjection("orthographic", width, height, fc, { rotate: rotation });
    proj.scale(proj.scale() * globeK);
    return proj;
  }, [fc, width, height, rotation, globeK]);

  // Imperative draw on every projection/hover change. This is the only per-frame
  // cost: one clear + ~240 path fills to the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = SPACE;
    ctx.fillRect(0, 0, width, height);

    const path = geoPath(projection, ctx);

    ctx.beginPath();
    path(SPHERE);
    ctx.fillStyle = SEA;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = LIMB;
    ctx.stroke();

    ctx.beginPath();
    path(geoGraticule10());
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = GRATICULE;
    ctx.stroke();

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = STROKE;
    for (const f of fc.features) {
      ctx.beginPath();
      path(f);
      ctx.fillStyle = LAND;
      ctx.fill();
      ctx.stroke();
    }
    if (hover.feature) {
      ctx.beginPath();
      path(hover.feature);
      ctx.fillStyle = LAND_HOVER;
      ctx.fill();
      ctx.stroke();
    }
  }, [projection, hover.feature, fc, width, height]);

  // Interaction: drag rotates, wheel zooms (separate behaviours so they coexist).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sel = select(canvas);

    const z = d3zoom()
      .scaleExtent([1, 12])
      .filter((e) => e.type === "wheel")
      .on("zoom", (e) => setGlobeK(e.transform.k));
    sel.call(z);
    sel.call(z.transform, zoomIdentity);

    let start = null;
    let startRot = null;
    let raf = null;
    let pending = null;
    const dragBehaviour = d3drag()
      .on("start", (e) => {
        draggingRef.current = true;
        start = [e.x, e.y];
        startRot = rotRef.current;
      })
      .on("drag", (e) => {
        const sens = 0.4 / kRef.current;
        const lambda = startRot[0] + (e.x - start[0]) * sens;
        const phi = Math.max(-90, Math.min(90, startRot[1] - (e.y - start[1]) * sens));
        pending = [lambda, phi];
        if (!raf) {
          raf = requestAnimationFrame(() => {
            raf = null;
            if (pending) setRotation(pending);
          });
        }
      })
      .on("end", () => {
        draggingRef.current = false;
      });
    sel.call(dragBehaviour);

    return () => {
      sel.on(".zoom", null);
      sel.on(".drag", null);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [fc, width, height]);

  // Hover: invert the cursor to lon/lat and find the country containing it.
  // Skipped while dragging (that's a rotate gesture, not a hover).
  function handleMove(e) {
    if (draggingRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Only pick when the cursor is on the globe disk. geoOrthographic.invert
    // returns a limb lon/lat for points OUTSIDE the disk too, so without this a
    // hover over the black space near the edge would report a country.
    const [tx, ty] = projection.translate();
    const r = projection.scale(); // sphere radius in px for orthographic
    const onGlobe = (mx - tx) ** 2 + (my - ty) ** 2 <= r * r;

    let feature = null;
    if (onGlobe) {
      const ll = projection.invert([mx, my]);
      if (ll) {
        for (const f of fc.features) {
          if (geoContains(f, ll)) {
            feature = f;
            break;
          }
        }
      }
    }
    setHover({ feature, name: feature ? feature.properties.name : null, x: mx, y: my });
  }

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return (
    <div style={{ position: "relative", width, height }}>
      <canvas
        ref={canvasRef}
        width={Math.round(width * dpr)}
        height={Math.round(height * dpr)}
        style={{
          display: "block",
          width,
          height,
          background: SPACE,
          cursor: "grab",
          borderRadius: 12,
        }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover((h) => ({ ...h, feature: null, name: null }))}
      />
      <Tooltip name={hover.name} x={hover.x} y={hover.y} />
    </div>
  );
}
