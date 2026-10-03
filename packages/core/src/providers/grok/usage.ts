import fs from "node:fs";
import path from "node:path";
import type { SessionRef } from "@threadle/shared";
import { sessionsRoot } from "./paths.js";

/** Docs: costUsdTicks is 10¹⁰ ticks per USD. */
const TICKS_PER_USD = 1e10;

interface UsageFile {
  session?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedReadTokens?: number;
    cacheCreationTokens?: number;
    reasoningTokens?: number;
    costUsdTicks?: number;
  };
}

export type GrokTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/** Read usage.json → inject-shaped tokens (nonzero only). */
export function readGrokUsageFile(usagePath: string): GrokTokenUsage | undefined {
  try {
    const raw = fs.readFileSync(usagePath, "utf8");
    const data = JSON.parse(raw) as UsageFile;
    const s = data.session;
    if (!s) return undefined;
    const inputTokens = typeof s.inputTokens === "number" ? s.inputTokens : 0;
    const outputTokens = typeof s.outputTokens === "number" ? s.outputTokens : 0;
    if (!inputTokens && !outputTokens) return undefined;
    return { inputTokens, outputTokens };
  } catch {
    return undefined;
  }
}

/** Locate `…/sessions/<cwd-slug>/<id>/usage.json` under GROK_HOME. */
export function findGrokUsagePath(
  sessionId: string,
  projectDir?: string,
): string | undefined {
  const root = sessionsRoot();
  if (projectDir) {
    const direct = path.join(
      root,
      encodeURIComponent(projectDir),
      sessionId,
      "usage.json",
    );
    if (fs.existsSync(direct)) return direct;
  }
  try {
    for (const g of fs.readdirSync(root, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name.startsWith(".")) continue;
      const candidate = path.join(root, g.name, sessionId, "usage.json");
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* missing root */
  }
  return undefined;
}

/** Brief settle for usage.json after a CLI exit (often written late / starts at 0). */
export async function waitGrokUsage(
  sessionId: string,
  projectDir?: string,
  attempts = 5,
  delayMs = 200,
): Promise<GrokTokenUsage | undefined> {
  for (let i = 0; i < attempts; i++) {
    const p = findGrokUsagePath(sessionId, projectDir);
    if (p) {
      const u = readGrokUsageFile(p);
      if (u) return u;
    }
    if (i + 1 < attempts) {
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  return undefined;
}

export function enrichSessionTokens(
  ref: SessionRef,
  sessionDir: string,
): SessionRef {
  const usagePath = path.join(sessionDir, "usage.json");
  try {
    const raw = fs.readFileSync(usagePath, "utf8");
    const data = JSON.parse(raw) as UsageFile;
    const s = data.session;
    if (!s) return ref;
    if (typeof s.inputTokens === "number") ref.tokensIn = s.inputTokens;
    if (typeof s.outputTokens === "number") ref.tokensOut = s.outputTokens;
    if (typeof s.reasoningTokens === "number") ref.tokensReasoning = s.reasoningTokens;
    if (typeof s.cachedReadTokens === "number") ref.tokensCacheRead = s.cachedReadTokens;
    if (typeof s.cacheCreationTokens === "number") ref.tokensCacheWrite = s.cacheCreationTokens;
    if (typeof s.costUsdTicks === "number" && Number.isFinite(s.costUsdTicks)) {
      const tracked = s.costUsdTicks / TICKS_PER_USD;
      ref.cost = tracked;
      // SuperGrok subscription — tracked list price only; actual spend is 0.
      ref.actualCost = 0;
    }
  } catch {
    /* missing / churn */
  }
  return ref;
}
