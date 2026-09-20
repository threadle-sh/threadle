import fs from "node:fs";
import path from "node:path";
import type { ContentPart, NormalizedMessage } from "@threadle/shared";
import { opencodeDataDir, query, type MessageRow, type PartRow } from "./db.js";

const TOOL_OUTPUT_MAX_CHARS = 64_000;

interface MessageData {
  role?: "user" | "assistant" | "system";
  time?: { created?: number; completed?: number };
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  summary?: { diffs?: Array<{ file?: string }> };
}

interface PartData {
  type?: string;
  text?: string;
  synthetic?: boolean;
  ignored?: boolean;
  tool?: string;
  callID?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
  };
  tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } };
  cost?: number;
  hash?: string;
  files?: unknown;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…truncated]` : text;
}

function resolveToolOutput(state: PartData["state"]): string {
  const output = state?.output;
  if (typeof output === "string") {
    // large outputs are spilled to tool-output/tool_<id>; resolve references
    const spillMatch = /^tool-output\/(tool_[\w]+)$/.exec(output.trim());
    if (spillMatch) {
      try {
        const spillPath = path.join(opencodeDataDir(), "tool-output", spillMatch[1]!);
        return truncate(
          fs.readFileSync(spillPath, "utf8"),
          TOOL_OUTPUT_MAX_CHARS,
        );
      } catch {
        return output;
      }
    }
    return truncate(output, TOOL_OUTPUT_MAX_CHARS);
  }
  if (output === undefined || output === null) return "";
  return truncate(JSON.stringify(output), TOOL_OUTPUT_MAX_CHARS);
}

function partToContentParts(data: PartData): ContentPart[] {
  switch (data.type) {
    case "text":
      return typeof data.text === "string"
        ? [{ type: "text", text: data.text }]
        : [];
    case "reasoning":
      return typeof data.text === "string"
        ? [{ type: "thinking", text: data.text }]
        : [];
    case "tool": {
      const parts: ContentPart[] = [
        {
          type: "tool_use",
          toolName: data.tool ?? "tool",
          toolInput: data.state?.input,
          toolUseId: data.callID,
        },
      ];
      const outputText = resolveToolOutput(data.state);
      if (outputText) {
        parts.push({
          type: "tool_result",
          toolUseId: data.callID,
          isError: data.state?.status === "error",
          text: outputText,
        });
      }
      return parts;
    }
    case "patch": {
      const files = Array.isArray(data.files)
        ? data.files.map(String)
        : data.files && typeof data.files === "object"
          ? Object.keys(data.files)
          : [];
      return [
        {
          type: "patch",
          text: files.length ? `patched: ${files.join(", ")}` : "patch",
        },
      ];
    }
    default:
      // step-start / step-finish / compaction handled by caller (token harvest)
      return [];
  }
}

export async function readOpencodeTranscript(
  sessionId: string,
): Promise<NormalizedMessage[]> {
  const [messages, parts] = await Promise.all([
    query<MessageRow>(
      "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC",
      [sessionId],
    ),
    query<PartRow>(
      "SELECT message_id, data FROM part WHERE session_id = ? ORDER BY id ASC",
      [sessionId],
    ),
  ]);

  const partsByMessage = new Map<string, PartData[]>();
  for (const row of parts) {
    try {
      const data = JSON.parse(row.data) as PartData;
      if (!partsByMessage.has(row.message_id)) {
        partsByMessage.set(row.message_id, []);
      }
      partsByMessage.get(row.message_id)!.push(data);
    } catch {
      // skip unparseable part
    }
  }

  const out: NormalizedMessage[] = [];
  for (const row of messages) {
    let data: MessageData;
    try {
      data = JSON.parse(row.data) as MessageData;
    } catch {
      continue;
    }
    const rawParts = partsByMessage.get(row.id) ?? [];
    const contentParts: ContentPart[] = [];
    let synthetic = false;
    let tokens: NormalizedMessage["tokens"];
    let cost = data.cost;

    for (const p of rawParts) {
      if (p.synthetic || p.ignored) synthetic = true;
      if (p.type === "step-finish") {
        if (p.tokens)
          tokens = {
            input: p.tokens.input,
            output: p.tokens.output,
            cacheRead: p.tokens.cache?.read,
            cacheWrite: p.tokens.cache?.write,
          };
        if (typeof p.cost === "number") cost = (cost ?? 0) + p.cost;
        continue;
      }
      contentParts.push(...partToContentParts(p));
    }

    if (!contentParts.length) continue;
    if (data.tokens && !tokens) {
      tokens = { input: data.tokens.input, output: data.tokens.output };
    }

    out.push({
      id: row.id,
      role: data.role === "assistant" ? "assistant" : data.role === "system" ? "system" : "user",
      parts: contentParts,
      timestamp: data.time?.created,
      synthetic: synthetic || undefined,
      tokens,
      cost,
    });
  }
  return out;
}
