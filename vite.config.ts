import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 1420 is what src-tauri/tauri.conf.json expects for `tauri dev`.
// In a plain browser, /api is proxied to the dev server (crates/manywrite-devserver).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.MW_DEV_PORT ?? 1421}` },
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  build: { target: "es2021", chunkSizeWarningLimit: 2000 },
  test: { include: ["src/**/*.test.ts"] },
} as any);
