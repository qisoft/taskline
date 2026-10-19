import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4317,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4318",
      "/blobs": "http://127.0.0.1:4318",
    },
  },
  build: { outDir: "dist" },
});
