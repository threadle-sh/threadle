import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../server/package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [vue()],
  define: {
    // baked at build time; compared against the server's web-dist mtime
    __APP_BUILD_TIME__: JSON.stringify(Date.now()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: 5173,
    // Mirror the production server's CSP (server.ts) so XSS findings are not
    // silently unmitigated during development — the only deltas are the HMR
    // websocket in connect-src. Keep the two policies in sync.
    headers: {
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join("; "),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4570",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "../server/web-dist"),
    emptyOutDir: true,
  },
});
