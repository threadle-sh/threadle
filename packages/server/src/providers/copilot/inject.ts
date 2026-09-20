import { randomUUID } from "node:crypto";
import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, type LogLane, type LogSink } from "../stream.js";
import { copilotBin } from "./paths.js";

const INJECT_TIMEOUT_MS = 10 * 60_000;

/** Known Copilot models (CLI `--model`); `auto` lets Copilot pick. */
const FALLBACK_MODELS = [
  "auto",
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1",
  "claude-sonnet-4",
  "claude-opus-4",
  "gemini-2.5-pro",
];

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

/** Non-interactive flags required for headless `-p` runs. */
function safetyArgs(): string[] {
  return ["--allow-all-tools", "--allow-all-paths"];
}

function execArgs(opts: {
  sessionId?: string;
  model?: string;
  agent?: string;
  prompt: string;
}): string[] {
  const args = ["-p", opts.prompt, "-s", ...safetyArgs()];
  if (opts.model) args.push("--model", opts.model);
  if (opts.agent && opts.agent !== "copilot") args.push("--agent", opts.agent);
  if (opts.sessionId) {
    args.push("--resume", opts.sessionId);
  } else {
    // Pin a UUID so we can correlate the new session without parsing UI output.
    args.push("--session-id", randomUUID());
  }
  return args;
}

function findSessionIdFromArgs(args: string[]): string | undefined {
  const i = args.indexOf("--session-id");
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const r = args.indexOf("--resume");
  if (r >= 0 && args[r + 1]) return args[r + 1];
  return undefined;
}

async function runCopilotStreaming(
  args: string[],
  cwd: string,
  onLog?: LogSink,
  signal?: AbortSignal,
): Promise<{ sessionId?: string; resultText?: string; isError: boolean }> {
  const child = execa(copilotBin(), args, {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: signal,
    reject: false,
    env: {
      ...process.env,
      COPILOT_ALLOW_ALL: "true",
    },
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
  return {
    sessionId: findSessionIdFromArgs(args),
    resultText: stdout.trim() || undefined,
    isError: result.exitCode !== 0 && result.exitCode !== undefined,
  };
}

export async function injectCopilot(
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
    const r = await runCopilotStreaming(args, cwd);
    if (r.isError) throw new Error("copilot continue inject failed");
    return {
      newSessionId: r.sessionId ?? target.sessionId,
      provider: "copilot",
      resultText: r.resultText,
    };
  }

  if (target.mode === "new-session") {
    const args = execArgs({ prompt, model: target.model });
    const r = await runCopilotStreaming(args, cwd);
    if (r.isError) throw new Error("copilot new-session inject failed");
    if (!r.sessionId) throw new Error("copilot new-session returned no session id");
    return {
      newSessionId: r.sessionId,
      provider: "copilot",
      resultText: r.resultText,
    };
  }

  throw new Error(`unsupported inject mode for copilot: ${target.mode}`);
}

export async function runCopilotAgent(opts: {
  agent?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  sessionId?: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}): Promise<InjectResult> {
  const args = execArgs({
    prompt: opts.prompt,
    model: opts.model,
    agent: opts.agent,
    sessionId: opts.sessionId,
  });
  const r = await runCopilotStreaming(args, opts.projectDir, opts.onLog, opts.signal);
  if (r.isError) throw new Error("copilot agent run failed");
  const newSessionId = r.sessionId ?? opts.sessionId;
  if (!newSessionId) throw new Error("copilot agent run returned no session id");
  return {
    newSessionId,
    provider: "copilot",
    resultText: r.resultText,
  };
}

export async function listCopilotModels(): Promise<string[]> {
  // Copilot does not expose a stable `models` subcommand; use documented defaults.
  return [...FALLBACK_MODELS];
}
