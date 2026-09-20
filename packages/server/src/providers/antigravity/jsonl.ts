import fs from "node:fs";
import type { ContentPart, NormalizedMessage } from "@threadle/shared";

export interface AntigravityTranscriptLine {
  step_index?: number;
  type?: string;
  source?: string;
  status?: string;
  created_at?: string;
  content?: string;
}

/** Strip Antigravity USER_REQUEST / metadata wrappers for display. */
export function cleanUserContent(raw: string): string {
  const m = raw.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  if (m?.[1]) return m[1].trim();
  return raw
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "")
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, "")
    .trim();
}

function roleForType(type: string | undefined): "user" | "assistant" | undefined {
  if (!type) return undefined;
  switch (type) {
    case "USER_INPUT":
      return "user";
    case "PLANNER_RESPONSE":
    case "AGENT_RESPONSE":
    case "MODEL_RESPONSE":
      return "assistant";
    default:
      // unknown step types — skip (format churn)
      return undefined;
  }
}

/** Async iterator over JSONL records; skips malformed / unknown lines. */
export async function* readAntigravityLines(
  filePath: string,
): AsyncGenerator<AntigravityTranscriptLine> {
  let text: string;
  try {
    text = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as AntigravityTranscriptLine;
    } catch {
      // skip bad lines
    }
  }
}

export async function readAntigravityTranscript(
  filePath: string,
): Promise<NormalizedMessage[]> {
  const out: NormalizedMessage[] = [];
  let i = 0;
  for await (const entry of readAntigravityLines(filePath)) {
    const role = roleForType(entry.type);
    if (!role) continue;
    let text = typeof entry.content === "string" ? entry.content : "";
    if (role === "user") text = cleanUserContent(text);
    if (!text) continue;
    const parts: ContentPart[] = [{ type: "text", text }];
    const ts = entry.created_at ? Date.parse(entry.created_at) : undefined;
    out.push({
      id: `${pathBasename(filePath)}:${entry.step_index ?? i}`,
      role,
      parts,
      timestamp: Number.isFinite(ts) ? ts : undefined,
    });
    i += 1;
  }
  return out;
}

function pathBasename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export async function countAntigravityMessages(filePath: string): Promise<number> {
  let n = 0;
  for await (const entry of readAntigravityLines(filePath)) {
    if (roleForType(entry.type)) n += 1;
  }
  return n;
}

export async function firstUserPrompt(filePath: string): Promise<string | undefined> {
  for await (const entry of readAntigravityLines(filePath)) {
    if (entry.type !== "USER_INPUT" || typeof entry.content !== "string") continue;
    const text = cleanUserContent(entry.content);
    if (text) return text;
  }
  return undefined;
}
