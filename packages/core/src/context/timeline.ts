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

function promptPreview(m: NormalizedMessage, max = 220): string {
  const chunks: string[] = [];
  for (const p of m.parts) {
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
      chunks.push(p.text);
    }
  }
  const oneLine = chunks.join(" ").replace(/\s+/g, " ").trim();
  if (!oneLine) return "(no text)";
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function hasUserText(m: NormalizedMessage): boolean {
  return m.parts.some((p) => p.type === "text" && typeof p.text === "string" && p.text.trim());
}

function messageSignals(m: NormalizedMessage): {
  thinkingBlocks: number;
  thinkingChars: number;
  toolErrors: number;
  toolCalls: number;
  skillCalls: number;
} {
  let thinkingBlocks = 0;
  let thinkingChars = 0;
  let toolErrors = 0;
  let toolCalls = 0;
  let skillCalls = 0;
  for (const part of m.parts) {
    if (part.type === "thinking") {
      thinkingBlocks++;
      thinkingChars += part.text?.length ?? 0;
    }
    if (part.type === "tool_result" && part.isError) toolErrors++;
    if (part.type === "tool_use") {
      toolCalls++;
      if (part.toolName === "Skill") skillCalls++;
    }
  }
  return { thinkingBlocks, thinkingChars, toolErrors, toolCalls, skillCalls };
}

export interface ContextGrowthStep {
  context: number;
  delta: number;
  ts?: number;
  assistantMessageId: string;
  promptMessageId?: string;
  promptPreview: string;
  compacted: boolean;
  input?: number;
  cacheRead?: number;
  thinkingBlocks?: number;
  thinkingChars?: number;
  toolErrors?: number;
  toolCalls?: number;
  skillCalls?: number;
}

export interface ContextGrowth {
  steps: ContextGrowthStep[];
  estimated: boolean;
  peakContext: number;
  lastContext: number;
  truncated?: boolean;
}

const MAX_GROWTH_STEPS = 12_000;

function isCompaction(prev: number, cur: number): boolean {
  return prev > 20_000 && cur < prev * 0.55;
}

type RawStep = {
  context: number;
  ts?: number;
  assistantMessageId: string;
  promptMessageId?: string;
  promptPreview: string;
  input?: number;
  cacheRead?: number;
  thinkingBlocks?: number;
  thinkingChars?: number;
  toolErrors?: number;
  toolCalls?: number;
  skillCalls?: number;
};

function finalizeGrowth(raw: RawStep[], estimated: boolean): ContextGrowth {
  const truncated = raw.length > MAX_GROWTH_STEPS;
  const slice = truncated ? raw.slice(0, MAX_GROWTH_STEPS) : raw;
  const steps: ContextGrowthStep[] = [];
  let prev = 0;
  for (let i = 0; i < slice.length; i++) {
    const s = slice[i]!;
    const delta = i === 0 ? s.context : s.context - prev;
    steps.push({
      context: s.context,
      delta,
      ts: s.ts,
      assistantMessageId: s.assistantMessageId,
      promptMessageId: s.promptMessageId,
      promptPreview: s.promptPreview,
      compacted: i > 0 && isCompaction(prev, s.context),
      ...(s.input != null ? { input: s.input } : {}),
      ...(s.cacheRead != null ? { cacheRead: s.cacheRead } : {}),
      ...(s.thinkingBlocks ? { thinkingBlocks: s.thinkingBlocks } : {}),
      ...(s.thinkingChars ? { thinkingChars: s.thinkingChars } : {}),
      ...(s.toolErrors ? { toolErrors: s.toolErrors } : {}),
      ...(s.toolCalls ? { toolCalls: s.toolCalls } : {}),
      ...(s.skillCalls ? { skillCalls: s.skillCalls } : {}),
    });
    prev = s.context;
  }
  const peakContext = steps.reduce((a, t) => Math.max(a, t.context), 0);
  const lastContext = steps.at(-1)?.context ?? 0;
  return {
    steps,
    estimated,
    peakContext,
    lastContext,
    ...(truncated ? { truncated: true } : {}),
  };
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

/**
 * Per-turn context growth attributed to the nearest preceding user prompt.
 * Same measurement rules as {@link buildContextTimeline}.
 */
export function buildContextGrowth(transcript: NormalizedMessage[]): ContextGrowth {
  let lastUser: NormalizedMessage | undefined;
  const fromUsage: RawStep[] = [];
  for (const m of transcript) {
    if (m.role === "user" && hasUserText(m)) lastUser = m;
    const tk = m.tokens;
    if (m.role === "assistant" && tk && ((tk.input ?? 0) || (tk.cacheRead ?? 0))) {
      const sig = messageSignals(m);
      fromUsage.push({
        context: (tk.input ?? 0) + (tk.cacheRead ?? 0) + (tk.cacheWrite ?? 0),
        ts: m.timestamp,
        assistantMessageId: m.id,
        promptMessageId: lastUser?.id,
        promptPreview: lastUser ? promptPreview(lastUser) : "(no prior prompt)",
        input: tk.input ?? 0,
        cacheRead: tk.cacheRead ?? 0,
        ...sig,
      });
    }
  }
  if (fromUsage.length) return finalizeGrowth(fromUsage, false);

  lastUser = undefined;
  const estimated: RawStep[] = [];
  let cum = 0;
  for (const m of transcript) {
    if (m.role === "user" && hasUserText(m)) lastUser = m;
    cum += messageChars(m);
    if (m.role === "assistant" && cum > 0) {
      const sig = messageSignals(m);
      estimated.push({
        context: Math.max(1, Math.ceil(cum / 4)),
        ts: m.timestamp,
        assistantMessageId: m.id,
        promptMessageId: lastUser?.id,
        promptPreview: lastUser ? promptPreview(lastUser) : "(no prior prompt)",
        ...sig,
      });
    }
  }
  return finalizeGrowth(estimated, estimated.length > 0);
}
