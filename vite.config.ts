import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { proxy: { "/api": "http://127.0.0.1:4299" } },
});
