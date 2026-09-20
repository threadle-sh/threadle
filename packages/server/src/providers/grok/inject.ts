import { randomUUID } from "node:crypto";
import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, type LogLane, type LogSink } from "../stream.js";
import { grokBin } from "./paths.js";

const INJECT_TIMEOUT_MS = 10 * 60_000;

const FALLBACK_MODELS = ["grok-4.6", "grok-4.5"];

function contextText(payload: ContextPayload, kickoff?: string): string {
  const parts = [
    "# Context handed off from another agent session",
    "",
    `(source: ${payload.source.provider} session ${payload.source.sessionId}${payload.meta.sourceTitle ? ` — "${payload.meta.sourceTitle}"` : ""}, payload kind: ${payload.kind})`,
    "",
    payload.content,
  ];
  if (kickoff?.trim()) parts.push("", "---", "", kickoff.trim());
  return parts.join("\n");
}

function safetyArgs(): string[] {
  return ["--always-approve"];
}

function execArgs(opts: {
  sessionId?: string;
  model?: string;
  agent?: string;
  prompt: string;
  /** Pin a new session UUID (must not already exist). */
  newSessionId?: string;
}): string[] {
  const args = [
    "-p",
    opts.prompt,
    "--output-format",
    "plain",
    ...safetyArgs(),
  ];
  if (opts.model) args.push("-m", opts.model);
  if (opts.agent && opts.agent !== "grok") args.push("--agent", opts.agent);
  if (opts.sessionId) {
    args.push("--resume", opts.sessionId);
  } else if (opts.newSessionId) {
    args.push("--session-id", opts.newSessionId);
  }
  return args;
}

async function runGrokStreaming(
  args: string[],
  cwd: string,
  onLog?: LogSink,
  signal?: AbortSignal,
): Promise<{ sessionId?: string; resultText?: string; isError: boolean }> {
  const child = execa(grokBin(), args, {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: signal,
    reject: false,
  });
  const chunks: string[] = [];
  forEachLine(child.stdout, (line) => {
    chunks.push(line);
    if (onLog) onLog("text" as LogLane, line);
  });
  forEachLine(child.stderr, (line) => {
    if (onLog) onLog("raw" as LogLane, line);
  });
  const result = await child;
  const stdout = chunks.join("\n") || result.stdout || "";

  let sessionId: string | undefined;
  const resumeIdx = args.indexOf("--resume");
  if (resumeIdx >= 0 && args[resumeIdx + 1]) sessionId = args[resumeIdx + 1];
  const sidIdx = args.indexOf("--session-id");
  if (sidIdx >= 0 && args[sidIdx + 1]) sessionId = args[sidIdx + 1];

  return {
    sessionId,
    resultText: stdout.trim() || undefined,
    isError: result.exitCode !== 0 && result.exitCode !== undefined,
  };
}

export async function injectGrok(
  target: InjectTarget,
  payload: ContextPayload,
  kickoff?: string,
): Promise<InjectResult> {
  const prompt = contextText(payload, kickoff);
  const cwd = target.projectDir || process.cwd();

  if (target.mode === "continue") {
    if (!target.sessionId) throw new Error("continue inject requires a sessionId");
    const args = execArgs({
      prompt,
      model: target.model,
      sessionId: target.sessionId,
    });
    const r = await runGrokStreaming(args, cwd);
    if (r.isError) throw new Error("grok continue inject failed");
    return {
      newSessionId: r.sessionId ?? target.sessionId,
      provider: "grok",
      resultText: r.resultText,
    };
  }

  if (target.mode === "new-session") {
    const newSessionId = randomUUID();
    const args = execArgs({ prompt, model: target.model, newSessionId });
    const r = await runGrokStreaming(args, cwd);
    if (r.isError) throw new Error("grok new-session inject failed");
    return {
      newSessionId: r.sessionId ?? newSessionId,
      provider: "grok",
      resultText: r.resultText,
    };
  }

  throw new Error(`unsupported inject mode for grok: ${target.mode}`);
}

export async function runGrokAgent(opts: {
  agent?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  sessionId?: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}): Promise<InjectResult> {
  const newSessionId = opts.sessionId ? undefined : randomUUID();
  const args = execArgs({
    prompt: opts.prompt,
    model: opts.model,
    agent: opts.agent,
    sessionId: opts.sessionId,
    newSessionId,
  });
  const r = await runGrokStreaming(args, opts.projectDir, opts.onLog, opts.signal);
  if (r.isError) throw new Error("grok agent run failed");
  const id = r.sessionId ?? opts.sessionId ?? newSessionId;
  if (!id) throw new Error("grok agent run returned no session id");
  return {
    newSessionId: id,
    provider: "grok",
    resultText: r.resultText,
  };
}

export async function listGrokModels(): Promise<string[]> {
  try {
    const { stdout } = await execa(grokBin(), ["models"], {
      timeout: 15_000,
      reject: false,
    });
    const found: string[] = [];
    for (const line of stdout.split("\n")) {
      const m = /^\s*[*-]?\s*(grok-[\w.-]+)\b/.exec(line);
      if (m?.[1] && !found.includes(m[1])) found.push(m[1]);
    }
    if (found.length) return found;
  } catch {
    /* fall through */
  }
  return [...FALLBACK_MODELS];
}
