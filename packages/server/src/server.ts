import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { registry } from "./providers/registry.js";
import { sessionRoutes } from "./routes/sessions.js";
import { agentRoutes, setDefaultProjectDir } from "./routes/agents.js";
import { graphRoutes } from "./routes/graphs.js";
import { contextRoutes, payloadRoutes } from "./routes/context.js";
import { eventRoutes } from "./routes/events.js";
import { injectRoutes } from "./routes/inject.js";
import { modelRoutes, runRoutes } from "./routes/run.js";
import { fileRoutes } from "./routes/files.js";
import { openRoutes, settingsRoutes } from "./routes/settings.js";
import { jobRoutes } from "./routes/run.js";
import { bundleRoutes } from "./routes/bundle.js";
import { ruleRoutes } from "./routes/rules.js";
import { searchRoutes } from "./routes/search.js";
import { lineageRoutes } from "./routes/lineage.js";
import { atlasRoutes } from "./routes/atlas.js";
import { pricingRoutes } from "./routes/pricing.js";
import { subscriptionRoutes } from "./routes/subscription.js";
import { internalsRoutes } from "./routes/internals.js";
import { customNodeRoutes } from "./routes/custom-nodes.js";
import { mcpRoutes } from "./routes/mcp.js";
import { backupRoutes } from "./routes/backup.js";
import { gitRoutes } from "./routes/git.js";
import { favoriteRoutes } from "./routes/favorites.js";
import { memoryRoutes } from "./routes/memory.js";
import { pluginRoutes } from "./routes/plugins.js";
import { gcTmpFiles } from "./gc.js";
import { appLog, captureConsole, compactJobHistory } from "./jobs.js";

export interface AppOptions {
  projectDir: string;
}

/**
 * Build skew detection: the running file's mtime is captured at boot; if a
 * later rebuild replaces it on disk, this process is stale. `webBuildId` is a
 * content token written into web-dist at UI build time — comparing that (not
 * mtime) lets the UI detect a stale browser tab without false positives after
 * npm pack/extract.
 */
const serverFile = fileURLToPath(import.meta.url);
const bootMtime = fs.existsSync(serverFile)
  ? fs.statSync(serverFile).mtimeMs
  : Date.now();

/** hosts a loopback-bound server should ever be addressed as */
const ALLOWED_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** Simple process-local token bucket for run/inject rate limiting. */
function createTokenBucket(opts: { capacity: number; refillPerSec: number }) {
  let tokens = opts.capacity;
  let last = Date.now();
  return {
    take(): boolean {
      const now = Date.now();
      tokens = Math.min(
        opts.capacity,
        tokens + ((now - last) / 1000) * opts.refillPerSec,
      );
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

export function createApp(opts: AppOptions) {
  captureConsole();
  appLog("server", `threadle server starting (pid ${process.pid}, node ${process.version})`);
  const app = new Hono();
  setDefaultProjectDir(opts.projectDir);

  // ---- hardening (localhost threat model) ----
  app.use("*", async (c, next) => {
    // DNS-rebinding guard: a malicious site can point its own hostname at
    // 127.0.0.1 and bypass the same-origin policy — reject foreign Hosts.
    const host = c.req.header("host") ?? "";
    if (!ALLOWED_HOST.test(host)) {
      appLog("server", "forbidden host");
      return c.text("forbidden host", 403);
    }

    // Cross-site guard for EVERY method, not just writes: several GETs have
    // side effects (MCP stdio spawn, git in a foreign cwd, class-node meta
    // probes, materialize), so a drive-by <img>/no-cors fetch must not reach
    // them. Browsers mark those requests Sec-Fetch-Site: cross-site; the SPA
    // sends "same-origin", address-bar visits send "none", and curl/CLI send
    // no header at all (allowed — loopback trust). Residual gap: pre-2023
    // Safari omits the header on GET, same as curl.
    const site = (c.req.header("sec-fetch-site") ?? "").toLowerCase();
    if (site === "cross-site") {
      appLog("server", "cross-site request rejected");
      return c.text("cross-site request rejected", 403);
    }

    // CSRF guard: browsers attach Origin to cross-site and same-origin
    // POSTs alike; state-changing requests must come from our own origin
    // (no Origin at all = curl/CLI, which is fine on loopback).
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = c.req.header("origin");
      if (origin) {
        let originHost: string;
        try {
          originHost = new URL(origin).host;
        } catch {
          appLog("server", "malformed origin");
          return c.text("malformed origin", 403);
        }
        if (!ALLOWED_HOST.test(originHost)) {
          appLog("server", "cross-origin write rejected");
          return c.text("cross-origin write rejected", 403);
        }
      }
    }

    await next();

    // response headers: lock the SPA down, leak nothing
    // API responses can carry transcript/config content — never disk-cache.
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    );
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join("; "),
    );
  });

  // bounded request bodies — nothing threadle accepts legitimately exceeds
  // this. A chunked request carries no Content-Length, which previously
  // skipped the cap entirely — require a declared length on bodied methods.
  app.use("/api/*", async (c, next) => {
    const method = c.req.method;
    const rawLen = c.req.header("content-length");
    if (rawLen !== undefined) {
      const len = Number(rawLen);
      if (!Number.isFinite(len) || len > 20 * 1024 * 1024) {
        return c.text("payload too large", 413);
      }
    } else if (
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS" &&
      (c.req.header("transfer-encoding") ?? "").toLowerCase().includes("chunked")
    ) {
      return c.text("chunked bodies require content-length", 411);
    }
    await next();
  });

  // Token-bucket rate limit on expensive mutating run/inject surfaces
  // (XSS / runaway graphs should not burn plan quota unchecked).
  const runBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5 });
  app.use("/api/run/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      return next();
    }
    if (!runBucket.take()) {
      appLog("server", "rate-limit: /api/run rejected");
      return c.text("too many runs — try again shortly", 429);
    }
    return next();
  });
  const injectBucket = createTokenBucket({ capacity: 40, refillPerSec: 1 });
  app.use("/api/inject/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      return next();
    }
    if (!injectBucket.take()) {
      appLog("server", "rate-limit: /api/inject rejected");
      return c.text("too many injects — try again shortly", 429);
    }
    return next();
  });
  // Other spawn-bearing surfaces share one bucket — custom-node runs, MCP
  // tool calls, and distills all launch child processes / burn quota.
  const workBucket = createTokenBucket({ capacity: 30, refillPerSec: 0.5 });
  for (const p of ["/api/custom-nodes/run", "/api/mcp/call", "/api/context/distill"]) {
    app.use(p, async (c, next) => {
      if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
        return next();
      }
      if (!workBucket.take()) {
        appLog("server", `rate-limit: ${p} rejected`);
        return c.text("too many requests — try again shortly", 429);
      }
      return next();
    });
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, "../web-dist");

  app.get("/api/health", (c) => {
    let serverStale = false;
    try {
      serverStale = fs.statSync(serverFile).mtimeMs > bootMtime;
    } catch {
      // bundle vanished — treat as stale
      serverStale = true;
    }
    let webBuildId: string | undefined;
    try {
      webBuildId = fs
        .readFileSync(path.join(webDist, "build-id"), "utf8")
        .trim();
      if (!webBuildId) webBuildId = undefined;
    } catch {
      webBuildId = undefined;
    }
    return c.json({
      ok: true,
      projectDir: opts.projectDir,
      serverStale,
      webBuildId,
      mem: process.memoryUsage().rss,
      uptime: Math.round(process.uptime()),
    });
  });
  app.get("/api/providers", async (c) => {
    const info = await registry.info();
    return c.json(
      await Promise.all(
        info.map(async (p) => ({ ...p, storage: await storageInfo(p.id) })),
      ),
    );
  });
  app.route("/api/sessions", sessionRoutes);
  app.route("/api/agents", agentRoutes);
  app.route("/api/graphs", graphRoutes);
  app.route("/api/context", contextRoutes);
  app.route("/api/payloads", payloadRoutes);
  app.route("/api/events", eventRoutes);
  app.route("/api/inject", injectRoutes);
  app.route("/api/run", runRoutes);
  app.route("/api/models", modelRoutes);
  app.route("/api/files", fileRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/open", openRoutes);
  app.route("/api/jobs", jobRoutes);
  app.route("/api/bundle", bundleRoutes);
  app.route("/api/rules", ruleRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/lineage", lineageRoutes);
  app.route("/api/atlas", atlasRoutes);
  app.route("/api/pricing", pricingRoutes);
  app.route("/api/subscription", subscriptionRoutes);
  app.route("/api/internals", internalsRoutes);
  app.route("/api/custom-nodes", customNodeRoutes);
  app.route("/api/mcp", mcpRoutes);
  app.route("/api/git", gitRoutes);
  app.route("/api/backup", backupRoutes);
  app.route("/api/favorites", favoriteRoutes);
  app.route("/api/memory", memoryRoutes);
  app.route("/api/plugins", pluginRoutes);

  app.onError((err, c) => {
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      return c.json({ error: err.message }, status as 400);
    }
    // 5xx: log the real error, return a generic body — raw messages leak
    // absolute paths and internals to whatever is calling the API.
    console.error("threadle:", err);
    return c.json({ error: "internal error — see server log" }, 500);
  });

  void gcTmpFiles();
  // …and keep sweeping: a daemon can be up for weeks, one boot-time sweep
  // would let tmp files and the append-only job history grow unbounded.
  setInterval(() => void gcTmpFiles(), 24 * 3_600_000).unref();
  void compactJobHistory();

  // Static frontend: web-dist sits next to dist/ in the published package,
  // and at packages/server/web-dist during development.
  if (fs.existsSync(webDist)) {
    const root = path.relative(process.cwd(), webDist) || ".";
    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  } else {
    app.get("/", (c) =>
      c.text(
        "threadle: frontend not built. Run `npm run build -w @threadle/web` (or use the Vite dev server on :5173).",
      ),
    );
  }

  return app;
}


// ---- provider storage overview (path + size, cached 10 min) ----

const storageCache = new Map<string, { at: number; value: StorageInfo | undefined }>();

interface StorageInfo {
  path: string;
  bytes: number;
  files: number;
}

async function dirSize(root: string, maxEntries = 20_000): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const stack = [root];
  while (stack.length && files < maxEntries) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          bytes += (await fs.promises.stat(full)).size;
          files += 1;
        } catch {
          // unreadable file
        }
      }
    }
  }
  return { bytes, files };
}

async function storageInfo(providerId: string): Promise<StorageInfo | undefined> {
  const cached = storageCache.get(providerId);
  if (cached && Date.now() - cached.at < 600_000) return cached.value;
  let value: StorageInfo | undefined;
  try {
    if (providerId === "claude-code") {
      const p = path.join(os.homedir(), ".claude", "projects");
      const s = await dirSize(p);
      value = { path: p, ...s };
    } else if (providerId === "opencode") {
      const p = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
      const st = await fs.promises.stat(p);
      value = { path: p, bytes: st.size, files: 1 };
    } else if (providerId === "cursor") {
      const p = path.join(os.homedir(), ".cursor", "projects");
      const s = await dirSize(p);
      value = { path: p, ...s };
    } else if (providerId === "antigravity") {
      const p = path.join(os.homedir(), ".gemini", "antigravity-cli");
      const s = await dirSize(p);
      value = { path: p, ...s };
    } else if (providerId === "codex") {
      const p = process.env.CODEX_HOME?.trim()
        ? path.resolve(process.env.CODEX_HOME.trim())
        : path.join(os.homedir(), ".codex");
      const s = await dirSize(p);
      value = { path: p, ...s };
    } else if (providerId === "copilot") {
      const p = process.env.COPILOT_HOME?.trim()
        ? path.resolve(process.env.COPILOT_HOME.trim())
        : path.join(os.homedir(), ".copilot");
      const s = await dirSize(p);
      value = { path: p, ...s };
    } else if (providerId === "grok") {
      const p = process.env.GROK_HOME?.trim()
        ? path.resolve(process.env.GROK_HOME.trim())
        : path.join(os.homedir(), ".grok");
      const s = await dirSize(p);
      value = { path: p, ...s };
    }
  } catch {
    value = undefined;
  }
  storageCache.set(providerId, { at: Date.now(), value });
  return value;
}
