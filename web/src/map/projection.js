import { geoNaturalEarth1, geoMercator, geoOrthographic } from "d3-geo";

// The ONE place a projection is chosen. Everything downstream consumes the
// returned d3 projection through geoPath, so switching the flat map to a
// rotatable globe later is a change *here* (plus a drag->rotate handler in the
// map component), not a rewrite of the render path.
//
// Each factory fits the projection to the FeatureCollection so the whole
// swallowed world is framed; pan/zoom then explores it.
const FACTORIES = {
  naturalEarth1: geoNaturalEarth1,
  mercator: geoMercator,
  orthographic: geoOrthographic, // stubbed for the future globe stage
};

export const PROJECTION_TYPES = Object.keys(FACTORIES);

export function createProjection(type, width, height, featureCollection, pad = 8) {
  const make = FACTORIES[type] || FACTORIES.naturalEarth1;
  const projection = make();

  if (type === "orthographic") {
    // A globe shows a hemisphere; clip the back side. Rotation is added by the
    // future globe stage via projection.rotate([lambda, phi]).
    projection.clipAngle(90);
  }

  // fitExtent frames the data into the viewport with a little padding.
  projection.fitExtent(
    [
      [pad, pad],
      [width - pad, height - pad],
    ],
    featureCollection
  );

  return projection;
}
