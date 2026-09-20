import type { ContentPart, NormalizedMessage } from "@threadle/shared";

/** Rough char weight of a message for context-size estimation. */
function messageChars(m: NormalizedMessage): number {
  let n = 0;
  for (const p of m.parts) n += partChars(p);
  return n;
}

function partChars(p: ContentPart): number {
  let n = 0;
  if (typeof p.text === "string") n += p.text.length;
  if (typeof p.toolName === "string") n += p.toolName.length;
  if (p.toolInput !== undefined) {
    try {
      n += JSON.stringify(p.toolInput).length;
    } catch {
      // ignore
    }
  }
  return n;
}

/**
 * Build a context-size timeline from per-message usage when present.
 * Falls back to cumulative chars÷4 after each assistant turn (Cursor and
 * any provider that omits usage from the public transcript).
 */
export function buildContextTimeline(transcript: NormalizedMessage[]): {
  timeline: Array<{ ts?: number; context: number }>;
  estimated: boolean;
} {
  const fromUsage: Array<{ ts?: number; context: number }> = [];
  for (const m of transcript) {
    const tk = m.tokens;
    if (m.role === "assistant" && tk && ((tk.input ?? 0) || (tk.cacheRead ?? 0))) {
      fromUsage.push({
        ts: m.timestamp,
        context: (tk.input ?? 0) + (tk.cacheRead ?? 0) + (tk.cacheWrite ?? 0),
      });
    }
  }
  if (fromUsage.length) return { timeline: fromUsage, estimated: false };

  const estimated: Array<{ ts?: number; context: number }> = [];
  let cum = 0;
  for (const m of transcript) {
    cum += messageChars(m);
    if (m.role === "assistant" && cum > 0) {
      estimated.push({
        ts: m.timestamp,
        context: Math.max(1, Math.ceil(cum / 4)),
      });
    }
  }
  return { timeline: estimated, estimated: estimated.length > 0 };
}
