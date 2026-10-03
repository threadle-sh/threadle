import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { execa } from "execa";
import { estimateTokenBaseline, formatBaselineSuffix } from "@threadle/shared";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, type LogLane, type LogSink } from "../stream.js";
import { copilotBin } from "./paths.js";
import {
  copilotUsageTempPath,
  readCopilotUsageFile,
  waitSessionTokensFromDb,
  type CopilotTokenUsage,
} from "./usage.js";

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
  /** Skip AGENTS.md / custom instruction files. */
  ignoreLocalMarkdown?: boolean;
  usageOutputFile?: string;
}): string[] {
  const args = ["-p", opts.prompt, "-s", ...safetyArgs()];
  if (opts.ignoreLocalMarkdown) args.push("--no-custom-instructions");
  if (opts.usageOutputFile) args.push("--usage-output-file", opts.usageOutputFile);
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

function logTokMeta(
  onLog: LogSink | undefined,
  usage: CopilotTokenUsage | undefined,
  prompt: string | undefined,
  ignoreLocalMarkdown: boolean | undefined,
): void {
  if (!onLog || !usage) return;
  const parts = [`${usage.inputTokens}→${usage.outputTokens} tok`];
  if (prompt) {
    const b = estimateTokenBaseline(usage.inputTokens, prompt, {
      ignoreLocalMarkdown,
    });
    const suf = b ? formatBaselineSuffix(b) : "";
    if (suf) parts.push(suf);
  }
  onLog("meta", `■ ${parts.join(" · ")}`);
}

async function runCopilotStreaming(
  args: string[],
  cwd: string,
  onLog?: LogSink,
  signal?: AbortSignal,
  usageFile?: string,
): Promise<{
  sessionId?: string;
  resultText?: string;
  isError: boolean;
  usage?: CopilotTokenUsage;
}> {
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
  const sessionId = findSessionIdFromArgs(args);
  let usage = usageFile ? readCopilotUsageFile(usageFile) : undefined;
  if (!usage && sessionId) {
    usage = await waitSessionTokensFromDb(sessionId);
  }
  if (usageFile) {
    await fs.promises.unlink(usageFile).catch(() => undefined);
  }
  return {
    sessionId,
    resultText: stdout.trim() || undefined,
    isError: result.exitCode !== 0 && result.exitCode !== undefined,
    usage,
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
    const usageFile = copilotUsageTempPath();
    const args = execArgs({
      prompt,
      model: target.model,
      sessionId: target.sessionId,
      usageOutputFile: usageFile,
    });
    const r = await runCopilotStreaming(args, cwd, undefined, undefined, usageFile);
    if (r.isError) throw new Error("copilot continue inject failed");
    return {
      newSessionId: r.sessionId ?? target.sessionId,
      provider: "copilot",
      resultText: r.resultText,
      usage: r.usage,
    };
  }

  if (target.mode === "new-session") {
    const usageFile = copilotUsageTempPath();
    const args = execArgs({ prompt, model: target.model, usageOutputFile: usageFile });
    const r = await runCopilotStreaming(args, cwd, undefined, undefined, usageFile);
    if (r.isError) throw new Error("copilot new-session inject failed");
    if (!r.sessionId) throw new Error("copilot new-session returned no session id");
    return {
      newSessionId: r.sessionId,
      provider: "copilot",
      resultText: r.resultText,
      usage: r.usage,
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
  ignoreLocalMarkdown?: boolean;
  onLog?: LogSink;
  signal?: AbortSignal;
}): Promise<InjectResult> {
  const usageFile = copilotUsageTempPath();
  const args = execArgs({
    prompt: opts.prompt,
    model: opts.model,
    agent: opts.agent,
    sessionId: opts.sessionId,
    ignoreLocalMarkdown: opts.ignoreLocalMarkdown,
    usageOutputFile: usageFile,
  });
  if (opts.onLog && opts.ignoreLocalMarkdown) {
    opts.onLog("meta", "ignore local md · --no-custom-instructions");
  }
  const r = await runCopilotStreaming(
    args,
    opts.projectDir,
    opts.onLog,
    opts.signal,
    usageFile,
  );
  if (r.isError) throw new Error("copilot agent run failed");
  const newSessionId = r.sessionId ?? opts.sessionId;
  if (!newSessionId) throw new Error("copilot agent run returned no session id");
  logTokMeta(opts.onLog, r.usage, opts.prompt, opts.ignoreLocalMarkdown);
  return {
    newSessionId,
    provider: "copilot",
    resultText: r.resultText,
    usage: r.usage,
  };
}

export async function listCopilotModels(): Promise<string[]> {
  // Copilot does not expose a stable `models` subcommand; use documented defaults.
  return [...FALLBACK_MODELS];
}
