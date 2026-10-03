import fs from "node:fs";
import type { ContentPart, NormalizedMessage } from "@threadle/shared";
import { asObj, recordsFromLine, resolveLogPath, microsToMs } from "./discover.js";

/**
 * Parse Muse MSP session.jsonl into NormalizedMessage.
 * Known: user intents, assistant_message_committed, reasoning_committed, tool events.
 * Unknown payload/event kinds are skipped.
 */
export async function readMuseTranscript(sessionId: string): Promise<NormalizedMessage[]> {
  const logPath = await resolveLogPath(sessionId);
  if (!logPath) return [];
  let raw: string;
  try {
    raw = await fs.promises.readFile(logPath, "utf8");
  } catch {
    return [];
  }

  const out: NormalizedMessage[] = [];
  let idx = 0;
  const seenAssistant = new Set<string>();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    for (const rj of recordsFromLine(line)) {
      const pt = typeof rj.payload_type === "string" ? rj.payload_type : "";
      const ts = microsToMs(rj.recorded_at) || undefined;
      const payload = asObj(rj.payload) ?? {};

      if (pt === "runtime.user_intent.accepted") {
        const texts: string[] = [];
        const blocks = payload.refill_blocks;
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            const t = asObj(b)?.text;
            if (typeof t === "string" && t.trim()) texts.push(t.trim());
          }
        }
        if (!texts.length) {
          const msgs = payload.model_messages;
          if (Array.isArray(msgs)) {
            for (const m of msgs) {
              const content = asObj(m)?.content;
              if (!Array.isArray(content)) continue;
              for (const c of content) {
                const t = asObj(c)?.text;
                if (typeof t === "string" && t.trim()) texts.push(t.trim());
              }
            }
          }
        }
        const text = texts.join("\n").trim();
        if (!text) continue;
        out.push({
          id: typeof payload.intent_id === "string" ? payload.intent_id : `${sessionId}:u:${idx++}`,
          role: "user",
          parts: [{ type: "text", text }],
          timestamp: ts,
        });
        continue;
      }

      if (pt === "runtime.session" && payload.kind === "run") {
        const event = asObj(payload.event);
        if (!event) continue;
        const kind = typeof event.kind === "string" ? event.kind : "";

        if (kind === "assistant_message_committed") {
          const text = typeof event.text === "string" ? event.text : "";
          const mid =
            typeof event.message_id === "string" ? event.message_id : `${sessionId}:a:${idx++}`;
          if (seenAssistant.has(mid)) continue;
          seenAssistant.add(mid);
          if (!text.trim()) continue;
          out.push({
            id: mid,
            role: "assistant",
            parts: [{ type: "text", text }],
            timestamp: ts,
          });
          continue;
        }

        if (kind === "reasoning_committed") {
          const text = typeof event.text === "string" ? event.text : "";
          if (!text.trim()) continue;
          const mid =
            typeof event.message_id === "string"
              ? `${event.message_id}:think`
              : `${sessionId}:t:${idx++}`;
          out.push({
            id: mid,
            role: "assistant",
            parts: [{ type: "thinking", text }],
            timestamp: ts,
          });
          continue;
        }

        if (kind === "model_completed") {
          const usage = asObj(event.usage);
          if (!usage || out.length === 0) continue;
          const last = out[out.length - 1];
          if (last?.role === "assistant") {
            last.tokens = {
              input: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
              output: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
              cacheRead:
                typeof usage.cache_read_tokens === "number"
                  ? usage.cache_read_tokens
                  : typeof usage.cached_tokens === "number"
                    ? usage.cached_tokens
                    : undefined,
              cacheWrite:
                typeof usage.cache_write_tokens === "number"
                  ? usage.cache_write_tokens
                  : undefined,
            };
          }
          continue;
        }

        // Tool calls (best-effort): tool_* event kinds with name + input
        if (kind.startsWith("tool_") || kind.includes("tool_call")) {
          const toolName =
            (typeof event.tool_name === "string" && event.tool_name) ||
            (typeof event.name === "string" && event.name) ||
            undefined;
          if (!toolName) continue;
          const parts: ContentPart[] = [
            {
              type: kind.includes("result") ? "tool_result" : "tool_use",
              toolName,
              toolInput: event.input ?? event.args ?? event.arguments,
              toolUseId: typeof event.tool_use_id === "string" ? event.tool_use_id : undefined,
              text: typeof event.text === "string" ? event.text : undefined,
              isError: event.is_error === true,
            },
          ];
          out.push({
            id: `${sessionId}:tool:${idx++}`,
            role: "assistant",
            parts,
            timestamp: ts,
          });
        }
      }
    }
  }

  return out;
}
