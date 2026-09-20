import type { NormalizedMessage } from "@threadle/shared";
import { listTurns } from "./discover.js";

function parseTime(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/** Map Copilot SQLite turns → NormalizedMessage[]. Unknown fields are ignored. */
export function readCopilotTranscript(sessionId: string): NormalizedMessage[] {
  const turns = listTurns(sessionId);
  const out: NormalizedMessage[] = [];
  for (const turn of turns) {
    const ts = parseTime(turn.timestamp);
    const idx = turn.turn_index;
    if (turn.user_message?.trim()) {
      out.push({
        id: `${sessionId}:u:${idx}`,
        role: "user",
        parts: [{ type: "text", text: turn.user_message }],
        timestamp: ts,
      });
    }
    if (turn.assistant_response?.trim()) {
      out.push({
        id: `${sessionId}:a:${idx}`,
        role: "assistant",
        parts: [{ type: "text", text: turn.assistant_response }],
        timestamp: ts,
      });
    }
  }
  return out;
}
