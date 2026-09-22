<template>
  <div class="gr-page">
    <DashNav :items="navItems" active="sessions" @select="goDash" />

    <div class="gr-layout">
      <div class="gr-chrome">
        <header class="gr-head">
          <div class="gr-head-copy">
            <div class="gr-title-row">
              <button class="gr-back" title="Back to sessions" @click="goBack">←</button>
              <h1 class="gr-title">{{ data?.ref?.title ?? shortId(sessionId) }}</h1>
            </div>
          </div>
          <div class="gr-controls">
            <button
              class="vsc-btn"
              title="View the interactive message transcript in a floating window"
              @click="fileViewers.openTranscript(provider, sessionId)"
            >
              ≡ transcript
            </button>
            <button
              class="vsc-btn"
              @click="router.push(`/blueprint/${provider}/${sessionId}`)"
            >
              ⌗ blueprint
            </button>
          </div>
        </header>

        <div class="gr-toolbar type-filterbar">
          <span class="micro-label type-filter-label">show</span>
          <button
            v-for="t in visibleLayerToggles"
            :key="t.key"
            type="button"
            class="type-chip"
            :class="{ active: layers[t.key] }"
            :disabled="t.key === 'cache' && !!data?.estimated"
            :title="chipTitle(t)"
            @click="toggleLayer(t.key)"
          >
            {{ t.glyph }} {{ t.label }}
            <em v-if="chipCount(t.key)">{{ chipCount(t.key) }}</em>
          </button>
        </div>
      </div>

      <div class="gr-body">
        <GraphLoadingOverlay :loading="loading" label="Loading growth" />
        <div v-if="!loading && error" class="gr-dim">{{ error }}</div>
        <div v-else-if="!loading && !rawSteps.length" class="gr-dim">
          no context samples for this session
        </div>
        <div v-else-if="!loading && !steps.length" class="gr-dim">
          no user prompts in this session
        </div>
        <div
          v-else-if="!loading && steps.length"
          class="gr-fill"
          :style="{ '--gr-prov': provColor }"
        >
          <div class="gr-chart-wrap">
            <div class="micro-label gr-section">
              context growth
              <span v-if="chartCaption" class="gr-section-hint">{{ chartCaption }}</span>
              <span
                v-if="data?.estimated"
                class="gr-est"
                title="Estimated from transcript size (chars÷4) — provider did not record per-turn usage"
                >~est</span
              >
            </div>
            <div class="gr-plot">
              <div class="gr-axis-y mono" aria-hidden="true">
                <span class="gr-axis-letter">Y</span>
                <span class="gr-axis-name">context tokens</span>
              </div>
              <div
                ref="chartHost"
                class="gr-chart"
                :class="{ panning: isPanning }"
                :style="{ '--gr-prov': provColor }"
                @wheel.prevent="onWheel"
                @pointerdown="onPanStart"
                @pointermove="onPanMove"
                @pointerup="onPanEnd"
                @pointercancel="onPanEnd"
                @dblclick="() => resetView()"
                @contextmenu.prevent="openChartCtx($event)"
                @mouseleave="onChartLeave"
              >
              <svg
                class="gr-svg"
                :viewBox="`0 0 ${chartW} ${chartH}`"
                preserveAspectRatio="none"
                role="img"
                aria-label="context tokens over the session"
              >
                <defs>
                  <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" :stop-color="provHex" stop-opacity="0.28" />
                    <stop offset="100%" :stop-color="provHex" stop-opacity="0.02" />
                  </linearGradient>
                  <clipPath :id="clipId">
                    <rect
                      :x="pad.l"
                      :y="pad.t"
                      :width="chartW - pad.l - pad.r"
                      :height="innerH"
                    />
                  </clipPath>
                </defs>
                <g :clip-path="`url(#${clipId})`">
                  <line
                    v-for="(y, i) in gridYs"
                    :key="'g' + i"
                    :x1="pad.l"
                    :x2="chartW - pad.r"
                    :y1="y"
                    :y2="y"
                    class="gr-grid"
                  />
                  <line
                    v-for="(m, i) in pctMarks"
                    :key="'pct' + i"
                    :x1="pad.l"
                    :x2="chartW - pad.r"
                    :y1="m.y"
                    :y2="m.y"
                    class="gr-pct-line"
                    :stroke="provHex"
                  />
                  <line
                    v-if="windowY != null"
                    :x1="pad.l"
                    :x2="chartW - pad.r"
                    :y1="windowY"
                    :y2="windowY"
                    class="gr-window-line"
                    :stroke="provHex"
                  />
                  <line
                    v-if="peakY != null"
                    :x1="pad.l"
                    :x2="chartW - pad.r"
                    :y1="peakY"
                    :y2="peakY"
                    class="gr-peak-line"
                    :stroke="provHex"
                  />
                  <line
                    v-for="(x, i) in compactXs"
                    :key="'c' + i"
                    :x1="x"
                    :x2="x"
                    :y1="pad.t"
                    :y2="pad.t + innerH"
                    class="gr-compact-tick"
                  />
                  <path
                    v-if="areaPath"
                    :d="areaPath"
                    class="gr-area"
                    :fill="`url(#${gradId})`"
                  />
                  <path
                    v-if="cachePath"
                    :d="cachePath"
                    class="gr-cache-line"
                  />
                  <path v-if="linePath" :d="linePath" class="gr-line" :stroke="provHex" />
                </g>
              </svg>

              <span
                v-for="m in pctMarks"
                :key="'pl' + m.pct"
                class="gr-pct-label mono"
                :style="{ top: m.pctY + '%' }"
                >{{ m.pct }}%</span
              >

              <div
                v-for="pt in cachePoints"
                :key="'cache-' + pt.idx"
                class="gr-cache-dot"
                :style="{ left: pt.pctX + '%', top: pt.pctY + '%' }"
              />

              <div
                v-for="pt in compactPoints"
                :key="'cmp-' + pt.idx"
                class="gr-compact-mark mono"
                :style="{ left: pt.pctX + '%', top: pt.pctY + '%' }"
                :title="`context compacted · ${fmtCtx(pt.step.context)} after drop of ${fmtDelta(pt.step.delta)}`"
              >
                ≡
              </div>

              <div
                v-for="pt in reasoningPoints"
                :key="'th-' + pt.idx"
                class="gr-signal-mark gr-signal-reason mono"
                :style="{ left: pt.pctX + '%', top: pt.pctY + '%' }"
                :title="`reasoning · ${pt.step.thinkingBlocks} block${(pt.step.thinkingBlocks ?? 0) === 1 ? '' : 's'}`"
              >
                ◎
              </div>

              <div
                v-for="pt in errorPoints"
                :key="'err-' + pt.idx"
                class="gr-signal-mark gr-signal-err mono"
                :style="{ left: pt.pctX + '%', top: pt.pctY + '%' }"
                :title="`tool errors · ${pt.step.toolErrors}`"
              >
                !
              </div>

              <button
                v-for="pt in points"
                :key="pt.idx"
                type="button"
                class="gr-node"
                :class="{
                  hot: hoverIdx === pt.idx || selectedIdx === pt.idx,
                  compact: pt.step.compacted,
                  user: pt.kind === 'user',
                  agent: pt.kind === 'agent',
                }"
                :style="{
                  left: pt.pctX + '%',
                  top: pt.pctY + '%',
                  '--node': pt.kind === 'user' ? 'var(--accent)' : provColor,
                }"
                @pointerdown.stop
                @mouseenter="onNodeEnter(pt.idx, $event)"
                @mousemove="onNodeMove($event)"
                @mouseleave="onNodeLeave(pt.idx)"
                @click.stop="onNodeClick(pt.idx)"
                @contextmenu.prevent.stop="openPointCtx($event, pt.idx)"
              />

              <div
                v-if="tagStep && tagStyle"
                class="gr-tag mono"
                :style="{
                  ...tagStyle,
                  borderColor: provSoft,
                  '--tag': provColor,
                }"
              >
                <span class="gr-tag-idx">#{{ (tagIdx ?? 0) + 1 }}</span>
                <span class="gr-tag-role" :class="tagKind">{{ tagKind }}</span>
                <span class="gr-tag-delta" :class="deltaClass(tagStep.delta)">{{
                  fmtDelta(tagStep.delta)
                }}</span>
                <span class="gr-tag-abs">{{ fmtCtx(tagStep.context) }}</span>
                <span v-if="tagStep.ts" class="gr-tag-time">{{ fmtTime(tagStep.ts) }}</span>
                <div v-if="tagUsageInfo" class="gr-tag-usage">
                  <template v-if="tagUsageInfo.cache != null">
                    <span class="gr-tag-usage-k">cache</span>
                    <span class="gr-tag-usage-v gr-tag-cache">{{
                      fmtTokens(tagUsageInfo.cache)
                    }}</span>
                  </template>
                  <template v-if="tagUsageInfo.input != null">
                    <span class="gr-tag-usage-k">input</span>
                    <span class="gr-tag-usage-v">{{ fmtTokens(tagUsageInfo.input) }}</span>
                  </template>
                  <template v-if="tagUsageInfo.hit != null">
                    <span class="gr-tag-usage-k">hit</span>
                    <span class="gr-tag-usage-v">{{ tagUsageInfo.hit }}%</span>
                  </template>
                </div>
                <div v-if="tagSignals(tagStep)" class="gr-tag-signals">
                  <span v-if="tagStep.thinkingBlocks" class="gr-tag-sig"
                    >◎ {{ tagStep.thinkingBlocks }}</span
                  >
                  <span v-if="tagStep.toolErrors" class="gr-tag-sig gr-tag-sig-err"
                    >! {{ tagStep.toolErrors }}</span
                  >
                  <span v-if="tagStep.compacted" class="gr-tag-sig">≡ compact</span>
                </div>
                <span class="gr-tag-prompt" :title="tagStep.promptPreview">{{
                  tagStep.promptPreview
                }}</span>
              </div>

              <div class="gr-controls-stack" @pointerdown.stop @dblclick.stop @contextmenu.prevent.stop>
                <button
                  type="button"
                  class="gr-ctrl-btn"
                  title="Zoom in"
                  :disabled="!canZoomIn"
                  @click="zoomBy(1 / 1.85)"
                >
                  +
                </button>
                <button
                  type="button"
                  class="gr-ctrl-btn"
                  title="Zoom out"
                  :disabled="!canZoomOut"
                  @click="zoomBy(1.85)"
                >
                  −
                </button>
                <button
                  type="button"
                  class="gr-ctrl-btn"
                  :class="{ on: yFit }"
                  title="Fit Y to the visible line range"
                  @click="fitToScreen()"
                >
                  ⛶
                </button>
                <button
                  type="button"
                  class="gr-ctrl-btn"
                  title="Reset zoom + Y fit"
                  :disabled="!zoomed && !yFit"
                  @click="() => resetView()"
                >
                  ⟲
                </button>
              </div>
            </div>
            </div>
            <div class="gr-axis mono">
              <span class="gr-axis-lo">{{ fmtCtx(yScale.floor) }}</span>
              <ul class="gr-axis-legend">
                <li>
                  <i class="gr-leg-swatch gr-leg-user" aria-hidden="true" />
                  user
                </li>
                <li>
                  <i
                    class="gr-leg-swatch gr-leg-agent"
                    aria-hidden="true"
                    :style="{ background: provColor }"
                  />
                  agent
                </li>
                <li v-if="layers.cache && !data?.estimated">
                  <i class="gr-leg-swatch gr-leg-cache" aria-hidden="true" />
                  cache
                </li>
              </ul>
              <span class="gr-axis-x"
                ><span class="gr-axis-letter">X</span>
                {{ layers.prompts ? "prompts" : "turns" }} →</span
              >
              <span class="gr-axis-hi"
                >{{ fmtCtx(peak)
                }}<span class="gr-axis-win"> / {{ fmtTok(ctxWindow) }}</span></span
              >
            </div>
          </div>

          <aside class="gr-side">
            <div class="micro-label gr-section">metrics</div>
            <div class="meta-kv mono gr-metrics">
              <template v-for="[k, v] in metricRows" :key="k">
                <span class="kv-key">{{ k }}</span><span>{{ v }}</span>
              </template>
            </div>

            <div class="micro-label gr-section">
              top growth
              <span class="gr-section-hint mono"
                >Δ vs previous {{ layers.prompts ? "prompt" : "turn"
                }}{{ data?.estimated ? " · ~est" : "" }}</span
              >
            </div>
            <div v-if="!topContributors.length" class="gr-dim-sm">no positive growth steps</div>
            <button
              v-for="c in topContributors"
              :key="c.idx"
              class="gr-contrib"
              :class="{ picked: selectedIdx === c.idx }"
              :style="selectedIdx === c.idx ? { borderColor: provSoft } : undefined"
              :title="c.step.promptPreview"
              @click="focusStep(c.idx)"
              @dblclick="openStepTranscript(c.idx)"
              @contextmenu.prevent.stop="openPointCtx($event, c.idx)"
            >
              <span class="gr-contrib-delta mono" :class="deltaClass(c.step.delta)">
                {{ fmtDelta(c.step.delta) }}
              </span>
              <span class="gr-contrib-prompt">{{ c.step.promptPreview }}</span>
              <span class="gr-contrib-abs mono">{{ fmtCtx(c.step.context) }}</span>
            </button>

            <div v-if="selectedStep" class="gr-detail">
              <div class="micro-label gr-section">selected · #{{ selectedIdx! + 1 }}</div>
              <div class="meta-kv mono">
                <span class="kv-key">Δ</span
                ><span :class="deltaClass(selectedStep.delta)">{{
                  fmtDelta(selectedStep.delta)
                }}</span>
                <span class="kv-key">context</span
                ><span>{{ fmtCtx(selectedStep.context) }}</span>
                <template v-if="selectedStep.cacheRead != null">
                  <span class="kv-key">cache</span
                  ><span>{{ fmtTokens(selectedStep.cacheRead) }}</span>
                </template>
                <template v-if="selectedStep.input != null">
                  <span class="kv-key">input</span
                  ><span>{{ fmtTokens(selectedStep.input) }}</span>
                </template>
                <template v-if="cacheHitPct(selectedStep) != null">
                  <span class="kv-key">cache hit</span
                  ><span>{{ cacheHitPct(selectedStep) }}%</span>
                </template>
                <span class="kv-key">time</span
                ><span>{{ selectedStep.ts ? fmtTime(selectedStep.ts) : "—" }}</span>
              </div>
              <pre class="gr-prompt mono">{{ selectedStep.promptPreview }}</pre>
              <button class="vsc-btn" @click="openStepTranscript(selectedIdx!)">
                ≡ open in transcript
              </button>
            </div>
          </aside>
        </div>
      </div>
      <StatusBar />
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="chartCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: chartCtx.x + 'px', top: chartCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button type="button" class="menu-item" @click="menuAction(() => fitToScreen(true))">
        <span class="menu-glyph">⛶</span> Fit to screen
      </button>
      <button
        type="button"
        class="menu-item"
        :disabled="!canZoomIn"
        @click="menuAction(() => zoomBy(1 / 1.85))"
      >
        <span class="menu-glyph">+</span> Zoom in
      </button>
      <button
        type="button"
        class="menu-item"
        :disabled="!canZoomOut"
        @click="menuAction(() => zoomBy(1.85))"
      >
        <span class="menu-glyph">−</span> Zoom out
      </button>
      <button
        type="button"
        class="menu-item"
        :disabled="!zoomed && !yFit"
        @click="menuAction(() => resetView())"
      >
        <span class="menu-glyph">⟲</span> Reset view
      </button>
      <div class="menu-sep" />
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => fileViewers.openTranscript(provider, sessionId))"
      >
        <span class="menu-glyph">≡</span> Transcript
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => router.push(`/blueprint/${provider}/${sessionId}`))"
      >
        <span class="menu-glyph">⌗</span> Blueprint
      </button>
    </div>

    <div
      v-if="pointCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: pointCtx.x + 'px', top: pointCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => openStepTranscript(pointCtx!.idx))"
      >
        <span class="menu-glyph">≡</span> Open in transcript
      </button>
      <button type="button" class="menu-item" @click="menuAction(() => selectStep(pointCtx!.idx))">
        <span class="menu-glyph">↗</span> Select
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => fitAroundPoint(pointCtx!.idx))"
      >
        <span class="menu-glyph">⛶</span> Fit around point
      </button>
      <div class="menu-sep" />
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => copyPointPrompt(pointCtx!.idx))"
      >
        <span class="menu-glyph">❐</span> Copy prompt
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { SessionRef } from "@threadle/shared";
import DashNav from "@/panels/DashNav.vue";
import StatusBar from "@/panels/StatusBar.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import { useNavItems } from "@/panels/useNavItems";
import { shortId, fmtTokens, isTokenEstimate } from "@/lib/format";
import { estimateContextWindow } from "@/lib/contextWindow";
import { providerColor, providerColorHex } from "@/lib/providers";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useSettingsStore } from "@/stores/settings";
import "@/views/dashboard/chrome.css";

function fmtDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const hm = m % 60;
  return hm ? `${h}h ${hm}m` : `${h}h`;
}

interface GrowthStep {
  context: number;
  delta: number;
  ts?: number;
  assistantMessageId: string;
  promptMessageId?: string;
  promptPreview: string;
  compacted: boolean;
  input?: number;
  cacheRead?: number;
  thinkingBlocks?: number;
  thinkingChars?: number;
  toolErrors?: number;
}

interface GrowthData {
  ref: SessionRef;
  steps: GrowthStep[];
  estimated: boolean;
  peakContext: number;
  lastContext: number;
  truncated?: boolean;
  metrics?: {
    messages: number;
    userTurns: number;
    assistantTurns: number;
    thinkingBlocks: number;
    thinkingChars: number;
    toolErrors: number;
    compactions: number;
    durationMs?: number;
  };
}

interface ChartPoint {
  idx: number;
  x: number;
  y: number;
  pctX: number;
  pctY: number;
  step: GrowthStep;
  /** User prompt landmark vs agent context sample. */
  kind: "user" | "agent";
}

type LayerKey = "prompts" | "cache" | "pct" | "reasoning" | "errors";

const LAYER_TOGGLES: Array<{ key: LayerKey; glyph: string; label: string; title: string }> = [
  { key: "prompts", glyph: "❝", label: "prompts", title: "One point per user prompt" },
  { key: "cache", glyph: "▤", label: "cache", title: "Cache-read tokens (usage providers)" },
  { key: "pct", glyph: "%", label: "marks", title: "50% / 80% / 90% of window" },
  {
    key: "reasoning",
    glyph: "◎",
    label: "reasoning",
    title: "Mark turns that include thinking / reasoning blocks",
  },
  {
    key: "errors",
    glyph: "!",
    label: "errors",
    title: "Mark turns with tool errors",
  },
];

const route = useRoute();
const router = useRouter();
const navItems = useNavItems();
const fileViewers = useFileViewersStore();
const settings = useSettingsStore();
void settings.load();

const provider = computed(() => String(route.params.provider));
const sessionId = computed(() => String(route.params.id));

const loading = ref(true);
const error = ref<string>();
const data = ref<GrowthData>();
const layers = reactive<Record<LayerKey, boolean>>({
  prompts: true,
  cache: false,
  pct: false,
  reasoning: false,
  errors: false,
});
const hoverIdx = ref<number>();
const selectedIdx = ref<number>();
const chartHost = ref<HTMLElement | null>(null);
const tipPos = ref<{ x: number; y: number }>();

const zoom = ref({ a: 0, b: 1 });
/** When true, Y scales tightly to the visible line (min/max in view). */
const yFit = ref(false);
const isPanning = ref(false);
const chartCtx = ref<{ x: number; y: number }>();
const pointCtx = ref<{ x: number; y: number; idx: number }>();
let ctxIgnoreClick = false;
let panStartX = 0;
let panStartA = 0;
let panStartB = 1;

const chartW = 1000;
const chartH = 280;
const pad = { t: 16, r: 16, b: 12, l: 12 };
const innerH = chartH - pad.t - pad.b;
const gradId = computed(
  () => `gr-grad-${provider.value.replace(/[^\w-]/g, "")}-${sessionId.value.slice(0, 8)}`,
);
const clipId = computed(() => `gr-clip-${gradId.value}`);

const provColor = computed(() => providerColor(provider.value));
const provHex = computed(() => providerColorHex(provider.value));
const provSoft = computed(() => `color-mix(in srgb, ${provColor.value} 45%, transparent)`);

const rawSteps = computed(() => data.value?.steps ?? []);

function collapseToPrompts(list: GrowthStep[]): GrowthStep[] {
  const out: GrowthStep[] = [];
  let run: GrowthStep[] = [];
  const flush = () => {
    if (!run.length) return;
    const last = { ...run[run.length - 1]! };
    let thinkingBlocks = 0;
    let thinkingChars = 0;
    let toolErrors = 0;
    for (const s of run) {
      thinkingBlocks += s.thinkingBlocks ?? 0;
      thinkingChars += s.thinkingChars ?? 0;
      toolErrors += s.toolErrors ?? 0;
    }
    if (thinkingBlocks) last.thinkingBlocks = thinkingBlocks;
    else delete last.thinkingBlocks;
    if (thinkingChars) last.thinkingChars = thinkingChars;
    else delete last.thinkingChars;
    if (toolErrors) last.toolErrors = toolErrors;
    else delete last.toolErrors;
    out.push(last);
    run = [];
  };
  for (const s of list) {
    const key = s.promptMessageId ?? s.assistantMessageId;
    const prevKey = run.length
      ? (run[0]!.promptMessageId ?? run[0]!.assistantMessageId)
      : undefined;
    if (run.length && key !== prevKey) flush();
    run.push(s);
  }
  flush();
  return out.map((s, i) => {
    const prev = i > 0 ? out[i - 1]!.context : 0;
    const delta = i === 0 ? s.context : s.context - prev;
    const compacted = i > 0 && prev > 20_000 && s.context < prev * 0.55;
    return { ...s, delta, compacted };
  });
}

const steps = computed(() => {
  const all = rawSteps.value;
  if (!layers.prompts) return all;
  return collapseToPrompts(all);
});

const peak = computed(() => {
  const fromSteps = steps.value.reduce((a, s) => Math.max(a, s.context), 0);
  return Math.max(fromSteps, 1);
});

const ctxWindow = computed(() =>
  estimateContextWindow(data.value?.ref?.model, peak.value),
);

const zoomed = computed(() => zoom.value.a > 0.001 || zoom.value.b < 0.999);

const win = computed(() => {
  const n = steps.value.length;
  if (n <= 1) return { lo: 0, hi: Math.max(0, n - 1) };
  const lo = Math.max(0, Math.floor(zoom.value.a * (n - 1)));
  const hi = Math.min(n - 1, Math.max(lo + 1, Math.ceil(zoom.value.b * (n - 1))));
  return { lo, hi };
});

const chartCaption = computed(() => {
  if (!steps.value.length) return "";
  const unit = layers.prompts ? "prompts" : "turns";
  const parts = [`${steps.value.length} ${unit}`];
  if (zoomed.value) parts.push(`${win.value.lo + 1}–${win.value.hi + 1}`);
  if (yFit.value) parts.push("fit");
  const peakLabel = fmtTokens(peak.value, { estimate: data.value?.estimated });
  const now = data.value?.lastContext ?? peak.value;
  if (Math.abs(now - peak.value) / Math.max(peak.value, 1) > 0.05) {
    parts.push(
      `${fmtTokens(now, { estimate: data.value?.estimated })} now · ${peakLabel} peak`,
    );
  } else {
    parts.push(`${peakLabel} peak`);
  }
  if (data.value?.truncated) parts.push("truncated");
  return parts.join(" · ");
});

const yScale = computed(() => {
  const { lo, hi } = win.value;
  let dataMax = 1;
  let dataMin = Number.POSITIVE_INFINITY;
  for (let i = lo; i <= hi; i++) {
    const step = steps.value[i];
    if (!step) continue;
    if (step.context > dataMax) dataMax = step.context;
    if (step.context < dataMin) dataMin = step.context;
    if (layers.cache && (step.cacheRead ?? 0) > dataMax) dataMax = step.cacheRead!;
    if (layers.cache && step.cacheRead != null && step.cacheRead < dataMin) {
      dataMin = step.cacheRead;
    }
  }
  if (!Number.isFinite(dataMin)) dataMin = 0;

  if (yFit.value) {
    const span = Math.max(dataMax - dataMin, 1);
    const pad = Math.max(span * 0.08, dataMax * 0.02, 1);
    return {
      floor: Math.max(0, dataMin - pad),
      peak: dataMax + pad,
    };
  }

  // Modest headroom so the curve isn't glued to the top edge.
  const padded = Math.max(dataMax * 1.08, dataMax + 1);
  const winTok = ctxWindow.value;
  let peak = padded;
  // % marks need the full window. Otherwise only pull the ceiling up when the
  // series is close enough that the window reads as headroom — not empty sky.
  if (layers.pct || dataMax >= winTok * 0.28) {
    peak = Math.max(padded, winTok);
  } else if (dataMax >= winTok * 0.12) {
    peak = Math.min(winTok, Math.max(padded, dataMax / 0.45));
  }

  let floor = 0;
  if (zoomed.value) {
    floor = Math.max(0, Math.floor(dataMin * 0.92));
  }
  return { floor, peak };
});

function yAt(value: number): number {
  const { floor, peak } = yScale.value;
  const ySpan = Math.max(1, peak - floor);
  return pad.t + innerH - (innerH * (value - floor)) / ySpan;
}

const points = computed((): ChartPoint[] => {
  const n = steps.value.length;
  if (!n) return [];
  const { lo, hi } = win.value;
  const count = hi - lo + 1;
  const avail = chartW - pad.l - pad.r;
  const out: ChartPoint[] = [];
  for (let i = lo; i <= hi; i++) {
    const step = steps.value[i]!;
    const j = i - lo;
    const x = count === 1 ? pad.l + avail / 2 : pad.l + (avail * j) / (count - 1);
    const y = yAt(step.context);
    out.push({
      idx: i,
      x,
      y,
      pctX: (100 * x) / chartW,
      pctY: (100 * y) / chartH,
      step,
      kind: stepKindAt(i),
    });
  }
  return out;
});

function stepKindAt(i: number): "user" | "agent" {
  if (layers.prompts) return "user";
  const step = steps.value[i];
  if (!step) return "user";
  const prev = i > 0 ? steps.value[i - 1] : undefined;
  const promptKey = step.promptMessageId ?? step.assistantMessageId;
  const prevKey = prev
    ? (prev.promptMessageId ?? prev.assistantMessageId)
    : undefined;
  return !prev || promptKey !== prevKey ? "user" : "agent";
}

function focusMessageIdForStep(i: number): string | undefined {
  const step = steps.value[i];
  if (!step) return undefined;
  if (stepKindAt(i) === "agent") {
    return step.assistantMessageId ?? step.promptMessageId;
  }
  return step.promptMessageId ?? step.assistantMessageId;
}

const linePath = computed(() => {
  const pts = points.value;
  if (!pts.length) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
});

const areaPath = computed(() => {
  const pts = points.value;
  if (!pts.length) return "";
  const base = pad.t + innerH;
  const head = linePath.value;
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  return `${head} L${last.x.toFixed(1)},${base} L${first.x.toFixed(1)},${base} Z`;
});

const cachePath = computed(() => {
  if (!layers.cache || data.value?.estimated) return "";
  const pts = points.value.filter((p) => p.step.cacheRead != null);
  if (pts.length < 2) return "";
  // Draw as a step-ish polyline so sparse turns don't invent diagonal cache growth.
  return pts
    .map((p, i) => {
      const y = yAt(p.step.cacheRead ?? 0);
      return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
});

const cachePoints = computed(() => {
  if (!layers.cache || data.value?.estimated) return [] as ChartPoint[];
  return points.value
    .filter((p) => p.step.cacheRead != null)
    .map((p) => {
      const y = yAt(p.step.cacheRead ?? 0);
      return {
        ...p,
        y,
        pctY: (100 * y) / chartH,
      };
    });
});

const gridYs = computed(() => {
  const ys: number[] = [];
  for (let i = 0; i <= 4; i++) ys.push(pad.t + (innerH * i) / 4);
  return ys;
});

const compactPoints = computed(() =>
  points.value.filter((p) => p.step.compacted),
);

const reasoningPoints = computed(() =>
  layers.reasoning ? points.value.filter((p) => (p.step.thinkingBlocks ?? 0) > 0) : [],
);

const errorPoints = computed(() =>
  layers.errors ? points.value.filter((p) => (p.step.toolErrors ?? 0) > 0) : [],
);

const chipCounts = computed(() => {
  const list = steps.value;
  let reasoning = 0;
  let errors = 0;
  for (const s of list) {
    reasoning += s.thinkingBlocks ?? 0;
    errors += s.toolErrors ?? 0;
  }
  return { reasoning, errors, prompts: list.length };
});

const visibleLayerToggles = computed(() =>
  LAYER_TOGGLES.filter((t) => {
    if (t.key === "reasoning") return chipCounts.value.reasoning > 0;
    if (t.key === "errors") return chipCounts.value.errors > 0;
    return true;
  }),
);

const compactXs = computed(() => compactPoints.value.map((p) => p.x));

const windowY = computed(() => {
  const y = yAt(ctxWindow.value);
  if (y < pad.t - 2 || y > pad.t + innerH + 2) return undefined;
  return y;
});

const peakY = computed(() => yAt(peak.value));

const pctMarks = computed(() => {
  if (!layers.pct) return [] as Array<{ pct: number; y: number; pctY: number }>;
  return [50, 80, 90]
    .map((pct) => {
      const v = (ctxWindow.value * pct) / 100;
      const y = yAt(v);
      return { pct, y, pctY: (100 * y) / chartH };
    })
    .filter((m) => m.y >= pad.t - 1 && m.y <= pad.t + innerH + 1);
});

const topContributors = computed(() => {
  return steps.value
    .map((step, idx) => ({ step, idx }))
    .filter((c) => c.idx > 0 && c.step.delta > 0)
    .sort((a, b) => b.step.delta - a.step.delta)
    .slice(0, 12);
});

const metricRows = computed((): Array<[string, string]> => {
  const m = data.value?.metrics;
  const ref = data.value?.ref;
  const est = data.value?.estimated === true;
  const rows: Array<[string, string]> = [
    ["peak", fmtTokens(peak.value, { estimate: est })],
    ["window", fmtTokens(ctxWindow.value)],
    [
      "used",
      `${Math.min(999, Math.round((100 * (data.value?.lastContext ?? 0)) / ctxWindow.value))}%`,
    ],
  ];
  if (m) {
    rows.push(
      ["messages", String(m.messages)],
      ["user turns", String(m.userTurns)],
      ["assistant", String(m.assistantTurns)],
      ["compactions", String(m.compactions)],
      [
        "reasoning",
        m.thinkingBlocks
          ? `${m.thinkingBlocks} · ${fmtTokens(Math.round(m.thinkingChars / 4))} tok est`
          : "—",
      ],
      ["tool errors", String(m.toolErrors)],
      ["duration", fmtDuration(m.durationMs)],
    );
  }
  if (ref) {
    rows.push(
      ["tokens in", fmtTokens(ref.tokensIn, { estimate: est || isTokenEstimate(ref.meta) })],
      ["tokens out", fmtTokens(ref.tokensOut, { estimate: est || isTokenEstimate(ref.meta) })],
      [
        "reasoning tok",
        ref.tokensReasoning != null ? fmtTokens(ref.tokensReasoning, { estimate: est }) : "—",
      ],
      [
        "cache read",
        ref.tokensCacheRead != null ? fmtTokens(ref.tokensCacheRead, { estimate: est }) : "—",
      ],
      ["tracked costs", ref.cost !== undefined ? `$${ref.cost.toFixed(4)}` : "—"],
      [
        "actual spend",
        ref.actualCost === undefined
          ? "—"
          : ref.actualCost === 0 && (ref.cost ?? 0) > 0
            ? "$0 (subscription)"
            : `$${ref.actualCost.toFixed(4)}`,
      ],
    );
  }
  return rows;
});

/** Hover-only tag; selection still highlights the node + side panel. */
const tagIdx = computed(() => hoverIdx.value);
const tagStep = computed(() =>
  tagIdx.value != null ? steps.value[tagIdx.value] : undefined,
);
const tagKind = computed(
  () => points.value.find((p) => p.idx === tagIdx.value)?.kind ?? "user",
);
const tagUsageInfo = computed(() =>
  tagStep.value ? tagUsage(tagStep.value) : undefined,
);
const selectedStep = computed(() =>
  selectedIdx.value != null ? steps.value[selectedIdx.value] : undefined,
);

const tagStyle = computed(() => {
  if (!tipPos.value || tagIdx.value == null) return undefined;
  const host = chartHost.value;
  const maxW = host ? host.clientWidth - 16 : 320;
  const left = Math.min(Math.max(8, tipPos.value.x), maxW - 220);
  const top = Math.max(8, tipPos.value.y - 12);
  return { left: `${left}px`, top: `${top}px` };
});

function chipTitle(t: (typeof LAYER_TOGGLES)[number]): string {
  if (t.key === "cache" && data.value?.estimated) {
    return "Cache line needs per-turn usage (not available for this provider)";
  }
  return t.title;
}

function chipCount(key: LayerKey): number | undefined {
  if (key === "reasoning") {
    const n = chipCounts.value.reasoning;
    return n > 0 ? n : undefined;
  }
  if (key === "errors") {
    const n = chipCounts.value.errors;
    return n > 0 ? n : undefined;
  }
  return undefined;
}

function cacheHitPct(step: GrowthStep): number | undefined {
  if (step.cacheRead == null || step.context <= 0) return undefined;
  return Math.min(100, Math.round((100 * step.cacheRead) / step.context));
}

function tagUsage(step: GrowthStep): { cache?: number; input?: number; hit?: number } | undefined {
  if (step.cacheRead == null && step.input == null) return undefined;
  return {
    ...(step.cacheRead != null ? { cache: step.cacheRead } : {}),
    ...(step.input != null ? { input: step.input } : {}),
    ...(cacheHitPct(step) != null ? { hit: cacheHitPct(step)! } : {}),
  };
}

function tagSignals(step: GrowthStep): boolean {
  return !!(step.thinkingBlocks || step.toolErrors || step.compacted);
}

function toggleLayer(key: LayerKey): void {
  if (key === "cache" && data.value?.estimated) return;
  layers[key] = !layers[key];
  if (key === "prompts") {
    selectedIdx.value = undefined;
    hoverIdx.value = undefined;
    tipPos.value = undefined;
    resetView();
  }
}

watch(
  () => [chipCounts.value.reasoning, chipCounts.value.errors] as const,
  ([reasoning, errors], prev) => {
    const [prevReasoning = 0, prevErrors = 0] = prev ?? [];
    if (reasoning === 0) layers.reasoning = false;
    else if (prevReasoning === 0) layers.reasoning = true;
    if (errors === 0) layers.errors = false;
    else if (prevErrors === 0) layers.errors = true;
  },
);

watch(
  () => steps.value.length,
  () => resetView(),
);

let zoomTarget = { a: 0, b: 1 };
let zoomRaf = 0;

function minZoomSpan(): number {
  const n = steps.value.length;
  if (n <= 1) return 1;
  return Math.min(1, Math.max(4 / Math.max(n - 1, 1), 0.015));
}

function clampZoom(a: number, b: number): { a: number; b: number } {
  const minSpan = minZoomSpan();
  const span = Math.min(1, Math.max(minSpan, b - a));
  let na = a;
  let nb = a + span;
  if (nb > 1) {
    nb = 1;
    na = 1 - span;
  }
  if (na < 0) {
    na = 0;
    nb = span;
  }
  return { a: na, b: nb };
}

function setZoom(a: number, b: number, animate = false): void {
  zoomTarget = clampZoom(a, b);
  if (zoomRaf) {
    cancelAnimationFrame(zoomRaf);
    zoomRaf = 0;
  }
  zoom.value = { ...zoomTarget };
  void animate;
}

const canZoomIn = computed(() => zoom.value.b - zoom.value.a > minZoomSpan() + 0.001);
const canZoomOut = computed(() => zoom.value.a > 0.001 || zoom.value.b < 0.999);

function resetZoom(_animate = false): void {
  setZoom(0, 1, false);
}

function resetView(): void {
  resetZoom();
  yFit.value = false;
}

/** Scale Y tightly to the min/max of the line currently in view. */
function fitToScreen(forceOn = false): void {
  yFit.value = forceOn ? true : !yFit.value;
}

/** Zoom X around a point and fit Y to that neighborhood. */
function fitAroundPoint(idx: number): void {
  const n = steps.value.length;
  if (n <= 1) {
    yFit.value = true;
    selectStep(idx);
    return;
  }
  const span = Math.min(Math.max(12, Math.floor(n * 0.12)), n - 1);
  const half = Math.floor(span / 2);
  let lo = Math.max(0, idx - half);
  let hi = Math.min(n - 1, lo + span);
  lo = Math.max(0, hi - span);
  setZoom(lo / (n - 1), hi / (n - 1), false);
  yFit.value = true;
  selectStep(idx);
}

function zoomAround(factor: number, frac = 0.5): void {
  if (steps.value.length < 3) return;
  const span = zoomTarget.b - zoomTarget.a;
  const center = zoomTarget.a + frac * span;
  const nextSpan = span * factor;
  setZoom(center - nextSpan * frac, center + nextSpan * (1 - frac), false);
}

function zoomBy(factor: number): void {
  zoomAround(factor, 0.5);
}

function onWheel(e: WheelEvent): void {
  const host = chartHost.value;
  if (!host || steps.value.length < 3) return;
  const rect = host.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  if (e.deltaMode === 2) dy *= rect.height;
  zoomAround(Math.exp(dy * 0.0045), frac);
}

function onPanStart(e: PointerEvent): void {
  if (e.button !== 0 || !zoomed.value) return;
  if ((e.target as HTMLElement | null)?.closest?.(".gr-node, .gr-controls-stack")) return;
  zoom.value = { ...zoomTarget };
  isPanning.value = true;
  panStartX = e.clientX;
  panStartA = zoomTarget.a;
  panStartB = zoomTarget.b;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}

function onPanMove(e: PointerEvent): void {
  if (!isPanning.value || !chartHost.value) return;
  const w = chartHost.value.clientWidth || 1;
  const span = panStartB - panStartA;
  const dx = (e.clientX - panStartX) / w;
  setZoom(panStartA - dx * span, panStartB - dx * span, false);
}

function onPanEnd(e: PointerEvent): void {
  if (!isPanning.value) return;
  isPanning.value = false;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  } catch {
    // ignore
  }
}

function ensureVisible(idx: number): void {
  const n = steps.value.length;
  if (n <= 1) return;
  const { lo, hi } = win.value;
  if (idx >= lo && idx <= hi) return;
  const span = Math.max(hi - lo, Math.min(24, n - 1));
  const half = Math.floor(span / 2);
  setZoom((idx - half) / (n - 1), (idx - half + span) / (n - 1), false);
}

function fmtCtx(n: number): string {
  return fmtTokens(n, { estimate: data.value?.estimated === true });
}

function fmtTok(n: number): string {
  return fmtTokens(n);
}

function fmtDelta(d: number): string {
  const sign = d > 0 ? "+" : "";
  return `${sign}${fmtCtx(d)}`;
}

function deltaClass(d: number): string {
  if (d > 0) return "delta-pos";
  if (d < 0) return "delta-neg";
  return "delta-flat";
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function goDash(view: string): void {
  if (view === "lineage") return void router.push("/lineage");
  if (view === "timeline") return void router.push("/timeline");
  if (view === "map") {
    const projectDir = data.value?.ref?.projectDir;
    return void router.push({
      path: "/map",
      query: projectDir ? { dir: projectDir } : undefined,
    });
  }
  void router.push({ path: "/", query: { view } });
}

function goBack(): void {
  const from = route.query.from;
  if (from === "timeline") return void router.push("/timeline");
  if (from === "lineage") return void router.push("/lineage");
  if (from === "map" || from === "atlas") {
    const projectDir = data.value?.ref?.projectDir;
    return void router.push({
      path: "/map",
      query: projectDir ? { dir: projectDir } : undefined,
    });
  }
  goDash("sessions");
}

function placeTip(e: MouseEvent): void {
  const host = chartHost.value;
  if (!host) return;
  const rect = host.getBoundingClientRect();
  tipPos.value = {
    x: e.clientX - rect.left + 14,
    y: e.clientY - rect.top - 10,
  };
}

function onNodeEnter(i: number, e: MouseEvent): void {
  hoverIdx.value = i;
  placeTip(e);
}

function onNodeMove(e: MouseEvent): void {
  placeTip(e);
}

function onNodeLeave(i: number): void {
  if (hoverIdx.value === i) {
    hoverIdx.value = undefined;
    tipPos.value = undefined;
  }
}

function placeCtxMenu(e: MouseEvent): { x: number; y: number } {
  const pad = 8;
  const mw = 220;
  const mh = 220;
  return {
    x: Math.min(e.clientX, window.innerWidth - mw - pad),
    y: Math.min(e.clientY, window.innerHeight - mh - pad),
  };
}

function openChartCtx(e: MouseEvent): void {
  pointCtx.value = undefined;
  ctxIgnoreClick = true;
  chartCtx.value = placeCtxMenu(e);
  requestAnimationFrame(() => {
    ctxIgnoreClick = false;
  });
}

function openPointCtx(e: MouseEvent, idx: number): void {
  chartCtx.value = undefined;
  selectedIdx.value = idx;
  ctxIgnoreClick = true;
  pointCtx.value = { ...placeCtxMenu(e), idx };
  requestAnimationFrame(() => {
    ctxIgnoreClick = false;
  });
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    chartCtx.value = undefined;
    pointCtx.value = undefined;
  }
}

function dismissCtx(e: MouseEvent): void {
  if (ctxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".wf-folder-ctx")) {
    chartCtx.value = undefined;
    pointCtx.value = undefined;
  }
}

async function copyPointPrompt(idx: number): Promise<void> {
  const step = steps.value[idx];
  if (!step?.promptPreview) return;
  try {
    await navigator.clipboard.writeText(step.promptPreview);
  } catch {
    // ignore
  }
}

function onChartLeave(): void {
  hoverIdx.value = undefined;
  tipPos.value = undefined;
  if (isPanning.value) isPanning.value = false;
}

function selectStep(i: number): void {
  selectedIdx.value = i;
}

function focusStep(i: number): void {
  ensureVisible(i);
  requestAnimationFrame(() => selectStep(i));
}

function onNodeClick(i: number): void {
  selectStep(i);
  openStepTranscript(i);
}

function openStepTranscript(i: number): void {
  const step = steps.value[i];
  if (!step) return;
  fileViewers.openTranscript(provider.value, sessionId.value, {
    focusMessageId: focusMessageIdForStep(i),
  });
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = undefined;
  selectedIdx.value = undefined;
  hoverIdx.value = undefined;
  chartCtx.value = undefined;
  pointCtx.value = undefined;
  resetView();
  try {
    const res = await fetch(
      `/api/sessions/${provider.value}/growth/${sessionId.value}`,
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    }
    data.value = (await res.json()) as GrowthData;
    if (data.value.estimated) layers.cache = false;
    // Enable signal chips only when the chart can actually mark them.
    layers.reasoning = chipCounts.value.reasoning > 0;
    layers.errors = chipCounts.value.errors > 0;
  } catch (e) {
    data.value = undefined;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch([provider, sessionId], () => void load(), { immediate: true });

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    if (chartCtx.value || pointCtx.value) {
      chartCtx.value = undefined;
      pointCtx.value = undefined;
      return;
    }
    if (zoomed.value || yFit.value) resetView();
    else selectedIdx.value = undefined;
  }
}
onMounted(() => {
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", dismissCtx);
  document.addEventListener("contextmenu", dismissCtx);
});
onUnmounted(() => {
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("click", dismissCtx);
  document.removeEventListener("contextmenu", dismissCtx);
  if (zoomRaf) {
    cancelAnimationFrame(zoomRaf);
    zoomRaf = 0;
  }
});
</script>

<style>
/* Teleported menus — not scoped. */
.menu-pop .menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
  flex-shrink: 0;
}
</style>

<style scoped>
.gr-page {
  height: 100%;
  min-height: 0;
  display: flex;
}
.gr-layout {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.gr-chrome {
  flex-shrink: 0;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.gr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px 20px;
  margin-bottom: 14px;
}
.gr-head-copy {
  flex: 1 1 22rem;
  min-width: 0;
}
.gr-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.gr-back {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: var(--fs-2xl);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}
.gr-back:hover {
  color: var(--text);
}
.gr-title {
  margin: 0;
  font-size: var(--fs-title);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.gr-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}
.gr-toolbar {
  padding-bottom: 14px;
}
.gr-body {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
.gr-dim {
  padding: 48px 36px;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-sm);
}
.gr-dim-sm {
  padding: 8px 0;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.gr-fill {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 320px);
  gap: 0;
}
.gr-chart-wrap {
  min-width: 0;
  min-height: 0;
  padding: 20px 28px 24px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}
.gr-section {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.gr-section-hint {
  font-size: var(--fs-xs);
  color: var(--text-dim);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  font-family: var(--mono);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gr-est {
  font-size: var(--fs-2xs);
  font-family: var(--mono);
  color: var(--text-faint);
  flex-shrink: 0;
}
.gr-plot {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
}
.gr-axis-y {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 1.1rem;
  color: var(--text-faint);
  user-select: none;
  pointer-events: none;
}
.gr-axis-y .gr-axis-name {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: var(--fs-2xs);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.gr-axis-letter {
  font-size: var(--fs-2xs);
  font-weight: 700;
  color: var(--text-dim);
  letter-spacing: 0.04em;
}
.gr-chart {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 200px;
  background: color-mix(in srgb, var(--gr-prov, var(--text-faint)) 4%, var(--panel-bg));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}
.gr-chart.panning {
  cursor: grabbing;
}
.gr-controls-stack {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  box-shadow: var(--shadow);
}
.gr-ctrl-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  background: var(--panel-bg);
  border: none;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  padding: 0;
  color: var(--text-dim);
  font-size: 15px;
  line-height: 1;
  font-family: var(--mono);
}
.gr-ctrl-btn:last-child {
  border-bottom: none;
}
.gr-ctrl-btn:hover:not(:disabled) {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.gr-ctrl-btn.on {
  background: var(--panel-bg-raised);
  color: var(--text);
  border-color: var(--border-strong);
}
.gr-ctrl-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.gr-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.gr-grid {
  stroke: var(--border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.gr-window-line {
  stroke-width: 1.25;
  stroke-opacity: 0.55;
  vector-effect: non-scaling-stroke;
}
.gr-peak-line {
  stroke-width: 1;
  stroke-dasharray: 5 4;
  stroke-opacity: 0.45;
  vector-effect: non-scaling-stroke;
}
.gr-pct-line {
  stroke-width: 1;
  stroke-dasharray: 2 4;
  stroke-opacity: 0.28;
  vector-effect: non-scaling-stroke;
}
.gr-pct-label {
  position: absolute;
  right: 44px;
  transform: translateY(-50%);
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  pointer-events: none;
  z-index: 1;
}
.gr-compact-tick {
  stroke: var(--status-waiting, var(--text-dim));
  stroke-width: 1.25;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
  opacity: 0.75;
}
.gr-compact-mark {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -120%);
  font-size: var(--fs-2xs);
  color: var(--status-waiting, var(--text-dim));
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
  line-height: 1.2;
  pointer-events: none;
  white-space: nowrap;
}
.gr-metrics {
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.gr-area {
  stroke: none;
}
.gr-line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.gr-cache-line {
  fill: none;
  stroke: var(--gr-cache, var(--context));
  stroke-width: 1.75;
  stroke-opacity: 0.95;
  stroke-dasharray: 2.5 3.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.gr-cache-dot {
  position: absolute;
  z-index: 2;
  width: 7px;
  height: 7px;
  border-radius: 1px;
  transform: translate(-50%, -50%) rotate(45deg);
  background: var(--panel-bg);
  border: 1.5px solid var(--gr-cache, var(--context));
  pointer-events: none;
}
.gr-axis {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px 14px;
  margin-top: 8px;
  margin-left: calc(1.1rem + 8px);
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.gr-axis-lo,
.gr-axis-hi,
.gr-axis-x {
  flex-shrink: 0;
  white-space: nowrap;
}
.gr-axis-x {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-faint);
}
.gr-axis-hi {
  color: var(--text-dim);
  text-align: right;
}
.gr-axis-win {
  color: var(--text-faint);
  font-weight: 400;
}
.gr-axis-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 2px 14px;
  min-width: 0;
  color: var(--text-faint);
}
.gr-axis-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.gr-leg-swatch {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  box-sizing: border-box;
}
.gr-leg-user {
  background: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent);
}
.gr-leg-agent {
  background: var(--gr-prov, var(--text-dim));
}
.gr-leg-cache {
  width: 6px;
  height: 6px;
  border-radius: 1px;
  transform: rotate(45deg);
  background: var(--panel-bg);
  border: 1.5px solid var(--gr-cache, var(--context));
}
.gr-signal-mark {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, 40%);
  font-size: var(--fs-2xs);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
  line-height: 1.2;
  pointer-events: none;
  white-space: nowrap;
}
.gr-signal-reason {
  color: var(--text-dim);
}
.gr-signal-err {
  color: var(--status-error, #c45c5c);
  border-color: color-mix(in srgb, var(--status-error, #c45c5c) 40%, var(--border));
}
.gr-node {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: 0;
  padding: 0;
  border: 2px solid var(--panel-bg);
  border-radius: 50%;
  background: var(--node, var(--text-dim));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--node, var(--text-dim)) 55%, transparent);
  transform: translate(-50%, -50%);
  cursor: pointer;
  z-index: 2;
  transition:
    transform 80ms ease,
    box-shadow 80ms ease;
}
.gr-node:hover,
.gr-node.hot {
  transform: translate(-50%, -50%) scale(1.35);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--node, var(--text-dim)) 28%, transparent);
  z-index: 3;
}
.gr-node.compact {
  outline: 1px dashed var(--text-faint);
  outline-offset: 2px;
}
.gr-tag {
  position: absolute;
  z-index: 6;
  max-width: 280px;
  pointer-events: none;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 8px;
  background: var(--panel-bg);
  border: 1px solid;
  border-left: 3px solid var(--tag, var(--text-dim));
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-strong);
  padding: 7px 10px;
  font-size: var(--fs-xs);
}
.gr-tag-idx {
  color: var(--text-faint);
  flex-shrink: 0;
}
.gr-tag-role {
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.gr-tag-role.user {
  color: var(--accent);
}
.gr-tag-role.agent {
  color: var(--tag, var(--text-dim));
}
.gr-tag-delta {
  flex-shrink: 0;
}
.gr-tag-abs {
  color: var(--text-faint);
  flex-shrink: 0;
}
.gr-tag-time {
  color: var(--text-faint);
  flex-shrink: 0;
  margin-left: auto;
}
.gr-tag-usage {
  flex: 1 1 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  color: var(--text-dim);
  font-size: var(--fs-2xs);
}
.gr-tag-usage-k {
  color: var(--text-faint);
}
.gr-tag-usage-v {
  color: var(--text-dim);
}
.gr-tag-cache {
  color: var(--gr-cache, var(--context));
}
.gr-tag-signals {
  flex: 1 1 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: var(--fs-2xs);
}
.gr-tag-sig {
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 5px;
  line-height: 1.4;
}
.gr-tag-sig-err {
  color: var(--status-error, #c45c5c);
  border-color: color-mix(in srgb, var(--status-error, #c45c5c) 40%, var(--border));
}
.gr-tag-prompt {
  flex: 1 1 100%;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}
.gr-side {
  min-height: 0;
  overflow: auto;
  padding: 20px 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gr-contrib {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: baseline;
  width: 100%;
  text-align: left;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  cursor: pointer;
  color: var(--text);
}
.gr-contrib:hover {
  background: var(--accent-soft);
}
.gr-contrib.picked {
  background: var(--accent-soft);
}
.gr-contrib-delta {
  font-size: var(--fs-xs);
  flex-shrink: 0;
}
.gr-contrib-prompt {
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.gr-contrib-abs {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  flex-shrink: 0;
}
.delta-pos {
  color: var(--gr-prov, var(--context));
}
.delta-neg {
  color: var(--text-faint);
}
.delta-flat {
  color: var(--text-dim);
}
.gr-detail {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gr-prompt {
  margin: 0;
  padding: 8px 10px;
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow: auto;
}
.meta-kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: var(--fs-xs);
}
.kv-key {
  color: var(--text-faint);
}
@media (max-width: 900px) {
  .gr-fill {
    grid-template-columns: 1fr;
  }
  .gr-chart-wrap {
    border-right: none;
    border-bottom: 1px solid var(--border);
    min-height: 280px;
  }
}
</style>
