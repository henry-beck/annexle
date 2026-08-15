import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Plain Vite + React. Generated map data is served statically from
// public/data/ (see scripts/sync-data.mjs), not bundled.
export default defineConfig({
  plugins: [react()],
});
