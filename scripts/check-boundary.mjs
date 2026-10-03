#!/usr/bin/env node
/**
 * Boundary check: the viewer and core never depend on workflows.
 *
 *   @threadle/shared            ← everyone (depends on nothing in-repo)
 *   @threadle/workflows-shared  → shared
 *   @threadle/core              → shared
 *   @threadle/workflows-server  → core, shared, workflows-shared
 *   threadle (bin)              → all server packages (composition root)
 *   @threadle/ui                → shared
 *   @threadle/workflows-web     → ui, shared, workflows-shared
 *   @threadle/web (viewer app)  → ui, shared (never the editor — separate app)
 *
 * Checked in package.json dependencies and in source imports (package
 * specifiers, the web aliases @/ @ui/ @wf/, and relative paths that escape
 * the package directory).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WEB_PKGS = ["@threadle/ui", "@threadle/web", "@threadle/workflows-web"];

/** package dir → forbidden package specifiers / aliases */
const RULES = [
  {
    dir: "packages/shared",
    packages: ["@threadle/workflows-shared", "@threadle/core", "@threadle/workflows-server", "threadle", ...WEB_PKGS],
  },
  {
    dir: "packages/workflows-shared",
    packages: ["@threadle/core", "@threadle/workflows-server", "threadle", ...WEB_PKGS],
  },
  {
    dir: "packages/core",
    packages: ["@threadle/workflows-shared", "@threadle/workflows-server", "threadle", ...WEB_PKGS],
  },
  { dir: "packages/workflows-server", packages: ["threadle", ...WEB_PKGS] },
  { dir: "packages/server", packages: WEB_PKGS },
  {
    dir: "packages/ui",
    packages: ["@threadle/workflows-shared", "@threadle/workflows-web", "@threadle/web"],
    aliases: ["@/", "@wf/"],
  },
  { dir: "packages/workflows-web", packages: ["@threadle/web"], aliases: ["@/"] },
  {
    dir: "packages/web",
    packages: ["@threadle/workflows-shared", "@threadle/workflows-web"],
    aliases: ["@wf/"],
  },
];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "web-dist") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|vue|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

function under(file, dir) {
  return path.resolve(file).startsWith(path.resolve(dir) + path.sep);
}

const IMPORT_RE = /(?:from|import\s*\(|import|vi\.mock\()\s*["']([^"']+)["']/g;

const violations = [];

for (const rule of RULES) {
  const dir = path.join(root, rule.dir);
  const pkgFile = path.join(dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const depHits = rule.packages.filter((d) => d in deps && !(rule.allowDeps ?? []).includes(d));
  if (depHits.length) {
    violations.push({ file: pkgFile, hits: depHits, rule: `${pkg.name} must not depend on these` });
  }
  const allowFiles = new Set((rule.allowFiles ?? []).map((f) => path.join(dir, f)));
  for (const file of [...walk(path.join(dir, "src")), ...walk(path.join(dir, "test"))]) {
    if (allowFiles.has(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    const hits = [];
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (rule.packages.some((f) => spec === f || spec.startsWith(`${f}/`))) hits.push(spec);
      if ((rule.aliases ?? []).some((a) => spec.startsWith(a))) hits.push(spec);
      if (spec.startsWith(".") && !under(path.resolve(path.dirname(file), spec), dir)) hits.push(spec);
    }
    if (hits.length) {
      violations.push({ file, hits, rule: `${pkg.name} must not import across its package boundary` });
    }
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

console.log("boundary check OK (viewer/core ↛ workflows)");
