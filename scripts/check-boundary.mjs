#!/usr/bin/env node
/**
 * Boundary check: viewer/core must not import wire.
 * Phase 1 of the viewer/wire split — cheap future extract.
 *
 * Allowed: app composition roots (router, GraphList, server.ts, cli.ts)
 * and anything under wire/ itself.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WEB_VIEWER = path.join(root, "packages/web/src/viewer");
const WEB_WIRE = path.join(root, "packages/web/src/wire");
const SERVER_SRC = path.join(root, "packages/server/src");
const SERVER_WIRE = path.join(SERVER_SRC, "wire");

/** Composition roots may mount wire. */
const WEB_ALLOW = new Set([
  path.join(root, "packages/web/src/router.ts"),
  path.join(root, "packages/web/src/views/GraphList.vue"),
  path.join(root, "packages/web/src/App.vue"),
  path.join(root, "packages/web/src/main.ts"),
]);

const SERVER_ALLOW = new Set([
  path.join(SERVER_SRC, "server.ts"),
  path.join(SERVER_SRC, "cli.ts"),
]);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|vue|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

function under(file, dir) {
  const a = path.resolve(file);
  const b = path.resolve(dir) + path.sep;
  return a.startsWith(b);
}

/** Match wire imports in source text. */
function webWireImports(src) {
  const hits = [];
  const patterns = [
    /from\s+["']@\/wire\//g,
    /from\s+["'][^"']*\/wire\//g,
    /import\s*\(\s*["'][^"']*\/wire\//g,
    /import\s*\(\s*["']\.\/wire\//g,
    /@\/wire\//g,
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(src))) hits.push(m[0]);
  }
  return hits;
}

function serverWireImports(src) {
  const hits = [];
  const patterns = [
    /from\s+["'][^"']*\/wire\//g,
    /from\s+["']\.\/wire\//g,
    /from\s+["']\.\.\/wire\//g,
    /import\s*\(\s*["'][^"']*wire\/workflows/g,
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(src))) hits.push(m[0]);
  }
  return hits;
}

const violations = [];

// Web: viewer/** must not import wire
for (const file of walk(WEB_VIEWER)) {
  const src = fs.readFileSync(file, "utf8");
  const hits = webWireImports(src);
  if (hits.length) {
    violations.push({ file, hits, rule: "viewer must not import wire" });
  }
}

// Web: non-wire, non-allowlisted files under src must not import wire
// (panels/components/lib that aren't composition roots)
for (const file of walk(path.join(root, "packages/web/src"))) {
  if (under(file, WEB_WIRE)) continue;
  if (WEB_ALLOW.has(file)) continue;
  if (under(file, WEB_VIEWER)) continue; // already checked
  // skip node_modules already
  const src = fs.readFileSync(file, "utf8");
  // Only flag panels/lib/stores/components — not router/views shell
  const rel = path.relative(path.join(root, "packages/web/src"), file);
  if (rel.startsWith("views" + path.sep) && path.basename(file) === "GraphList.vue") {
    continue;
  }
  if (
    rel.startsWith("panels" + path.sep) ||
    rel.startsWith("components" + path.sep) ||
    rel.startsWith("lib" + path.sep) ||
    rel.startsWith("stores" + path.sep)
  ) {
    // Shared chrome may reference wire for palette/canvas helpers later —
    // only forbid explicit @/wire imports from viewer chrome that isn't allowlisted.
    // Palette is shared with canvas; allow panels for now except we still
    // forbid viewer/**. Soft rule on shared chrome: warn only if importing @/wire.
    const hits = [...src.matchAll(/@\/wire\//g)].map((m) => m[0]);
    if (hits.length) {
      violations.push({
        file,
        hits,
        rule: "shared web chrome should not import @/wire (use composition root)",
      });
    }
  }
}

// Server: everything outside wire/ and allowlist must not import wire
for (const file of walk(SERVER_SRC)) {
  if (under(file, SERVER_WIRE)) continue;
  if (SERVER_ALLOW.has(file)) continue;
  // routes/run.ts and mcp/workflow-tools mount executor — composition-adjacent.
  // Treat routes that only exist to call wire as allowed adapters:
  const rel = path.relative(SERVER_SRC, file);
  if (
    rel === path.join("routes", "run.ts") ||
    rel === path.join("mcp", "workflow-tools.ts") ||
    rel === path.join("triggers", "index.ts") ||
    rel === path.join("context", "distill.ts")
  ) {
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  const hits = serverWireImports(src);
  if (hits.length) {
    violations.push({ file, hits, rule: "server core must not import wire" });
  }
}

if (violations.length) {
  console.error("boundary check FAILED:\n");
  for (const v of violations) {
    console.error(`  ${path.relative(root, v.file)}`);
    console.error(`    rule: ${v.rule}`);
    console.error(`    hits: ${[...new Set(v.hits)].join(", ")}`);
  }
  process.exit(1);
}

console.log("boundary check OK (viewer/core ↛ wire)");
