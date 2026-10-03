import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { estimateTokenBaseline, formatBaselineSuffix } from "@threadle/shared";
import type { LogSink } from "../stream.js";
import { positionalSafe } from "../argv-safe.js";
import { resolveRunHarnessExtras, logHarnessExtrasLanes } from "../harness-extras.js";
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

/** Build argv for a headless `agy` run (without --output-format). Exported for tests. */
export function buildAgyAgentArgv(opts: {
  sessionId?: string;
  model?: string;
  agent?: string;
  prompt: string;
  harnessExtras?: boolean;
}): string[] {
  return baseArgs(opts);
}

function baseArgs(opts: {
  sessionId?: string;
  model?: string;
  agent?: string;
  prompt: string;
  harnessExtras?: boolean;
}): string[] {
  // `-p` / `--print` takes the prompt as its value (not a bare flag + positional).
  const args = ["-p", positionalSafe(opts.prompt), "--dangerously-skip-permissions"];
  if (opts.sessionId) args.push("--conversation", opts.sessionId);
  if (opts.model) args.push("--model", opts.model);
  if (opts.harnessExtras === false) args.push("--disable-slash-commands");
  applyAgentMode(args, opts.agent);
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
  signal?: AbortSignal,
): Promise<{
  sessionId?: string;
  resultText?: string;
  isError: boolean;
  usage?: AgyJsonResult["usage"];
  stderr?: string;
}> {
  const child = await execa(agyBin(), [...args, "--output-format", "json"], {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: signal,
    reject: false,
  });
  const evt = parseJsonResult(child.stdout || "");
  const resultText =
    typeof evt?.response === "string" ? evt.response.trimEnd() : undefined;
  const statusFail = Boolean(evt?.status && !/^SUCCESS$/i.test(evt.status));
  const exitFail = child.exitCode !== 0 && child.exitCode !== undefined;
  const emptyFail = !resultText?.trim();
  return {
    sessionId: evt?.conversation_id,
    resultText,
    isError: statusFail || exitFail || emptyFail,
    usage: evt?.usage,
    stderr: (child.stderr || "").trim() || undefined,
  };
}

function agyFailMessage(
  prefix: string,
  result: { resultText?: string; stderr?: string },
): string {
  const detail = [result.stderr, result.resultText].filter(Boolean).join("\n").trim();
  if (!result.resultText?.trim() && !detail) {
    return `${prefix}: no response`;
  }
  return detail ? `${prefix}: ${detail.slice(0, 400)}` : prefix;
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
    if (result.isError) throw new Error(agyFailMessage("antigravity continue inject failed", result));
    const newSessionId = result.sessionId ?? target.sessionId;
    await persistUsage(newSessionId, result.usage);
    return {
      newSessionId,
      provider: "antigravity",
      resultText: result.resultText,
      usage: result.usage
        ? {
            inputTokens: result.usage.input_tokens,
            outputTokens: result.usage.output_tokens,
          }
        : undefined,
    };
  }

  if (target.mode === "new-session") {
    const args = baseArgs({
      model: target.model,
      agent: target.agent,
      prompt: text,
    });
    const result = await runAgyJson(args, target.projectDir);
    if (result.isError) throw new Error(agyFailMessage("antigravity new-session inject failed", result));
    if (!result.sessionId) throw new Error("antigravity new-session returned no conversation_id");
    await persistUsage(result.sessionId, result.usage);
    return {
      newSessionId: result.sessionId,
      provider: "antigravity",
      resultText: result.resultText,
      usage: result.usage
        ? {
            inputTokens: result.usage.input_tokens,
            outputTokens: result.usage.output_tokens,
          }
        : undefined,
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
  harnessExtras?: boolean;
  ignoreLocalMarkdown?: boolean;
}

export async function runAntigravityAgent(
  opts: RunAntigravityAgentOptions,
): Promise<InjectResult> {
  const harnessExtras = await resolveRunHarnessExtras(opts.harnessExtras);
  const args = baseArgs({
    sessionId: opts.sessionId,
    model: opts.model,
    agent: opts.agent,
    prompt: opts.prompt,
    harnessExtras,
  });
  if (opts.onLog) {
    logHarnessExtrasLanes(opts.onLog, "antigravity", harnessExtras);
  }

  // Always use final JSON — stream-json + stdin ignore aborts mid-turn on current agy.
  const result = await runAgyJson(args, opts.projectDir, opts.signal);

  if (result.isError) {
    throw new Error(agyFailMessage("antigravity agent run failed", result));
  }
  const newSessionId = result.sessionId ?? opts.sessionId;
  if (!newSessionId) throw new Error("antigravity agent run returned no conversation_id");
  await persistUsage(newSessionId, result.usage);
  if (opts.onLog) {
    if (result.resultText) opts.onLog("text", result.resultText);
    if (result.usage) {
      const inTok = result.usage.input_tokens ?? 0;
      const outTok = result.usage.output_tokens ?? 0;
      const think = result.usage.thinking_tokens ?? 0;
      const parts = [`${inTok}→${outTok} tok`];
      if (think) parts.push(`${think} think`);
      if (result.usage.total_tokens) parts.push(`${result.usage.total_tokens} total`);
      const b = estimateTokenBaseline(inTok, opts.prompt, {
        ignoreLocalMarkdown: opts.ignoreLocalMarkdown,
      });
      const suf = b ? formatBaselineSuffix(b) : "";
      if (suf) parts.push(suf);
      opts.onLog("meta", `■ ${parts.join(" · ")}`);
    }
  }
  return {
    newSessionId,
    provider: "antigravity",
    resultText: result.resultText,
    usage: result.usage
      ? {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        }
      : undefined,
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
