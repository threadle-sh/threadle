import crypto from "node:crypto";
import { execa, type ResultPromise } from "execa";
import { estimateTokenBaseline, formatBaselineSuffix } from "@threadle/shared";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, toolSummary, type LogLane, type LogSink } from "../stream.js";
import { positionalSafe } from "../argv-safe.js";
import { query, type SessionRow } from "./db.js";

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

/** Scan an `opencode run --format json` event stream for the session id. */
function findSessionId(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      const found = scanForSessionId(evt, 0);
      if (found) return found;
    } catch {
      // non-JSON line
    }
  }
  return undefined;
}

/**
 * Collect the assistant's reply from an `opencode run --format json` stream:
 * text events carry the emitted message parts. Best-effort; callers fall back
 * to reading the transcript when this returns undefined.
 */
function findResultText(stdout: string): string | undefined {
  const parts: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as {
        type?: string;
        part?: { type?: string; text?: string };
      };
      if (evt.type === "text" && typeof evt.part?.text === "string") {
        parts.push(evt.part.text);
      }
    } catch {
      // non-JSON line
    }
  }
  const text = parts.join("");
  return text.trim() ? text : undefined;
}

/** Accumulate step-finish tokens from an opencode JSON event stream. */
export function findOpencodeUsageInJsonl(stdout: string): {
  inputTokens: number;
  outputTokens: number;
} | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let saw = false;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      let bag: unknown;
      if (evt.type === "step-finish" && evt.tokens) {
        bag = evt.tokens;
      } else {
        const part =
          evt.part && typeof evt.part === "object" && !Array.isArray(evt.part)
            ? (evt.part as Record<string, unknown>)
            : undefined;
        if (part?.type === "step-finish" && part.tokens) bag = part.tokens;
      }
      if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
      const t = bag as Record<string, unknown>;
      const inn =
        typeof t.input === "number"
          ? t.input
          : typeof t.input_tokens === "number"
            ? t.input_tokens
            : undefined;
      const out =
        typeof t.output === "number"
          ? t.output
          : typeof t.output_tokens === "number"
            ? t.output_tokens
            : undefined;
      if (inn != null) {
        inputTokens += inn;
        saw = true;
      }
      if (out != null) {
        outputTokens += out;
        saw = true;
      }
    } catch {
      // skip
    }
  }
  if (!saw || (!inputTokens && !outputTokens)) return undefined;
  return { inputTokens, outputTokens };
}

function scanForSessionId(value: unknown, depth: number): string | undefined {
  if (depth > 4 || !value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of ["sessionID", "session_id", "sessionId"]) {
    const v = obj[key];
    if (typeof v === "string" && v.startsWith("ses_")) return v;
  }
  if (typeof obj.id === "string" && obj.id.startsWith("ses_")) return obj.id;
  for (const v of Object.values(obj)) {
    const found = scanForSessionId(v, depth + 1);
    if (found) return found;
  }
  return undefined;
}

// ---- managed `opencode serve` for synthetic (no-reply) context inserts ----

interface ManagedServer {
  url: string;
  auth: string; // basic auth header value
  child: ResultPromise;
}

let managed: ManagedServer | undefined;
/** single-flight: concurrent callers share ONE spawn instead of each starting their own */
let pending: Promise<ManagedServer> | undefined;
/** after a failed spawn, back off — a broken opencode must never cause a spawn storm */
let lastFailureAt = 0;
const RETRY_COOLDOWN_MS = 30_000;

async function ensureServer(): Promise<ManagedServer> {
  if (managed) return managed;
  if (pending) return pending;
  if (Date.now() - lastFailureAt < RETRY_COOLDOWN_MS) {
    throw new Error("opencode serve failed to start recently — retrying later");
  }
  pending = spawnManagedServer().then(
    (s) => {
      managed = s;
      pending = undefined;
      return s;
    },
    (err: unknown) => {
      pending = undefined;
      lastFailureAt = Date.now();
      throw err;
    },
  );
  return pending;
}

let spawningChild: ResultPromise | undefined;

async function spawnManagedServer(): Promise<ManagedServer> {
  const password = crypto.randomBytes(16).toString("hex");
  const child = execa("opencode", ["serve", "--port", "0"], {
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
    stdin: "ignore",
    reject: false,
    // The child lives for the daemon's lifetime and logs every request —
    // execa's default buffering would retain ALL of it in memory.
    buffer: false,
  });
  spawningChild = child;

  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      // Detach the URL sniffers once startup settles — leaving them attached
      // would concatenate days of serve logs onto `buffer` forever. Keep the
      // streams FLOWING afterwards (resume) so the pipe buffer never fills
      // and blocks the child's writes — data is simply discarded.
      const detach = (): void => {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        child.stdout?.resume();
        child.stderr?.resume();
        buffer = "";
      };
      const timer = setTimeout(() => {
        detach();
        reject(new Error("opencode serve did not report a URL within 30s"));
      }, 30_000);
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const m = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d+/.exec(buffer);
        if (m) {
          const url = m[0];
          detach();
          resolve(url.replace("0.0.0.0", "127.0.0.1"));
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      void child.on("exit", () => {
        detach();
        reject(new Error("opencode serve exited before reporting a URL"));
      });
    });

    // if the server dies later, forget it so the next call respawns cleanly
    void child.on("exit", () => {
      if (managed?.child === child) managed = undefined;
    });
    // spawn settled — drop the module-level ref so a later exit can't retain
    // this execa handle (and its streams) via `spawningChild`
    spawningChild = undefined;

    return {
      url,
      auth: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      child,
    };
  } catch (err) {
    // NEVER leak the child on failure — this is what melted CPUs before
    child.kill();
    spawningChild = undefined;
    throw err;
  }
}

/** Authenticated GET against the managed serve instance. */
export async function serverGet<T>(pathname: string): Promise<T> {
  const server = await ensureServer();
  const res = await fetch(`${server.url}${pathname}`, {
    headers: { Authorization: server.auth },
  });
  if (!res.ok) throw new Error(`opencode serve GET ${pathname}: ${res.status}`);
  return (await res.json()) as T;
}

export function shutdownManagedServer(): void {
  managed?.child.kill();
  managed = undefined;
  spawningChild?.kill(); // a child still mid-startup must die with us too
  spawningChild = undefined;
}

async function syntheticInsert(
  sessionId: string,
  text: string,
  directory: string,
): Promise<void> {
  const server = await ensureServer();
  const res = await fetch(
    `${server.url}/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(directory)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: server.auth,
      },
      body: JSON.stringify({
        noReply: true,
        parts: [{ type: "text", text, synthetic: true }],
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `opencode synthetic insert failed: ${res.status} ${body.slice(0, 300)}`,
    );
  }
}

export async function injectOpencode(
  target: InjectTarget,
  payload: ContextPayload,
  kickoffPrompt?: string,
): Promise<InjectResult> {
  const text = contextText(payload, kickoffPrompt);

  if (target.mode === "synthetic") {
    if (!target.sessionId) throw new Error("synthetic inject requires a sessionId");
    await syntheticInsert(
      target.sessionId,
      contextText(payload), // no kickoff — pure context, no generation
      target.projectDir,
    );
    return { newSessionId: target.sessionId, provider: "opencode" };
  }

  if (target.mode === "continue") {
    if (!target.sessionId) throw new Error("continue inject requires a sessionId");
    const { stdout } = await execa(
      "opencode",
      ["run", "-s", target.sessionId, "--format", "json", text],
      { cwd: target.projectDir, timeout: INJECT_TIMEOUT_MS, stdin: "ignore" },
    );
    return {
      newSessionId: findSessionId(stdout) ?? target.sessionId,
      provider: "opencode",
    };
  }

  if (target.mode === "new-session") {
    const args = ["run", "--format", "json"];
    if (target.agent) args.push("--agent", target.agent);
    if (target.model) args.push("-m", target.model);
    args.push(positionalSafe(text));
    const { stdout } = await execa("opencode", args, {
      cwd: target.projectDir,
      timeout: INJECT_TIMEOUT_MS,
      stdin: "ignore",
    });
    const newSessionId = findSessionId(stdout);
    if (!newSessionId) {
      throw new Error("could not determine new opencode session id from run output");
    }
    return { newSessionId, provider: "opencode" };
  }

  throw new Error(`unsupported inject mode for opencode: ${target.mode}`);
}

export interface RunAgentOptions {
  /** omitted to send a plain message when continuing a session */
  agent?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  /** continue this existing session instead of starting a fresh one */
  sessionId?: string;
  /** live stream of the run's text/tool events */
  onLog?: LogSink;
  signal?: AbortSignal;
  ignoreLocalMarkdown?: boolean;
}

async function sessionTokensFromDb(
  sessionId: string,
): Promise<{ inputTokens: number; outputTokens: number } | undefined> {
  try {
    const rows = await query<SessionRow>(
      "SELECT tokens_input, tokens_output FROM session WHERE id = ?",
      [sessionId],
    );
    const row = rows[0];
    if (!row) return undefined;
    const inputTokens = Number(row.tokens_input) || 0;
    const outputTokens = Number(row.tokens_output) || 0;
    if (!inputTokens && !outputTokens) return undefined;
    return { inputTokens, outputTokens };
  } catch {
    return undefined;
  }
}

async function waitSessionTokensFromDb(
  sessionId: string,
  attempts = 4,
  delayMs = 150,
): Promise<{ inputTokens: number; outputTokens: number } | undefined> {
  for (let i = 0; i < attempts; i++) {
    const u = await sessionTokensFromDb(sessionId);
    if (u) return u;
    if (i + 1 < attempts) {
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  return undefined;
}

function logTokMeta(
  onLog: LogSink | undefined,
  usage: { inputTokens: number; outputTokens: number } | undefined,
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

/** Map one `opencode run --format json` event line onto a log lane. */
function opencodeEventToLog(line: string): [LogLane, string] | undefined {
  const evt = JSON.parse(line) as {
    type?: string;
    part?: {
      type?: string;
      text?: string;
      tool?: string;
      state?: { status?: string; input?: unknown };
    };
  };
  const part = evt.part;
  switch (evt.type) {
    case "text":
      return part?.text ? ["text", part.text] : undefined;
    case "reasoning":
      return part?.text ? ["thinking", part.text] : undefined;
    case "tool": {
      if (!part?.tool) return undefined;
      // events fire per state change; only surface the start to avoid duplicates
      if (part.state?.status && part.state.status !== "running") return undefined;
      return ["tool", toolSummary(part.tool, part.state?.input)];
    }
    default:
      return undefined;
  }
}

/** Run an opencode agent headlessly with a prompt → new session, or continue `sessionId`. */
export async function runOpencodeAgent(opts: RunAgentOptions): Promise<InjectResult> {
  const args = ["run", "--format", "json"];
  if (opts.agent) args.push("--agent", opts.agent);
  if (opts.sessionId) args.push("-s", opts.sessionId);
  if (opts.model) args.push("-m", opts.model);
  args.push(positionalSafe(opts.prompt));
  if (opts.onLog && opts.ignoreLocalMarkdown) {
    opts.onLog("meta", "ignore local md · bare cwd only (no skip flag)");
  }
  const child = execa("opencode", args, {
    cwd: opts.projectDir,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: opts.signal,
  });
  const lines: string[] = [];
  forEachLine(child.stdout, (line) => {
    lines.push(line);
    if (opts.onLog) {
      const log = opencodeEventToLog(line);
      if (log) opts.onLog(log[0], log[1]);
    }
  });
  await child;
  const streamText = lines.join("\n");
  const newSessionId = findSessionId(streamText) ?? opts.sessionId;
  if (!newSessionId) {
    throw new Error("could not determine session id from opencode run output");
  }
  let usage = findOpencodeUsageInJsonl(streamText);
  if (!usage) usage = await waitSessionTokensFromDb(newSessionId);
  logTokMeta(opts.onLog, usage, opts.prompt, opts.ignoreLocalMarkdown);
  return {
    newSessionId,
    provider: "opencode",
    resultText: findResultText(streamText),
    usage,
  };
}

/** List models known to opencode ("provider/model" ids). */
export async function listOpencodeModels(): Promise<string[]> {
  try {
    const { stdout } = await execa("opencode", ["models"], { timeout: 30_000 });
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[\w.-]+\/[\w.:-]+$/.test(l));
  } catch {
    return [];
  }
}
