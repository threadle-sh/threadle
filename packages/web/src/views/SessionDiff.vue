<template>
  <div class="diff-page">
    <DashNav :items="navItems" active="sessions" @select="goDash" />
    <div class="diff-main">
      <header class="diff-topbar">
        <button class="back" title="Back to sessions" @click="router.push({ path: '/', query: { view: 'sessions' } })">←</button>
        <div class="diff-title-wrap">
          <div class="diff-title">Session diff</div>
          <div class="diff-sub micro-label">
            why did A work and B not — metrics, tools, files, divergence
          </div>
        </div>
      </header>

      <div class="diff-fill">
        <GraphLoadingOverlay
          :loading="loading"
          label="Loading sessions"
        />
        <div v-if="!loading && (!a || !b)" class="diff-dim">
          pick two sessions to compare (Sessions view → ⇆ compare)
        </div>
        <div v-else-if="a && b" class="diff-body">
        <!-- ==== header cards ==== -->
        <div class="diff-grid diff-heads">
          <div v-for="(s, i) in [a, b]" :key="i" class="diff-head-card">
            <div class="diff-side-label mono">{{ i === 0 ? "A" : "B" }}</div>
            <div class="diff-head-title" :title="s.ref?.title">
              {{ s.ref?.title ?? shortId(s.id) }}
            </div>
            <div class="diff-head-meta mono">
              {{ s.provider }} · {{ s.ref?.model ?? "—" }} · {{ s.ref?.agent ?? "no agent" }}
            </div>
            <div class="diff-head-meta mono dim2">
              {{ s.ref?.projectDir ?? "" }}
            </div>
            <div class="diff-head-actions">
              <button class="vsc-btn" @click="router.push(`/blueprint/${s.provider}/${s.id}`)">
                ⌗ blueprint
              </button>
            </div>
          </div>
        </div>

        <!-- ==== metrics ==== -->
        <div class="micro-label diff-section">metrics</div>
        <div class="diff-table mono">
          <template v-for="m in metricRows" :key="m.label">
            <span class="dt-key">{{ m.label }}</span>
            <span class="dt-val" :class="{ hot: m.differs && m.hotter === 0 }">{{ m.a }}</span>
            <span class="dt-val" :class="{ hot: m.differs && m.hotter === 1 }">{{ m.b }}</span>
          </template>
        </div>

        <!-- ==== tools ==== -->
        <div class="micro-label diff-section">tools</div>
        <div class="diff-table mono">
          <span class="dt-key dt-head">tool</span>
          <span class="dt-val dt-head">A</span>
          <span class="dt-val dt-head">B</span>
          <template v-for="t in toolRows" :key="t.name">
            <span class="dt-key">⚙ {{ t.name }}</span>
            <span class="dt-val" :class="{ zero: !t.a, diff: t.a !== t.b }">{{ t.a || "—" }}</span>
            <span class="dt-val" :class="{ zero: !t.b, diff: t.a !== t.b }">{{ t.b || "—" }}</span>
          </template>
          <p v-if="!toolRows.length" class="diff-note">no tool calls in either session</p>
        </div>

        <!-- ==== files ==== -->
        <div class="micro-label diff-section">files touched</div>
        <div class="diff-files">
          <span
            v-for="f in fileRows"
            :key="f.path"
            class="threadle-chip mono file-chip"
            :class="'in-' + f.side"
            :title="f.path + ' · ' + (f.side === 'both' ? 'both sessions' : 'only session ' + f.side.toUpperCase())"
          >
            {{ f.side === "both" ? "◍" : f.side === "a" ? "A" : "B" }} {{ f.path.split("/").pop() }}
          </span>
          <p v-if="!fileRows.length" class="diff-note">no files touched in either session</p>
        </div>

        <!-- ==== divergence ==== -->
        <div class="micro-label diff-section">divergence</div>
        <div v-if="divergence" class="diff-diverge">
          <p class="diff-note">
            <template v-if="divergence.index === -1">
              user prompts are identical across
              {{ divergence.aTotal }} vs {{ divergence.bTotal }} user turns —
              differences come from the model/tool side.
            </template>
            <template v-else>
              first divergence at user turn #{{ divergence.index + 1 }}:
            </template>
          </p>
          <div v-if="divergence.index >= 0" class="diff-grid">
            <pre class="diff-prompt mono">{{ divergence.aText || "(no such turn — session A ended)" }}</pre>
            <pre class="diff-prompt mono">{{ divergence.bText || "(no such turn — session B ended)" }}</pre>
          </div>
        </div>
      </div>
      </div>
    <StatusBar />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { SessionRef } from "@threadle/shared";
import DashNav from "@/panels/DashNav.vue";
import StatusBar from "@/panels/StatusBar.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import { useNavItems } from "@/panels/useNavItems";
import { fmtTokens, isTokenEstimate, shortId } from "@/lib/format";

interface SideData {
  provider: string;
  id: string;
  ref?: SessionRef;
  stats?: { userTurns: number; assistantTurns: number; messages: number };
  internals?: {
    peakContext: number;
    lastContext: number;
    contextEstimated?: boolean;
    compactions: number;
    toolErrors: number;
    durationMs?: number;
  };
  tools: Array<{ name: string; count: number }>;
  files: Array<{ path: string; op: string }>;
  userPrompts: string[];
}

const route = useRoute();
const router = useRouter();
const navItems = useNavItems();

const loading = ref(true);
const a = ref<SideData>();
const b = ref<SideData>();

function goDash(view: string): void {
  if (view === "lineage") return void router.push("/lineage");
  if (view === "timeline") return void router.push("/timeline");
  if (view === "map") return void router.push("/map");
  void router.push({ path: "/", query: { view } });
}

function parseRef(q: unknown): { provider: string; id: string } | undefined {
  if (typeof q !== "string") return undefined;
  const i = q.indexOf("::");
  if (i < 0) return undefined;
  return { provider: q.slice(0, i), id: q.slice(i + 2) };
}

async function loadSide(provider: string, id: string): Promise<SideData | undefined> {
  try {
    const bp = (await (
      await fetch(`/api/sessions/${provider}/blueprint/${id}`)
    ).json()) as {
      ref?: SessionRef;
      stats?: SideData["stats"];
      internals?: SideData["internals"];
      tools: SideData["tools"];
      files: SideData["files"];
    };
    const tr = (await (
      await fetch(`/api/sessions/${provider}/transcript/${id}?full=1`)
    ).json()) as { messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> };
    const userPrompts = tr.messages
      .filter((m) => m.role === "user")
      .map((m) =>
        m.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim(),
      )
      .filter(Boolean);
    return {
      provider,
      id,
      ref: bp.ref,
      stats: bp.stats,
      internals: bp.internals,
      tools: bp.tools ?? [],
      files: bp.files ?? [],
      userPrompts,
    };
  } catch {
    return undefined;
  }
}

onMounted(async () => {
  const ra = parseRef(route.query.a);
  const rb = parseRef(route.query.b);
  if (ra && rb) {
    [a.value, b.value] = await Promise.all([
      loadSide(ra.provider, ra.id),
      loadSide(rb.provider, rb.id),
    ]);
  }
  loading.value = false;
});

function fmtDur(ms?: number): string {
  if (!ms) return "—";
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface MetricRow {
  label: string;
  a: string;
  b: string;
  differs: boolean;
  /** which side has the LARGER raw value (0|1) — highlighted as the outlier */
  hotter?: 0 | 1;
}

function num(label: string, va?: number, vb?: number, fmt: (n?: number) => string = fmtTokens): MetricRow {
  const differs = (va ?? 0) !== (vb ?? 0);
  return {
    label,
    a: fmt(va),
    b: fmt(vb),
    differs,
    hotter: differs ? ((va ?? 0) > (vb ?? 0) ? 0 : 1) : undefined,
  };
}

function tokMetric(
  label: string,
  ra: SessionRef | undefined,
  rb: SessionRef | undefined,
  key: "tokensIn" | "tokensOut" | "tokensReasoning" | "tokensCacheRead" | "tokensCacheWrite",
): MetricRow {
  const va = ra?.[key];
  const vb = rb?.[key];
  const differs = (va ?? 0) !== (vb ?? 0);
  return {
    label,
    a: fmtTokens(va, { estimate: isTokenEstimate(ra?.meta) }),
    b: fmtTokens(vb, { estimate: isTokenEstimate(rb?.meta) }),
    differs,
    hotter: differs ? ((va ?? 0) > (vb ?? 0) ? 0 : 1) : undefined,
  };
}

const metricRows = computed<MetricRow[]>(() => {
  if (!a.value || !b.value) return [];
  const ra = a.value.ref;
  const rb = b.value.ref;
  const rows: MetricRow[] = [
    num("messages", ra?.messageCount, rb?.messageCount, (n) => String(n ?? "—")),
    num("user turns", a.value.stats?.userTurns, b.value.stats?.userTurns, (n) => String(n ?? "—")),
    tokMetric("tokens in", ra, rb, "tokensIn"),
    tokMetric("tokens out", ra, rb, "tokensOut"),
    tokMetric("reasoning", ra, rb, "tokensReasoning"),
    tokMetric("cache read", ra, rb, "tokensCacheRead"),
    tokMetric("cache write", ra, rb, "tokensCacheWrite"),
    {
      label: "peak context",
      a: fmtTokens(a.value.internals?.peakContext, {
        estimate: a.value.internals?.contextEstimated,
      }),
      b: fmtTokens(b.value.internals?.peakContext, {
        estimate: b.value.internals?.contextEstimated,
      }),
      differs:
        (a.value.internals?.peakContext ?? 0) !== (b.value.internals?.peakContext ?? 0),
      hotter:
        (a.value.internals?.peakContext ?? 0) !== (b.value.internals?.peakContext ?? 0)
          ? (a.value.internals?.peakContext ?? 0) > (b.value.internals?.peakContext ?? 0)
            ? 0
            : 1
          : undefined,
    },
    {
      label: "last context",
      a: fmtTokens(a.value.internals?.lastContext, {
        estimate: a.value.internals?.contextEstimated,
      }),
      b: fmtTokens(b.value.internals?.lastContext, {
        estimate: b.value.internals?.contextEstimated,
      }),
      differs:
        (a.value.internals?.lastContext ?? 0) !== (b.value.internals?.lastContext ?? 0),
      hotter:
        (a.value.internals?.lastContext ?? 0) !== (b.value.internals?.lastContext ?? 0)
          ? (a.value.internals?.lastContext ?? 0) > (b.value.internals?.lastContext ?? 0)
            ? 0
            : 1
          : undefined,
    },
    num("compactions", a.value.internals?.compactions, b.value.internals?.compactions, (n) => String(n ?? 0)),
    num("tool errors", a.value.internals?.toolErrors, b.value.internals?.toolErrors, (n) => String(n ?? 0)),
    num("duration", a.value.internals?.durationMs, b.value.internals?.durationMs, fmtDur),
    num("tracked costs", ra?.cost, rb?.cost, (n) => (n === undefined ? "—" : `$${n.toFixed(4)}`)),
    num("actual spend", ra?.actualCost, rb?.actualCost, (n) => (n === undefined ? "—" : `$${n.toFixed(4)}`)),
  ];
  const sa = typeof ra?.meta?.tokenSource === "string" ? ra.meta.tokenSource : undefined;
  const sb = typeof rb?.meta?.tokenSource === "string" ? rb.meta.tokenSource : undefined;
  if (sa || sb) {
    rows.splice(4, 0, {
      label: "token source",
      a: sa ?? "—",
      b: sb ?? "—",
      differs: (sa ?? "") !== (sb ?? ""),
    });
  }
  return rows;
});

const toolRows = computed(() => {
  if (!a.value || !b.value) return [];
  const map = new Map<string, { name: string; a: number; b: number }>();
  for (const t of a.value.tools) map.set(t.name, { name: t.name, a: t.count, b: 0 });
  for (const t of b.value.tools) {
    const row = map.get(t.name) ?? { name: t.name, a: 0, b: 0 };
    row.b = t.count;
    map.set(t.name, row);
  }
  return [...map.values()].sort((x, y) => y.a + y.b - (x.a + x.b));
});

const fileRows = computed(() => {
  if (!a.value || !b.value) return [];
  const inA = new Set(a.value.files.map((f) => f.path));
  const inB = new Set(b.value.files.map((f) => f.path));
  const all = [...new Set([...inA, ...inB])].sort();
  return all.map((path) => ({
    path,
    side: inA.has(path) && inB.has(path) ? "both" : inA.has(path) ? "a" : "b",
  }));
});

const divergence = computed(() => {
  if (!a.value || !b.value) return undefined;
  const pa = a.value.userPrompts;
  const pb = b.value.userPrompts;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    if ((pa[i] ?? "") !== (pb[i] ?? "")) {
      return {
        index: i,
        aText: (pa[i] ?? "").slice(0, 2000),
        bText: (pb[i] ?? "").slice(0, 2000),
        aTotal: pa.length,
        bTotal: pb.length,
      };
    }
  }
  return { index: -1, aText: "", bText: "", aTotal: pa.length, bTotal: pb.length };
});
</script>

<style scoped>
.diff-page {
  display: flex;
  height: 100vh;
  background: var(--canvas-bg);
}
.diff-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.diff-fill {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.diff-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 5;
}
.back {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: var(--fs-lg);
}
.back:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
.diff-title {
  font-size: var(--fs-lg);
  font-weight: 600;
}
.diff-sub {
  margin-top: 2px;
}
.diff-dim {
  padding: 24px 28px;
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.diff-body {
  padding: 18px 24px 40px;
  max-width: 1100px;
}
.diff-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}
.diff-head-card {
  position: relative;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.diff-side-label {
  position: absolute;
  top: 10px;
  right: 12px;
  font-size: var(--fs-xs);
  font-weight: 700;
  color: var(--text-faint);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 1px 7px;
}
.diff-head-title {
  font-size: var(--fs-lg);
  font-weight: 600;
  margin-bottom: 4px;
  padding-right: 34px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-head-meta {
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.diff-head-meta.dim2 {
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-head-actions {
  margin-top: 10px;
  display: flex;
  gap: 6px;
}
.diff-section {
  margin: 22px 0 8px;
}
.diff-table {
  display: grid;
  grid-template-columns: minmax(140px, auto) minmax(0, 1fr) minmax(0, 1fr);
  gap: 5px 18px;
  font-size: var(--fs-xs);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
}
.dt-key {
  color: var(--text-faint);
}
.dt-head {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  padding-bottom: 3px;
}
.dt-val {
  color: var(--text-dim);
}
.dt-val.hot {
  color: var(--text);
  font-weight: 600;
}
.dt-val.zero {
  color: var(--text-faint);
}
.dt-val.diff:not(.zero) {
  color: var(--text);
}
.diff-note {
  grid-column: 1 / -1;
  margin: 4px 0 0;
  color: var(--text-faint);
  font-size: var(--fs-xs);
}
.diff-files {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
}
.file-chip.in-a {
  border-color: rgba(201, 111, 82, 0.5);
}
.file-chip.in-b {
  border-color: rgba(38, 179, 162, 0.5);
}
.diff-diverge {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 16px;
}
.diff-diverge .diff-note {
  margin: 0 0 8px;
}
.diff-prompt {
  margin: 0;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: var(--fs-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-dim);
  max-height: 260px;
  overflow-y: auto;
}
</style>
