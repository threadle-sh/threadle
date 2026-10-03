import type { NormalizedMessage } from "@threadle/shared";
import { toolInvocationBody, toolSummary } from "../providers/stream.js";

export type InvocationKind = "tool" | "skill" | "reasoning";

interface Call {
  body: string;
  ts?: number;
}

function fmtWhen(ts?: number): string {
  return ts
    ? new Date(ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
    : "—";
}

function toMarkdown(title: string, kind: InvocationKind, calls: Call[]): string {
  const lines: string[] = [
    `# ${kind}: ${title}`,
    "",
    `${calls.length} invocation(s)`,
    "",
  ];
  for (const [i, call] of calls.entries()) {
    lines.push(`## ${i + 1}. ${fmtWhen(call.ts)}`, "", "```", call.body.trimEnd(), "```", "");
  }
  return lines.join("\n");
}

/** Full invocation dump for a tool, skill, or reasoning stream. */
export function renderInvocationsMarkdown(
  transcript: NormalizedMessage[],
  kind: InvocationKind,
  name: string,
): { md: string; count: number; title: string } {
  const calls: Call[] = [];

  if (kind === "reasoning") {
    for (const m of transcript) {
      for (const part of m.parts) {
        if (part.type !== "thinking" || !part.text) continue;
        calls.push({ body: part.text, ts: m.timestamp });
      }
    }
    const title = "internal reasoning";
    return { md: toMarkdown(title, kind, calls), count: calls.length, title };
  }

  if (kind === "skill") {
    for (const m of transcript) {
      if (m.role === "user") {
        for (const pt of m.parts) {
          if (pt.type !== "text" || !pt.text) continue;
          const cmd = /<command-name>\/?([\w:-]+)<\/command-name>/.exec(pt.text);
          if (cmd?.[1] === name) {
            const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(pt.text)?.[1]?.trim();
            calls.push({
              body: args ? `/${name}\n\n${args}` : `/${name}`,
              ts: m.timestamp,
            });
          }
          break;
        }
      }
      for (const part of m.parts) {
        if (part.type !== "tool_use" || part.toolName !== "Skill") continue;
        if (!part.toolInput || typeof part.toolInput !== "object") continue;
        const input = part.toolInput as { skill?: unknown; args?: unknown };
        if (input.skill !== name) continue;
        const skillBody =
          typeof input.args === "string" && input.args
            ? `Skill: ${name}\n\nargs:\n${input.args}`
            : `Skill: ${name}\n\ninvoked via Skill tool`;
        calls.push({ body: skillBody, ts: m.timestamp });
      }
    }
    return { md: toMarkdown(name, kind, calls), count: calls.length, title: name };
  }

  // tool
  for (const m of transcript) {
    for (const part of m.parts) {
      if (part.type !== "tool_use" || part.toolName !== name) continue;
      calls.push({
        body: toolInvocationBody(part.toolName, part.toolInput),
        ts: m.timestamp,
      });
    }
  }
  return { md: toMarkdown(name, kind, calls), count: calls.length, title: name };
}

/** @internal — kept for tests / one-liner summaries when needed. */
export function summarizeToolCall(name: string, input: unknown): string {
  return toolSummary(name, input);
}
