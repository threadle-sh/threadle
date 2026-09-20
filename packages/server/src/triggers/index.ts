import fs from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { assessDetachedReadiness } from "@threadle/shared";
import { threadleConfigDir } from "../paths.js";
import { readGraph } from "../graphs/store.js";
import { jobs, appendJobLog } from "../jobs.js";
import { executeWorkflow } from "../workflows/executor.js";
import { bus } from "../events.js";
import {
  cronMatches,
  parseTriggersJson,
  type TriggerDef,
  type TriggersFile,
} from "./schema.js";

const LOG_LINE_MAX = 2000;

let loaded: TriggersFile = { triggers: [] };
let cronTimer: ReturnType<typeof setInterval> | undefined;
const watchers: FSWatcher[] = [];
/** triggerId → last cron fire minute key (YYYY-MM-DDTHH:MM) to avoid double-fire */
const lastCronFire = new Map<string, string>();
const runningTriggers = new Set<string>();

export function triggersPath(): string {
  return path.join(threadleConfigDir(), "triggers.json");
}

export function getLoadedTriggers(): TriggersFile {
  return loaded;
}

export async function loadTriggers(): Promise<TriggersFile> {
  const file = triggersPath();
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    loaded = parseTriggersJson(JSON.parse(raw) as unknown);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      loaded = { triggers: [] };
    } else {
      console.warn(
        `threadle: triggers.json ignored: ${err instanceof Error ? err.message : String(err)}`,
      );
      loaded = { triggers: [] };
    }
  }
  return loaded;
}

async function fireTrigger(t: TriggerDef, reason: string): Promise<void> {
  if (runningTriggers.has(t.id)) {
    console.warn(`threadle: trigger ${t.id} still running — skip (${reason})`);
    return;
  }
  const g = await readGraph(t.graphId);
  if (!g) {
    console.warn(`threadle: trigger ${t.id}: graph ${t.graphId} not found`);
    return;
  }
  const readiness = assessDetachedReadiness(g);
  const blockers = readiness.filter((i) => i.blocking);
  if (blockers.length) {
    console.warn(
      `threadle: trigger ${t.id}: blocked — ${blockers.map((b) => b.label).join(", ")}`,
    );
    return;
  }
  const gates = readiness.filter(
    (i) => i.kind === "approval" || i.kind === "live-handoff",
  );
  if (gates.length && !t.approveAll) {
    console.warn(
      `threadle: trigger ${t.id}: skipped — ${gates.length} gate(s); set approveAll: true`,
    );
    return;
  }
  const approveAll = t.approveAll === true;

  runningTriggers.add(t.id);
  const { jobId, signal } = jobs.create("workflow", `trigger:${t.id}`, g.id);
  const onLog = (lane: string, line: string): void => {
    const capped = line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX)}…` : line;
    bus.publish({ type: "job.log", jobId, lane: lane as "raw", line: capped });
    appendJobLog(jobId, lane, capped);
  };
  onLog("meta", `trigger ${t.id} fired (${reason})`);
  try {
    const res = await executeWorkflow({
      graphId: g.id,
      params: t.params,
      approveAll,
      // triggers.json is disk-only (no route writes it) — a hostile value
      // here already implies local file write, so projectDir is trusted
      // as user intent, unlike the HTTP run surfaces.
      projectDir: t.projectDir ?? process.cwd(),
      log: onLog,
      signal,
      jobId,
      onNodeStatus: (nodeId, status) => {
        bus.publish({ type: "job.node", jobId, graphId: g.id, nodeId, status });
      },
    });
    onLog("meta", `trigger ${t.id} done (${res.outputs} output(s))`);
    jobs.finish(jobId, { status: "done", result: { type: "job.done", jobId } });
    bus.publish({ type: "job.done", jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onLog("stderr", `trigger ${t.id} failed: ${message}`);
    jobs.finish(jobId, { status: "error", error: message });
    bus.publish({ type: "job.error", jobId, error: message });
  } finally {
    runningTriggers.delete(t.id);
  }
}

function minuteKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}T${d.getHours()}:${d.getMinutes()}`;
}

function tickCron(now = new Date()): void {
  const key = minuteKey(now);
  for (const t of loaded.triggers) {
    if (t.kind !== "cron" || !t.cron) continue;
    if (!cronMatches(t.cron, now)) continue;
    if (lastCronFire.get(t.id) === key) continue;
    lastCronFire.set(t.id, key);
    void fireTrigger(t, `cron ${t.cron}`);
  }
}

function startWatchTriggers(): void {
  for (const w of watchers) void w.close();
  watchers.length = 0;
  for (const t of loaded.triggers) {
    if (t.kind !== "watch" || !t.paths?.length) continue;
    const base = t.projectDir ?? process.cwd();
    const resolved = t.paths.map((p) =>
      path.isAbsolute(p) ? p : path.resolve(base, p),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void fireTrigger(t, "watch"), 800);
    };
    const w = chokidar
      .watch(resolved, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      })
      .on("add", fire)
      .on("change", fire)
      .on("error", (err) => {
        console.warn(`threadle: trigger ${t.id} watch error: ${String(err)}`);
      });
    watchers.push(w);
  }
}

/** Load triggers.json and start cron tick + path watches. Idempotent. */
export async function startTriggers(): Promise<void> {
  await loadTriggers();
  if (cronTimer) clearInterval(cronTimer);
  // Align near minute boundary: check every 15s
  cronTimer = setInterval(() => tickCron(), 15_000);
  tickCron();
  startWatchTriggers();
  if (loaded.triggers.length) {
    console.log(`threadle: ${loaded.triggers.length} trigger(s) loaded`);
    const gated = loaded.triggers.filter((t) => !t.approveAll);
    if (gated.length) {
      console.warn(
        `threadle: ${gated.length} trigger(s) without approveAll — graphs with approval / live-handoff / wait-idle park will be skipped until you set approveAll: true`,
      );
    }
    const auto = loaded.triggers.filter((t) => t.approveAll);
    if (auto.length) {
      console.warn(
        `threadle: ${auto.length} trigger(s) with approveAll: true — unattended runs auto-pass gates (no splice)`,
      );
    }
  }
}

export async function stopTriggers(): Promise<void> {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = undefined;
  }
  for (const w of watchers) await w.close().catch(() => undefined);
  watchers.length = 0;
  lastCronFire.clear();
}

/** Test hook: run cron tick once with a fixed date. */
export function __tickCronForTest(now: Date): void {
  tickCron(now);
}

/** Test hook: replace loaded triggers without reading disk. */
export function __setTriggersForTest(file: TriggersFile): void {
  loaded = file;
}

/** Test hook: fire without readiness (caller mocks execute). */
export { fireTrigger as __fireTriggerForTest };
