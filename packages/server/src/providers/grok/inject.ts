import { randomUUID } from "node:crypto";
import { execa } from "execa";
import { estimateTokenBaseline, formatBaselineSuffix } from "@threadle/shared";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, type LogLane, type LogSink } from "../stream.js";
import { resolveRunHarnessExtras, logHarnessExtrasLanes } from "../harness-extras.js";
import { grokBin } from "./paths.js";
import { waitGrokUsage, type GrokTokenUsage } from "./usage.js";

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
  /** When false, pass --no-subagents. */
  harnessExtras?: boolean;
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
  if (opts.harnessExtras === false) args.push("--no-subagents");
  if (opts.sessionId) {
    args.push("--resume", opts.sessionId);
  } else if (opts.newSessionId) {
    args.push("--session-id", opts.newSessionId);
  }
  return args;
}

function logTokMeta(
  onLog: LogSink | undefined,
  usage: GrokTokenUsage | undefined,
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

async function runGrokStreaming(
  args: string[],
  cwd: string,
  onLog?: LogSink,
  signal?: AbortSignal,
): Promise<{ sessionId?: string; resultText?: string; stderr?: string; isError: boolean }> {
  const child = execa(grokBin(), args, {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: signal,
    reject: false,
  });
  const chunks: string[] = [];
  const errChunks: string[] = [];
  forEachLine(child.stdout, (line) => {
    chunks.push(line);
    if (onLog) onLog("text" as LogLane, line);
  });
  forEachLine(child.stderr, (line) => {
    errChunks.push(line);
    if (onLog) onLog("raw" as LogLane, line);
  });
  const result = await child;
  const stdout = chunks.join("\n") || result.stdout || "";
  const stderr = errChunks.join("\n") || result.stderr || "";
  const combined = `${stdout}\n${stderr}`;
  const paidFail = /402|payment required|balance exhausted|insufficient/i.test(combined);

  let sessionId: string | undefined;
  const resumeIdx = args.indexOf("--resume");
  if (resumeIdx >= 0 && args[resumeIdx + 1]) sessionId = args[resumeIdx + 1];
  const sidIdx = args.indexOf("--session-id");
  if (sidIdx >= 0 && args[sidIdx + 1]) sessionId = args[sidIdx + 1];

  return {
    sessionId,
    resultText: stdout.trim() || undefined,
    stderr: stderr.trim() || undefined,
    isError:
      (result.exitCode !== 0 && result.exitCode !== undefined) || paidFail,
  };
}

function grokFail(prefix: string, r: { resultText?: string; stderr?: string }): Error {
  const detail = [r.stderr, r.resultText].filter(Boolean).join("\n").trim();
  return new Error(detail ? `${prefix}: ${detail}` : prefix);
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
    if (r.isError) throw grokFail("grok continue inject failed", r);
    const id = r.sessionId ?? target.sessionId;
    const usage = await waitGrokUsage(id, cwd);
    return {
      newSessionId: id,
      provider: "grok",
      resultText: r.resultText,
      usage,
    };
  }

  if (target.mode === "new-session") {
    const newSessionId = randomUUID();
    const args = execArgs({ prompt, model: target.model, newSessionId });
    const r = await runGrokStreaming(args, cwd);
    if (r.isError) throw grokFail("grok new-session inject failed", r);
    const id = r.sessionId ?? newSessionId;
    const usage = await waitGrokUsage(id, cwd);
    return {
      newSessionId: id,
      provider: "grok",
      resultText: r.resultText,
      usage,
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
  harnessExtras?: boolean;
  ignoreLocalMarkdown?: boolean;
}): Promise<InjectResult> {
  const newSessionId = opts.sessionId ? undefined : randomUUID();
  const harnessExtras = await resolveRunHarnessExtras(opts.harnessExtras);
  const args = execArgs({
    prompt: opts.prompt,
    model: opts.model,
    agent: opts.agent,
    sessionId: opts.sessionId,
    newSessionId,
    harnessExtras,
  });
  if (opts.onLog) {
    logHarnessExtrasLanes(opts.onLog, "grok", harnessExtras);
    if (opts.ignoreLocalMarkdown) {
      opts.onLog("meta", "ignore local md · bare cwd only (no skip flag)");
    }
  }
  const r = await runGrokStreaming(args, opts.projectDir, opts.onLog, opts.signal);
  if (r.isError) throw grokFail("grok agent run failed", r);
  const id = r.sessionId ?? opts.sessionId ?? newSessionId;
  if (!id) throw new Error("grok agent run returned no session id");
  const usage = await waitGrokUsage(id, opts.projectDir);
  logTokMeta(opts.onLog, usage, opts.prompt, opts.ignoreLocalMarkdown);
  return {
    newSessionId: id,
    provider: "grok",
    resultText: r.resultText,
    usage,
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
