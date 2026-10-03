import fs from "node:fs";
import type { ContentPart, NormalizedMessage } from "@threadle/shared";

export interface CursorContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

export interface CursorTranscriptLine {
  role?: string;
  type?: string;
  status?: string;
  message?: {
    content?: CursorContentBlock[] | string;
  };
}

const TOOL_RESULT_MAX = 32_000;

/**
 * Cursor wraps user turns as:
 *   <timestamp>…</timestamp>
 *   <user_query>\nactual text\n</user_query>
 * Strip the chrome for display / matching; keep inner newlines.
 */
export function formatCursorUserText(text: string): string {
  let t = text.replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/gi, "");
  const wrapped = t.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (wrapped) t = wrapped[1] ?? "";
  else t = t.replace(/<\/?user_query>/gi, "");
  return t.replace(/^\s+|\s+$/g, "");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…truncated]` : text;
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: unknown }).text);
        }
        return JSON.stringify(block);
      })
      .join("\n");
  }
  return content === undefined ? "" : JSON.stringify(content);
}

function partsFromContent(content: CursorContentBlock[] | string | undefined): ContentPart[] {
  const parts: ContentPart[] = [];
  if (typeof content === "string") {
    if (content) parts.push({ type: "text", text: content });
    return parts;
  }
  if (!Array.isArray(content)) return parts;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
        if (typeof block.text === "string" && block.text) {
          parts.push({ type: "text", text: block.text });
        }
        break;
      case "thinking":
      case "reasoning":
        if (typeof block.thinking === "string" && block.thinking) {
          parts.push({ type: "thinking", text: block.thinking });
        } else if (typeof block.text === "string" && block.text) {
          parts.push({ type: "thinking", text: block.text });
        }
        break;
      case "tool_use":
        parts.push({
          type: "tool_use",
          toolName: typeof block.name === "string" ? block.name : "tool",
          toolInput: block.input,
          toolUseId: typeof block.id === "string" ? block.id : undefined,
        });
        break;
      case "tool_result":
        parts.push({
          type: "tool_result",
          toolUseId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
          isError: block.is_error === true,
          text: truncate(stringifyToolResult(block.content), TOOL_RESULT_MAX),
        });
        break;
      default:
        // unknown block types — skip (format churn)
        break;
    }
  }
  return parts;
}

/** Async iterator over JSONL records; skips malformed / unknown lines. */
export async function* readCursorLines(
  filePath: string,
): AsyncGenerator<CursorTranscriptLine> {
  let text: string;
  try {
    text = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as CursorTranscriptLine;
    } catch {
      // skip bad lines
    }
  }
}

export async function readCursorTranscript(filePath: string): Promise<NormalizedMessage[]> {
  const out: NormalizedMessage[] = [];
  let i = 0;
  for await (const entry of readCursorLines(filePath)) {
    // skip control records like {type:"turn_ended",status:"success"}
    if (!entry.role) continue;
    const role =
      entry.role === "user" || entry.role === "assistant" || entry.role === "system"
        ? entry.role
        : undefined;
    if (!role) continue;
    const parts = partsFromContent(entry.message?.content);
    if (role === "user") {
      for (const p of parts) {
        if (p.type === "text" && p.text) p.text = formatCursorUserText(p.text);
      }
    }
    if (!parts.length) continue;
    // Drop empty user shells after stripping wrappers
    if (role === "user" && parts.every((p) => p.type === "text" && !p.text?.trim())) continue;
    out.push({
      id: `${pathBasename(filePath)}:${i++}`,
      role,
      parts,
    });
  }
  return out;
}

function pathBasename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** Count role-bearing messages without full normalize (for list discover). */
export async function countCursorMessages(filePath: string): Promise<number> {
  let n = 0;
  for await (const entry of readCursorLines(filePath)) {
    if (entry.role === "user" || entry.role === "assistant" || entry.role === "system") n += 1;
  }
  return n;
}
