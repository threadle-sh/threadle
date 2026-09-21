<template>
  <div class="sip">
    <div v-if="loading" class="sip-dim">loading…</div>
    <template v-else-if="ref_">
      <div class="sip-kv mono">
        <template v-for="[k, v] in rows" :key="k">
          <span class="sip-key">{{ k }}</span
          ><span class="sip-val" :title="v">{{ v }}</span>
        </template>
      </div>
      <div v-if="usageRows.length" class="sip-block">
        <div class="micro-label sip-section">usage by model</div>
        <div class="sip-usage mono">
          <div v-for="u in usageRows" :key="u.model" class="sip-usage-row">
            <span class="um-model" :title="u.model">{{ u.model }}</span>
            <span class="um-cost">{{ fmtCost(u.cost) }}</span>
            <span class="um-detail">
              {{ fmtTok(u.input) }} in · {{ fmtTok(u.output) }} out ·
              {{ fmtTok(u.cacheRead) }} cache read · {{ fmtTok(u.cacheWrite) }} cache write
            </span>
          </div>
        </div>
      </div>
      <div class="sip-links">
        <button
          v-if="ref_.parentId"
          class="vsc-btn"
          title="Open the parent session"
          @click="emit('open-parent')"
        >
          ↑ parent session
        </button>
        <button
          class="vsc-btn"
          title="View the interactive message transcript in a floating window"
          @click="fileViewers.openTranscript(provider, sessionId)"
        >
          view transcript
        </button>
        <a
          v-if="shareUrl"
          class="vsc-btn"
          :href="shareUrl"
          target="_blank"
          rel="noopener noreferrer"
        >share url</a>
        <button
          v-if="transcriptPath"
          class="vsc-btn"
          title="Open the raw transcript file in your editor"
          @click="transcriptPath && settings.openPath(transcriptPath)"
        >
          transcript file
        </button>
        <button
          v-if="planPath"
          class="vsc-btn"
          :class="{ 'sip-missing': planMissing }"
          :title="
            planMissing
              ? 'Plan file is missing from disk — deleted or moved'
              : 'Open this session\'s plan file'
          "
          @click="openPlan"
        >
          ≡ plan.md
          <em v-if="planMissing" class="sip-missing-tag">missing</em>
        </button>
        <button
          class="vsc-btn"
          title="Open project in your editor"
          @click="ref_ && settings.openPath(ref_.projectDir)"
        >
          {{ settings.editorLabel }}
        </button>
        <button
          class="vsc-btn"
          :title="`Copy the terminal command to resume this session:\n${resumeCmd}`"
          @click="copyResumeCmd"
        >
          {{ resumeCopied ? "✓ copied" : "❯ resume in terminal" }}
        </button>
      </div>
      <div v-if="touchingRuns.length" class="sip-block">
        <div class="micro-label sip-section">threadle runs · {{ touchingRuns.length }}</div>
        <div class="sip-chips">
          <component
            :is="r.graphId ? 'button' : 'span'"
            v-for="(r, ri) in touchingRuns"
            :key="ri"
            class="sip-chip mono chip-wf"
            :class="{ 'chip-wf-link': r.graphId }"
            :title="r.graphId
              ? 'Open the workflow that ran this'
              : `This session was ${r.kind === 'run-session' ? 'continued' : 'created/driven'} by a threadle run (${r.status})`"
            @click="r.graphId && router.push(`/graph/${r.graphId}`)"
          >
            ⌗ {{ r.label ?? r.kind }} <em>{{ relativeTime(r.createdAt) }}</em>
            <template v-if="r.graphId"> →</template>
          </component>
        </div>
      </div>

      <div class="micro-label sip-section">downloads</div>
      <div class="sip-links">
        <button class="vsc-btn" @click="dl('bundle')">⇓ bundle</button>
        <button class="vsc-btn" @click="dl('context')">⇓ context</button>
        <button class="vsc-btn" @click="dl('reasoning')">⇓ reasoning</button>
      </div>

      <template v-if="bp">
        <div
          v-if="bp.internals && (bp.internals.peakContext > 0 || (bp.internals.timeline?.length ?? 0) > 0)"
          class="sip-block"
        >
          <div class="micro-label sip-section">
            context window
            <span v-if="bp.internals.contextEstimated" class="sip-est" title="Estimated from transcript size (chars÷4) — provider did not record per-turn usage">~est</span>
          </div>
          <div class="sip-ctx">
            <button
              v-if="sparkPoints"
              type="button"
              class="sip-spark-btn"
              title="Open interactive context growth diagram"
              @click="router.push(`/growth/${provider}/${sessionId}`)"
            >
              <svg
                class="sip-spark"
                viewBox="0 0 100 44"
                preserveAspectRatio="none"
                role="img"
                aria-label="context tokens per request over the session — click for growth view"
              >
                <line
                  v-for="x in compactionTicks"
                  :key="x"
                  :x1="x"
                  :x2="x"
                  y1="3"
                  y2="41"
                  class="sip-spark-compact"
                />
                <polyline :points="sparkPoints" class="sip-spark-line" />
              </svg>
            </button>
            <div class="ctxbar">
              <div
                class="ctxbar-fill"
                :class="ctxClass"
                :style="{ width: Math.min(100, ctxPct) + '%' }"
              />
            </div>
            <div class="sip-ctx-row mono">
              <span class="ctx-pct" :class="ctxClass">{{ ctxPct }}% context used</span>
              <span class="ctx-detail">
                {{ fmtCtx(bp.internals.lastContext) }} / {{ fmtTok(ctxWindow) }}
                · peak {{ fmtCtx(bp.internals.peakContext) }}
              </span>
            </div>
            <div v-if="bp.internals.compactions > 0" class="sip-chips">
              <span
                class="sip-chip mono chip-compact"
                title="Context dropped sharply mid-session — the conversation was compacted (summarized to free the window)"
              >
                ≡ compacted conversation <em>×{{ bp.internals.compactions }}</em>
              </span>
            </div>
          </div>
        </div>

        <div
          v-if="contextHandoffs.extracted.length || contextHandoffs.injected.length"
          class="sip-block"
        >
          <div class="micro-label sip-section">
            context handoffs ·
            {{ contextHandoffs.extracted.length + contextHandoffs.injected.length }}
          </div>
          <div class="sip-chips">
            <button
              v-for="cx in contextHandoffs.extracted"
              :key="'ex-' + cx.hash"
              class="sip-chip mono chip-ctx"
              :title="cx.preview || cx.kind"
              @click="openLineage()"
            >
              ↑ {{ KIND_SHORT[cx.kind] ?? cx.kind }}
              <em>{{ fmtTok(Math.round(cx.chars / 4)) }} tok</em>
            </button>
            <button
              v-for="cx in contextHandoffs.injected"
              :key="'in-' + cx.hash"
              class="sip-chip mono chip-ctx"
              :title="cx.preview || cx.kind"
              @click="openLineage()"
            >
              ↓ {{ KIND_SHORT[cx.kind] ?? cx.kind }}
              <em>{{ fmtTok(Math.round(cx.chars / 4)) }} tok</em>
            </button>
          </div>
          <div class="sip-links" style="margin-top: 6px">
            <button class="vsc-btn" @click="openLineage()">❝ lineage</button>
          </div>
        </div>

        <div v-if="bp.tools.length" class="sip-block">
          <div class="micro-label sip-section">tools · {{ bp.tools.length }}</div>
          <div class="sip-chips">
            <span
              v-for="t in bp.tools"
              :key="t.name"
              class="sip-chip mono"
              :title="t.calls?.[0]?.summary"
            >
              ⚙ {{ t.name }} <em>×{{ t.count }}</em>
            </span>
          </div>
        </div>

        <div v-if="bp.skills.length" class="sip-block">
          <div class="micro-label sip-section">skills · {{ bp.skills.length }}</div>
          <div class="sip-chips">
            <span
              v-for="sk in bp.skills"
              :key="sk.name"
              class="sip-chip mono"
              :title="sk.calls?.[0]?.summary"
            >
              ✦ {{ sk.name }} <em>×{{ sk.count }}</em>
            </span>
          </div>
        </div>

        <div v-if="bp.children.length" class="sip-block">
          <div class="micro-label sip-section">subagents · {{ bp.children.length }}</div>
          <div class="sip-sublist">
            <div v-for="c in bp.children" :key="c.id" class="sip-subrow">
              <span class="sip-subglyph mono">⎇</span>
              <span class="sip-subtitle" :title="c.title">{{ c.title ?? c.id }}</span>
              <span class="sip-subagent mono">{{ c.agent ?? "" }}</span>
            </div>
          </div>
        </div>

        <div v-if="bp.files.length" class="sip-block">
          <div class="micro-label sip-section">
            files touched · {{ bp.files.length }}
          </div>
          <div class="sip-chips">
            <span
              v-for="f in bp.files.slice(0, 12)"
              :key="f.path"
              class="sip-chip mono"
              :class="'op-' + f.op"
              :title="f.path"
            >
              {{ f.path.split("/").pop() }}
            </span>
            <span v-if="bp.files.length > 12" class="sip-chip mono dim">
              +{{ bp.files.length - 12 }} more
            </span>
          </div>
        </div>
      </template>
      <div v-else-if="bpLoading" class="sip-dim">scanning session usage…</div>
    </template>
    <div v-else class="sip-dim">session not found (stale reference?)</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SessionRef } from "@threadle/shared";
import { api } from "@/api/client";
import { relativeTime, shortId, fmtTokens, isTokenEstimate } from "@/lib/format";
import { estimateContextWindow } from "@/lib/contextWindow";
import { downloadUrl } from "@/lib/convert";
import { safeExternalHref } from "@/lib/safeHtml";
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useSessionsStore } from "@/stores/sessions";

const props = defineProps<{
  provider: string;
  sessionId: string;
  /** optional seed while /detail is loading or if detail 404s (e.g. stale lists) */
  seed?: SessionRef;
}>();

const emit = defineEmits<{ "open-parent": [] }>();

const router = useRouter();
const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const sessions = useSessionsStore();
void settings.load();

const ref_ = ref<SessionRef>();
const loading = ref(true);

/** Prefer live store status so waiting/running updates without a full reload. */
watch(
  () => sessions.find(props.provider, props.sessionId)?.status,
  (st) => {
    if (st && ref_.value) ref_.value.status = st;
  },
);

interface BpLite {
  tools: Array<{ name: string; count: number; calls?: Array<{ summary: string }> }>;
  skills: Array<{ name: string; count: number; calls?: Array<{ summary: string }> }>;
  children: Array<{ id: string; title?: string; agent?: string }>;
  files: Array<{ path: string; op: string }>;
  contexts?: {
    extracted: Array<{ hash: string; kind: string; preview: string; chars: number }>;
    injected: Array<{ hash: string; kind: string; preview: string; chars: number }>;
  };
  internals?: {
    peakContext: number;
    lastContext: number;
    contextEstimated?: boolean;
    compactions: number;
    timeline?: Array<{ ts?: number; context: number }>;
  };
}
const bp = ref<BpLite>();
const bpLoading = ref(false);

// ---- threadle runs that produced/continued this session (workflow hint) ----

interface TouchingRun {
  kind: string;
  label?: string;
  createdAt: number;
  status: string;
  graphId?: string;
}
const touchingRuns = ref<TouchingRun[]>([]);

async function loadTouchingRuns(): Promise<void> {
  touchingRuns.value = [];
  try {
    const all = (await (await fetch("/api/jobs")).json()) as Array<{
      kind: string;
      label?: string;
      createdAt: number;
      status: string;
      graphId?: string;
      result?: { inject?: { provider: string; newSessionId: string } };
    }>;
    touchingRuns.value = all
      .filter(
        (j) =>
          j.result?.inject?.provider === props.provider &&
          j.result.inject.newSessionId === props.sessionId,
      )
      .map((j) => ({
        kind: j.kind,
        label: j.label,
        createdAt: j.createdAt,
        status: j.status,
        graphId: j.graphId,
      }));
  } catch {
    // jobs endpoint unavailable — no hint
  }
}

const sparkPoints = computed(() => {
  const tl = bp.value?.internals?.timeline;
  if (!tl || tl.length < 2) return "";
  const peak = Math.max(...tl.map((t) => t.context), 1);
  return tl
    .map((t, i) => {
      const x = 2 + (96 * i) / (tl.length - 1);
      const y = 41 - (38 * t.context) / peak;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
});

const compactionTicks = computed(() => {
  const tl = bp.value?.internals?.timeline;
  if (!tl || tl.length < 2) return [];
  const ticks: number[] = [];
  for (let i = 1; i < tl.length; i++) {
    const prev = tl[i - 1]!.context;
    if (prev > 20_000 && tl[i]!.context < prev * 0.55) {
      ticks.push(2 + (96 * i) / (tl.length - 1));
    }
  }
  return ticks;
});

/**
 * best-effort context window: model-id hint, then bumped to the smallest
 * standard window that fits the observed peak (the peak never lies).
 */
const ctxWindow = computed(() =>
  estimateContextWindow(ref_.value?.model, bp.value?.internals?.peakContext ?? 0),
);
const ctxPct = computed(() => {
  const last = bp.value?.internals?.lastContext ?? 0;
  return Math.min(999, Math.round((100 * last) / ctxWindow.value));
});
const ctxClass = computed(() =>
  ctxPct.value >= 90 ? "ctx-hot" : ctxPct.value >= 70 ? "ctx-warm" : "ctx-ok",
);

watch(
  () => [props.provider, props.sessionId] as const,
  async () => {
    loading.value = true;
    bp.value = undefined;
    bpLoading.value = true;
    if (props.seed && props.seed.id === props.sessionId && props.seed.provider === props.provider) {
      ref_.value = props.seed;
    }
    try {
      const live = await api.session(props.provider, props.sessionId);
      ref_.value = live;
    } catch {
      if (!(props.seed && props.seed.id === props.sessionId)) {
        ref_.value = undefined;
      }
    } finally {
      loading.value = false;
    }
    void loadTouchingRuns();
    // usage lists come from the (heavier, mtime-cached) blueprint endpoint
    void fetch(`/api/sessions/${props.provider}/blueprint/${props.sessionId}`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((b) => {
        bp.value = b as BpLite | undefined;
      })
      .catch(() => undefined)
      .finally(() => {
        bpLoading.value = false;
      });
  },
  { immediate: true },
);

function metaStr(key: string): string | undefined {
  const v = ref_.value?.meta?.[key];
  return typeof v === "string" ? v : undefined;
}
function metaNum(key: string): number | undefined {
  const v = ref_.value?.meta?.[key];
  return typeof v === "number" ? v : undefined;
}

function fmtTok(n?: number): string {
  return fmtTokens(n);
}

function fmtTokMaybeEst(n?: number): string {
  return fmtTokens(n, { estimate: isTokenEstimate(ref_.value?.meta) });
}

function fmtCtx(n?: number): string {
  return fmtTokens(n, { estimate: bp.value?.internals?.contextEstimated === true });
}

const KIND_SHORT: Record<string, string> = {
  "distilled-summary": "distilled",
  "transcript-excerpt": "excerpt",
  files: "files",
};

const contextHandoffs = computed(() => ({
  extracted: bp.value?.contexts?.extracted ?? [],
  injected: bp.value?.contexts?.injected ?? [],
}));

function openLineage(): void {
  void router.push({
    path: "/lineage",
    query: { focus: `${props.provider}:${props.sessionId}` },
  });
}

function fmtBytes(n?: number): string {
  if (n === undefined) return "—";
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

function fmtDur(ms?: number): string {
  if (ms === undefined || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtCost(c?: number): string {
  if (c === undefined) return "—";
  return `$${c.toFixed(c < 0.01 ? 4 : 2)}`;
}

/** claude's /cost "Usage by model", scanned server-side from the transcript */
interface UsageRow {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: number;
}
const usageRows = computed<UsageRow[]>(() => {
  const v = ref_.value?.meta?.usageByModel;
  return Array.isArray(v) ? (v as UsageRow[]) : [];
});

const rows = computed<Array<[string, string]>>(() => {
  const r = ref_.value;
  if (!r) return [];
  const cacheTotal =
    (r.tokensIn ?? 0) + (r.tokensCacheRead ?? 0) + (r.tokensCacheWrite ?? 0);
  const out: Array<[string, string]> = [
    ["provider", r.provider],
    ["kind", r.kind === "subagent-run" ? "subagent run" : "session"],
    ["session id", r.id],
    ["project", r.projectDir],
    ["model", r.model ?? "—"],
    ["agent", r.agent ?? "—"],
    ["parent", r.parentId ?? "—"],
    ["status", r.status],
    ["created", r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"],
    ["updated", new Date(r.updatedAt).toLocaleString()],
    ["messages", String(r.messageCount ?? "—")],
    ["tokens in", fmtTokMaybeEst(r.tokensIn)],
    ["tokens out", fmtTokMaybeEst(r.tokensOut)],
    ["reasoning", fmtTokMaybeEst(r.tokensReasoning)],
    ["cache read", fmtTokMaybeEst(r.tokensCacheRead)],
    ["cache write", fmtTokMaybeEst(r.tokensCacheWrite)],
    [
      "cache hit",
      cacheTotal
        ? `${((100 * (r.tokensCacheRead ?? 0)) / cacheTotal).toFixed(1)}%`
        : "—",
    ],
    ["tracked costs", r.cost !== undefined ? `$${r.cost.toFixed(4)}` : "—"],
    [
      "actual spend",
      r.actualCost === undefined
        ? "—"
        : r.actualCost === 0 && (r.cost ?? 0) > 0
          ? "$0 (subscription)"
          : `$${r.actualCost.toFixed(4)}`,
    ],
    ["permission", metaStr("permissionMode") ?? "default"],
  ];
  const planMode = metaStr("planMode");
  if (planMode || planPath.value) {
    const awaiting = ref_.value?.meta?.planAwaitingApproval === true;
    out.push([
      "plan",
      planMode
        ? `${planMode}${awaiting ? " · awaiting approval" : ""}`
        : "plan.md",
    ]);
  }
  const tokenSource = metaStr("tokenSource");
  if (tokenSource === "estimate") {
    out.splice(
      out.findIndex(([k]) => k === "tokens out") + 1,
      0,
      ["token source", "estimate (chars/4)"],
    );
  } else if (tokenSource === "cli" || tokenSource === "turn_ended") {
    out.splice(
      out.findIndex(([k]) => k === "tokens out") + 1,
      0,
      ["token source", tokenSource],
    );
  }
  const apiMs = metaNum("apiDurationMs");
  if (apiMs !== undefined) out.push(["duration (API)", fmtDur(apiMs)]);
  if (r.createdAt) out.push(["duration (wall)", fmtDur(r.updatedAt - r.createdAt)]);
  const lAdd = metaNum("linesAdded");
  const lDel = metaNum("linesRemoved");
  if (lAdd !== undefined || lDel !== undefined) {
    out.push(["code changes", `+${lAdd ?? 0} −${lDel ?? 0} lines`]);
  }
  out.push(
    ["git branch", metaStr("gitBranch") ?? "—"],
    ["cli version", metaStr("cliVersion") ?? "—"],
  );
  const slug = metaStr("slug");
  if (slug) out.push(["slug", slug]);
  const bridge = metaStr("bridgeSessionId");
  if (bridge) out.push(["claude.ai bridge", bridge]);
  const tBytes = metaNum("transcriptBytes");
  if (tBytes !== undefined) out.push(["transcript size", fmtBytes(tBytes)]);
  const dAdd = metaNum("diffAdditions");
  const dDel = metaNum("diffDeletions");
  const dFiles = metaNum("diffFiles");
  if (dAdd !== undefined || dDel !== undefined) {
    out.push([
      "diff summary",
      `+${dAdd ?? 0} −${dDel ?? 0}${dFiles ? ` across ${dFiles} files` : ""}`,
    ]);
  }
  return out;
});

const shareUrl = computed(() => safeExternalHref(metaStr("shareUrl")));
const transcriptPath = computed(() => metaStr("transcriptPath"));
const planPath = computed(() => metaStr("planPath"));
const planMissing = computed(() => {
  void fileViewers.missingPaths;
  const p = planPath.value;
  return !!p && fileViewers.isMissing(p);
});

function openPlan(): void {
  const p = planPath.value;
  if (!p) return;
  void fileViewers.open(p);
}

watch(
  planPath,
  (p) => {
    if (p) void fileViewers.probeMissing([p]);
  },
  { immediate: true },
);
const sessionHasTranscript = computed(() => {
  if ((ref_.value?.messageCount ?? 0) > 0) return true;
  return !!transcriptPath.value;
});

// ---- resume in terminal ----

const resumeCopied = ref(false);

const resumeCmd = computed(() => {
  const r = ref_.value;
  if (!r) return "";
  const cd = r.projectDir ? `cd ${shellQuote(r.projectDir)} && ` : "";
  if (r.provider === "opencode") return `${cd}opencode -s ${r.id}`;
  if (r.provider === "cursor") return `${cd}agent --resume ${r.id}`;
  if (r.provider === "antigravity") return `${cd}agy --conversation ${r.id}`;
  if (r.provider === "codex") return `${cd}codex exec resume ${r.id}`;
  if (r.provider === "copilot") return `${cd}copilot --resume ${r.id}`;
  if (r.provider === "grok") return `${cd}grok --resume ${r.id}`;
  return `${cd}claude --resume ${r.id}`;
});

function shellQuote(p: string): string {
  return /^[A-Za-z0-9_\-./~]+$/.test(p) ? p : `'${p.replaceAll("'", "'\\''")}'`;
}

async function copyResumeCmd(): Promise<void> {
  if (!resumeCmd.value) return;
  await navigator.clipboard.writeText(resumeCmd.value).catch(() => undefined);
  resumeCopied.value = true;
  setTimeout(() => (resumeCopied.value = false), 1600);
}

async function dl(kind: "bundle" | "context" | "reasoning"): Promise<void> {
  await downloadUrl(
    `/api/sessions/${props.provider}/${kind}/${props.sessionId}`,
    `threadle-${kind}-${shortId(props.sessionId).replace("…", "")}.${kind === "bundle" ? "json" : "md"}`,
  );
}
</script>

<style scoped>
.sip {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sip-dim {
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.vsc-btn.sip-missing {
  opacity: 0.55;
  color: var(--text-faint);
}
.sip-missing-tag {
  margin-left: 6px;
  font-style: normal;
  font-size: var(--fs-2xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--status-error);
}
.sip-kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 5px 16px;
  font-size: var(--fs-xs);
}
.sip-key {
  color: var(--text-faint);
}
.sip-val {
  color: var(--text-dim);
  word-break: break-word;
}
.sip-links {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.sip-section {
  padding-top: 6px;
}
.sip-est,
.bp-est {
  margin-left: 6px;
  color: var(--text-faint);
  font-weight: 400;
  letter-spacing: 0.02em;
}
.sip-chip.chip-ctx {
  cursor: pointer;
  border-color: color-mix(in srgb, var(--context) 45%, transparent);
  color: var(--context);
  background: none;
}
.sip-chip.chip-ctx:hover {
  background: color-mix(in srgb, var(--context) 12%, transparent);
}
.mono {
  font-family: var(--mono);
}
.sip-block {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.sip-usage {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-xs);
}
.sip-usage-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 1px 12px;
}
.um-model {
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.um-cost {
  color: var(--text);
  text-align: right;
}
.um-detail {
  grid-column: 1 / -1;
  color: var(--text-faint);
}
.sip-ctx {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sip-spark-btn {
  display: block;
  width: 100%;
  padding: 0;
  margin: 0;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.sip-spark-btn:hover .sip-spark {
  border-color: color-mix(in srgb, var(--context) 45%, transparent);
}
.sip-spark {
  width: 100%;
  height: 46px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  display: block;
}
.sip-spark-line {
  fill: none;
  stroke: var(--lane-session);
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}
.sip-spark-compact {
  stroke: var(--status-waiting);
  stroke-width: 1;
  stroke-dasharray: 2 2;
  vector-effect: non-scaling-stroke;
}
.ctxbar {
  height: 5px;
  border-radius: 3px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  overflow: hidden;
}
.ctxbar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.25s ease;
}
.ctxbar-fill.ctx-ok {
  background: var(--text-dim);
}
.ctxbar-fill.ctx-warm {
  background: var(--status-warn, #e8b93e);
}
.ctxbar-fill.ctx-hot {
  background: var(--status-error);
}
.sip-ctx-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  font-size: var(--fs-2xs);
}
.ctx-pct {
  font-weight: 600;
}
.ctx-pct.ctx-ok {
  color: var(--text-dim);
}
.ctx-pct.ctx-warm {
  color: var(--status-warn, #e8b93e);
}
.ctx-pct.ctx-hot {
  color: var(--status-error);
}
.ctx-detail {
  color: var(--text-faint);
}
.sip-chip.chip-compact {
  border-color: rgba(232, 185, 62, 0.35);
  color: var(--text-dim);
}
.sip-chip.chip-wf {
  border-color: var(--border-strong);
  color: var(--text);
  background: none;
}
.sip-chip.chip-wf-link {
  cursor: pointer;
}
.sip-chip.chip-wf-link:hover {
  background: var(--panel-bg-raised);
}
.sip-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.sip-chip {
  font: inherit;
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 7px;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sip-chip em {
  font-style: normal;
  color: var(--text-faint);
}
.sip-chip.dim {
  color: var(--text-faint);
  border-style: dashed;
}
.sip-chip.op-write,
.sip-chip.op-create {
  border-color: rgba(74, 222, 128, 0.3);
}
.sip-chip.op-edit,
.sip-chip.op-patch {
  border-color: rgba(232, 185, 62, 0.3);
}
.sip-sublist {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sip-subrow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
}
.sip-subglyph {
  color: var(--lane-session);
  flex-shrink: 0;
}
.sip-subtitle {
  flex: 1;
  min-width: 0;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sip-subagent {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  flex-shrink: 0;
}
</style>
