import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  // In production builds, Vite asset paths are prefixed with /static/ so
  // they land exactly where WhiteNoise already serves Django static files.
  // In development mode, base stays at / so the Vite dev proxy still works.
  base: mode === "production" ? "/static/" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy keeps the browser on one origin in development, so there are no
    // CORS preflights and the API base URL is the same in dev and production.
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the heavy, independently-cacheable libraries out of the
        // main bundle so a code change doesn't invalidate them.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("leaflet")) return "map";
          if (id.includes("framer-motion") || id.includes("motion-dom"))
            return "motion";
          return "vendor";
        },
      },
    },
  },
}));
