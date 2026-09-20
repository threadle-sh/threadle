import fs from "node:fs";
import path from "node:path";
import type { SessionRef } from "@threadle/shared";

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
