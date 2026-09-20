import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, type LogLane, type LogSink } from "../stream.js";
import { positionalSafe } from "../argv-safe.js";
import { codexBin } from "./paths.js";

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
  return [
    "--sandbox",
    opts?.sandbox?.trim() || "workspace-write",
    "--ask-for-approval",
    opts?.askForApproval?.trim() || "never",
  ];
}

export function execArgs(opts: {
  sessionId?: string;
  model?: string;
  prompt: string;
  sandbox?: string;
  askForApproval?: string;
}): string[] {
  // codex exec [--json] [resume <id>] [flags…] <prompt>
  const args = [
    "exec",
    "--json",
    ...safetyArgs({ sandbox: opts.sandbox, askForApproval: opts.askForApproval }),
  ];
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

function eventToLogs(line: string): Array<[LogLane, string]> {
  const out: Array<[LogLane, string]> = [];
  try {
    const evt = JSON.parse(line) as Record<string, unknown>;
    if (typeof evt.text === "string" && evt.text) out.push(["text", evt.text]);
    if (evt.type === "agent_message" && typeof evt.message === "string") {
      out.push(["text", evt.message]);
    }
  } catch {
    // ignore
  }
  return out;
}

async function runCodexStreaming(
  args: string[],
  cwd: string,
  onLog?: LogSink,
  signal?: AbortSignal,
): Promise<{ sessionId?: string; resultText?: string; isError: boolean }> {
  const child = execa(codexBin(), args, {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: signal,
    reject: false,
  });
  const chunks: string[] = [];
  forEachLine(child.stdout, (line) => {
    chunks.push(line);
    if (onLog) for (const [lane, text] of eventToLogs(line)) onLog(lane, text);
  });
  const result = await child;
  const stdout = chunks.join("\n") || result.stdout || "";
  return {
    sessionId: findSessionId(stdout),
    resultText: findResultText(stdout),
    isError: result.exitCode !== 0 && result.exitCode !== undefined,
  };
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
    if (r.isError) throw new Error("codex continue inject failed");
    return {
      newSessionId: r.sessionId ?? target.sessionId,
      provider: "codex",
      resultText: r.resultText,
    };
  }

  if (target.mode === "new-session") {
    const r = await runCodexStreaming(execArgs({ prompt, model: target.model }), cwd);
    if (r.isError) throw new Error("codex new-session inject failed");
    if (!r.sessionId) throw new Error("codex new-session returned no session id");
    return {
      newSessionId: r.sessionId,
      provider: "codex",
      resultText: r.resultText,
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
  onLog?: LogSink;
  signal?: AbortSignal;
}): Promise<InjectResult> {
  const r = await runCodexStreaming(
    execArgs({
      prompt: opts.prompt,
      model: opts.model,
      sessionId: opts.sessionId,
      sandbox: opts.sandbox,
      askForApproval: opts.askForApproval,
    }),
    opts.projectDir,
    opts.onLog,
    opts.signal,
  );
  if (r.isError) throw new Error("codex agent run failed");
  const newSessionId = r.sessionId ?? opts.sessionId;
  if (!newSessionId) throw new Error("codex agent run returned no session id");
  return {
    newSessionId,
    provider: "codex",
    resultText: r.resultText,
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
