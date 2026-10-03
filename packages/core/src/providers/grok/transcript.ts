import fs from "node:fs";
import path from "node:path";
import type { ContentPart, NormalizedMessage } from "@threadle/shared";
import { resolveSessionDir } from "./discover.js";

function parseIso(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

function stripUserQuery(text: string): string {
  const m = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i.exec(text);
  return (m?.[1] ?? text).trim();
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

/**
 * Prefer chat_history.jsonl for roles; fall back to coalescing updates.jsonl
 * ACP chunks. Unknown record types are skipped.
 */
export async function readGrokTranscript(sessionId: string): Promise<NormalizedMessage[]> {
  const dir = await resolveSessionDir(sessionId);
  if (!dir) return [];

  const fromChat = await readChatHistory(sessionId, dir);
  if (fromChat.length > 0) return fromChat;
  return readUpdates(sessionId, dir);
}

async function readChatHistory(
  sessionId: string,
  dir: string,
): Promise<NormalizedMessage[]> {
  const file = path.join(dir, "chat_history.jsonl");
  const out: NormalizedMessage[] = [];
  let idx = 0;
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = row.type;
      if (type === "system") continue;
      if (row.synthetic_reason) continue;

      if (type === "user") {
        const text = stripUserQuery(textFromContent(row.content));
        if (!text) continue;
        // Skip harness wrappers that land as role=user without synthetic_reason.
        if (
          text.startsWith("<user_info>") ||
          text.startsWith("<system-reminder>") ||
          text.startsWith("<system>")
        ) {
          continue;
        }
        out.push({
          id: `${sessionId}:u:${idx++}`,
          role: "user",
          parts: [{ type: "text", text }],
        });
        continue;
      }

      if (type === "reasoning") {
        const summary = row.summary;
        let think = "";
        if (Array.isArray(summary)) {
          think = summary
            .map((s) =>
              s && typeof s === "object" && typeof (s as { text?: string }).text === "string"
                ? (s as { text: string }).text
                : "",
            )
            .filter(Boolean)
            .join("\n");
        }
        if (!think && typeof row.content === "string") think = row.content;
        if (!think) continue;
        out.push({
          id: `${sessionId}:t:${idx++}`,
          role: "assistant",
          parts: [{ type: "thinking", text: think }],
        });
        continue;
      }

      if (type === "assistant") {
        const text = textFromContent(row.content);
        if (!text.trim()) continue;
        out.push({
          id: `${sessionId}:a:${idx++}`,
          role: "assistant",
          parts: [{ type: "text", text }],
        });
        continue;
      }
      /* unknown — skip */
    }
  } catch {
    return [];
  }
  return out;
}

async function readUpdates(
  sessionId: string,
  dir: string,
): Promise<NormalizedMessage[]> {
  const file = path.join(dir, "updates.jsonl");
  const out: NormalizedMessage[] = [];
  let userBuf = "";
  let assistantBuf = "";
  let thinkBuf = "";
  let idx = 0;
  let lastTs: number | undefined;

  const flush = () => {
    if (userBuf.trim()) {
      out.push({
        id: `${sessionId}:u:${idx++}`,
        role: "user",
        parts: [{ type: "text", text: userBuf }],
        timestamp: lastTs,
      });
      userBuf = "";
    }
    const parts: ContentPart[] = [];
    if (thinkBuf.trim()) parts.push({ type: "thinking", text: thinkBuf });
    if (assistantBuf.trim()) parts.push({ type: "text", text: assistantBuf });
    if (parts.length) {
      out.push({
        id: `${sessionId}:a:${idx++}`,
        role: "assistant",
        parts,
        timestamp: lastTs,
      });
    }
    thinkBuf = "";
    assistantBuf = "";
  };

  try {
    const raw = await fs.promises.readFile(file, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const params = row.params as
        | { update?: { sessionUpdate?: string; content?: { text?: string } }; _meta?: { agentTimestampMs?: number } }
        | undefined;
      const update = params?.update;
      const kind = update?.sessionUpdate;
      const text = update?.content?.text ?? "";
      const ts = params?._meta?.agentTimestampMs;
      if (typeof ts === "number") lastTs = ts;

      if (kind === "user_message_chunk") {
        if (assistantBuf || thinkBuf) flush();
        userBuf += text;
        continue;
      }
      if (kind === "agent_thought_chunk") {
        thinkBuf += text;
        continue;
      }
      if (kind === "agent_message_chunk") {
        assistantBuf += text;
        continue;
      }
      if (kind === "turn_completed") {
        flush();
        continue;
      }
      /* tool chunks / unknown — skip for now */
    }
    flush();
  } catch {
    return [];
  }
  return out;
}

/** Optional: ISO timestamps unused when reading chat_history. */
export function _parseIso(iso: string | null | undefined): number | undefined {
  return parseIso(iso);
}
