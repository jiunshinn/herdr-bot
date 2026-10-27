import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The control-center window. Electron loads the built files from dist/app over file://, so asset
// paths must be relative.
export default defineConfig({
  root: "app",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist/app", emptyOutDir: true },
});
