import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Everything in public/ is the site's Open Agentic Web bundle: agent-manifest.json, the
// network definition, links.json, the bridge, site-actions.js and the official runtime.
// Vite copies public/ into dist/ unchanged, so the runtime is never bundled or rewritten.
//
// base "./" keeps every URL relative, so the built site also works under a subpath, and
// the app uses hash routing, so a static host needs no rewrite rules.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  // "@/x" is "src/x", as in tsconfig.json.
  resolve: { alias: { "@": "/src" } },
  server: { port: 8080, strictPort: true, host: "localhost" },
  preview: { port: 8080, strictPort: true, host: "localhost" },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          map: ["leaflet", "react-leaflet"],
        },
      },
    },
  },
});
