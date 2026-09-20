#!/usr/bin/env node
/**
 * Fetch models.dev list prices, validate, and write the bundled snapshot.
 * Used by CI (schedule / workflow_dispatch) — never at runtime.
 *
 *   node scripts/update-models-pricing.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://models.dev/api.json";
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_COST = 10_000; // $/1M tokens — reject absurd outliers
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "packages/server/data/models-pricing.json");

function fail(msg) {
  console.error(`update-models-pricing: ${msg}`);
  process.exit(1);
}

function assertFiniteCost(label, n) {
  if (n === undefined || n === null) return;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_COST) {
    fail(`bad cost ${label}=${String(n)}`);
  }
}

function validate(db) {
  if (!db || typeof db !== "object" || Array.isArray(db)) {
    fail("root must be a plain object (provider → models)");
  }
  if (Object.prototype.hasOwnProperty.call(db, "__proto__")) {
    fail("rejected __proto__ key at root");
  }
  const providers = Object.keys(db);
  if (providers.length < 1) fail("no providers");
  if (!db.anthropic?.models || typeof db.anthropic.models !== "object") {
    fail("missing anthropic.models (required for claude-code costs)");
  }
  let modelCount = 0;
  for (const [prov, block] of Object.entries(db)) {
    if (prov === "__proto__" || prov === "constructor" || prov === "prototype") {
      fail(`rejected dangerous provider key: ${prov}`);
    }
    if (!block || typeof block !== "object") continue;
    const models = block.models;
    if (!models || typeof models !== "object") continue;
    for (const [id, m] of Object.entries(models)) {
      if (!m || typeof m !== "object") continue;
      modelCount += 1;
      const c = m.cost;
      if (!c || typeof c !== "object") continue;
      assertFiniteCost(`${prov}/${id}.input`, c.input);
      assertFiniteCost(`${prov}/${id}.output`, c.output);
      assertFiniteCost(`${prov}/${id}.cache_read`, c.cache_read);
      assertFiniteCost(`${prov}/${id}.cache_write`, c.cache_write);
    }
  }
  if (modelCount < 1) fail("no models found");
  return { providers: providers.length, models: modelCount };
}

const res = await fetch(SOURCE_URL, {
  signal: AbortSignal.timeout(60_000),
  headers: { Accept: "application/json" },
});
if (!res.ok) fail(`HTTP ${res.status} from ${SOURCE_URL}`);
const buf = Buffer.from(await res.arrayBuffer());
if (buf.byteLength > MAX_BYTES) {
  fail(`response too large (${buf.byteLength} > ${MAX_BYTES})`);
}
let db;
try {
  db = JSON.parse(buf.toString("utf8"));
} catch (err) {
  fail(`JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
}
const stats = validate(db);
await fs.promises.mkdir(path.dirname(OUT), { recursive: true });
// Compact JSON — no pretty-print (keeps the npm package smaller).
await fs.promises.writeFile(OUT, JSON.stringify(db), "utf8");
console.log(
  `wrote ${OUT} · ${stats.providers} providers · ${stats.models} models · ${buf.byteLength} bytes`,
);
