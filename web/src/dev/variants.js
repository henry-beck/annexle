// Geometry variants of a single puzzle.
//
// Every puzzle ships two seam-style variants — straight (Voronoi) and organic
// (curved seams) — at `diffStraight` / `diffOrganic`. Puzzles the pipeline built
// distortion for also carry `diffDistorted` (stacked on the organic base). This
// helper is the single place that maps a puzzles.json entry to its variant URLs;
// the dev picker's toggle renders whatever it returns, so the 44 organic-default
// puzzles show Straight/Organic/Distorted and every other puzzle shows
// Straight/Organic automatically. `entry.defaultVariant` names which one the
// daily (non-dev) client serves at `<slug>.json`.
const DATA_ROOT = import.meta.env.BASE_URL + "data";

export function listVariants(entry) {
  const url = (p) => `${DATA_ROOT}/${p}`;
  const variants = [
    { key: "straight", label: "Straight", diffUrl: url(entry.diffStraight || entry.diff) },
    { key: "organic", label: "Organic", diffUrl: url(entry.diffOrganic || entry.diff) },
  ];
  if (entry.diffDistorted) {
    variants.push({ key: "distorted", label: "Distorted", diffUrl: url(entry.diffDistorted) });
  }
  return variants;
}
