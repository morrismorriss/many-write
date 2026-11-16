import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 1420 is what src-tauri/tauri.conf.json expects for `tauri dev`.
// In a plain browser, /api is proxied to the dev server (crates/manywrite-devserver).
//
// MW_PREVIEW=1 is for viewing the browser build through a forwarding proxy (a
// hosted preview): it accepts any Host and presents the request to the dev
// server as local. Leave it off on your own machine; the defaults refuse other
// sites and DNS rebinding.
const preview = process.env.MW_PREVIEW === "1";
const api = `http://127.0.0.1:${process.env.MW_DEV_PORT ?? 1421}`;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    ...(preview ? { allowedHosts: true as const } : {}),
    proxy: {
      "/api": preview
        ? {
            target: api,
            changeOrigin: true,
            configure: (proxy) => proxy.on("proxyReq", (req) => req.setHeader("origin", api)),
          }
        : api,
    },
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  build: { target: "es2021", chunkSizeWarningLimit: 2000 },
  test: { include: ["src/**/*.test.ts"] },
} as any);
