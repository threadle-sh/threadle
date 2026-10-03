import { defineConfig, type Plugin, type UserConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Shared Vite setup for the two threadle front ends (viewer, workflows editor).
 * Each app is its own Vite project with its own dev port and build output;
 * they share the UI kit (@ui), public assets and this config.
 */
export function threadleApp(opts: {
  /** the app package dir (import.meta.dirname of its vite.config.ts) */
  dir: string;
  /** dev server port (viewer 5173, workflows 5174) */
  port: number;
  /** built into packages/server/<outDir> (served by threadle / threadle-workflows) */
  outDir: "web-dist" | "web-dist-workflows";
  /** the app's own alias, e.g. { "@": src } or { "@wf": src } */
  alias: Record<string, string>;
}): UserConfig {
  const uiDir = path.resolve(import.meta.dirname);
  const serverDir = path.resolve(uiDir, "../server");
  const pkg = JSON.parse(readFileSync(path.join(serverDir, "package.json"), "utf8")) as {
    version: string;
  };
  const outDir = path.join(serverDir, opts.outDir);

  // Content-based build id shared by the client bundle and <outDir>/build-id.
  // Comparing this (not filesystem mtime) avoids false "newer UI" banners after
  // npm pack/extract, which rewrites mtimes on install.
  const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const emitBuildId: Plugin = {
    name: "threadle-build-id",
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "build-id"), buildId, "utf8");
    },
  };

  return defineConfig({
    plugins: [vue(), emitBuildId],
    publicDir: path.join(uiDir, "public"),
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: { "@ui": path.join(uiDir, "src"), ...opts.alias },
    },
    server: {
      port: opts.port,
      strictPort: true,
      // Mirror the production server's CSP (server.ts) so XSS findings are not
      // silently unmitigated during development — the only deltas are the HMR
      // websocket in connect-src. Keep the two policies in sync.
      headers: {
        "Content-Security-Policy": [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          `connect-src 'self' ws://127.0.0.1:${opts.port} ws://localhost:${opts.port}`,
          "font-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
        ].join("; "),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
      // One dev API server (:4570) backs both apps.
      proxy: {
        "/api": {
          target: "http://127.0.0.1:4570",
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
    },
  });
}
