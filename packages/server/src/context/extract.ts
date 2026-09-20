import type { ExtractConfig, NormalizedMessage } from "@threadle/shared";

function toolInputOneliner(input: unknown): string {
  if (input === null || input === undefined) return "";
  const s = JSON.stringify(input);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

/** Render normalized messages to a markdown context document. Pure. */
export function renderTranscript(
  messages: NormalizedMessage[],
  config: ExtractConfig,
): string {
  const [start, end] = config.range ?? [0, messages.length - 1];
  const slice = messages.slice(Math.max(0, start), end + 1);
  const lines: string[] = [];

  for (const msg of slice) {
    if (msg.role !== "system" && !config.roles.includes(msg.role as "user" | "assistant")) {
      continue;
    }
    const ts = msg.timestamp
      ? ` — ${new Date(msg.timestamp).toISOString().replace("T", " ").slice(0, 19)}`
      : "";
    const header = `## ${msg.role}${msg.synthetic ? " (injected)" : ""}${ts}`;
    const body: string[] = [];

    for (const part of msg.parts) {
      switch (part.type) {
        case "text":
          if (part.text) body.push(part.text);
          break;
        case "thinking":
          if (config.includeThinking && part.text) {
            body.push(`> [thinking]\n> ${part.text.replace(/\n/g, "\n> ")}`);
          }
          break;
        case "tool_use":
          if (config.includeToolCalls === "names") {
            body.push(`> tool: ${part.toolName}(${toolInputOneliner(part.toolInput)})`);
          } else if (config.includeToolCalls === "full") {
            body.push(
              `**tool call: ${part.toolName}**\n\n\`\`\`json\n${JSON.stringify(part.toolInput, null, 2)}\n\`\`\``,
            );
          }
          break;
        case "tool_result":
          if (config.includeToolCalls === "full" && part.text) {
            body.push(
              `**tool result${part.isError ? " (error)" : ""}:**\n\n\`\`\`\n${part.text}\n\`\`\``,
            );
          }
          break;
        case "patch":
          if (part.text) body.push(`> ${part.text}`);
          break;
        default:
          break;
      }
    }

    if (body.length) {
      lines.push(header, "", ...body, "");
    }
  }

  let out = lines.join("\n").trim();
  if (config.maxChars && out.length > config.maxChars) {
    out = `${out.slice(0, config.maxChars)}\n\n[…truncated]`;
  }
  return out;
}

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
