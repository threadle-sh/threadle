<template>
  <div class="charts-wrap">
    <div class="chart-legend mono">
      <span v-for="id in PROVIDER_IDS" :key="id">
        <i class="leg-dot" :style="{ background: providerColor(id) }" />
        {{ providerShort(id) }}
      </span>
    </div>
    <div class="charts">
      <!-- sessions started per day, stacked by provider -->
      <section class="chart-card">
        <div class="micro-label chart-title">sessions started · last 14 days</div>
        <div class="vbars">
          <div
            v-for="d in perDay"
            :key="d.label"
            class="vbar-col"
            :title="dayTitle(d)"
          >
            <span v-if="d.total" class="vbar-val mono">{{ d.total }}</span>
            <div class="vbar-stack" :style="{ height: `${d.total ? Math.max(6, (100 * d.total) / perDayMax) : 2}%` }">
              <div
                v-for="id in PROVIDER_IDS"
                v-show="d.counts[id]"
                :key="id"
                class="vbar-seg"
                :style="{ flex: d.counts[id] || 0, background: providerColor(id) }"
              />
              <div v-if="!d.total" class="vbar-seg empty" style="flex: 1" />
            </div>
            <span class="vbar-label mono">{{ d.short }}</span>
          </div>
        </div>
      </section>

      <!-- output tokens by project, stacked by provider -->
      <section class="chart-card">
        <div class="micro-label chart-title">output tokens · by project</div>
        <div class="hbars">
          <div
            v-for="r in tokensByProject"
            :key="r.full"
            class="hbar-row"
            :title="splitTitle(r)"
          >
            <span class="hbar-label" :title="r.full">{{ r.label }}</span>
            <div class="hbar-track">
              <div class="hbar-stack" :style="{ width: pct(r.total, tokensByProjectMax) }">
                <div
                  v-for="id in PROVIDER_IDS"
                  v-show="r.counts[id]"
                  :key="id"
                  class="hbar-seg"
                  :style="{ flex: r.counts[id] || 0, background: providerColor(id) }"
                />
              </div>
            </div>
            <span class="hbar-val mono">{{ fmtTokens(r.total) }}</span>
          </div>
          <p v-if="!tokensByProject.length" class="chart-empty">no token data</p>
        </div>
      </section>

      <!-- spend by model, colored by the model's provider -->
      <section class="chart-card">
        <div class="micro-label chart-title">tracked costs · by model</div>
        <div class="hbars">
          <div
            v-for="r in spendByModel"
            :key="`${r.provider}:${r.full}`"
            class="hbar-row"
            :title="`${r.full} (${r.provider}): $${r.value.toFixed(4)}`"
          >
            <span class="hbar-label" :title="r.full">{{ r.label }}</span>
            <div class="hbar-track">
              <div
                class="hbar"
                :style="{
                  width: pct(r.value, spendByModelMax),
                  background: providerColor(r.provider),
                }"
              />
            </div>
            <span class="hbar-val mono">${{ r.value.toFixed(2) }}</span>
          </div>
          <p v-if="!spendByModel.length" class="chart-empty">
            no dollar costs tracked (Cursor/Claude subscription sessions report tokens without list price)
          </p>
        </div>
      </section>

      <!-- cache hit by provider -->
      <section class="chart-card">
        <div class="micro-label chart-title">cache hit rate · by provider</div>
        <div class="hbars">
          <div
            v-for="r in cacheByProvider"
            :key="r.label"
            class="hbar-row"
            :title="`${r.label}: ${r.value.toFixed(1)}% of input tokens served from cache`"
          >
            <span class="hbar-label">{{ r.label }}</span>
            <div class="hbar-track">
              <div
                class="hbar"
                :style="{
                  width: `${Math.max(2, r.value)}%`,
                  background: providerColor(r.provider),
                }"
              />
            </div>
            <span class="hbar-val mono">{{ r.value.toFixed(1) }}%</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ProviderId, SessionRef } from "@threadle/shared";
import { PROVIDER_IDS, providerColor, providerShort } from "@/lib/providers";
import { fmtTokens } from "@/lib/format";

const props = defineProps<{ sessions: SessionRef[] }>();

type Counts = Record<ProviderId, number>;

function emptyCounts(): Counts {
  return { "claude-code": 0, opencode: 0, cursor: 0, antigravity: 0, codex: 0, copilot: 0, grok: 0 };
}

function pct(v: number, max: number): string {
  return `${max ? Math.max(2, (100 * v) / max) : 2}%`;
}

function dayTitle(d: { label: string; counts: Counts }): string {
  const parts = PROVIDER_IDS.filter((id) => d.counts[id]).map(
    (id) => `${d.counts[id]} ${providerShort(id)}`,
  );
  return `${d.label}: ${parts.join(" · ") || "0"}`;
}

function splitTitle(r: { full: string; counts: Counts }): string {
  const parts = PROVIDER_IDS.filter((id) => r.counts[id]).map(
    (id) => `${fmtTokens(r.counts[id])} ${providerShort(id)}`,
  );
  return `${r.full}: ${parts.join(" · ")}`;
}

const DAY = 86_400_000;

const perDay = computed(() => {
  const days: Array<{
    label: string;
    short: string;
    counts: Counts;
    total: number;
  }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const start = today.getTime() - i * DAY;
    const d = new Date(start);
    const inDay = props.sessions.filter(
      (s) => (s.createdAt ?? 0) >= start && (s.createdAt ?? 0) < start + DAY,
    );
    const counts = emptyCounts();
    for (const s of inDay) counts[s.provider] = (counts[s.provider] ?? 0) + 1;
    days.push({
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      short: String(d.getDate()),
      counts,
      total: inDay.length,
    });
  }
  return days;
});
const perDayMax = computed(() => Math.max(...perDay.value.map((d) => d.total), 1));

function topSplit(
  keyOf: (s: SessionRef) => string | undefined,
  valueOf: (s: SessionRef) => number,
  labelOf: (key: string) => string,
  top = 6,
): Array<{ label: string; full: string; counts: Counts; total: number }> {
  const map = new Map<string, Counts>();
  for (const s of props.sessions) {
    const key = keyOf(s);
    if (!key) continue;
    const v = valueOf(s);
    if (!v) continue;
    if (!map.has(key)) map.set(key, emptyCounts());
    const row = map.get(key)!;
    row[s.provider] = (row[s.provider] ?? 0) + v;
  }
  return [...map.entries()]
    .map(([key, counts]) => ({
      label: labelOf(key),
      full: key,
      counts,
      total: PROVIDER_IDS.reduce((n, id) => n + (counts[id] ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, top);
}

const tokensByProject = computed(() =>
  topSplit(
    (s) => s.projectDir || undefined,
    (s) => s.tokensOut ?? 0,
    (k) => k.split("/").filter(Boolean).pop() ?? k,
  ),
);
const tokensByProjectMax = computed(() =>
  Math.max(...tokensByProject.value.map((r) => r.total), 1),
);

const spendByModel = computed(() => {
  // key by provider+model so the same Claude model used via Cursor vs Claude Code
  // keeps the correct color (first-writer-wins on bare model id was wrong).
  const map = new Map<string, { model: string; value: number; provider: string }>();
  for (const s of props.sessions) {
    if (!s.model || !s.cost) continue;
    const key = `${s.provider}\0${s.model}`;
    if (!map.has(key)) map.set(key, { model: s.model, value: 0, provider: s.provider });
    map.get(key)!.value += s.cost;
  }
  return [...map.values()]
    .map((r) => ({
      label: r.model.split("/").pop() ?? r.model,
      full: r.model,
      value: r.value,
      provider: r.provider,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
});
const spendByModelMax = computed(() =>
  Math.max(...spendByModel.value.map((r) => r.value), 0.0001),
);

const cacheByProvider = computed(() => {
  const acc = new Map<string, { read: number; total: number; provider: string }>();
  for (const s of props.sessions) {
    if (s.tokensCacheRead === undefined && s.tokensCacheWrite === undefined) continue;
    const key = providerShort(s.provider);
    if (!acc.has(key)) acc.set(key, { read: 0, total: 0, provider: s.provider });
    const a = acc.get(key)!;
    a.read += s.tokensCacheRead ?? 0;
    a.total +=
      (s.tokensIn ?? 0) + (s.tokensCacheRead ?? 0) + (s.tokensCacheWrite ?? 0);
  }
  return [...acc.entries()]
    .filter(([, a]) => a.total > 0)
    .map(([label, a]) => ({
      label,
      value: (100 * a.read) / a.total,
      provider: a.provider,
    }))
    .sort((a, b) => b.value - a.value);
});
</script>

<style scoped>
.charts-wrap {
  margin: 18px 0 6px;
}
.chart-legend {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  margin-bottom: 8px;
}
.leg-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: baseline;
}
.charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.chart-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px 12px;
  min-height: 170px;
  display: flex;
  flex-direction: column;
}
.chart-title {
  padding-bottom: 12px;
}
.chart-empty {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  font-style: italic;
  margin: auto 0;
}
.mono {
  font-family: var(--mono);
}

/* vertical day bars — stacked segments with a 2px surface gap */
.vbars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-height: 110px;
}
.vbar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  gap: 4px;
}
.vbar-stack {
  width: 100%;
  max-width: 26px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: height 0.2s;
}
.vbar-seg {
  border-radius: 3px;
  min-height: 3px;
}
.vbar-seg.empty {
  background: var(--border);
  min-height: 2px;
}
.vbar-val {
  font-size: var(--fs-2xs);
  color: var(--text-dim);
}
.vbar-label {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}

/* horizontal bars */
.hbars {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  justify-content: center;
}
.hbar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hbar-label {
  width: 120px;
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}
.hbar-track {
  flex: 1;
  height: 14px;
  display: flex;
  align-items: center;
}
.hbar,
.hbar-stack {
  height: 14px;
  min-width: 3px;
  border-radius: 3px;
  transition: width 0.2s;
}
.hbar-stack {
  display: flex;
  gap: 2px;
}
.hbar-seg {
  border-radius: 3px;
  min-width: 2px;
}
.hbar-val {
  width: 64px;
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  text-align: right;
}

@media (max-width: 980px) {
  .charts {
    grid-template-columns: 1fr;
  }
}
</style>
