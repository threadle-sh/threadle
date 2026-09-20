import fs from "node:fs";
import path from "node:path";
import { threadleConfigDir } from "../../graphs/store.js";
import { readCursorLines, type CursorContentBlock } from "./jsonl.js";

export interface CursorUsage {
  tokensIn: number;
  tokensOut: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
  /** authoritative from agent CLI result; estimate from transcript chars */
  source: "cli" | "estimate" | "turn_ended";
}

export interface CursorCliUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface UsageCacheFile {
  version: 1;
  /** sessionId → usage (cli-captured only) */
  sessions: Record<string, Omit<CursorUsage, "source"> & { updatedAt: number }>;
}

function usageCachePath(): string {
  return path.join(threadleConfigDir(), "cursor-usage.json");
}

let cacheMem: UsageCacheFile | undefined;

async function loadCache(): Promise<UsageCacheFile> {
  if (cacheMem) return cacheMem;
  try {
    const raw = JSON.parse(
      await fs.promises.readFile(usageCachePath(), "utf8"),
    ) as UsageCacheFile;
    if (raw?.version === 1 && raw.sessions && typeof raw.sessions === "object") {
      cacheMem = raw;
      return raw;
    }
  } catch {
    // missing / corrupt
  }
  cacheMem = { version: 1, sessions: {} };
  return cacheMem;
}

/** Persist usage captured from an `agent --print` result event. */
export async function recordCursorUsage(
  sessionId: string,
  usage: CursorCliUsage,
): Promise<void> {
  const inTok = num(usage.inputTokens);
  const outTok = num(usage.outputTokens);
  if (inTok === undefined && outTok === undefined) return;
  const cache = await loadCache();
  cache.sessions[sessionId] = {
    tokensIn: inTok ?? 0,
    tokensOut: outTok ?? 0,
    tokensReasoning: num(usage.reasoningTokens),
    tokensCacheRead: num(usage.cacheReadTokens),
    tokensCacheWrite: num(usage.cacheWriteTokens),
    updatedAt: Date.now(),
  };
  await fs.promises.mkdir(threadleConfigDir(), { recursive: true });
  await fs.promises.writeFile(usageCachePath(), JSON.stringify(cache, null, 2), "utf8");
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Math.round(Number(v));
  }
  return undefined;
}

/** ≈ tokens from UTF-8 char length (same rule of thumb Claude tools often use). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function contentTextLens(content: CursorContentBlock[] | string | undefined): {
  text: number;
  tools: number;
  thinking: number;
  results: number;
} {
  let text = 0;
  let tools = 0;
  let thinking = 0;
  let results = 0;
  if (typeof content === "string") return { text: content.length, tools: 0, thinking: 0, results: 0 };
  if (!Array.isArray(content)) return { text: 0, tools: 0, thinking: 0, results: 0 };
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") text += block.text.length;
    else if (block.type === "thinking" || block.type === "reasoning") {
      thinking +=
        typeof block.thinking === "string"
          ? block.thinking.length
          : typeof block.text === "string"
            ? block.text.length
            : 0;
    } else if (block.type === "tool_use") {
      tools += (block.name?.length ?? 0) + JSON.stringify(block.input ?? {}).length;
    } else if (block.type === "tool_result") {
      results +=
        typeof block.content === "string"
          ? block.content.length
          : JSON.stringify(block.content ?? "").length;
    }
  }
  return { text, tools, thinking, results };
}

/**
 * Cursor's public JSONL usually omits usage. Prefer any `turn_ended` token fields
 * if present; else estimate text/tool/thinking from transcript chars ÷ 4.
 */
export async function estimateUsageFromTranscript(
  transcriptPath: string,
): Promise<CursorUsage | undefined> {
  let inChars = 0;
  let outChars = 0;
  let thinkChars = 0;
  let fromTurn: CursorUsage | undefined;

  for await (const entry of readCursorLines(transcriptPath)) {
    if (entry.type === "turn_ended") {
      const e = entry as {
        inputTokens?: unknown;
        outputTokens?: unknown;
        reasoningTokens?: unknown;
        cacheReadTokens?: unknown;
        cacheWriteTokens?: unknown;
        input_tokens?: unknown;
        output_tokens?: unknown;
        reasoning_tokens?: unknown;
        cache_read_tokens?: unknown;
        cache_write_tokens?: unknown;
      };
      const tin = num(e.inputTokens ?? e.input_tokens);
      const tout = num(e.outputTokens ?? e.output_tokens);
      const tr = num(e.reasoningTokens ?? e.reasoning_tokens);
      const cr = num(e.cacheReadTokens ?? e.cache_read_tokens);
      const cw = num(e.cacheWriteTokens ?? e.cache_write_tokens);
      if (
        tin !== undefined ||
        tout !== undefined ||
        tr !== undefined ||
        cr !== undefined ||
        cw !== undefined
      ) {
        const prev = fromTurn ?? {
          tokensIn: 0,
          tokensOut: 0,
          source: "turn_ended" as const,
        };
        fromTurn = {
          tokensIn: prev.tokensIn + (tin ?? 0),
          tokensOut: prev.tokensOut + (tout ?? 0),
          tokensReasoning: (prev.tokensReasoning ?? 0) + (tr ?? 0),
          tokensCacheRead: (prev.tokensCacheRead ?? 0) + (cr ?? 0),
          tokensCacheWrite: (prev.tokensCacheWrite ?? 0) + (cw ?? 0),
          source: "turn_ended",
        };
      }
      continue;
    }
    if (!entry.role) continue;
    const lens = contentTextLens(entry.message?.content);
    if (entry.role === "user" || entry.role === "system") {
      inChars += lens.text + lens.results;
    } else if (entry.role === "assistant") {
      outChars += lens.text + lens.tools;
      thinkChars += lens.thinking;
    }
  }

  if (fromTurn) {
    // drop zero-only optional fields so UI shows "—" instead of 0 when absent
    return {
      ...fromTurn,
      tokensReasoning: fromTurn.tokensReasoning || undefined,
      tokensCacheRead: fromTurn.tokensCacheRead || undefined,
      tokensCacheWrite: fromTurn.tokensCacheWrite || undefined,
    };
  }
  if (!inChars && !outChars && !thinkChars) return undefined;
  return {
    tokensIn: Math.max(0, Math.ceil(inChars / 4)),
    tokensOut: Math.max(0, Math.ceil(outChars / 4)),
    tokensReasoning: thinkChars ? Math.max(0, Math.ceil(thinkChars / 4)) : undefined,
    source: "estimate",
  };
}

/** Prefer CLI-captured usage, else transcript estimate / turn_ended. */
export async function resolveCursorUsage(
  sessionId: string,
  transcriptPath: string,
): Promise<CursorUsage | undefined> {
  const cache = await loadCache();
  const hit = cache.sessions[sessionId];
  if (hit) {
    return {
      tokensIn: hit.tokensIn,
      tokensOut: hit.tokensOut,
      tokensReasoning: hit.tokensReasoning,
      tokensCacheRead: hit.tokensCacheRead,
      tokensCacheWrite: hit.tokensCacheWrite,
      source: "cli",
    };
  }
  return estimateUsageFromTranscript(transcriptPath);
}

export function invalidateUsageCache(): void {
  cacheMem = undefined;
}
