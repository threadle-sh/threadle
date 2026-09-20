import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, type LogLane, type LogSink } from "../stream.js";
import { positionalSafe } from "../argv-safe.js";
import { agyBin } from "./agy-bin.js";
import { recordAntigravityUsage } from "./usage.js";

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

interface AgyJsonResult {
  conversation_id?: string;
  status?: string;
  response?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    cache_read_tokens?: number;
    total_tokens?: number;
  };
}

function parseJsonResult(stdout: string): AgyJsonResult | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as AgyJsonResult;
  } catch {
    // last JSON object line
    for (const line of trimmed.split("\n").reverse()) {
      if (!line.trim()) continue;
      try {
        return JSON.parse(line) as AgyJsonResult;
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

function applyAgentMode(args: string[], agent?: string): void {
  const mode = agent?.toLowerCase();
  if (mode === "plan" || mode === "accept-edits") {
    args.push("--mode", mode);
  } else if (mode && mode !== "agent") {
    args.push("--agent", agent!);
  }
}

function baseArgs(opts: {
  sessionId?: string;
  model?: string;
  agent?: string;
  prompt: string;
}): string[] {
  const args = ["-p", "--dangerously-skip-permissions"];
  if (opts.sessionId) args.push("--conversation", opts.sessionId);
  if (opts.model) args.push("--model", opts.model);
  applyAgentMode(args, opts.agent);
  args.push(positionalSafe(opts.prompt));
  return args;
}

async function persistUsage(
  sessionId: string | undefined,
  usage: AgyJsonResult["usage"] | undefined,
): Promise<void> {
  if (!sessionId || !usage) return;
  try {
    await recordAntigravityUsage(sessionId, usage);
  } catch {
    // best-effort
  }
}

async function runAgyJson(
  args: string[],
  cwd: string,
): Promise<{
  sessionId?: string;
  resultText?: string;
  isError: boolean;
  usage?: AgyJsonResult["usage"];
}> {
  const { stdout } = await execa(agyBin(), [...args.slice(0, -1), "--output-format", "json", args[args.length - 1]!], {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
  });
  const evt = parseJsonResult(stdout);
  const isError = Boolean(evt?.status && !/^SUCCESS$/i.test(evt.status));
  return {
    sessionId: evt?.conversation_id,
    resultText: typeof evt?.response === "string" ? evt.response.trimEnd() : undefined,
    isError,
    usage: evt?.usage,
  };
}

function agyEventToLogs(line: string): Array<[LogLane, string]> {
  const out: Array<[LogLane, string]> = [];
  try {
    const evt = JSON.parse(line) as Record<string, unknown>;
    if (typeof evt.response === "string" && evt.response) {
      out.push(["text", evt.response]);
    }
    if (typeof evt.text === "string" && evt.text) {
      out.push(["text", evt.text]);
    }
    if (typeof evt.content === "string" && evt.content && evt.type === "PLANNER_RESPONSE") {
      out.push(["text", evt.content]);
    }
  } catch {
    // ignore
  }
  return out;
}

async function runAgyStreaming(
  args: string[],
  cwd: string,
  onLog: LogSink,
  signal?: AbortSignal,
): Promise<{
  sessionId?: string;
  resultText?: string;
  isError: boolean;
  usage?: AgyJsonResult["usage"];
}> {
  // insert output-format before the prompt (last arg)
  const prompt = args[args.length - 1]!;
  const head = args.slice(0, -1);
  const child = execa(
    agyBin(),
    [...head, "--output-format", "stream-json", prompt],
    {
      cwd,
      timeout: INJECT_TIMEOUT_MS,
      stdin: "ignore",
      cancelSignal: signal,
    },
  );
  let result: AgyJsonResult | undefined;
  let sessionId: string | undefined;
  const chunks: string[] = [];
  forEachLine(child.stdout, (line) => {
    chunks.push(line);
    try {
      const evt = JSON.parse(line) as AgyJsonResult & { conversation_id?: string };
      if (typeof evt.conversation_id === "string") sessionId = evt.conversation_id;
      if (evt.response !== undefined || evt.usage || evt.status) result = evt;
      for (const [lane, text] of agyEventToLogs(line)) onLog(lane, text);
    } catch {
      // ignore
    }
  });
  await child;
  const stdout = chunks.join("\n");
  const parsed = result ?? parseJsonResult(stdout);
  if (parsed?.response) onLog("text", parsed.response);
  return {
    sessionId: parsed?.conversation_id ?? sessionId,
    resultText: typeof parsed?.response === "string" ? parsed.response.trimEnd() : undefined,
    isError: Boolean(parsed?.status && !/^SUCCESS$/i.test(parsed.status)),
    usage: parsed?.usage,
  };
}

export async function injectAntigravity(
  target: InjectTarget,
  payload: ContextPayload,
  kickoffPrompt?: string,
): Promise<InjectResult> {
  const text = contextText(payload, kickoffPrompt);

  if (target.mode === "continue") {
    if (!target.sessionId) throw new Error("continue inject requires a sessionId");
    const args = baseArgs({
      sessionId: target.sessionId,
      model: target.model,
      agent: target.agent,
      prompt: text,
    });
    const result = await runAgyJson(args, target.projectDir);
    if (result.isError) throw new Error("antigravity continue inject failed");
    const newSessionId = result.sessionId ?? target.sessionId;
    await persistUsage(newSessionId, result.usage);
    return {
      newSessionId,
      provider: "antigravity",
      resultText: result.resultText,
    };
  }

  if (target.mode === "new-session") {
    const args = baseArgs({
      model: target.model,
      agent: target.agent,
      prompt: text,
    });
    const result = await runAgyJson(args, target.projectDir);
    if (result.isError) throw new Error("antigravity new-session inject failed");
    if (!result.sessionId) throw new Error("antigravity new-session returned no conversation_id");
    await persistUsage(result.sessionId, result.usage);
    return {
      newSessionId: result.sessionId,
      provider: "antigravity",
      resultText: result.resultText,
    };
  }

  throw new Error(`unsupported inject mode for antigravity: ${target.mode}`);
}

export interface RunAntigravityAgentOptions {
  agent?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  sessionId?: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}

export async function runAntigravityAgent(
  opts: RunAntigravityAgentOptions,
): Promise<InjectResult> {
  const args = baseArgs({
    sessionId: opts.sessionId,
    model: opts.model,
    agent: opts.agent,
    prompt: opts.prompt,
  });

  const result = opts.onLog
    ? await runAgyStreaming(args, opts.projectDir, opts.onLog, opts.signal)
    : await runAgyJson(args, opts.projectDir);

  if (result.isError) throw new Error("antigravity agent run failed");
  const newSessionId = result.sessionId ?? opts.sessionId;
  if (!newSessionId) throw new Error("antigravity agent run returned no conversation_id");
  await persistUsage(newSessionId, result.usage);
  return {
    newSessionId,
    provider: "antigravity",
    resultText: result.resultText,
  };
}

/** Parse `agy models` lines like `id\\tDisplay Name`. */
export async function listAntigravityModels(): Promise<string[]> {
  try {
    const { stdout } = await execa(agyBin(), ["models"], {
      timeout: 30_000,
      reject: false,
    });
    const ids: string[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || /^fetching/i.test(trimmed) || /^available/i.test(trimmed)) continue;
      const tab = trimmed.split(/\t+/);
      const id = (tab[0] ?? "").trim();
      if (id && /^[\w./:+-]+$/.test(id)) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}
