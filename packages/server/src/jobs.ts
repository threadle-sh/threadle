import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { ServerEvent } from "@threadle/shared";
import { threadleConfigDir } from "./graphs/store.js";

export type JobKind =
  | "run-agent"
  | "run-session"
  | "inject"
  | "distill"
  | "workflow"
  | "custom-node";
export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface JobRecord {
  id: string;
  kind: JobKind;
  label?: string;
  /** workflow (graph) that launched the run, when known */
  graphId?: string;
  status: JobStatus;
  createdAt: number;
  finishedAt?: number;
  /** last sign of life (log line / output merge) — reaper input */
  touchedAt?: number;
  /**
   * Started via POST /api/jobs/start — the BROWSER owns the lifecycle. A
   * closed/crashed tab never calls /finish, so these are the only jobs the
   * abandoned-job reaper may touch (server-driven jobs always finish in
   * their own try/catch).
   */
  clientDriven?: boolean;
  /** terminal payload, mirrors the SSE event */
  result?: Extract<ServerEvent, { type: "job.done" }>;
  error?: string;
}

/** Client-driven jobs idle longer than this are considered abandoned. */
export const JOB_ABANDON_MS = 10 * 60_000;

class JobRegistry extends EventEmitter {
  private jobs = new Map<string, JobRecord>();
  private controllers = new Map<string, AbortController>();
  private counter = 0;

  create(
    kind: JobKind,
    label?: string,
    graphId?: string,
    opts?: { clientDriven?: boolean },
  ): { jobId: string; signal: AbortSignal } {
    this.counter += 1;
    const jobId = `job_${Date.now().toString(36)}_${this.counter}`;
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    this.jobs.set(jobId, {
      id: jobId,
      kind,
      label,
      graphId,
      status: "running",
      createdAt: Date.now(),
      touchedAt: Date.now(),
      clientDriven: opts?.clientDriven || undefined,
    });
    return { jobId, signal: controller.signal };
  }

  /** Record a sign of life (log line / output merge) for the reaper. */
  touch(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.status === "running") job.touchedAt = Date.now();
  }

  /**
   * Finish client-driven jobs whose tab stopped talking to us — without this
   * they stay `running` forever, are skipped by the retention prune, and the
   * jobs map grows without bound (plus phantom "running" rows in the UI).
   */
  reapAbandoned(maxIdleMs = JOB_ABANDON_MS): number {
    const now = Date.now();
    let reaped = 0;
    for (const job of this.jobs.values()) {
      if (!job.clientDriven || job.status !== "running") continue;
      if (now - (job.touchedAt ?? job.createdAt) <= maxIdleMs) continue;
      this.finish(job.id, {
        status: "error",
        error: "abandoned — client disconnected",
      });
      reaped += 1;
    }
    return reaped;
  }

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  list(limit = 100): JobRecord[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /** In-memory jobs merged with the persisted history (survives restarts). */
  async listWithHistory(limit = 200): Promise<JobRecord[]> {
    const merged = new Map<string, JobRecord>();
    for (const job of await readHistory(1000)) merged.set(job.id, job);
    for (const job of this.jobs.values()) merged.set(job.id, job);
    return [...merged.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  cancel(jobId: string): boolean {
    const controller = this.controllers.get(jobId);
    const job = this.jobs.get(jobId);
    if (!controller || !job || job.status !== "running") return false;
    controller.abort();
    this.finish(jobId, { status: "cancelled", error: "cancelled by user" });
    return true;
  }

  finish(
    jobId: string,
    outcome:
      | { status: "done"; result: Extract<ServerEvent, { type: "job.done" }> }
      | { status: "error" | "cancelled"; error: string },
  ): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running") return;
    job.finishedAt = Date.now();
    if (outcome.status === "done") {
      job.status = "done";
      job.result = outcome.result;
    } else {
      job.status = outcome.status;
      job.error = outcome.error;
    }
    this.controllers.delete(jobId);
    void appendHistory(job);
    // cap in-memory retention
    if (this.jobs.size > 500) {
      const oldest = [...this.jobs.values()]
        .filter((j) => j.status !== "running")
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.jobs.delete(oldest.id);
    }
  }
}

async function readHistory(maxLines: number): Promise<JobRecord[]> {
  try {
    const file = path.join(threadleConfigDir(), "runs", "jobs.jsonl");
    const raw = await fs.promises.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean).slice(-maxLines);
    const out: JobRecord[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as JobRecord);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Boot maintenance for runs/jobs.jsonl: mark rows that were still `running`
 * when the previous process died as interrupted (they can never finish now),
 * and cap the append-only file so it doesn't grow forever.
 */
export async function compactJobHistory(maxLines = 2000): Promise<void> {
  try {
    const file = path.join(threadleConfigDir(), "runs", "jobs.jsonl");
    const raw = await fs.promises.readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: string[] = [];
    for (const line of lines.slice(-maxLines)) {
      try {
        const job = JSON.parse(line) as JobRecord;
        if (job.status === "running") {
          job.status = "error";
          job.error = "interrupted — server restarted";
          job.finishedAt = job.finishedAt ?? Date.now();
        }
        out.push(JSON.stringify(job));
      } catch {
        // drop corrupt line
      }
    }
    if (out.length !== lines.length || raw.includes('"status":"running"')) {
      await fs.promises.writeFile(file, out.length ? `${out.join("\n")}\n` : "", "utf8");
    }
  } catch {
    // no history yet — fine
  }
}

async function appendHistory(job: JobRecord): Promise<void> {
  try {
    const dir = path.join(threadleConfigDir(), "runs");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(
      path.join(dir, "jobs.jsonl"),
      `${JSON.stringify(job)}\n`,
      "utf8",
    );
  } catch {
    // history is best-effort
  }
}

// ---- per-job log persistence (runs/logs/<jobId>.jsonl) ----

export interface JobLogLine {
  ts: number;
  lane: string;
  line: string;
}

function logsDir(): string {
  return path.join(threadleConfigDir(), "runs", "logs");
}

/** jobIds are registry-generated (job_<ts36>_<n>) — reject anything else before touching paths. */
function safeJobId(jobId: string): boolean {
  return /^job_[a-z0-9]+_\d+$/.test(jobId);
}

export function appendJobLog(jobId: string, lane: string, line: string): void {
  if (!safeJobId(jobId)) return;
  jobs.touch(jobId);
  const entry: JobLogLine = { ts: Date.now(), lane, line };
  void fs.promises
    .mkdir(logsDir(), { recursive: true })
    .then(() =>
      fs.promises.appendFile(
        path.join(logsDir(), `${jobId}.jsonl`),
        `${JSON.stringify(entry)}\n`,
        "utf8",
      ),
    )
    .catch(() => undefined); // logs are best-effort
}

export async function readJobLogs(jobId: string, maxLines = 2000): Promise<JobLogLine[]> {
  if (!safeJobId(jobId)) return [];
  try {
    const raw = await fs.promises.readFile(path.join(logsDir(), `${jobId}.jsonl`), "utf8");
    const lines = raw.split("\n").filter(Boolean).slice(-maxLines);
    const out: JobLogLine[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as JobLogLine);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

export const jobs = new JobRegistry();

// ---- application log: threadle's own noise (server + frontend), not tied to a job ----

const APP_LOG = "app.jsonl";

export function appLog(source: "server" | "frontend", line: string): void {
  const entry: JobLogLine = { ts: Date.now(), lane: source, line: line.slice(0, 4000) };
  void fs.promises
    .mkdir(logsDir(), { recursive: true })
    .then(() =>
      fs.promises.appendFile(
        path.join(logsDir(), APP_LOG),
        `${JSON.stringify(entry)}\n`,
        "utf8",
      ),
    )
    .catch(() => undefined);
}

export async function readAppLogs(maxLines = 2000): Promise<JobLogLine[]> {
  try {
    const raw = await fs.promises.readFile(path.join(logsDir(), APP_LOG), "utf8");
    const out: JobLogLine[] = [];
    for (const line of raw.split("\n").filter(Boolean).slice(-maxLines)) {
      try {
        out.push(JSON.parse(line) as JobLogLine);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---- per-job node output cache (runs/<jobId>/outputs.json) ----

/** Serializable node output for replay / scoped seed. */
export interface CachedNodeOutput {
  text?: string;
  items?: string[];
  session?: { provider: string; sessionId: string };
  ports?: Record<string, string>;
}

function jobOutputsPath(jobId: string): string {
  return path.join(threadleConfigDir(), "runs", jobId, "outputs.json");
}

export async function readJobOutputs(
  jobId: string,
): Promise<Record<string, CachedNodeOutput>> {
  if (!safeJobId(jobId)) return {};
  try {
    const raw = await fs.promises.readFile(jobOutputsPath(jobId), "utf8");
    const parsed = JSON.parse(raw) as Record<string, CachedNodeOutput>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeJobOutputs(
  jobId: string,
  outputs: Record<string, CachedNodeOutput>,
): Promise<void> {
  if (!safeJobId(jobId)) return;
  try {
    const dir = path.dirname(jobOutputsPath(jobId));
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      jobOutputsPath(jobId),
      JSON.stringify(outputs),
      "utf8",
    );
  } catch {
    // best-effort cache
  }
}

/** Merge one node into the on-disk cache (read-modify-write). */
export async function mergeJobNodeOutput(
  jobId: string,
  nodeId: string,
  output: CachedNodeOutput,
): Promise<void> {
  if (!safeJobId(jobId) || !nodeId) return;
  jobs.touch(jobId);
  const cur = await readJobOutputs(jobId);
  cur[nodeId] = output;
  await writeJobOutputs(jobId, cur);
}

/**
 * Latest finished workflow job for `graphId` that has an outputs.json.
 * Used when seeding a scoped / replay run.
 */
export async function findLatestGraphOutputs(
  graphId: string,
  excludeJobId?: string,
): Promise<{ jobId: string; outputs: Record<string, CachedNodeOutput> } | undefined> {
  if (!graphId) return undefined;
  const history = await jobs.listWithHistory(500);
  const candidates = history
    .filter(
      (j) =>
        j.kind === "workflow" &&
        j.graphId === graphId &&
        j.status === "done" &&
        j.id !== excludeJobId,
    )
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt));
  for (const j of candidates) {
    const outputs = await readJobOutputs(j.id);
    if (Object.keys(outputs).length) return { jobId: j.id, outputs };
  }
  return undefined;
}

/** mirror console.warn/error into the app log so the Logs view sees server noise */
export function captureConsole(): void {
  let inside = false;
  for (const level of ["warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      if (inside) return;
      inside = true;
      try {
        appLog("server", `[${level}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
      } catch {
        // never let logging break the caller
      } finally {
        inside = false;
      }
    };
  }
}
