import { geoNaturalEarth1, geoMercator, geoOrthographic } from "d3-geo";

// The ONE place a projection is chosen. Everything downstream consumes the
// returned d3 projection through geoPath, so the 2D<->globe toggle is a change
// *here* (plus the drag/zoom handling in the map component), not a rewrite of
// the render path — the same swallowed-world GeoJSON feeds both.
const FACTORIES = {
  naturalEarth1: geoNaturalEarth1,
  mercator: geoMercator,
  orthographic: geoOrthographic, // the globe
};

export const PROJECTION_TYPES = Object.keys(FACTORIES);

export function createProjection(
  type,
  width,
  height,
  featureCollection,
  { rotate = [0, -15], pad = 8 } = {}
) {
  const make = FACTORIES[type] || FACTORIES.naturalEarth1;
  const projection = make();
  const extent = [
    [pad, pad],
    [width - pad, height - pad],
  ];

  if (type === "orthographic") {
    // Globe: clip the back hemisphere (far-side geometry produces empty paths,
    // so it isn't drawn or hoverable), apply the current rotation, and fit to
    // the SPHERE — a rotation-invariant disk — so spinning changes what's shown
    // without resizing the globe.
    projection.clipAngle(90).rotate(rotate);
    projection.fitExtent(extent, { type: "Sphere" });
  } else {
    // Flat: fit to the data so the whole swallowed world is framed.
    projection.fitExtent(extent, featureCollection);
  }

  return projection;
}
