import { lazy, Suspense, useCallback, useRef, useState } from "react";
import MissingCountryMap from "./map/MissingCountryMap.jsx";
import GuessPanel from "./game/GuessPanel.jsx";
import { useDailyPuzzle } from "./game/useDailyPuzzle.js";
import { loadPref, savePref } from "./game/storage.js";

// Dev-only QC surface. Gated by TWO locks: (1) import.meta.env.DEV, which Vite
// hard-replaces with `false` in `vite build` so this whole branch is dead code,
// and (2) it's pulled in by a dynamic import() living INSIDE that dead branch,
// so the src/dev/* module tree is never emitted into a production chunk. A
// `?dev` query trigger then decides whether to show it during development, so
// plain localhost still plays the normal daily game.
const DEV_ENABLED =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("dev");
const DevApp = DEV_ENABLED ? lazy(() => import("./dev/DevApp.jsx")) : null;

// The daily puzzle (deterministic via the manifest), the map (flat or globe),
// and the guessing game.
export default function App() {
  if (DevApp) {
    return (
      <Suspense fallback={<Note>Loading dev mode…</Note>}>
        <DevApp />
      </Suspense>
    );
  }
  return <DailyGame />;
}

const MAP_MAX_W = 840;
const MAP_ASPECT = 560 / 840; // keep the original 3:2 shape at any width

// Measure an element's content width so the SVG/canvas map (which need pixel
// dimensions, not %) can be sized to fit the column on any screen — full width
// on a phone, capped at MAP_MAX_W on desktop. Uses a REF CALLBACK, not
// useEffect: the measured column mounts only once the puzzle finishes loading,
// after this component's mount effects have already run, so a callback that
// fires when the node attaches is what reliably catches it.
function useMeasuredWidth() {
  const [width, setWidth] = useState(0);
  const roRef = useRef(null);
  const ref = useCallback((el) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure(); // immediate, so we don't render a frame at the wrong size
    roRef.current = new ResizeObserver(measure);
    roRef.current.observe(el);
  }, []);
  return [ref, width];
}

function DailyGame() {
  const puzzle = useDailyPuzzle();
  const [view, setView] = useState("flat"); // "flat" | "globe"
  const globe = view === "globe";

  // Responsive map: fill the column, capped at the original size on desktop.
  const [mapColRef, colW] = useMeasuredWidth();
  const mapW = Math.round(Math.min(colW || MAP_MAX_W, MAP_MAX_W));
  const mapH = Math.round(mapW * MAP_ASPECT);

  // Distinct-country coloring is an opt-in accessibility/difficulty aid, free to
  // all players and remembered across sessions (localStorage). `palette` picks
  // the colorblind-safe (okabe) or normal hue set; it only matters when on.
  const [colorize, setColorize] = useState(() => loadPref("colorize", false));
  const [palette, setPalette] = useState(() => loadPref("palette", "okabe"));
  const setColorizePref = (v) => { setColorize(v); savePref("colorize", v); };
  const setPalettePref = (v) => { setPalette(v); savePref("palette", v); };

  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "clamp(12px, 4vw, 24px)", // tighter on small screens, full on desktop
        color: "#e2e8f0",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Annexle</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
          {puzzle.status === "ready" ? (
            <>
              Daily puzzle for <code>{puzzle.date}</code>
              {puzzle.dayIndex != null && <> (day #{puzzle.dayIndex})</>} ·{" "}
              {globe
                ? "drag to rotate, scroll/pinch to zoom, touch or hover to read a country’s name."
                : "scroll/pinch to zoom, drag to pan, touch or hover to read a country’s name."}
            </>
          ) : (
            "One country is gone — its land now belongs to its neighbours."
          )}
        </p>
      </div>

      {puzzle.status === "loading" && <Note>Loading today’s puzzle…</Note>}
      {puzzle.status === "error" && (
        <Note>Failed to load: {String(puzzle.error?.message || puzzle.error)}</Note>
      )}
      {puzzle.status === "before-launch" && (
        <Note>The game launches {puzzle.launch}. Try ?date=2026-10-02.</Note>
      )}
      {puzzle.status === "past-horizon" && (
        <Note>Past the {puzzle.days}-day manifest horizon — regenerate it.</Note>
      )}

      {puzzle.status === "ready" && (
        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "flex-start",
            flexWrap: "wrap",
            justifyContent: "center",
            width: "100%",
            maxWidth: 1200,
          }}
        >
          <div
            ref={mapColRef}
            style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 420px", minWidth: 0, maxWidth: MAP_MAX_W }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <ViewToggle view={view} setView={setView} />
              <Toggle
                options={[["off", "Off"], ["on", "On"]]}
                value={colorize ? "on" : "off"}
                onChange={(v) => setColorizePref(v === "on")}
                label="Colors"
              />
              {colorize && (
                <Toggle
                  options={[["normal", "Normal"], ["okabe", "Colorblind"]]}
                  value={palette}
                  onChange={setPalettePref}
                />
              )}
            </div>
            <MissingCountryMap
              slug={puzzle.slug}
              projectionType={globe ? "orthographic" : "naturalEarth1"}
              width={mapW}
              height={mapH}
              colorize={colorize}
              palette={palette}
            />
          </div>
          <div style={{ flex: "1 1 300px", minWidth: 0, maxWidth: 360 }}>
            <GuessPanel
              date={puzzle.date}
              countries={puzzle.countries}
              target={puzzle.target}
              targetCentroid={puzzle.targetCentroid}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ViewToggle({ view, setView }) {
  const opt = (value, label) => {
    const active = view === value;
    return (
      <button
        onClick={() => setView(value)}
        aria-pressed={active}
        style={{
          minHeight: 40, // comfortable touch target
          padding: "8px 14px",
          border: "1px solid #334155",
          background: active ? "#334155" : "transparent",
          color: active ? "#f8fafc" : "#94a3b8",
          fontSize: 13,
          cursor: "pointer",
          borderRadius: value === "flat" ? "8px 0 0 8px" : "0 8px 8px 0",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: "flex", width: "fit-content" }}>
      {opt("flat", "2D")}
      {opt("globe", "Globe")}
    </div>
  );
}

// Reusable segmented toggle. `options` is [value, label] pairs; `label` renders
// a small caption before the control (e.g. "Colors").
function Toggle({ options, value, onChange, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {label && <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>}
      <div style={{ display: "flex", width: "fit-content" }}>
        {options.map(([val, lbl], i) => {
          const active = value === val;
          return (
            <button
              key={val}
              onClick={() => onChange(val)}
              aria-pressed={active}
              style={{
                minHeight: 40, // comfortable touch target
                padding: "8px 14px",
                border: "1px solid #334155",
                background: active ? "#334155" : "transparent",
                color: active ? "#f8fafc" : "#94a3b8",
                fontSize: 13,
                cursor: "pointer",
                borderRadius:
                  i === 0
                    ? "8px 0 0 8px"
                    : i === options.length - 1
                    ? "0 8px 8px 0"
                    : 0,
              }}
            >
              {lbl}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Note({ children }) {
  return (
    <div style={{ fontSize: 14, color: "#94a3b8", padding: 24 }}>{children}</div>
  );
}
