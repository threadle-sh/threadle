import type { ContentPart, NormalizedMessage } from "@threadle/shared";
import { readLines, type TranscriptLine } from "./jsonl.js";

const TOOL_RESULT_MAX_CHARS = 32_000;

function stringifyToolResultContent(content: unknown): string {
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

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…truncated]` : text;
}

function toMessage(entry: TranscriptLine): NormalizedMessage | undefined {
  const uuid = entry.uuid;
  if (!uuid) return undefined;

  if (entry.type === "user") {
    const content = entry.message?.content;
    const parts: ContentPart[] = [];
    if (typeof content === "string") {
      parts.push({ type: "text", text: content });
    } else if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "tool_result") {
          parts.push({
            type: "tool_result",
            toolUseId:
              typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
            isError: block.is_error === true,
            text: truncate(
              stringifyToolResultContent(block.content),
              TOOL_RESULT_MAX_CHARS,
            ),
          });
        } else if (block.type === "text" && typeof block.text === "string") {
          parts.push({ type: "text", text: block.text });
        }
      }
    }
    if (!parts.length) return undefined;
    return {
      id: uuid,
      role: "user",
      parts,
      timestamp: entry.timestamp ? Date.parse(entry.timestamp) : undefined,
    };
  }

  if (entry.type === "assistant") {
    const content = entry.message?.content;
    const parts: ContentPart[] = [];
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        switch (block.type) {
          case "text":
            if (typeof block.text === "string") {
              parts.push({ type: "text", text: block.text });
            }
            break;
          case "thinking":
            if (typeof block.thinking === "string") {
              parts.push({ type: "thinking", text: block.thinking });
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
          default:
            break;
        }
      }
    }
    if (!parts.length) return undefined;
    const usage = entry.message?.usage;
    return {
      id: uuid,
      role: "assistant",
      parts,
      timestamp: entry.timestamp ? Date.parse(entry.timestamp) : undefined,
      tokens: usage
        ? {
            input: usage.input_tokens,
            output: usage.output_tokens,
            cacheRead: usage.cache_read_input_tokens,
            cacheWrite: usage.cache_creation_input_tokens,
          }
        : undefined,
    };
  }

  return undefined;
}

/**
 * Reconstruct the current conversation branch of a Claude Code transcript.
 * File order can contain abandoned branches (rewind/compaction); the true
 * thread is the parentUuid chain ending at the last `last-prompt.leafUuid`.
 */
export async function readThread(filePath: string): Promise<NormalizedMessage[]> {
  const byUuid = new Map<string, TranscriptLine>();
  const fileOrder: string[] = [];
  let leafUuid: string | undefined;

  for await (const entry of readLines(filePath)) {
    if (entry.type === "last-prompt" && typeof entry.leafUuid === "string") {
      leafUuid = entry.leafUuid;
    }
    if (
      (entry.type === "user" || entry.type === "assistant") &&
      entry.uuid &&
      !entry.isSidechain &&
      !entry.isMeta
    ) {
      if (!byUuid.has(entry.uuid)) fileOrder.push(entry.uuid);
      byUuid.set(entry.uuid, entry);
    }
  }

  let ordered: TranscriptLine[];
  if (leafUuid && byUuid.has(leafUuid)) {
    const chain: TranscriptLine[] = [];
    const seen = new Set<string>();
    let cursor: string | null | undefined = leafUuid;
    while (cursor && byUuid.has(cursor) && !seen.has(cursor)) {
      const entry: TranscriptLine = byUuid.get(cursor)!;
      chain.push(entry);
      seen.add(cursor);
      cursor = entry.parentUuid;
    }
    chain.reverse();
    ordered = chain;
  } else {
    ordered = fileOrder.map((u) => byUuid.get(u)!);
  }

  const out: NormalizedMessage[] = [];
  for (const entry of ordered) {
    const msg = toMessage(entry);
    if (msg) out.push(msg);
  }
  return out;
}

/**
 * Every user/assistant message in file order, including abandoned branches —
 * used for whole-session aggregation (blueprints), not for reading as a thread.
 */
export async function readAllMessages(filePath: string): Promise<NormalizedMessage[]> {
  const out: NormalizedMessage[] = [];
  const seen = new Set<string>();
  for await (const entry of readLines(filePath)) {
    if (
      (entry.type === "user" || entry.type === "assistant") &&
      entry.uuid &&
      !seen.has(entry.uuid) &&
      !entry.isSidechain &&
      !entry.isMeta
    ) {
      seen.add(entry.uuid);
      const msg = toMessage(entry);
      if (msg) out.push(msg);
    }
  }
  return out;
}
