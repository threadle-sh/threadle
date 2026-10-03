import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { formatDuration, shortId } from "../run-metrics.js";
import { resolveRunHarnessExtras, logHarnessExtrasLanes } from "../harness-extras.js";
import { forEachLine, type LogLane, type LogSink } from "../stream.js";
import { museBin } from "./paths.js";

const INJECT_TIMEOUT_MS = 10 * 60_000;

/**
 * Muse experimental "lane reminder gates". Setting each to `0`/`false` turns
 * that reminder family off for the process (skill / goal / verify / …).
 * When unset, Muse runs them and `muse exec` waits on the child sessions.
 */
export const MUSE_REMINDER_GATE_ENV = [
  "MUSE_EXPERIMENTAL_SKILL_REMINDER",
  "MUSE_EXPERIMENTAL_GOAL_REMINDER",
  "MUSE_EXPERIMENTAL_VERIFY_REMINDER",
  "MUSE_EXPERIMENTAL_MEMORY_REMINDER",
  "MUSE_EXPERIMENTAL_TODO_REMINDER",
  "MUSE_EXPERIMENTAL_SCOPE_REMINDER",
] as const;

/** Env for `muse exec`: when reminders are off, pin the gate vars to `0`. */
export function museExecEnv(reminders: boolean): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!reminders) {
    for (const key of MUSE_REMINDER_GATE_ENV) env[key] = "0";
  }
  return env;
}

const FALLBACK_MODELS = [
  "muse-spark-1.3",
  "muse-spark-1.3-contributor",
  "muse-spark-1.2",
];

/** Pull Spark model ids from muse help text (soft catalog until upstream ships `muse models`). */
export function parseMuseSparkIds(helpText: string): string[] {
  const ids = new Set<string>();
  for (const m of helpText.matchAll(/muse-spark-[\w.-]+/g)) {
    ids.add(m[0]!);
  }
  return [...ids];
}

async function helpText(args: string[]): Promise<string> {
  const { stdout, stderr } = await execa(museBin(), args, {
    timeout: 8_000,
    reject: false,
  });
  return `${stdout}\n${stderr}`;
}

export async function listMuseModels(): Promise<string[]> {
  // Prefer env override for labs. Upstream has no stable `muse models` yet.
  const env = process.env.MUSE_MODELS?.trim();
  if (env) {
    return env
      .split(/[,:\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const ids = new Set<string>(FALLBACK_MODELS);
  try {
    // Prefer exec help (inject surface); fall back to top-level help.
    for (const args of [["exec", "--help"], ["--help"]] as string[][]) {
      const text = await helpText(args);
      for (const id of parseMuseSparkIds(text)) ids.add(id);
      if (ids.size > FALLBACK_MODELS.length) break;
    }
  } catch {
    /* keep fallbacks */
  }
  return [...ids];
}

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

function execArgs(opts: {
  sessionId?: string;
  model?: string;
  promptFile: string;
  /** Exclude foreign personal rules/skills (workspace still empty when bare). */
  ignoreLocalMarkdown?: boolean;
}): string[] {
  const args = [
    "exec",
    "--json",
    "--prompt-file",
    opts.promptFile,
    "--approval-mode",
    "never",
  ];
  if (opts.ignoreLocalMarkdown) args.push("--no-foreign-personal-context");
  if (opts.model) args.push("--model", opts.model);
  if (opts.sessionId) args.push("--session-id", opts.sessionId);
  return args;
}

/** Muse `recorded_at` is microseconds since epoch; older fixtures may use ms. */
export function museRecordedMs(recordedAt: unknown): number | undefined {
  if (typeof recordedAt !== "number" || !Number.isFinite(recordedAt)) return undefined;
  return recordedAt > 1e14 ? recordedAt / 1000 : recordedAt;
}

function prettyTaskKind(taskKind: string): string {
  // reminder.agent.skill-reminder → skill-reminder
  const m = taskKind.match(/reminder\.agent\.(.+)$/);
  if (m?.[1]) return m[1];
  if (taskKind === "model.meta.response") return "model";
  return taskKind;
}

export type MuseIngestState = {
  sessionId?: string;
  resultText?: string;
  deltas: string[];
  /** Wall-clock start (Date.now) — Muse recorded_at is often clustered / unusable for deltas. */
  wall0: number;
  firstAnswerAt?: number;
  modelId?: string;
  tokensIn: number;
  tokensOut: number;
  /** task_id → display name + start time (wall) */
  tasks: Map<string, { name: string; startedAt?: number; spawned?: boolean }>;
  spawnNames: string[];
};

export function createMuseIngestState(now = Date.now()): MuseIngestState {
  return {
    deltas: [],
    wall0: now,
    tokensIn: 0,
    tokensOut: 0,
    tasks: new Map(),
    spawnNames: [],
  };
}

/** Accumulate input/output tokens from a Muse usage object (any nesting). */
function harvestMuseUsage(state: MuseIngestState, usage: unknown): void {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return;
  const u = usage as Record<string, unknown>;
  if (typeof u.input_tokens === "number") state.tokensIn += u.input_tokens;
  if (typeof u.output_tokens === "number") state.tokensOut += u.output_tokens;
}

function relativeLabel(state: MuseIngestState, at: number): string {
  return `@${formatDuration(at - state.wall0)}`;
}

/**
 * Pull session id + assistant text from one muse `--json` MSP line, and emit
 * run-log lanes (text / tool / meta). Unknown payload types are skipped.
 */
export function ingestMuseJsonLine(
  line: string,
  state: MuseIngestState,
): Array<[LogLane, string]> {
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const at = Date.now();

  if (typeof row.session_id === "string" && row.session_id) {
    state.sessionId = row.session_id;
  } else if (typeof row.sessionId === "string" && row.sessionId) {
    state.sessionId = row.sessionId;
  }
  const stream = row.stream;
  if (stream && typeof stream === "object" && !Array.isArray(stream)) {
    const s = stream as Record<string, unknown>;
    if (s.kind === "session" && typeof s.id === "string" && s.id) {
      state.sessionId = s.id;
    }
  }

  const pt = typeof row.payload_type === "string" ? row.payload_type : "";
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : undefined;
  if (!payload) return [];

  const out: Array<[LogLane, string]> = [];

  if (pt === "run.model.configured") {
    const model =
      (typeof payload.model_id === "string" && payload.model_id) ||
      (typeof payload.display_label === "string" && payload.display_label) ||
      undefined;
    if (model) {
      state.modelId = model;
      out.push(["meta", `model ${model}`]);
    }
    return out;
  }

  if (pt === "run.lifecycle.started") {
    out.push(["meta", `run started${relativeLabel(state, at)}`]);
    return out;
  }

  // Session/runtime events may carry model_completed.usage (tokens).
  if (pt === "runtime.session" || pt.startsWith("runtime.")) {
    const event =
      payload.event && typeof payload.event === "object" && !Array.isArray(payload.event)
        ? (payload.event as Record<string, unknown>)
        : undefined;
    if (event?.kind === "model_completed") {
      harvestMuseUsage(state, event.usage);
      if (typeof event.model === "string" && event.model) state.modelId = event.model;
    }
    harvestMuseUsage(state, payload.usage);
    return out;
  }

  if (pt === "run.output.delta" && typeof payload.text === "string" && payload.text) {
    state.deltas.push(payload.text);
    if (state.firstAnswerAt === undefined) {
      state.firstAnswerAt = at;
      out.push(["meta", `◷ first answer ${relativeLabel(state, at)}`]);
    }
    out.push(["text", payload.text]);
    return out;
  }

  if (pt === "run.terminal.completed") {
    if (typeof payload.text === "string" && payload.text.trim()) {
      state.resultText = payload.text.trim();
    }
    out.push(["meta", museRunSummary(state, at)]);
    return out;
  }

  if (pt.startsWith("task.lifecycle.")) {
    const taskId = typeof payload.task_id === "string" ? payload.task_id : undefined;
    const event =
      payload.event && typeof payload.event === "object" && !Array.isArray(payload.event)
        ? (payload.event as Record<string, unknown>)
        : undefined;
    if (!taskId || !event) return out;
    const ek = typeof event.kind === "string" ? event.kind : "";

    if (ek === "proposed" && typeof event.task_kind === "string") {
      const name = prettyTaskKind(event.task_kind);
      state.tasks.set(taskId, { name });
      return out;
    }

    if (ek === "started") {
      const task = state.tasks.get(taskId) ?? { name: shortId(taskId, 8) };
      task.startedAt = at;
      state.tasks.set(taskId, task);
      // Skip noisy model.meta.response start — first-answer meta covers it.
      if (task.name === "model") return out;
      if (!task.spawned) {
        task.spawned = true;
        if (!state.spawnNames.includes(task.name)) state.spawnNames.push(task.name);
        out.push(["meta", `⎇ spawn ${task.name}${relativeLabel(state, at)}`]);
        // Non-reminder child tasks surface as a tool lane for live phase HUD.
        if (!/reminder/i.test(task.name)) {
          out.push(["tool", task.name]);
        }
      }
      return out;
    }

    if (ek === "completed") {
      const task = state.tasks.get(taskId);
      if (!task || task.name === "model") return out;
      const dur =
        task.startedAt !== undefined
          ? formatDuration(at - task.startedAt)
          : undefined;
      out.push(["meta", `✓ ${task.name}${dur ? ` ${dur}` : ""}`.trim()]);
      return out;
    }

    if (ek === "status" && typeof event.message === "string" && event.message) {
      const msg = event.message;
      // Keep only phase transitions that explain wall time (retries / stream).
      if (/attempt|retry|error|fail|succeed|completed|opening/i.test(msg)) {
        const task = state.tasks.get(taskId);
        if (task?.name === "model") {
          out.push(["meta", msg]);
        }
      }
      return out;
    }

    if (ek === "side_effect_intent") {
      const op = typeof event.operation === "string" ? event.operation : "";
      if (op === "reminder.child_run") {
        const task = state.tasks.get(taskId);
        const key =
          typeof event.idempotency_key === "string" ? event.idempotency_key : undefined;
        // Prefer name from proposed; else scrape reminder_child:NAME:n
        if (task && !task.spawned) {
          const fromKey = key?.match(/reminder_child:([^:]+)/)?.[1];
          if (fromKey && task.name.startsWith("01")) task.name = fromKey;
        }
      }
      return out;
    }
  }

  return out;
}

/** End-of-run one-liner from accumulated muse stream state. */
export function museRunSummary(state: MuseIngestState, endAt = Date.now()): string {
  const parts: string[] = [formatDuration(endAt - state.wall0)];
  if (state.firstAnswerAt !== undefined) {
    parts.push(`answer@${formatDuration(state.firstAnswerAt - state.wall0)}`);
    if (endAt > state.firstAnswerAt + 250) {
      parts.push(`post-answer ${formatDuration(endAt - state.firstAnswerAt)}`);
    }
  }
  if (state.tokensIn || state.tokensOut) {
    parts.push(`${state.tokensIn}→${state.tokensOut} tok`);
  }
  if (state.spawnNames.length) {
    parts.push(`spawns ${state.spawnNames.length} (${state.spawnNames.join(", ")})`);
  }
  if (state.modelId) parts.push(state.modelId);
  const sid = shortId(state.sessionId);
  if (sid) parts.push(`session ${sid}`);
  return `■ ${parts.join(" · ")}`;
}

async function withPromptFile(
  prompt: string,
  fn: (file: string) => Promise<MuseStreamResult>,
): Promise<MuseStreamResult> {
  const file = path.join(os.tmpdir(), `threadle-muse-${randomUUID()}.txt`);
  await fs.promises.writeFile(file, prompt, "utf8");
  try {
    return await fn(file);
  } finally {
    await fs.promises.unlink(file).catch(() => undefined);
  }
}

type MuseStreamResult = {
  sessionId?: string;
  resultText?: string;
  isError: boolean;
  usage?: { inputTokens: number; outputTokens: number };
};

function museUsageFromState(
  state: MuseIngestState,
): { inputTokens: number; outputTokens: number } | undefined {
  if (!state.tokensIn && !state.tokensOut) return undefined;
  return { inputTokens: state.tokensIn, outputTokens: state.tokensOut };
}

async function runMuseStreaming(
  args: string[],
  cwd: string,
  onLog?: LogSink,
  signal?: AbortSignal,
  reminders = false,
): Promise<MuseStreamResult> {
  const wall0 = Date.now();
  const child = execa(museBin(), args, {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: signal,
    reject: false,
    env: museExecEnv(reminders),
  });
  const state = createMuseIngestState(wall0);
  if (onLog) {
    logHarnessExtrasLanes(onLog, "muse", reminders);
  }
  let sawTerminal = false;
  forEachLine(child.stdout, (line) => {
    const logs = ingestMuseJsonLine(line, state);
    if (logs.some(([lane, text]) => lane === "meta" && text.startsWith("■"))) {
      sawTerminal = true;
    }
    if (onLog) for (const [lane, text] of logs) onLog(lane, text);
  });
  forEachLine(child.stderr, (line) => {
    if (onLog) onLog("raw" as LogLane, line);
  });
  const result = await child;
  const sidIdx = args.indexOf("--session-id");
  if (sidIdx >= 0 && args[sidIdx + 1]) state.sessionId = state.sessionId ?? args[sidIdx + 1];
  const fromDeltas = state.deltas.join("").trim();
  if (onLog && !sawTerminal) {
    onLog("meta", museRunSummary(state));
  }
  return {
    sessionId: state.sessionId,
    resultText: state.resultText || fromDeltas || undefined,
    isError: result.exitCode !== 0 && result.exitCode !== undefined,
    usage: museUsageFromState(state),
  };
}

async function harnessExtrasEnabled(): Promise<boolean> {
  return resolveRunHarnessExtras();
}

export async function injectMuse(
  target: InjectTarget,
  payload: ContextPayload,
  kickoff?: string,
): Promise<InjectResult> {
  const prompt = contextText(payload, kickoff);
  const cwd = target.projectDir || process.cwd();

  if (target.mode === "continue") {
    if (!target.sessionId) throw new Error("continue inject requires a sessionId");
    const reminders = await harnessExtrasEnabled();
    const r = await withPromptFile(prompt, (file) =>
      runMuseStreaming(
        execArgs({ promptFile: file, model: target.model, sessionId: target.sessionId }),
        cwd,
        undefined,
        undefined,
        reminders,
      ),
    );
    if (r.isError) throw new Error("muse continue inject failed");
    return {
      newSessionId: r.sessionId ?? target.sessionId,
      provider: "muse",
      resultText: r.resultText,
      usage: r.usage,
    };
  }

  if (target.mode === "new-session") {
    const pinned = randomUUID();
    const reminders = await harnessExtrasEnabled();
    const r = await withPromptFile(prompt, (file) =>
      runMuseStreaming(
        execArgs({ promptFile: file, model: target.model, sessionId: pinned }),
        cwd,
        undefined,
        undefined,
        reminders,
      ),
    );
    if (r.isError) throw new Error("muse new-session inject failed");
    return {
      newSessionId: r.sessionId ?? pinned,
      provider: "muse",
      resultText: r.resultText,
      usage: r.usage,
    };
  }

  throw new Error(`unsupported inject mode for muse: ${target.mode}`);
}

export async function runMuseAgent(opts: {
  agent?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  sessionId?: string;
  onLog?: LogSink;
  signal?: AbortSignal;
  /** Override Settings `harnessExtras` for this spawn. */
  harnessExtras?: boolean;
  /** @deprecated */
  reminders?: boolean;
  ignoreLocalMarkdown?: boolean;
}): Promise<InjectResult> {
  const pinned = opts.sessionId ?? randomUUID();
  const reminders =
    opts.harnessExtras !== undefined
      ? opts.harnessExtras
      : opts.reminders !== undefined
        ? opts.reminders
        : await harnessExtrasEnabled();
  if (opts.onLog && opts.ignoreLocalMarkdown) {
    opts.onLog("meta", "ignore local md · bare cwd + --no-foreign-personal-context");
  }
  const r = await withPromptFile(opts.prompt, (file) =>
    runMuseStreaming(
      execArgs({
        promptFile: file,
        model: opts.model,
        sessionId: pinned,
        ignoreLocalMarkdown: opts.ignoreLocalMarkdown,
      }),
      opts.projectDir,
      opts.onLog,
      opts.signal,
      reminders,
    ),
  );
  if (r.isError) throw new Error("muse agent run failed");
  const id = r.sessionId ?? pinned;
  return {
    newSessionId: id,
    provider: "muse",
    resultText: r.resultText,
    usage: r.usage,
  };
}
