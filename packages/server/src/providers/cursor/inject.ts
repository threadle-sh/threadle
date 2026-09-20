import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { enrichUsageExhaustionError } from "@threadle/shared";
import { forEachLine, toolSummary, type LogLane, type LogSink } from "../stream.js";
import { positionalSafe } from "../argv-safe.js";
import { agentBin } from "./agent-bin.js";
import { recordCursorUsage } from "./usage.js";

const INJECT_TIMEOUT_MS = 10 * 60_000;

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

interface CursorJsonResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

function findUsage(stdout: string): CursorJsonResult["usage"] | undefined {
  for (const line of stdout.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as CursorJsonResult;
      if (evt.usage && typeof evt.usage === "object") return evt.usage;
    } catch {
      // continue
    }
  }
  try {
    const evt = JSON.parse(stdout) as CursorJsonResult;
    if (evt.usage) return evt.usage;
  } catch {
    // ignore
  }
  return undefined;
}

function findSessionId(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      const sid = evt.session_id;
      if (typeof sid === "string" && sid) return sid;
    } catch {
      // non-JSON
    }
  }
  // whole-stdout json object
  try {
    const evt = JSON.parse(stdout) as CursorJsonResult;
    if (typeof evt.session_id === "string") return evt.session_id;
  } catch {
    // not a single json blob
  }
  return undefined;
}

function findResultText(stdout: string): string | undefined {
  for (const line of stdout.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as CursorJsonResult;
      if (evt.type === "result" && typeof evt.result === "string") return evt.result;
      if (typeof evt.result === "string" && evt.result) return evt.result;
    } catch {
      // continue
    }
  }
  try {
    const evt = JSON.parse(stdout) as CursorJsonResult;
    if (typeof evt.result === "string") return evt.result;
  } catch {
    // ignore
  }
  return undefined;
}

async function createChatId(): Promise<string> {
  const { stdout } = await execa(agentBin(), ["create-chat"], { timeout: 15_000 });
  const id = stdout.trim().split("\n").pop()?.trim();
  if (!id) throw new Error("agent create-chat returned empty id");
  return id;
}

function baseArgs(opts: {
  sessionId?: string;
  projectDir: string;
  model?: string;
  prompt: string;
}): string[] {
  const args = ["-p", "--trust", "--workspace", opts.projectDir];
  if (opts.sessionId) args.push("--resume", opts.sessionId);
  if (opts.model) args.push("--model", opts.model);
  args.push(positionalSafe(opts.prompt));
  return args;
}

async function runAgentJson(
  args: string[],
  cwd: string,
): Promise<{
  sessionId?: string;
  resultText?: string;
  subtype?: string;
  isError: boolean;
  usage?: CursorJsonResult["usage"];
}> {
  const { stdout } = await execa(agentBin(), [...args, "--output-format", "json"], {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
  });
  let isError = false;
  let subtype: string | undefined;
  try {
    const evt = JSON.parse(stdout) as CursorJsonResult;
    if (evt.is_error) isError = true;
    if (evt.type === "result" && evt.is_error) isError = true;
    if (typeof evt.subtype === "string") subtype = evt.subtype;
  } catch {
    // stream of lines — check each
    for (const line of stdout.split("\n")) {
      try {
        const evt = JSON.parse(line) as CursorJsonResult;
        if (evt.type === "result" && evt.is_error) isError = true;
        if (typeof evt.subtype === "string") subtype = evt.subtype;
      } catch {
        // skip
      }
    }
  }
  return {
    sessionId: findSessionId(stdout),
    resultText: findResultText(stdout),
    subtype,
    isError,
    usage: findUsage(stdout),
  };
}

function cursorEventToLogs(line: string): Array<[LogLane, string]> {
  const evt = JSON.parse(line) as {
    type?: string;
    message?: { content?: Array<Record<string, unknown>>; role?: string };
    tool_call?: { name?: string; args?: unknown };
    name?: string;
    text?: string;
    subtype?: string;
  };
  const out: Array<[LogLane, string]> = [];
  if (evt.type === "assistant" && Array.isArray(evt.message?.content)) {
    for (const block of evt.message.content) {
      if (block.type === "text" && typeof block.text === "string" && block.text) {
        out.push(["text", block.text]);
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        out.push(["thinking", block.thinking]);
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        out.push(["tool", toolSummary(block.name, block.input)]);
      }
    }
  } else if (evt.type === "tool_call" && evt.tool_call?.name) {
    out.push(["tool", toolSummary(evt.tool_call.name, evt.tool_call.args)]);
  } else if (evt.type === "thinking" && typeof evt.text === "string" && evt.text) {
    out.push(["thinking", evt.text]);
  }
  return out;
}

async function runAgentStreaming(
  args: string[],
  cwd: string,
  onLog: LogSink,
  signal?: AbortSignal,
): Promise<{
  sessionId?: string;
  resultText?: string;
  subtype?: string;
  isError: boolean;
  usage?: CursorJsonResult["usage"];
}> {
  const child = execa(
    "agent",
    [...args, "--output-format", "stream-json"],
    {
      cwd,
      timeout: INJECT_TIMEOUT_MS,
      stdin: "ignore",
      cancelSignal: signal,
    },
  );
  let result: CursorJsonResult | undefined;
  let sessionId: string | undefined;
  const chunks: string[] = [];
  forEachLine(child.stdout, (line) => {
    chunks.push(line);
    try {
      const evt = JSON.parse(line) as CursorJsonResult & { session_id?: string };
      if (typeof evt.session_id === "string") sessionId = evt.session_id;
      if (evt.type === "result") result = evt;
      for (const [lane, text] of cursorEventToLogs(line)) onLog(lane, text);
    } catch {
      // ignore
    }
  });
  try {
    await child;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const detail = [result?.result, result?.subtype, msg].filter(Boolean).join(" — ");
    throw enrichUsageExhaustionError(new Error(`cursor agent run failed: ${detail}`));
  }
  const stdout = chunks.join("\n");
  return {
    sessionId: result?.session_id ?? sessionId ?? findSessionId(stdout),
    resultText: result?.result ?? findResultText(stdout),
    subtype: result?.subtype,
    isError: result?.is_error === true,
    usage: result?.usage ?? findUsage(stdout),
  };
}

async function persistUsage(
  sessionId: string | undefined,
  usage: CursorJsonResult["usage"] | undefined,
): Promise<void> {
  if (!sessionId || !usage) return;
  try {
    await recordCursorUsage(sessionId, usage);
  } catch {
    // best-effort; discovery still falls back to transcript estimate
  }
}

function applyAgentMode(args: string[], agent?: string): void {
  const mode = agent?.toLowerCase();
  if (mode === "plan" || mode === "ask") {
    args.unshift("--mode", mode);
  }
}

export async function injectCursor(
  target: InjectTarget,
  payload: ContextPayload,
  kickoffPrompt?: string,
): Promise<InjectResult> {
  const text = contextText(payload, kickoffPrompt);

  if (target.mode === "continue") {
    if (!target.sessionId) throw new Error("continue inject requires a sessionId");
    const args = baseArgs({
      sessionId: target.sessionId,
      projectDir: target.projectDir,
      model: target.model,
      prompt: text,
    });
    applyAgentMode(args, target.agent);
    const result = await runAgentJson(args, target.projectDir);
    if (result.isError) {
      const detail = [result.resultText, result.subtype].filter(Boolean).join(" — ");
      throw enrichUsageExhaustionError(
        new Error(detail ? `cursor continue inject failed: ${detail}` : "cursor continue inject failed"),
      );
    }
    const newSessionId = result.sessionId ?? target.sessionId;
    await persistUsage(newSessionId, result.usage);
    return {
      newSessionId,
      provider: "cursor",
      resultText: result.resultText,
    };
  }

  if (target.mode === "new-session") {
    // Pin a chat id up front so we know the session even if stdout parsing fails
    const chatId = await createChatId();
    const args = baseArgs({
      sessionId: chatId,
      projectDir: target.projectDir,
      model: target.model,
      prompt: text,
    });
    applyAgentMode(args, target.agent);
    const result = await runAgentJson(args, target.projectDir);
    if (result.isError) {
      const detail = [result.resultText, result.subtype].filter(Boolean).join(" — ");
      throw enrichUsageExhaustionError(
        new Error(detail ? `cursor new-session inject failed: ${detail}` : "cursor new-session inject failed"),
      );
    }
    const newSessionId = result.sessionId ?? chatId;
    await persistUsage(newSessionId, result.usage);
    return {
      newSessionId,
      provider: "cursor",
      resultText: result.resultText,
    };
  }

  throw new Error(`unsupported inject mode for cursor: ${target.mode}`);
}

export interface RunCursorAgentOptions {
  agent?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  sessionId?: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}

export async function runCursorAgent(
  opts: RunCursorAgentOptions,
): Promise<InjectResult> {
  const chatId = opts.sessionId ?? (await createChatId());
  const args = baseArgs({
    sessionId: chatId,
    projectDir: opts.projectDir,
    model: opts.model,
    prompt: opts.prompt,
  });
  applyAgentMode(args, opts.agent);

  const result = opts.onLog
    ? await runAgentStreaming(args, opts.projectDir, opts.onLog, opts.signal)
    : await runAgentJson(args, opts.projectDir);

  if (result.isError) {
    const detail = [result.resultText, result.subtype].filter(Boolean).join(" — ");
    throw enrichUsageExhaustionError(
      new Error(detail ? `cursor agent run failed: ${detail}` : "cursor agent run failed"),
    );
  }
  const newSessionId = result.sessionId ?? chatId;
  await persistUsage(newSessionId, result.usage);
  return {
    newSessionId,
    provider: "cursor",
    resultText: result.resultText,
  };
}

/** Parse `agent --list-models` / `agent models` lines like `id - Display Name`. */
export async function listCursorModels(): Promise<string[]> {
  try {
    const { stdout } = await execa(agentBin(), ["--list-models"], {
      timeout: 30_000,
      reject: false,
    });
    const ids: string[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || /^available models/i.test(trimmed)) continue;
      // "composer-2.5 - Composer 2.5" or just "auto"
      const m = trimmed.match(/^([\w./:+-]+)\s+-/);
      if (m?.[1]) ids.push(m[1]);
      else if (/^[\w./:+-]+$/.test(trimmed)) ids.push(trimmed);
    }
    return ids;
  } catch {
    return [];
  }
}
