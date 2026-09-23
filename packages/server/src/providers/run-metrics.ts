import type { LogSink } from "./stream.js";

/** Human-readable duration for run-log meta lines */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${rem.toString().padStart(2, "0")}s`;
}

/** Short session id fragment for meta lines */
export function shortId(id: string | undefined, n = 8): string {
  if (!id) return "";
  return id.length <= n ? id : id.slice(0, n);
}

export type RunTimer = {
  readonly startedAt: number;
  noteFirstAnswer: () => void;
  noteSpawn: (name: string) => void;
  noteTool: (name: string) => void;
  /** Elapsed ms since start */
  elapsed: () => number;
  /** One-line end summary (no leading glyph) */
  summary: (extra?: string) => string;
};

/** Wall-clock timer for provider / node runs */
export function createRunTimer(): RunTimer {
  const startedAt = Date.now();
  let firstAnswerAt: number | undefined;
  const spawns: string[] = [];
  let tools = 0;

  return {
    startedAt,
    noteFirstAnswer() {
      if (firstAnswerAt === undefined) firstAnswerAt = Date.now();
    },
    noteSpawn(name: string) {
      const n = name.trim();
      if (n && !spawns.includes(n)) spawns.push(n);
    },
    noteTool(_name: string) {
      tools += 1;
    },
    elapsed() {
      return Date.now() - startedAt;
    },
    summary(extra?: string) {
      const parts: string[] = [formatDuration(Date.now() - startedAt)];
      if (firstAnswerAt !== undefined) {
        const toAnswer = firstAnswerAt - startedAt;
        const post = Date.now() - firstAnswerAt;
        parts.push(`answer@${formatDuration(toAnswer)}`);
        if (post > 250) parts.push(`post-answer ${formatDuration(post)}`);
      }
      if (spawns.length) parts.push(`spawns ${spawns.length} (${spawns.join(", ")})`);
      if (tools) parts.push(`${tools} tool call${tools === 1 ? "" : "s"}`);
      if (extra?.trim()) parts.push(extra.trim());
      return parts.join(" · ");
    },
  };
}

/**
 * Wrap a provider agent call with ▶ / ■ meta lines (elapsed, optional session).
 * Mid-run spawn/tool notes still come from the provider's own onLog.
 */
export async function withProviderRunMetrics<T extends { newSessionId?: string }>(
  opts: {
    label: string;
    provider: string;
    model?: string;
    onLog?: LogSink;
  },
  run: (timer: RunTimer) => Promise<T>,
): Promise<T> {
  const timer = createRunTimer();
  const head = [opts.provider, opts.model].filter(Boolean).join("/");
  opts.onLog?.(
    "meta",
    `▶ ${opts.label}${head ? ` (${head})` : ""}`,
  );
  try {
    const result = await run(timer);
    const sid = shortId(result.newSessionId);
    opts.onLog?.(
      "meta",
      `■ ${opts.label} ${timer.summary(sid ? `session ${sid}` : undefined)}`,
    );
    return result;
  } catch (err) {
    opts.onLog?.(
      "meta",
      `■ ${opts.label} failed after ${formatDuration(timer.elapsed())}`,
    );
    throw err;
  }
}
