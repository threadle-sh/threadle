import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { listOpencodeModels } from "../providers/opencode/inject.js";
import { threadleConfigDir } from "../graphs/store.js";
import type { ModelUsage } from "../providers/claude-code/jsonl.js";

/**
 * List prices per 1M tokens (models.dev shape). Local-only, never phones home:
 *   1. opencode cache (~/.cache/opencode/models.json) when present
 *   2. bundled snapshot shipped with the package (CI-refreshed)
 *   3. legacy ~/.config/threadle/models-pricing.json (older installs only)
 * See scripts/update-models-pricing.mjs.
 */

export interface PriceRow {
  provider: string;
  id: string;
  name: string;
  /** $ per 1M tokens */
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  context?: number;
  maxOutput?: number;
  reasoning?: boolean;
  knowledge?: string;
  releaseDate?: string;
}

interface ModelsDev {
  [provider: string]: {
    name?: string;
    models?: Record<
      string,
      {
        name?: string;
        cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
        limit?: { context?: number; output?: number };
        reasoning?: boolean;
        knowledge?: string;
        release_date?: string;
      }
    >;
  };
}

let memDb: { db: ModelsDev; at: number; source: string } | undefined;

const MEM_TTL = 6 * 3_600_000;

/** Bundled snapshot path — works from tsup `dist/cli.js` and tsx `src/routes/`. */
export function bundledPricingPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "data", "models-pricing.json"), // dist/cli.js → ../data
    path.join(here, "..", "..", "data", "models-pricing.json"), // src/routes → ../../data
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return candidates[0]!;
}

function parseDb(raw: string): ModelsDev | undefined {
  try {
    const db = JSON.parse(raw) as ModelsDev;
    if (!db || typeof db !== "object" || Array.isArray(db)) return undefined;
    return db;
  } catch {
    return undefined;
  }
}

async function tryLoad(file: string): Promise<ModelsDev | undefined> {
  try {
    return parseDb(await fs.promises.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Prefer opencode mirror, then shipped bundle, then legacy user cache. */
async function loadModelsDb(): Promise<{ db: ModelsDev; source: string } | undefined> {
  if (memDb && Date.now() - memDb.at < MEM_TTL) {
    return { db: memDb.db, source: memDb.source };
  }

  const opencode = await tryLoad(path.join(os.homedir(), ".cache", "opencode", "models.json"));
  if (opencode) {
    memDb = { db: opencode, at: Date.now(), source: "opencode cache" };
    return { db: opencode, source: "opencode cache" };
  }

  const bundled = await tryLoad(bundledPricingPath());
  if (bundled) {
    memDb = { db: bundled, at: Date.now(), source: "bundled" };
    return { db: bundled, source: "bundled" };
  }

  const legacy = await tryLoad(path.join(threadleConfigDir(), "models-pricing.json"));
  if (legacy) {
    memDb = { db: legacy, at: Date.now(), source: "local cache" };
    return { db: legacy, source: "local cache" };
  }

  return undefined;
}

export interface ModelUsageRow extends ModelUsage {
  model: string;
  cost?: number;
}

/** $ for one model's claude-code usage; undefined when the model has no list price */
async function claudeUsageCost(modelId: string, u: ModelUsage): Promise<number | undefined> {
  const models = (await loadModelsDb())?.db.anthropic?.models;
  if (!models) return undefined;
  const key =
    modelId in models
      ? modelId
      : Object.keys(models)
          .filter((k) => modelId.startsWith(k))
          .sort((a, b) => b.length - a.length)[0];
  const cost = key ? models[key]?.cost : undefined;
  if (!cost) return undefined;
  const w1h = Math.min(u.cacheWrite1h, u.cacheWrite);
  const w5m = u.cacheWrite - w1h;
  // models.dev cache_write is the 5m rate; 1h-TTL writes bill at 2× input
  const rate1h = cost.input !== undefined ? cost.input * 2 : (cost.cache_write ?? 0) * 1.6;
  return (
    (u.input * (cost.input ?? 0) +
      u.output * (cost.output ?? 0) +
      u.cacheRead * (cost.cache_read ?? 0) +
      w5m * (cost.cache_write ?? 0) +
      w1h * rate1h) /
    1_000_000
  );
}

/** per-model rows with $ plus the session total — /cost's "Usage by model" */
export async function claudeUsageRows(
  usageByModel: Record<string, ModelUsage>,
): Promise<{ rows: ModelUsageRow[]; total?: number }> {
  const rows: ModelUsageRow[] = [];
  let total: number | undefined;
  for (const [model, u] of Object.entries(usageByModel)) {
    const cost = await claudeUsageCost(model, u);
    if (cost !== undefined) total = (total ?? 0) + cost;
    rows.push({ model, ...u, cost });
  }
  rows.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  return { rows, total };
}

export const pricingRoutes = new Hono();

pricingRoutes.get("/", async (c) => {
  const loaded = await loadModelsDb();
  if (!loaded) {
    return c.json({ rows: [], source: "unavailable (no bundled or local prices)" });
  }
  const { db, source } = loaded;

  // scope to providers the user can actually run: anthropic (Claude Code)
  // plus every provider prefix exposed by the user's opencode install
  const wanted = new Set(["anthropic", "opencode"]);
  try {
    for (const id of await listOpencodeModels()) {
      const slash = id.indexOf("/");
      if (slash > 0) wanted.add(id.slice(0, slash));
    }
  } catch {
    // opencode absent — anthropic + opencode defaults remain
  }

  const rows: PriceRow[] = [];
  for (const prov of wanted) {
    const models = db[prov]?.models;
    if (!models) continue;
    for (const [id, m] of Object.entries(models)) {
      rows.push({
        provider: prov,
        id,
        name: m.name ?? id,
        input: m.cost?.input,
        output: m.cost?.output,
        cacheRead: m.cost?.cache_read,
        cacheWrite: m.cost?.cache_write,
        context: m.limit?.context,
        maxOutput: m.limit?.output,
        reasoning: m.reasoning,
        knowledge: m.knowledge,
        releaseDate: m.release_date,
      });
    }
  }
  rows.sort(
    (a, b) => a.provider.localeCompare(b.provider) || (b.output ?? 0) - (a.output ?? 0),
  );
  return c.json({ rows, source });
});
