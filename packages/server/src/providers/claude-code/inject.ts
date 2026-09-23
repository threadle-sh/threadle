import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import {
  enrichUsageExhaustionError,
  estimateTokenBaseline,
  formatBaselineSuffix,
} from "@threadle/shared";
import { threadleConfigDir } from "../../graphs/store.js";
import { resolveRunHarnessExtras, logHarnessExtrasLanes } from "../harness-extras.js";
import { forEachLine, toolSummary, type LogLane, type LogSink } from "../stream.js";
import { formatDuration } from "../run-metrics.js";

const INJECT_TIMEOUT_MS = 10 * 60_000;

function contextPreamble(payload: ContextPayload): string {
  return [
    "# Context handed off from another agent session",
    "",
    `(source: ${payload.source.provider} session ${payload.source.sessionId}${payload.meta.sourceTitle ? ` — "${payload.meta.sourceTitle}"` : ""}, payload kind: ${payload.kind})`,
    "",
    payload.content,
  ].join("\n");
}

async function writeContextFile(payload: ContextPayload): Promise<string> {
  const dir = path.join(threadleConfigDir(), "tmp");
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `ctx-${payload.hash.slice(0, 12)}.md`);
  await fs.promises.writeFile(file, contextPreamble(payload), "utf8");
  return file;
}

interface ClaudeJsonResult {
  session_id?: string;
  result?: string;
  is_error?: boolean;
  subtype?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

async function runClaude(
  args: string[],
  cwd: string,
): Promise<ClaudeJsonResult> {
  const { stdout } = await execa("claude", args, {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "threadle-inject" },
  });
  return JSON.parse(stdout) as ClaudeJsonResult;
}

export async function injectClaude(
  target: InjectTarget,
  payload: ContextPayload,
  kickoffPrompt?: string,
): Promise<InjectResult> {
  const kickoff =
    kickoffPrompt?.trim() ||
    "Read the handed-off context in your system prompt and summarize in two sentences what you now know and what you would do next. Do not start working yet.";

  if (target.mode === "new-session") {
    const newId = crypto.randomUUID();
    const ctxFile = await writeContextFile(payload);
    const args = [
      "--session-id",
      newId,
      "--append-system-prompt-file",
      ctxFile,
      "-p",
      kickoff,
      "--output-format",
      "json",
    ];
    if (target.model) args.push("--model", target.model);
    const result = await runClaude(args, target.projectDir);
    if (result.is_error) {
      throw new Error(`claude new-session inject failed: ${result.subtype}`);
    }
    return {
      newSessionId: result.session_id ?? newId,
      provider: "claude-code",
      resultText: result.result,
    };
  }

  if (target.mode === "resume-fork") {
    if (!target.sessionId) throw new Error("resume-fork requires a sessionId");
    const prompt = `${contextPreamble(payload)}\n\n---\n\n${kickoff}`;
    const args = [
      "--resume",
      target.sessionId,
      "--fork-session",
      "-p",
      prompt,
      "--output-format",
      "json",
    ];
    if (target.model) args.push("--model", target.model);
    const result = await runClaude(args, target.projectDir);
    if (result.is_error || !result.session_id) {
      throw new Error(`claude fork inject failed: ${result.subtype ?? "no session id"}`);
    }
    return {
      newSessionId: result.session_id,
      provider: "claude-code",
      resultText: result.result,
    };
  }

  throw new Error(`unsupported inject mode for claude-code: ${target.mode}`);
}

export interface RunClaudeAgentOptions {
  /** agent definition name; empty/omitted = plain run (used for plain session continuation) */
  agent?: string;
  /** markdown body of a .claude/agents definition (frontmatter stripped); undefined for built-ins */
  agentSystemPrompt?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  /** continue this existing session (--resume) instead of starting a fresh one */
  sessionId?: string;
  /** Claude --permission-mode (overrides Plan agent default when set) */
  permissionMode?: string;
  /** When false, --disable-slash-commands. Omit = Settings. */
  harnessExtras?: boolean;
  /** Skip project/local CLAUDE.md (see buildClaudeAgentArgv). */
  ignoreLocalMarkdown?: boolean;
  /** live stream of the run's text/tool events */
  onLog?: LogSink;
  signal?: AbortSignal;
}

/**
 * Build argv for a headless `claude` agent run (without output-format / system-prompt file).
 * Exported for tests.
 */
export function buildClaudeAgentArgv(opts: {
  agent?: string;
  model?: string;
  prompt: string;
  /** When set, resume this session; otherwise start fresh with `freshSessionId`. */
  sessionId?: string;
  freshSessionId?: string;
  permissionMode?: string;
  /** When true, skip Plan/Explore defaults (caller adds --append-system-prompt-file). */
  hasAgentSystemPrompt?: boolean;
  /**
   * When false, pass `--disable-slash-commands` (skip slash skills).
   * Do not use `--bare` — it drops claude.ai login (`apiKeySource: none`).
   * Omit / true = Claude defaults.
   */
  harnessExtras?: boolean;
  /** Skip project/local CLAUDE.md via `--setting-sources user`. */
  ignoreLocalMarkdown?: boolean;
}): string[] {
  const args = opts.sessionId
    ? ["--resume", opts.sessionId, "-p", opts.prompt]
    : ["--session-id", opts.freshSessionId ?? "SESSION", "-p", opts.prompt];
  if (opts.model) args.push("--model", opts.model);

  if (opts.harnessExtras === false) {
    args.push("--disable-slash-commands");
  }
  if (opts.ignoreLocalMarkdown) {
    // Keep user settings (auth prefs); drop project + local CLAUDE.md / hooks.
    args.push("--setting-sources", "user");
  }

  if (opts.hasAgentSystemPrompt) {
    if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
  } else if (opts.permissionMode) {
    args.push("--permission-mode", opts.permissionMode);
  } else if (opts.agent === "Plan") {
    args.push("--permission-mode", "plan");
  } else if (opts.agent === "Explore") {
    args.push(
      "--append-system-prompt",
      "You are a read-only exploration agent: investigate and report, never modify files.",
    );
  }
  return args;
}

/** Map one `claude --output-format stream-json` event onto log lines. */
function claudeEventToLogs(line: string): Array<[LogLane, string]> {
  const evt = JSON.parse(line) as {
    type?: string;
    message?: { content?: Array<Record<string, unknown>> };
  };
  if (evt.type !== "assistant" || !Array.isArray(evt.message?.content)) return [];
  const out: Array<[LogLane, string]> = [];
  for (const block of evt.message.content) {
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      out.push(["text", block.text]);
    } else if (
      block.type === "thinking" &&
      typeof block.thinking === "string" &&
      block.thinking
    ) {
      out.push(["thinking", block.thinking]);
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      out.push(["tool", toolSummary(block.name, block.input)]);
    }
  }
  return out;
}

/** Like runClaude, but with `stream-json` output so each turn is surfaced as it happens. */
async function runClaudeStreaming(
  args: string[],
  cwd: string,
  onLog: LogSink,
  signal?: AbortSignal,
  metaOpts?: { prompt?: string; ignoreLocalMarkdown?: boolean },
): Promise<ClaudeJsonResult> {
  const child = execa(
    "claude",
    [...args, "--output-format", "stream-json", "--verbose"],
    {
      cwd,
      timeout: INJECT_TIMEOUT_MS,
      cancelSignal: signal,
      stdin: "ignore",
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "threadle-inject" },
    },
  );
  let result: ClaudeJsonResult | undefined;
  forEachLine(child.stdout, (line) => {
    const evt = JSON.parse(line) as ClaudeJsonResult & { type?: string };
    if (evt.type === "result") {
      result = evt;
      onLog("meta", claudeResultMeta(evt, metaOpts));
      return;
    }
    for (const [lane, text] of claudeEventToLogs(line)) onLog(lane, text);
  });
  await child;
  if (!result) throw new Error("claude stream ended without a result event");
  return result;
}

function claudeResultMeta(
  evt: ClaudeJsonResult,
  opts?: { prompt?: string; ignoreLocalMarkdown?: boolean },
): string {
  const parts: string[] = [];
  if (typeof evt.duration_ms === "number") parts.push(formatDuration(evt.duration_ms));
  if (typeof evt.duration_api_ms === "number") {
    parts.push(`api ${formatDuration(evt.duration_api_ms)}`);
  }
  if (typeof evt.num_turns === "number") {
    parts.push(`${evt.num_turns} turn${evt.num_turns === 1 ? "" : "s"}`);
  }
  const u = evt.usage;
  if (u) {
    const inTok = u.input_tokens ?? 0;
    const outTok = u.output_tokens ?? 0;
    if (inTok || outTok) parts.push(`${inTok}→${outTok} tok`);
    if (opts?.prompt && inTok) {
      const b = estimateTokenBaseline(inTok, opts.prompt, {
        ignoreLocalMarkdown: opts.ignoreLocalMarkdown,
      });
      const suf = b ? formatBaselineSuffix(b) : "";
      if (suf) parts.push(suf);
    }
  }
  if (typeof evt.total_cost_usd === "number") {
    parts.push(`$${evt.total_cost_usd.toFixed(4)}`);
  }
  return parts.length ? `■ ${parts.join(" · ")}` : "■ done";
}

/** Run a prompt headlessly as a new Claude session, optionally under an agent definition. */
export async function runClaudeAgent(
  opts: RunClaudeAgentOptions,
): Promise<InjectResult> {
  const newId = opts.sessionId ?? crypto.randomUUID();
  const harnessExtras = await resolveRunHarnessExtras(opts.harnessExtras);
  const args = buildClaudeAgentArgv({
    agent: opts.agent,
    model: opts.model,
    prompt: opts.prompt,
    sessionId: opts.sessionId,
    freshSessionId: opts.sessionId ? undefined : newId,
    permissionMode: opts.permissionMode,
    hasAgentSystemPrompt: Boolean(opts.agentSystemPrompt),
    harnessExtras,
    ignoreLocalMarkdown: opts.ignoreLocalMarkdown,
  });
  if (opts.onLog) {
    logHarnessExtrasLanes(opts.onLog, "claude-code", harnessExtras);
    if (opts.ignoreLocalMarkdown) {
      opts.onLog("meta", "ignore local md · --setting-sources user");
    }
  }

  if (opts.agentSystemPrompt) {
    const dir = path.join(threadleConfigDir(), "tmp");
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `agent-${Date.now().toString(36)}.md`);
    await fs.promises.writeFile(file, opts.agentSystemPrompt, "utf8");
    args.push("--append-system-prompt-file", file);
  }

  const result = opts.onLog
    ? await runClaudeStreaming(args, opts.projectDir, opts.onLog, opts.signal, {
        prompt: opts.prompt,
        ignoreLocalMarkdown: opts.ignoreLocalMarkdown,
      })
    : await runClaude([...args, "--output-format", "json"], opts.projectDir);
  if (result.is_error) {
    throw enrichUsageExhaustionError(
      new Error(
        `claude agent run failed: ${result.subtype ?? result.result ?? "unknown error"}`,
      ),
    );
  }
  return {
    newSessionId: result.session_id ?? newId,
    provider: "claude-code",
    resultText: result.result,
    usage: result.usage
      ? {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        }
      : undefined,
  };
}
