import { execa } from "execa";
import { estimateTokenBaseline, formatBaselineSuffix } from "@threadle/shared";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, toolSummary, type LogLane, type LogSink } from "../stream.js";
import { positionalSafe } from "../argv-safe.js";
import { codexBin } from "./paths.js";
import {
  findCodexUsageFromRollout,
  findCodexUsageInJsonl,
  parseCodexUsageFromEvent,
  type CodexUsage,
} from "./usage.js";

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

/** Non-interactive flags suitable for headless inject/run. */
export function safetyArgs(opts?: {
  sandbox?: string;
  askForApproval?: string;
}): string[] {
  const sandbox = opts?.sandbox?.trim() || "workspace-write";
  // `--approve-for-me` implies workspace-write and cannot combine with `--sandbox`.
  if (sandbox === "workspace-write") {
    const ask = opts?.askForApproval?.trim();
    if (!ask || ask === "never" || ask === "on-failure") {
      return ["--approve-for-me"];
    }
    return ["--sandbox", "workspace-write"];
  }
  return ["--sandbox", sandbox];
}

export function execArgs(opts: {
  sessionId?: string;
  model?: string;
  prompt: string;
  sandbox?: string;
  askForApproval?: string;
  /** Empty / non-git cwd — allow Codex outside a repo. */
  ignoreLocalMarkdown?: boolean;
}): string[] {
  // codex exec [--json] [resume <id>] [flags…] <prompt>
  const args = [
    "exec",
    "--json",
    ...safetyArgs({ sandbox: opts.sandbox, askForApproval: opts.askForApproval }),
  ];
  if (opts.ignoreLocalMarkdown) {
    args.push("--skip-git-repo-check");
  }
  if (opts.model) args.push("--model", opts.model);
  if (opts.sessionId) args.push("resume", opts.sessionId);
  args.push(positionalSafe(opts.prompt));
  return args;
}

function findSessionId(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      for (const key of ["session_id", "thread_id", "conversation_id", "id"]) {
        const v = evt[key];
        if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) return v;
      }
      const item = evt.item;
      if (item && typeof item === "object") {
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) return id;
      }
    } catch {
      // continue
    }
  }
  return undefined;
}

function findResultText(stdout: string): string | undefined {
  const chunks: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (typeof evt.text === "string" && evt.text) chunks.push(evt.text);
      if (typeof evt.message === "string" && evt.message) chunks.push(evt.message);
      if (evt.type === "agent_message" && typeof evt.text === "string") chunks.push(evt.text);
      const item = evt.item;
      if (item && typeof item === "object") {
        const it = item as Record<string, unknown>;
        if (typeof it.text === "string") chunks.push(it.text);
      }
    } catch {
      // continue
    }
  }
  const joined = chunks.join("").trim();
  return joined || undefined;
}

/** Map one Codex exec --json line into log lanes (thinking / tool / text). */
export function eventToLogs(line: string): Array<[LogLane, string]> {
  const out: Array<[LogLane, string]> = [];
  try {
    const evt = JSON.parse(line) as Record<string, unknown>;
    if (typeof evt.text === "string" && evt.text) out.push(["text", evt.text]);
    if (evt.type === "agent_message" && typeof evt.message === "string") {
      out.push(["text", evt.message]);
    }

    // Rollout-shaped items on the exec --json stream
    const payload =
      evt.payload && typeof evt.payload === "object" && !Array.isArray(evt.payload)
        ? (evt.payload as Record<string, unknown>)
        : undefined;
    const itemType =
      (typeof payload?.type === "string" && payload.type) ||
      (typeof evt.type === "string" && evt.type) ||
      "";

    if (itemType === "reasoning" || evt.type === "reasoning") {
      const bag = payload ?? evt;
      const summary =
        typeof bag.summary === "string"
          ? bag.summary
          : Array.isArray(bag.summary)
            ? bag.summary
                .map((b) =>
                  b && typeof b === "object" && typeof (b as { text?: string }).text === "string"
                    ? (b as { text: string }).text
                    : "",
                )
                .filter(Boolean)
                .join("\n")
            : "";
      const content =
        typeof bag.content === "string"
          ? bag.content
          : Array.isArray(bag.content)
            ? bag.content
                .map((b) =>
                  b && typeof b === "object" && typeof (b as { text?: string }).text === "string"
                    ? (b as { text: string }).text
                    : "",
                )
                .filter(Boolean)
                .join("\n")
            : "";
      const think = (summary || content).trim();
      if (think) out.push(["thinking", think.length > 200 ? `${think.slice(0, 200)}…` : think]);
    }

    if (
      itemType === "function_call" ||
      itemType === "custom_tool_call" ||
      itemType === "tool_call" ||
      evt.type === "function_call" ||
      evt.type === "tool_call"
    ) {
      const bag = payload ?? evt;
      const name = typeof bag.name === "string" ? bag.name : "tool";
      let input: unknown = bag.arguments ?? bag.input;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          /* keep string */
        }
      }
      out.push(["tool", toolSummary(name, input)]);
    }

    // Nested item on some stream events
    const item = evt.item;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const it = item as Record<string, unknown>;
      if (typeof it.text === "string" && it.text) out.push(["text", it.text]);
      if (it.type === "function_call" || it.type === "tool_call") {
        const name = typeof it.name === "string" ? it.name : "tool";
        out.push(["tool", toolSummary(name, it.arguments ?? it.input)]);
      }
    }
  } catch {
    // ignore
  }
  return out;
}

function toInjectUsage(
  u: CodexUsage | undefined,
): InjectResult["usage"] | undefined {
  if (!u || u.source !== "cli") return undefined;
  if (!u.tokensIn && !u.tokensOut) return undefined;
  return { inputTokens: u.tokensIn, outputTokens: u.tokensOut };
}

function logTokMeta(
  onLog: LogSink | undefined,
  usage: InjectResult["usage"] | undefined,
  prompt: string | undefined,
  ignoreLocalMarkdown: boolean | undefined,
): void {
  if (!onLog || !usage) return;
  const inTok = usage.inputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  const parts = [`${inTok}→${outTok} tok`];
  if (prompt) {
    const b = estimateTokenBaseline(inTok, prompt, { ignoreLocalMarkdown });
    const suf = b ? formatBaselineSuffix(b) : "";
    if (suf) parts.push(suf);
  }
  onLog("meta", `■ ${parts.join(" · ")}`);
}

async function runCodexStreaming(
  args: string[],
  cwd: string,
  onLog?: LogSink,
  signal?: AbortSignal,
): Promise<{
  sessionId?: string;
  resultText?: string;
  stderr?: string;
  isError: boolean;
  usage?: CodexUsage;
}> {
  const child = execa(codexBin(), args, {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: signal,
    reject: false,
  });
  const chunks: string[] = [];
  const errChunks: string[] = [];
  let streamUsage: CodexUsage | undefined;
  forEachLine(child.stdout, (line) => {
    chunks.push(line);
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      const u = parseCodexUsageFromEvent(evt);
      if (u) streamUsage = u;
    } catch {
      /* not json */
    }
    if (onLog) for (const [lane, text] of eventToLogs(line)) onLog(lane, text);
  });
  forEachLine(child.stderr, (line) => {
    errChunks.push(line);
    if (onLog) onLog("raw", line);
  });
  const result = await child;
  const stdout = chunks.join("\n") || result.stdout || "";
  const stderr = errChunks.join("\n") || result.stderr || "";
  const sessionId = findSessionId(stdout);
  let usage = streamUsage ?? findCodexUsageInJsonl(stdout);
  if ((!usage || usage.source !== "cli") && sessionId) {
    usage = (await findCodexUsageFromRollout(sessionId)) ?? usage;
  }
  return {
    sessionId,
    resultText: findResultText(stdout),
    stderr: stderr.trim() || undefined,
    isError: result.exitCode !== 0 && result.exitCode !== undefined,
    usage,
  };
}

function codexFail(prefix: string, r: { resultText?: string; stderr?: string }): Error {
  const detail = [r.stderr, r.resultText].filter(Boolean).join("\n").trim();
  return new Error(detail ? `${prefix}: ${detail}` : prefix);
}

export async function injectCodex(
  target: InjectTarget,
  payload: ContextPayload,
  kickoff?: string,
): Promise<InjectResult> {
  const prompt = contextText(payload, kickoff);
  const cwd = target.projectDir || process.cwd();

  if (target.mode === "continue") {
    if (!target.sessionId) throw new Error("continue inject requires a sessionId");
    const r = await runCodexStreaming(
      execArgs({ prompt, model: target.model, sessionId: target.sessionId }),
      cwd,
    );
    if (r.isError) throw codexFail("codex continue inject failed", r);
    return {
      newSessionId: r.sessionId ?? target.sessionId,
      provider: "codex",
      resultText: r.resultText,
      usage: toInjectUsage(r.usage),
    };
  }

  if (target.mode === "new-session") {
    const r = await runCodexStreaming(execArgs({ prompt, model: target.model }), cwd);
    if (r.isError) throw codexFail("codex new-session inject failed", r);
    if (!r.sessionId) throw new Error("codex new-session returned no session id");
    return {
      newSessionId: r.sessionId,
      provider: "codex",
      resultText: r.resultText,
      usage: toInjectUsage(r.usage),
    };
  }

  throw new Error(`unsupported inject mode for codex: ${target.mode}`);
}

export async function runCodexAgent(opts: {
  agent?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  sessionId?: string;
  sandbox?: string;
  askForApproval?: string;
  ignoreLocalMarkdown?: boolean;
  onLog?: LogSink;
  signal?: AbortSignal;
}): Promise<InjectResult> {
  if (opts.onLog && opts.ignoreLocalMarkdown) {
    opts.onLog("meta", "ignore local md · bare cwd + --skip-git-repo-check");
  }
  const r = await runCodexStreaming(
    execArgs({
      prompt: opts.prompt,
      model: opts.model,
      sessionId: opts.sessionId,
      sandbox: opts.sandbox,
      askForApproval: opts.askForApproval,
      ignoreLocalMarkdown: opts.ignoreLocalMarkdown,
    }),
    opts.projectDir,
    opts.onLog,
    opts.signal,
  );
  if (r.isError) throw codexFail("codex agent run failed", r);
  const newSessionId = r.sessionId ?? opts.sessionId;
  if (!newSessionId) throw new Error("codex agent run returned no session id");
  const usage = toInjectUsage(r.usage);
  logTokMeta(opts.onLog, usage, opts.prompt, opts.ignoreLocalMarkdown);
  return {
    newSessionId,
    provider: "codex",
    resultText: r.resultText,
    usage,
  };
}

export async function listCodexModels(): Promise<string[]> {
  try {
    const { stdout } = await execa(codexBin(), ["models"], {
      timeout: 12_000,
      reject: false,
    });
    const ids: string[] = [];
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || /^name\b/i.test(t)) continue;
      const id = t.split(/\s+/)[0];
      if (id && /^[\w./:+-]+$/.test(id) && !ids.includes(id)) ids.push(id);
    }
    if (ids.length) return ids;
  } catch {
    // fall through
  }
  return ["gpt-5", "gpt-5-codex", "o3", "o4-mini"];
}
