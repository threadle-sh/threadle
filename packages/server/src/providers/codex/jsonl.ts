import fs from "node:fs";
import type { ContentPart, NormalizedMessage } from "@threadle/shared";

export interface CodexRolloutLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
  /** legacy unwrapped shapes */
  id?: string;
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

const TOOL_RESULT_MAX = 32_000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…truncated]` : text;
}

function textFromContentBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const bits: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const t = b.type;
    if (
      (t === "input_text" || t === "output_text" || t === "text" || t === "summary_text") &&
      typeof b.text === "string"
    ) {
      bits.push(b.text);
    }
  }
  return bits.join("\n");
}

function isInstructionDump(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^<environment_context>/i.test(t)) return true;
  // Codex injects repo AGENTS.md / skills as a synthetic user turn
  if (/^#\s*AGENTS\.md\s+instructions\b/i.test(t)) return true;
  if (/^<skills_instructions>/i.test(t)) return true;
  if (/^<multi_agent_role>/i.test(t)) return true;
  if (/^<multi_agent_mode>/i.test(t)) return true;
  return false;
}

function partsFromResponseItem(payload: Record<string, unknown>): {
  role?: "user" | "assistant";
  parts: ContentPart[];
} {
  const itemType = typeof payload.type === "string" ? payload.type : "";
  const parts: ContentPart[] = [];

  if (itemType === "message") {
    const roleRaw = typeof payload.role === "string" ? payload.role : "";
    const role =
      roleRaw === "user" || roleRaw === "assistant"
        ? roleRaw
        : roleRaw === "system"
          ? undefined
          : undefined;
    const text = textFromContentBlocks(payload.content);
    if (text && !isInstructionDump(text)) {
      parts.push({ type: "text", text });
    }
    return { role, parts };
  }

  if (itemType === "reasoning") {
    const summary = textFromContentBlocks(payload.summary);
    const body = textFromContentBlocks(payload.content);
    const text = summary || body;
    if (text) parts.push({ type: "thinking", text });
    return { role: "assistant", parts };
  }

  if (
    itemType === "function_call" ||
    itemType === "custom_tool_call" ||
    itemType === "tool_call"
  ) {
    let input: unknown = payload.arguments ?? payload.input;
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        // keep string
      }
    }
    parts.push({
      type: "tool_use",
      toolName: typeof payload.name === "string" ? payload.name : "tool",
      toolInput: input,
      toolUseId:
        typeof payload.call_id === "string"
          ? payload.call_id
          : typeof payload.id === "string"
            ? payload.id
            : undefined,
    });
    return { role: "assistant", parts };
  }

  if (
    itemType === "function_call_output" ||
    itemType === "custom_tool_call_output" ||
    itemType === "tool_result"
  ) {
    const out = payload.output ?? payload.content;
    const text =
      typeof out === "string" ? out : out === undefined ? "" : JSON.stringify(out);
    parts.push({
      type: "tool_result",
      toolUseId: typeof payload.call_id === "string" ? payload.call_id : undefined,
      isError: payload.success === false || payload.is_error === true,
      text: truncate(text, TOOL_RESULT_MAX),
    });
    return { role: "assistant", parts };
  }

  return { parts };
}

/** Async iterator over JSONL records; skips malformed / unknown lines. */
export async function* readCodexLines(
  filePath: string,
): AsyncGenerator<CodexRolloutLine> {
  let text: string;
  try {
    text = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as CodexRolloutLine;
    } catch {
      // skip bad lines
    }
  }
}

export async function readCodexTranscript(
  filePath: string,
): Promise<NormalizedMessage[]> {
  const out: NormalizedMessage[] = [];
  let i = 0;
  const base = filePath.split(/[/\\]/).pop() ?? "rollout";

  for await (const entry of readCodexLines(filePath)) {
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : undefined;
    const stamp = Number.isFinite(ts) ? ts : undefined;

    // Wrapped ≥0.10: prefer response_item (model-visible log)
    if (entry.type === "response_item" && entry.payload && typeof entry.payload === "object") {
      const { role, parts } = partsFromResponseItem(entry.payload);
      if (!role || !parts.length) continue;
      out.push({
        id: `${base}:${i}`,
        role,
        parts,
        timestamp: stamp,
      });
      i += 1;
      continue;
    }

    // Legacy unwrapped message line
    if (entry.type === "message" || (!entry.type && entry.role)) {
      const { role, parts } = partsFromResponseItem({
        type: "message",
        role: entry.role,
        content: entry.content,
      });
      if (!role || !parts.length) continue;
      out.push({
        id: `${base}:${i}`,
        role,
        parts,
        timestamp: stamp,
      });
      i += 1;
      continue;
    }

    // Legacy reasoning / function_call at top level
    if (
      entry.type === "reasoning" ||
      entry.type === "function_call" ||
      entry.type === "function_call_output"
    ) {
      const { role, parts } = partsFromResponseItem(entry as Record<string, unknown>);
      if (!role || !parts.length) continue;
      out.push({
        id: `${base}:${i}`,
        role,
        parts,
        timestamp: stamp,
      });
      i += 1;
    }
  }

  return out;
}

export async function countCodexMessages(filePath: string): Promise<number> {
  const msgs = await readCodexTranscript(filePath);
  return msgs.length;
}

export async function readSessionMeta(
  filePath: string,
): Promise<{ id?: string; cwd?: string; model?: string; title?: string } | undefined> {
  let found: { id?: string; cwd?: string; model?: string; title?: string } | undefined;
  let n = 0;
  for await (const entry of readCodexLines(filePath)) {
    n += 1;
    if (entry.type === "session_meta" && entry.payload && typeof entry.payload === "object") {
      const p = entry.payload;
      found = {
        id: typeof p.id === "string" ? p.id : typeof p.session_id === "string" ? p.session_id : undefined,
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
        model: typeof p.model === "string" ? p.model : undefined,
        title:
          typeof p.session_name === "string"
            ? p.session_name
            : typeof p.title === "string"
              ? p.title
              : undefined,
      };
      // keep scanning a bit for model on turn_context if meta omitted it
      if (found.model) return found;
      continue;
    }
    // legacy first line
    if (!entry.type && typeof entry.id === "string") {
      found = {
        id: entry.id,
        cwd: typeof entry.cwd === "string" ? entry.cwd : undefined,
      };
      continue;
    }
    if (entry.type === "turn_context" && entry.payload) {
      const model = (entry.payload as { model?: string }).model;
      if (typeof model === "string") {
        if (found) {
          found.model ??= model;
          return found;
        }
        return { model };
      }
    }
    if (n >= 80) break;
  }
  return found;
}

export async function firstUserPrompt(filePath: string): Promise<string | undefined> {
  const msgs = await readCodexTranscript(filePath);
  for (const m of msgs) {
    if (m.role !== "user") continue;
    const text = m.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("\n")
      .trim();
    if (text) return text.slice(0, 200);
  }
  return undefined;
}
