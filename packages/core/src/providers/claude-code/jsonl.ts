import fs from "node:fs";
import { LruMap } from "../../lru.js";
import readline from "node:readline";

function isClaudePlanPath(p: string): boolean {
  return /[/\\]\.claude[/\\]plans[/\\]/.test(p);
}

/** A single parsed line from a Claude Code transcript. Unknown types pass through untyped. */
export interface TranscriptLine {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: {
    role?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
    model?: string;
  };
  // bookkeeping line fields
  aiTitle?: string;
  lastPrompt?: string;
  leafUuid?: string;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export async function* readLines(filePath: string): AsyncGenerator<TranscriptLine> {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line) as TranscriptLine;
      } catch {
        // tolerate partial/corrupt lines (file may be mid-append)
      }
    }
  } finally {
    // A consumer that breaks/returns early triggers this via generator
    // return — rl.close() alone does NOT destroy the file stream, and an
    // undestroyed createReadStream holds its fd until GC.
    rl.close();
    input.destroy();
  }
}

/** per-model token tallies — the raw counts behind claude's /cost breakdown */
export interface ModelUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 1h-TTL share of cacheWrite — billed at ~2× the input rate, not the 5m rate */
  cacheWrite1h: number;
}

export interface SessionScan {
  cwd?: string;
  gitBranch?: string;
  title?: string;
  model?: string;
  firstTimestamp?: number;
  lastTimestamp?: number;
  messageCount: number;
  leafUuid?: string;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  usageByModel: Record<string, ModelUsage>;
  /** sum of system/turn_duration lines — agent working time, /cost's "API duration" */
  apiDurationMs: number;
  /** line churn across Edit/Write results, /cost's "code changes" */
  linesAdded: number;
  linesRemoved: number;
  permissionMode?: string;
  cliVersion?: string;
  bridgeSessionId?: string;
  /** Absolute path to ~/.claude/plans/*.md when ExitPlanMode / Write recorded one */
  planFilePath?: string;
}

/** One streaming pass over a transcript collecting listing metadata. */
export async function scanSession(filePath: string): Promise<SessionScan> {
  const scan: SessionScan = {
    messageCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    usageByModel: {},
    apiDurationMs: 0,
    linesAdded: 0,
    linesRemoved: 0,
  };
  for await (const entry of readLines(filePath)) {
    // line churn: Edit results carry structuredPatch hunks, Write-new carries content
    const tur = entry.toolUseResult;
    if (tur && typeof tur === "object") {
      const r = tur as {
        type?: string;
        content?: unknown;
        structuredPatch?: Array<{ lines?: string[] }>;
      };
      if (Array.isArray(r.structuredPatch)) {
        for (const hunk of r.structuredPatch) {
          for (const l of hunk.lines ?? []) {
            if (l.startsWith("+")) scan.linesAdded++;
            else if (l.startsWith("-")) scan.linesRemoved++;
          }
        }
      } else if (r.type === "create" && typeof r.content === "string") {
        scan.linesAdded += r.content.split("\n").length;
      }
    }
    switch (entry.type) {
      case "system":
        if (
          (entry as Record<string, unknown>).subtype === "turn_duration" &&
          typeof (entry as Record<string, unknown>).durationMs === "number"
        ) {
          scan.apiDurationMs += (entry as { durationMs: number }).durationMs;
        }
        break;
      case "ai-title":
        if (typeof entry.aiTitle === "string") scan.title = entry.aiTitle;
        break;
      case "last-prompt":
        if (typeof entry.leafUuid === "string") scan.leafUuid = entry.leafUuid;
        break;
      case "bridge-session": {
        const b = (entry as Record<string, unknown>).bridgeSessionId;
        if (typeof b === "string") scan.bridgeSessionId = b;
        break;
      }
      case "permission-mode": {
        const mode = (entry as Record<string, unknown>).permissionMode;
        if (typeof mode === "string") scan.permissionMode = mode;
        break;
      }
      case "user": {
        if (typeof entry.message?.content === "string") scan.messageCount++;
        break;
      }
      case "assistant":
        scan.messageCount++;
        if (entry.message?.model && entry.message.model !== "<synthetic>") {
          scan.model = entry.message.model;
        }
        if (Array.isArray(entry.message?.content)) {
          for (const block of entry.message.content as Array<Record<string, unknown>>) {
            if (block.type !== "tool_use") continue;
            const name = typeof block.name === "string" ? block.name : "";
            const input =
              block.input && typeof block.input === "object"
                ? (block.input as Record<string, unknown>)
                : undefined;
            if (!input) continue;
            if (name === "ExitPlanMode" && typeof input.planFilePath === "string") {
              scan.planFilePath = input.planFilePath;
            } else if (
              (name === "Write" || name === "Edit") &&
              typeof input.file_path === "string" &&
              isClaudePlanPath(input.file_path)
            ) {
              scan.planFilePath = input.file_path;
            }
          }
        }
        if (entry.message?.usage) {
          const u = entry.message.usage;
          scan.tokensIn += u.input_tokens ?? 0;
          scan.tokensOut += u.output_tokens ?? 0;
          scan.tokensCacheRead += u.cache_read_input_tokens ?? 0;
          scan.tokensCacheWrite += u.cache_creation_input_tokens ?? 0;
          const model = entry.message.model;
          if (model && model !== "<synthetic>") {
            const m = (scan.usageByModel[model] ??= {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              cacheWrite1h: 0,
            });
            m.input += u.input_tokens ?? 0;
            m.output += u.output_tokens ?? 0;
            m.cacheRead += u.cache_read_input_tokens ?? 0;
            m.cacheWrite += u.cache_creation_input_tokens ?? 0;
            m.cacheWrite1h += u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
          }
        }
        break;
      default:
        break;
    }
    if (entry.cwd && !scan.cwd) scan.cwd = entry.cwd;
    if (!scan.cliVersion && typeof (entry as Record<string, unknown>).version === "string") {
      scan.cliVersion = (entry as Record<string, unknown>).version as string;
    }
    if (entry.gitBranch && !scan.gitBranch) scan.gitBranch = entry.gitBranch;
    if (entry.timestamp) {
      const t = Date.parse(entry.timestamp);
      if (!Number.isNaN(t)) {
        if (scan.firstTimestamp === undefined) scan.firstTimestamp = t;
        scan.lastTimestamp = t;
      }
    }
  }
  return scan;
}

// LRU, not Map: keyed by transcript path — every session EVER seen would
// otherwise stay cached for the daemon's lifetime, surviving file deletion.
const scanCache = new LruMap<string, { mtimeMs: number; size: number; scan: SessionScan }>(1000);

export async function scanSessionCached(filePath: string): Promise<SessionScan> {
  const stat = await fs.promises.stat(filePath);
  const cached = scanCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.scan;
  }
  const scan = await scanSession(filePath);
  scanCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, scan });
  return scan;
}
