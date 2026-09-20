import fs from "node:fs";
import path from "node:path";
import { threadleConfigDir } from "../../graphs/store.js";
import { cleanUserContent, readAntigravityLines } from "./jsonl.js";

export interface AntigravityUsage {
  tokensIn: number;
  tokensOut: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  source: "cli" | "estimate";
}

interface UsageCacheFile {
  version: 1;
  sessions: Record<
    string,
    {
      tokensIn: number;
      tokensOut: number;
      tokensReasoning?: number;
      tokensCacheRead?: number;
      updatedAt: number;
    }
  >;
}

function usageCachePath(): string {
  return path.join(threadleConfigDir(), "antigravity-usage.json");
}

async function loadCache(): Promise<UsageCacheFile> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(usageCachePath(), "utf8")) as UsageCacheFile;
    if (raw?.version === 1 && raw.sessions && typeof raw.sessions === "object") return raw;
  } catch {
    // missing / corrupt
  }
  return { version: 1, sessions: {} };
}

export async function recordAntigravityUsage(
  sessionId: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    cache_read_tokens?: number;
  },
): Promise<void> {
  const cache = await loadCache();
  cache.sessions[sessionId] = {
    tokensIn: usage.input_tokens ?? 0,
    tokensOut: usage.output_tokens ?? 0,
    tokensReasoning: usage.thinking_tokens,
    tokensCacheRead: usage.cache_read_tokens,
    updatedAt: Date.now(),
  };
  await fs.promises.mkdir(path.dirname(usageCachePath()), { recursive: true });
  await fs.promises.writeFile(usageCachePath(), JSON.stringify(cache), "utf8");
}

export async function estimateUsageFromTranscript(
  filePath: string,
): Promise<AntigravityUsage | undefined> {
  let inChars = 0;
  let outChars = 0;
  for await (const entry of readAntigravityLines(filePath)) {
    if (typeof entry.content !== "string") continue;
    if (entry.type === "USER_INPUT") {
      inChars += cleanUserContent(entry.content).length;
    } else if (
      entry.type === "PLANNER_RESPONSE" ||
      entry.type === "AGENT_RESPONSE" ||
      entry.type === "MODEL_RESPONSE"
    ) {
      outChars += entry.content.length;
    }
  }
  if (!inChars && !outChars) return undefined;
  return {
    tokensIn: Math.max(0, Math.ceil(inChars / 4)),
    tokensOut: Math.max(0, Math.ceil(outChars / 4)),
    source: "estimate",
  };
}

export async function resolveAntigravityUsage(
  sessionId: string,
  transcriptPath: string,
): Promise<AntigravityUsage | undefined> {
  const cache = await loadCache();
  const hit = cache.sessions[sessionId];
  if (hit) {
    return {
      tokensIn: hit.tokensIn,
      tokensOut: hit.tokensOut,
      tokensReasoning: hit.tokensReasoning,
      tokensCacheRead: hit.tokensCacheRead,
      source: "cli",
    };
  }
  return estimateUsageFromTranscript(transcriptPath);
}

export function invalidateUsageCache(): void {
  // no in-memory cache today; hook for discover invalidation symmetry
}
