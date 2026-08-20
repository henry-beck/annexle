// Geometry variants of a single puzzle.
//
// Today every puzzle has exactly one variant: the current per-piece swallow,
// whose diff lives at `puzzles/<slug>.json` (the `diff` field of a puzzles.json
// entry). This helper is the single place that knows how a puzzle maps to its
// diff URL(s), so adding the planned distorted-mode variant later is additive:
// return a second { key:"distorted", … } entry here and every consumer (the dev
// picker's variant toggle, a future side-by-side A/B view) picks it up without
// changing — no code assumes a slug owns exactly one diff.
const DATA_ROOT = import.meta.env.BASE_URL + "data";

export function listVariants(entry) {
  const variants = [
    {
      key: "swallow",
      label: "Current",
      // entry.diff is a path relative to the data root, e.g. "puzzles/x.json".
      diffUrl: `${DATA_ROOT}/${entry.diff}`,
    },
  ];
  // Later:
  // if (entry.diffDistorted)
  //   variants.push({ key: "distorted", label: "Distorted",
  //                   diffUrl: `${DATA_ROOT}/${entry.diffDistorted}` });
  return variants;
}
