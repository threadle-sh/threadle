<template>
  <div class="settings-card internals-card">
    <div class="micro-label">test pilot</div>
    <p class="stat-note internals-note">
      Cheap smoke prompts against available providers (harness extras off by
      default). <b>ignore local md</b> runs in an empty workspace so AGENTS.md /
      rules do not inflate tokens. Turn on <b>extra tests</b> for permission /
      sandbox / mode variants and extras:off · extras:on pairs. Click a row for
      diagram · metrics · logs. Prompt:
      <span class="mono">{{ plan?.prompt ?? "…" }}</span>.
      Tok / baseline when usage is available (Claude, Cursor, Antigravity,
      Muse, plus Codex / Copilot / Grok / OpenCode when the CLI or session
      store reports it). Grok / OpenCode ignore-md is bare cwd only (no skip
      flag).
    </p>
    <div class="settings-row">
      <span class="settings-opt-label">extra tests</span>
      <div class="settings-seg" role="group" aria-label="extra tests">
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !extraTests }"
          :disabled="busy || loading"
          title="Base smoke only (one case per provider)"
          @click="setExtraTests(false)"
        >
          off
        </button>
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: extraTests }"
          :disabled="busy || loading"
          :title="`Include ${plan?.extraCaseCount ?? '…'} flag / mode variants`"
          @click="setExtraTests(true)"
        >
          on
        </button>
      </div>
    </div>
    <div class="settings-row">
      <span class="settings-opt-label">ignore local md</span>
      <div class="settings-seg" role="group" aria-label="ignore local markdown">
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !ignoreLocalMd }"
          :disabled="busy || loading"
          title="Use the real project dir (AGENTS.md / CLAUDE.md / rules load)"
          @click="ignoreLocalMd = false"
        >
          off
        </button>
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: ignoreLocalMd }"
          :disabled="busy || loading"
          title="Bare empty workspace — skip AGENTS.md / CLAUDE.md / .cursor rules (cheap smoke)"
          @click="ignoreLocalMd = true"
        >
          on
        </button>
      </div>
    </div>
    <div class="settings-row">
      <button
        class="threadle-btn primary"
        :disabled="busy || !runnableCount"
        title="Run visible pilot cases in parallel"
        @click="runPilot"
      >
        {{ busy ? "Running…" : `▶ test ${runnableCount} case${runnableCount === 1 ? "" : "s"}` }}
      </button>
      <button
        v-if="busy"
        class="threadle-btn"
        title="Cancel in-flight pilot jobs"
        @click="cancelPilot"
      >
        ■ cancel
      </button>
      <button
        class="threadle-btn"
        :disabled="busy || loading"
        title="Refresh which CLIs are available"
        @click="loadPlan"
      >
        {{ loading ? "…" : "⟳" }}
      </button>
      <span v-if="summary" class="stat-note mono cnode-summary">{{ summary }}</span>
    </div>
    <p v-if="error" class="stat-note cnode-err">{{ error }}</p>
    <div
      class="stat-table cols-pilot"
      v-col-resize="'pilot'"
      data-cols="100px minmax(0,1fr) 64px 72px minmax(0,1.2fr)"
    >
      <div class="stat-cols micro-label">
        <span>provider</span><span>case</span><span>ms</span><span>tok</span><span>status</span>
      </div>
      <template v-for="row in rows" :key="row.id">
        <div
          class="stat-row pilot-clickable"
          :class="{
            'pilot-ok': row.state === 'ok',
            'pilot-err': row.state === 'error',
            'pilot-run': row.state === 'running' || row.state === 'queued',
            'pilot-skip': row.state === 'skip',
            'pilot-extra': row.extra,
            open: expanded === row.id,
          }"
          role="button"
          tabindex="0"
          :title="expanded === row.id ? 'Hide detail' : 'Show diagram · metrics · logs'"
          @click="toggleExpand(row)"
          @keydown.enter.prevent="toggleExpand(row)"
          @keydown.space.prevent="toggleExpand(row)"
        >
          <span class="mono">
            <span class="prov-dot" :data-p="row.provider" />
            {{ providerLabel(row.provider) }}
          </span>
          <span class="mono pilot-case" :title="row.note || row.variant">{{
            row.variant
          }}</span>
          <span class="mono pilot-ms">{{
            row.ms != null ? row.ms.toLocaleString() : "—"
          }}</span>
          <span class="mono pilot-tok" :title="tokenTitle(row)">{{
            row.tokens || "—"
          }}</span>
          <span class="mono pilot-status">{{ row.label }}</span>
        </div>
        <div v-if="expanded === row.id" class="pilot-detail" @click.stop>
          <div class="pilot-detail-bar">
            <button
              type="button"
              class="vsc-btn"
              :class="{ toggled: detailTab === 'diagram' }"
              @click="detailTab = 'diagram'"
            >
              ⌗ diagram
            </button>
            <button
              type="button"
              class="vsc-btn"
              :class="{ toggled: detailTab === 'metrics' }"
              @click="detailTab = 'metrics'"
            >
              ▤ metrics
            </button>
            <button
              type="button"
              class="vsc-btn"
              :class="{ toggled: detailTab === 'logs' }"
              @click="detailTab = 'logs'"
            >
              ≣ logs
              <span v-if="logsFor(row.id).length" class="pilot-tab-count">{{
                logsFor(row.id).length
              }}</span>
            </button>
            <span class="pilot-detail-spacer" />
            <button
              v-if="row.detail"
              type="button"
              class="threadle-btn pilot-copy"
              :disabled="copyBusy === row.id"
              @click="copyDetail(row)"
            >
              {{ copyBusy === row.id ? "copied" : "copy" }}
            </button>
          </div>

          <div v-if="detailTab === 'diagram'" class="pilot-diagram">
            <div class="pilot-flow">
              <div class="pilot-node">
                <span class="micro-label">prompt</span>
                <span class="pilot-node-body mono">{{
                  shortPrompt(plan?.prompt)
                }}</span>
              </div>
              <span class="pilot-arrow" aria-hidden="true">→</span>
              <div
                class="pilot-node pilot-node-agent"
                :class="{
                  ok: row.state === 'ok',
                  err: row.state === 'error',
                  run: row.state === 'running' || row.state === 'queued',
                }"
              >
                <span class="micro-label">
                  <span class="prov-dot" :data-p="row.provider" />
                  {{ providerLabel(row.provider) }}
                </span>
                <span class="pilot-node-body mono">{{ row.agent }}</span>
                <span class="pilot-node-sub mono">{{ row.variant }}</span>
              </div>
              <span class="pilot-arrow" aria-hidden="true">→</span>
              <div
                class="pilot-node"
                :class="{
                  ok: row.state === 'ok',
                  err: row.state === 'error',
                  skip: row.state === 'skip',
                }"
              >
                <span class="micro-label">result</span>
                <span class="pilot-node-body mono">{{ resultGlyph(row) }}</span>
                <span v-if="row.ms != null" class="pilot-node-sub mono"
                  >{{ row.ms.toLocaleString() }}ms</span
                >
                <span
                  v-if="row.tokens || tokensFromLogs(row.id)"
                  class="pilot-node-sub mono"
                  >{{ row.tokens || tokensFromLogs(row.id) }} tok</span
                >
                <span
                  v-if="row.baselineEst != null"
                  class="pilot-node-sub mono"
                  title="Estimated system · tools · rules · MCP overhead"
                  >baseline ~{{ formatTokCompact(row.baselineEst) }}</span
                >
              </div>
            </div>
            <p v-if="row.note" class="stat-note mono">{{ row.note }}</p>
            <div v-if="extrasLanes(row).length" class="pilot-extras">
              <span class="micro-label">harness extras</span>
              <div class="pilot-extras-list mono">
                <span
                  v-for="lane in extrasLanes(row)"
                  :key="lane.name"
                  class="pilot-extra-lane"
                  :class="lane.state"
                  >{{ lane.state === "run" ? "·" : "⊘" }} {{ lane.name }}</span
                >
              </div>
            </div>
            <pre
              v-if="row.detail && (row.state === 'error' || row.state === 'ok')"
              class="pilot-detail-body"
              :class="{ err: row.state === 'error' }"
              >{{ row.detail }}</pre
            >
          </div>

          <div v-else-if="detailTab === 'metrics'" class="pilot-metrics mono">
            <div class="pilot-kv">
              <template v-for="[k, v] in metricRows(row)" :key="k">
                <span class="pilot-key">{{ k }}</span>
                <span class="pilot-val" :title="v">{{ v }}</span>
              </template>
            </div>
            <p v-if="!metricRows(row).length" class="stat-note">no metrics yet</p>
          </div>

          <div v-else class="pilot-logs mono">
            <p v-if="logsBusy === row.id" class="stat-note">loading logs…</p>
            <p v-else-if="!logsFor(row.id).length" class="stat-note">
              {{
                row.jobId
                  ? "no log lines recorded for this run"
                  : "run the pilot to capture logs"
              }}
            </p>
            <div
              v-for="(l, li) in logsFor(row.id)"
              :key="li"
              class="pilot-log-line"
            >
              <span class="rl-ts">{{ logTime(l.ts) }}</span>
              <span class="rl-lane" :class="'rl-lane-' + l.lane">{{ l.lane }}</span>
              <span class="rl-text">{{ l.line }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import type { ProviderId, ServerEvent } from "@threadle/shared";
import {
  PROVIDER_HARNESS_EXTRAS,
  deriveRunPhase,
  estimateTokenBaseline,
  formatTokCompact,
} from "@threadle/shared";
import { api, subscribeEvents } from "@/api/client";
import { providerLabel } from "@/lib/providers";
import { vColResize } from "@/lib/colResize";

type PilotState = "idle" | "skip" | "queued" | "running" | "ok" | "error";
type DetailTab = "diagram" | "metrics" | "logs";

interface PilotCaseRow {
  id: string;
  provider: ProviderId;
  variant: string;
  agent: string;
  model?: string;
  permissionMode?: string;
  sandbox?: string;
  askForApproval?: string;
  harnessExtras?: boolean;
  extra?: boolean;
  note?: string;
  available: boolean;
  skipReason?: string;
}

interface PilotLogLine {
  ts: number;
  lane: string;
  line: string;
}

interface PilotRow extends PilotCaseRow {
  state: PilotState;
  jobId?: string;
  sessionId?: string;
  startedAt?: number;
  ms?: number;
  /** Parsed `in→out` token summary from meta logs */
  tokens?: string;
  /** Estimated baseline (tokensIn − prompt) */
  baselineEst?: number;
  baselineNote?: string;
  promptEst?: number;
  detail?: string;
  label: string;
}

interface PilotPlan {
  prompt: string;
  extraTests: boolean;
  harnessExtras: false;
  cases: PilotCaseRow[];
  extraCaseCount: number;
}

const plan = ref<PilotPlan>();
const rows = ref<PilotRow[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const projectDir = ref<string>();
const extraTests = ref(false);
/** Default on — pilot smoke should not ingest project AGENTS.md / rules. */
const ignoreLocalMd = ref(true);
const expanded = ref<string>();
const detailTab = ref<DetailTab>("diagram");
const copyBusy = ref<string>();
const logsBusy = ref<string>();
const logsByCase = reactive<Record<string, PilotLogLine[]>>({});
const jobToCase = new Map<string, string>();
let unsub: (() => void) | undefined;
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const runnableCount = computed(
  () => rows.value.filter((r) => r.available).length,
);

const summary = computed(() => {
  if (!rows.value.length) return "";
  const skip = rows.value.filter((r) => r.state === "skip").length;
  const ok = rows.value.filter((r) => r.state === "ok").length;
  const err = rows.value.filter((r) => r.state === "error").length;
  const run = rows.value.filter((r) => r.state === "running" || r.state === "queued").length;
  if (busy.value || run) return `${run} running · ${ok} ok · ${err} fail · ${skip} skip`;
  if (ok || err) return `${ok} ok · ${err} fail · ${skip} skip`;
  return `${rows.value.filter((r) => r.available).length} ready · ${skip} skip`;
});

function statusLabel(row: PilotRow): string {
  switch (row.state) {
    case "skip":
      return row.skipReason ?? "skip";
    case "queued":
      return "queued";
    case "running": {
      const { label } = deriveRunPhase(logsFor(row.id));
      return label;
    }
    case "ok": {
      const t = row.detail?.trim();
      return t ? `✓ ${t.slice(0, 48)}` : "✓ ok";
    }
    case "error":
      return `✗ ${(row.detail ?? "failed").slice(0, 72)}`;
    default:
      return "—";
  }
}

function resultGlyph(row: PilotRow): string {
  switch (row.state) {
    case "ok": {
      const t = row.detail?.trim();
      if (!t || t === "done") return "✓";
      return t.length > 48 ? `✓ ${t.slice(0, 48)}…` : `✓ ${t}`;
    }
    case "error":
      return "✗ fail";
    case "running":
      return deriveRunPhase(logsFor(row.id)).label;
    case "queued":
      return "queued";
    case "skip":
      return "⊘ skip";
    default:
      return "—";
  }
}

function shortPrompt(p?: string): string {
  const t = p?.trim() || "…";
  return t.length > 36 ? `${t.slice(0, 36)}…` : t;
}

function logsFor(id: string): PilotLogLine[] {
  return logsByCase[id] ?? [];
}

function logTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function appendLog(caseId: string, lane: string, line: string, ts = Date.now()): void {
  const cur = logsByCase[caseId] ?? [];
  logsByCase[caseId] = [...cur, { ts, lane, line }];
  const tok = parseTokensFromLine(line);
  if (tok) {
    const inTok = Number(tok.split("→")[0]);
    const patch: Partial<PilotRow> = { tokens: tok };
    if (Number.isFinite(inTok) && plan.value?.prompt) {
      const b = estimateTokenBaseline(inTok, plan.value.prompt, {
        ignoreLocalMarkdown: ignoreLocalMd.value,
      });
      if (b) {
        patch.baselineEst = b.baselineEst;
        patch.baselineNote = b.baselineNote;
        patch.promptEst = b.promptEst;
      }
    }
    patchRow(caseId, patch);
    return;
  }
  // Refresh status label while running so phase tracks the latest lane.
  const row = rows.value.find((r) => r.id === caseId);
  if (row && (row.state === "running" || row.state === "queued")) {
    patchRow(caseId, {});
  }
}

/** Pull `123→45 tok` (or similar) from a meta/result line. */
function parseTokensFromLine(line: string): string | undefined {
  const m =
    /(\d+)\s*→\s*(\d+)\s*tok/i.exec(line) ||
    /(\d+)\s*->\s*(\d+)\s*tok/i.exec(line) ||
    /input[_\s-]?tokens[=:\s]+(\d+).*output[_\s-]?tokens[=:\s]+(\d+)/i.exec(line);
  if (!m) return undefined;
  return `${m[1]}→${m[2]}`;
}

function tokensFromLogs(caseId: string): string | undefined {
  const lines = logsFor(caseId);
  for (let i = lines.length - 1; i >= 0; i--) {
    const tok = parseTokensFromLine(lines[i]!.line);
    if (tok) return tok;
  }
  return undefined;
}

function tokenTitle(row: PilotRow): string | undefined {
  if (!row.tokens && row.baselineEst == null) return undefined;
  const parts: string[] = [];
  if (row.tokens) parts.push(`${row.tokens} in→out`);
  if (row.promptEst != null) parts.push(`prompt ~${formatTokCompact(row.promptEst)}`);
  if (row.baselineEst != null) {
    parts.push(
      `baseline ~${formatTokCompact(row.baselineEst)}${
        row.baselineNote ? ` (${row.baselineNote})` : ""
      }`,
    );
  }
  return parts.join(" · ");
}

function extrasLanes(row: PilotRow): Array<{ name: string; state: string }> {
  const spec = PROVIDER_HARNESS_EXTRAS[row.provider];
  if (!spec) return [];
  const on = row.harnessExtras === true;
  return spec.lanes.map((name) => ({
    name,
    state: on ? "run" : "skipped",
  }));
}

function metricRows(row: PilotRow): Array<[string, string]> {
  const out: Array<[string, string]> = [
    ["provider", row.provider],
    ["case", row.variant],
    ["agent", row.agent],
  ];
  if (row.model) out.push(["model", row.model]);
  if (row.permissionMode) out.push(["permission", row.permissionMode]);
  if (row.sandbox) out.push(["sandbox", row.sandbox]);
  if (row.askForApproval) out.push(["ask", row.askForApproval]);
  if (row.harnessExtras !== undefined) {
    out.push(["harness extras", row.harnessExtras ? "on" : "off"]);
  }
  out.push(["ignore local md", ignoreLocalMd.value ? "on (bare workspace)" : "off"]);
  for (const lane of extrasLanes(row)) {
    out.push([`extra · ${lane.name}`, lane.state]);
  }
  if (row.ms != null) out.push(["wall", `${row.ms.toLocaleString()} ms`]);
  const tok = row.tokens || tokensFromLogs(row.id);
  if (tok) out.push(["tokens", `${tok} (in→out)`]);
  if (row.promptEst != null) {
    out.push(["prompt (est)", `~${formatTokCompact(row.promptEst)} tok`]);
  }
  if (row.baselineEst != null) {
    out.push([
      "baseline (est)",
      `~${formatTokCompact(row.baselineEst)}${
        row.baselineNote ? ` · ${row.baselineNote}` : ""
      }`,
    ]);
  }
  if (row.jobId) out.push(["job", row.jobId]);
  if (row.sessionId) out.push(["session", row.sessionId]);
  if (row.state) out.push(["status", row.state]);

  const meta = logsFor(row.id).filter((l) => l.lane === "meta");
  for (const m of meta.slice(-8)) {
    const line = m.line.replace(/^[^:]+:\s*/, "").trim();
    if (!line) continue;
    if (
      /^(▶|■|extras |⊘ |· )/i.test(line) ||
      /answer@|tok|turn|\$|api |post-answer|spawn /i.test(line)
    ) {
      out.push(["meta", line.length > 90 ? `${line.slice(0, 90)}…` : line]);
    }
  }
  return out;
}

function toggleExpand(row: PilotRow): void {
  if (expanded.value === row.id) {
    expanded.value = undefined;
    return;
  }
  expanded.value = row.id;
  detailTab.value = "diagram";
  void loadLogs(row);
}

async function loadLogs(row: PilotRow): Promise<void> {
  if (!row.jobId) return;
  if (logsFor(row.id).length) return;
  logsBusy.value = row.id;
  try {
    const { lines } = await api.jobLogs(row.jobId);
    logsByCase[row.id] = lines.map((l) => ({
      ts: l.ts,
      lane: l.lane,
      line: l.line,
    }));
    const tok = tokensFromLogs(row.id);
    if (tok) patchRow(row.id, { tokens: tok });
  } catch {
    // keep whatever we streamed live
  } finally {
    if (logsBusy.value === row.id) logsBusy.value = undefined;
  }
}

async function copyDetail(row: PilotRow): Promise<void> {
  const text =
    detailTab.value === "logs"
      ? logsFor(row.id)
          .map((l) => `${logTime(l.ts)}\t${l.lane}\t${l.line}`)
          .join("\n")
      : detailTab.value === "metrics"
        ? metricRows(row)
            .map(([k, v]) => `${k}\t${v}`)
            .join("\n")
        : row.detail?.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyBusy.value = row.id;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      if (copyBusy.value === row.id) copyBusy.value = undefined;
    }, 1200);
  } catch {
    // clipboard unavailable
  }
}

function patchRow(id: string, patch: Partial<PilotRow>): void {
  const i = rows.value.findIndex((r) => r.id === id);
  if (i < 0) return;
  const next = { ...rows.value[i]!, ...patch };
  next.label = statusLabel(next);
  rows.value[i] = next;
  rows.value = [...rows.value];
}

function recomputeBusy(): void {
  busy.value = rows.value.some((r) => r.state === "running" || r.state === "queued");
}

function applyPlan(p: PilotPlan): void {
  plan.value = p;
  rows.value = p.cases.map((r) => {
    const row: PilotRow = {
      ...r,
      state: r.available ? "idle" : "skip",
      label: "",
    };
    row.label = statusLabel(row);
    return row;
  });
}

async function loadPlan(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [p, health] = await Promise.all([
      api.pilotPlan(extraTests.value),
      fetch("/api/health")
        .then((r) => r.json() as Promise<{ projectDir?: string }>)
        .catch((): { projectDir?: string } => ({})),
    ]);
    if (typeof health.projectDir === "string" && health.projectDir) {
      projectDir.value = health.projectDir;
    }
    applyPlan(p);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function setExtraTests(on: boolean): Promise<void> {
  if (extraTests.value === on || busy.value) return;
  extraTests.value = on;
  expanded.value = undefined;
  await loadPlan();
}

async function runPilot(): Promise<void> {
  if (busy.value) return;
  error.value = "";
  if (!plan.value) await loadPlan();
  const prompt = plan.value?.prompt;
  if (!prompt) {
    error.value = "pilot plan unavailable";
    return;
  }

  jobToCase.clear();
  for (const k of Object.keys(logsByCase)) delete logsByCase[k];
  expanded.value = undefined;
  const targets = rows.value.filter((r) => r.available);
  if (!targets.length) {
    error.value = "no providers available";
    return;
  }

  for (const t of targets) {
    patchRow(t.id, {
      state: "queued",
      jobId: undefined,
      sessionId: undefined,
      startedAt: undefined,
      ms: undefined,
      tokens: undefined,
      baselineEst: undefined,
      baselineNote: undefined,
      promptEst: undefined,
      detail: undefined,
    });
  }
  busy.value = true;

  await Promise.all(
    targets.map(async (t) => {
      try {
        const { jobId } = await api.runAgent({
          provider: t.provider,
          agent: t.agent,
          model: t.model,
          prompt,
          projectDir: ignoreLocalMd.value ? "" : projectDir.value || "",
          permissionMode: t.permissionMode,
          sandbox: t.sandbox,
          askForApproval: t.askForApproval,
          harnessExtras: t.harnessExtras ?? false,
          ignoreLocalMarkdown: ignoreLocalMd.value,
          pilot: true,
          pilotCaseId: t.id,
        });
        jobToCase.set(jobId, t.id);
        patchRow(t.id, {
          state: "running",
          jobId,
          startedAt: Date.now(),
        });
      } catch (err) {
        patchRow(t.id, {
          state: "error",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  recomputeBusy();
}

async function cancelPilot(): Promise<void> {
  const ids = [...jobToCase.keys()];
  await Promise.all(
    ids.map(async (id) => {
      try {
        await api.cancelJob(id);
      } catch {
        // ignore
      }
      const caseId = jobToCase.get(id);
      if (caseId) {
        patchRow(caseId, { state: "error", detail: "cancelled", ms: elapsed(caseId) });
      }
    }),
  );
  jobToCase.clear();
  recomputeBusy();
}

function elapsed(caseId: string): number | undefined {
  const row = rows.value.find((r) => r.id === caseId);
  if (!row?.startedAt) return undefined;
  return Date.now() - row.startedAt;
}

function onEvent(ev: ServerEvent): void {
  if (!("jobId" in ev) || !ev.jobId) return;
  const caseId = jobToCase.get(ev.jobId);
  if (!caseId) return;

  if (ev.type === "job.log") {
    appendLog(caseId, ev.lane, ev.line);
    return;
  }
  if (ev.type === "job.progress") {
    patchRow(caseId, { state: "running", detail: ev.message });
    return;
  }
  if (ev.type === "job.done") {
    const text = ev.inject?.resultText?.trim();
    // Empty reply is not a successful smoke — treat as error on the client too.
    if (!text) {
      patchRow(caseId, {
        state: "error",
        detail: "no response",
        sessionId: ev.inject?.newSessionId,
        ms: elapsed(caseId),
      });
    } else {
      patchRow(caseId, {
        state: "ok",
        detail: text,
        sessionId: ev.inject?.newSessionId,
        ms: elapsed(caseId),
      });
    }
    jobToCase.delete(ev.jobId);
    recomputeBusy();
    return;
  }
  if (ev.type === "job.error") {
    patchRow(caseId, {
      state: "error",
      detail: ev.error,
      ms: elapsed(caseId),
    });
    jobToCase.delete(ev.jobId);
    recomputeBusy();
  }
}

onMounted(() => {
  unsub = subscribeEvents(onEvent);
  void loadPlan();
});

onUnmounted(() => {
  unsub?.();
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<style scoped>
.cols-pilot :deep(.stat-cols),
.cols-pilot :deep(.stat-row) {
  grid-template-columns: var(--cols-pilot, 100px minmax(0, 1fr) 64px 72px minmax(0, 1.2fr));
}
.pilot-case,
.pilot-ms,
.pilot-tok {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.pilot-ms,
.pilot-tok {
  text-align: right;
}
.pilot-extras {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pilot-extras-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: var(--fs-2xs);
  color: var(--text-dim);
}
.pilot-extra-lane.run {
  color: var(--text);
}
.pilot-extra-lane.skipped {
  color: var(--text-faint);
}
.pilot-extra .pilot-case {
  color: var(--text);
}
.pilot-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  color: var(--text-dim);
}
.pilot-ok .pilot-status {
  color: var(--text);
}
.pilot-err .pilot-status {
  color: var(--status-error);
}
.pilot-run .pilot-status {
  color: var(--status-waiting);
}
.pilot-skip .pilot-status {
  color: var(--text-faint);
}
.pilot-clickable {
  cursor: pointer;
}
.pilot-clickable:hover,
.pilot-clickable.open {
  background: var(--panel-bg-raised);
}
.pilot-detail {
  margin: 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--input-bg);
  overflow: hidden;
}
.pilot-detail-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.pilot-detail-spacer {
  flex: 1;
}
.pilot-tab-count {
  margin-left: 4px;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.pilot-copy {
  height: 22px;
  min-width: 0;
  padding: 0 8px;
  font-size: var(--fs-2xs);
}
.vsc-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.vsc-btn.toggled {
  border-color: var(--border);
  background: var(--panel-bg-raised);
  color: var(--text);
}
.pilot-diagram {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pilot-flow {
  display: flex;
  align-items: stretch;
  gap: 8px;
  flex-wrap: wrap;
}
.pilot-node {
  flex: 1 1 120px;
  min-width: 100px;
  max-width: 220px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pilot-node.ok {
  border-color: color-mix(in srgb, var(--text) 35%, var(--border));
}
.pilot-node.err {
  border-color: color-mix(in srgb, var(--status-error) 50%, var(--border));
}
.pilot-node.run {
  border-color: color-mix(in srgb, var(--status-waiting) 50%, var(--border));
}
.pilot-node.skip {
  opacity: 0.65;
}
.pilot-node-body {
  font-size: var(--fs-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pilot-node-sub {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pilot-arrow {
  align-self: center;
  color: var(--text-faint);
  font-family: var(--mono);
  flex-shrink: 0;
}
.pilot-detail-body {
  margin: 0;
  padding: 8px 10px;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--fs-xs);
  line-height: 1.4;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
}
.pilot-detail-body.err {
  color: var(--status-error);
}
.pilot-metrics {
  padding: 8px 12px 12px;
}
.pilot-kv {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 4px 12px;
  align-items: baseline;
}
.pilot-key {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}
.pilot-val {
  font-size: var(--fs-xs);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pilot-logs {
  padding: 6px 0 10px;
  max-height: 260px;
  overflow: auto;
}
.pilot-log-line {
  display: grid;
  grid-template-columns: 72px 64px minmax(0, 1fr);
  gap: 8px;
  padding: 2px 12px;
  font-size: var(--fs-xs);
  line-height: 1.35;
}
.rl-ts {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.rl-lane {
  color: var(--text-dim);
}
.rl-lane-stderr,
.rl-lane-error {
  color: var(--status-error);
}
.rl-lane-meta {
  color: var(--text-faint);
}
.rl-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
}
.pilot-log-line:hover .rl-text {
  white-space: pre-wrap;
  overflow: visible;
  color: var(--text);
}
.prov-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--text-faint);
}
.prov-dot[data-p="claude-code"] { background: var(--claude); }
.prov-dot[data-p="cursor"] { background: var(--cursor); }
.prov-dot[data-p="opencode"] { background: var(--opencode); }
.prov-dot[data-p="antigravity"] { background: var(--antigravity); }
.prov-dot[data-p="codex"] { background: var(--codex); }
.prov-dot[data-p="copilot"] { background: var(--copilot); }
.prov-dot[data-p="grok"] { background: var(--grok); }
.prov-dot[data-p="muse"] { background: var(--muse); }
.cnode-summary {
  margin-left: auto;
}
.cnode-err {
  color: var(--status-error);
}
.settings-opt-label {
  font-size: var(--fs-md);
  color: var(--text);
  margin-right: auto;
}
.settings-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.settings-seg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  min-width: 44px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  cursor: pointer;
  border-radius: calc(var(--radius-sm) - 1px);
}
.settings-seg-btn.active {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.settings-seg-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
