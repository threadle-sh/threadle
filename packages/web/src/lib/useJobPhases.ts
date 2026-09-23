import { onMounted, onUnmounted, reactive } from "vue";
import { deriveRunPhase } from "@threadle/shared";
import { api, subscribeEvents } from "@/api/client";

const LOG_CAP = 200;

type LogLine = { lane: string; line: string };
type SessionRefLite = { provider: string; sessionId: string };

/** Shared across views so one SSE subscription feeds Runs + pills. */
const logsByJobId = reactive<Record<string, LogLine[]>>({});
const sessionRefByJobId = reactive<Record<string, SessionRefLite>>({});
const runningByJobId = reactive<Record<string, boolean>>({});

let subscribers = 0;
let unsub: (() => void) | undefined;
let metaTimer: ReturnType<typeof setInterval> | undefined;
let metaBusy = false;

function sessionKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

function appendLog(jobId: string, lane: string, line: string): void {
  const cur = logsByJobId[jobId] ?? [];
  const next = [...cur, { lane, line }];
  if (next.length > LOG_CAP) next.splice(0, next.length - LOG_CAP);
  logsByJobId[jobId] = next;
}

function clearJob(jobId: string): void {
  delete logsByJobId[jobId];
  delete sessionRefByJobId[jobId];
  delete runningByJobId[jobId];
}

async function refreshJobMeta(): Promise<void> {
  if (metaBusy) return;
  metaBusy = true;
  try {
    const jobs = await api.jobs();
    const seen = new Set<string>();
    for (const j of jobs) {
      seen.add(j.id);
      if (j.status === "running") runningByJobId[j.id] = true;
      else delete runningByJobId[j.id];
      if (j.sessionRef?.provider && j.sessionRef?.sessionId) {
        sessionRefByJobId[j.id] = {
          provider: j.sessionRef.provider,
          sessionId: j.sessionRef.sessionId,
        };
      }
      if (j.status !== "running") {
        if (logsByJobId[j.id]) delete logsByJobId[j.id];
      }
    }
    for (const id of Object.keys(sessionRefByJobId)) {
      if (!seen.has(id)) clearJob(id);
    }
    for (const id of Object.keys(runningByJobId)) {
      if (!seen.has(id)) delete runningByJobId[id];
    }
  } catch {
    // ignore — next tick / event will retry
  } finally {
    metaBusy = false;
  }
}

function retain(): void {
  subscribers += 1;
  if (subscribers === 1) {
    void refreshJobMeta();
    metaTimer = setInterval(() => void refreshJobMeta(), 5_000);
    unsub = subscribeEvents((ev) => {
      if (ev.type === "job.log") {
        appendLog(ev.jobId, ev.lane, ev.line);
        runningByJobId[ev.jobId] = true;
        return;
      }
      if (ev.type === "job.progress") {
        void refreshJobMeta();
        return;
      }
      if (ev.type === "job.done" || ev.type === "job.error") {
        clearJob(ev.jobId);
        void refreshJobMeta();
      }
    });
  }
}

function release(): void {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers === 0) {
    unsub?.();
    unsub = undefined;
    if (metaTimer) {
      clearInterval(metaTimer);
      metaTimer = undefined;
    }
  }
}

/**
 * Live run-phase helpers derived from job.log + JobRecord.sessionRef.
 * Call from setup(); ref-counts a shared SSE subscription.
 */
export function useJobPhases() {
  onMounted(() => retain());
  onUnmounted(() => release());

  function phaseForJob(jobId: string): string {
    return deriveRunPhase(logsByJobId[jobId] ?? []).label;
  }

  function phaseForSession(
    provider: string,
    sessionId: string,
  ): string | undefined {
    const key = sessionKey(provider, sessionId);
    let bestJob: string | undefined;
    let bestLen = -1;
    for (const [jobId, ref] of Object.entries(sessionRefByJobId)) {
      if (!runningByJobId[jobId]) continue;
      if (sessionKey(ref.provider, ref.sessionId) !== key) continue;
      const len = logsByJobId[jobId]?.length ?? 0;
      if (len >= bestLen) {
        bestLen = len;
        bestJob = jobId;
      }
    }
    if (!bestJob) return undefined;
    return phaseForJob(bestJob);
  }

  function logsForJob(jobId: string): LogLine[] {
    return logsByJobId[jobId] ?? [];
  }

  return {
    phaseForJob,
    phaseForSession,
    logsForJob,
    refreshJobMeta,
  };
}

/** Test / debug: reset singleton state. */
export function _resetJobPhasesForTests(): void {
  for (const id of Object.keys(logsByJobId)) delete logsByJobId[id];
  for (const id of Object.keys(sessionRefByJobId)) delete sessionRefByJobId[id];
  for (const id of Object.keys(runningByJobId)) delete runningByJobId[id];
  unsub?.();
  unsub = undefined;
  if (metaTimer) clearInterval(metaTimer);
  metaTimer = undefined;
  subscribers = 0;
}
