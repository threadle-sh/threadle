<template>
  <div class="delay-panel">
    <label class="cfg-row">
      <span>label</span>
      <input
        class="threadle-input cfg-label"
        :value="data.label ?? ''"
        placeholder="optional"
        spellcheck="false"
        @input="onLabel"
      />
    </label>

    <label class="cfg-row">
      <span>seconds</span>
      <input
        class="threadle-input cfg-input"
        type="number"
        min="0"
        max="300"
        step="1"
        :value="seconds"
        @input="onSeconds"
      />
    </label>

    <div class="meta mono">{{ durationMeta }} · max 300s</div>

    <p class="hint">
      Wall-clock pause on the text lane — no agent. Inbound text is held, then
      forwarded unchanged. Useful for detached demos and pacing a chain.
    </p>

    <dl class="facts">
      <div class="fact">
        <dt>ports</dt>
        <dd>1 in · 1 out</dd>
      </div>
      <div class="fact">
        <dt>passes</dt>
        <dd>text through</dd>
      </div>
      <div class="fact">
        <dt>cancel</dt>
        <dd>aborts the wait</dd>
      </div>
      <div class="fact">
        <dt>detached</dt>
        <dd>survives tab close</dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DelayNodeData } from "@threadle/shared";

const props = defineProps<{ data: DelayNodeData }>();

const seconds = computed(() => Math.round((props.data.ms ?? 0) / 1000));

const durationMeta = computed(() => {
  const s = seconds.value;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
});

function onLabel(e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  props.data.label = v || undefined;
}

function onSeconds(e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value);
  const sec = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 0), 300) : 0;
  props.data.ms = sec * 1000;
}
</script>

<style scoped>
.delay-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.cfg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.cfg-input {
  width: auto;
  min-width: 88px;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  text-align: right;
}
.cfg-label {
  flex: 1;
  min-width: 0;
  width: auto;
  font-size: var(--fs-xs);
  font-family: var(--font);
  text-align: left;
}
.meta {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.45;
}
.facts {
  margin: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fact {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  font-size: var(--fs-xs);
  align-items: baseline;
}
.fact dt {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.fact dd {
  margin: 0;
  color: var(--text-dim);
  min-width: 0;
}
</style>
