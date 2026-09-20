import readline from "node:readline";
import type { Readable } from "node:stream";

export type LogLane = "text" | "thinking" | "tool" | "raw";
export type LogSink = (lane: LogLane, line: string) => void;

/** Attach a per-line parser to a child stdout stream; parse errors are ignored. */
export function forEachLine(
  stream: Readable | null | undefined,
  handle: (line: string) => void,
): void {
  if (!stream) return;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      handle(line);
    } catch {
      // never let a log-parsing hiccup kill the run
    }
  });
}

/** Compress a tool input object into a short one-line summary. */
export function toolSummary(name: string, input: unknown): string {
  let detail = "";
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const interesting =
      obj.command ??
      obj.file_path ??
      obj.filePath ??
      obj.path ??
      obj.pattern ??
      obj.url ??
      obj.search_term ??
      obj.query ??
      obj.explanation ??
      obj.description;
    if (interesting !== undefined) detail = String(interesting);
    else {
      const s = JSON.stringify(obj);
      detail = s.length > 80 ? `${s.slice(0, 80)}…` : s;
    }
  }
  if (detail.length > 100) detail = `${detail.slice(0, 100)}…`;
  return detail ? `${name}: ${detail}` : name;
}

/** Longer tool dump for invocation viewers (pretty JSON when possible). */
export function toolInvocationBody(name: string, input: unknown): string {
  if (input === undefined || input === null) return name;
  if (typeof input === "string") {
    const t = input.trim();
    return t ? `${name}\n\n${t}` : name;
  }
  try {
    const pretty = JSON.stringify(input, null, 2);
    if (pretty.length > 8_000) return `${name}\n\n${pretty.slice(0, 8_000)}\n…`;
    return `${name}\n\n${pretty}`;
  } catch {
    return toolSummary(name, input);
  }
}
