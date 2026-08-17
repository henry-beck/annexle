// Copy the pipeline's generated output into the app's static data folder.
//
// The pipeline (../missing_country.py) writes to ../out/, which is gitignored.
// The app serves map data from web/public/data/. Run `npm run sync-data` after
// regenerating puzzles to refresh what the app serves.
//
// The base world.geojson and the demo puzzle diffs are committed under
// public/data/ so the app runs on a fresh clone WITHOUT the Python pipeline;
// this script is how you pull in the full/updated set.
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "out");
const DEST = join(here, "..", "public", "data");

if (!existsSync(OUT)) {
  console.error(
    `No pipeline output at ${OUT}.\n` +
      `Generate it first, e.g.:  cd ..  &&  python missing_country.py build-auto 200`
  );
  process.exit(1);
}

mkdirSync(join(DEST, "puzzles"), { recursive: true });

let copied = 0;
for (const name of ["world.geojson", "puzzles.json", "countries.json", "manifest.json"]) {
  const src = join(OUT, name);
  if (existsSync(src)) {
    copyFileSync(src, join(DEST, name));
    copied++;
  }
}

const puzzlesDir = join(OUT, "puzzles");
if (existsSync(puzzlesDir)) {
  for (const f of readdirSync(puzzlesDir)) {
    if (f.endsWith(".json")) {
      copyFileSync(join(puzzlesDir, f), join(DEST, "puzzles", f));
      copied++;
    }
  }
}

console.log(`synced ${copied} files from out/ -> public/data/`);
