<template>
  <div v-if="live" class="graph-run-hud" title="Live run">
    <div class="hud-main">
      <span class="status-dot running" />
      <span class="hud-elapsed mono">{{ elapsedLabel }}</span>
      <span class="hud-title">{{ title }}</span>
    </div>
    <div v-if="detail" class="hud-detail mono" :title="detail">{{ detail }}</div>
    <div class="hud-extras">
      <span class="micro-label">harness extras</span>
      <div class="settings-seg" role="group" aria-label="harness extras">
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !harnessExtras }"
          :disabled="saving"
          title="Skip post-answer extras (Muse reminders, Claude hooks/slash, Grok subagents, …)"
          @click="emit('update:harnessExtras', false)"
        >
          off
        </button>
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: harnessExtras }"
          :disabled="saving"
          title="Allow provider post-answer extras (slower wall time)"
          @click="emit('update:harnessExtras', true)"
        >
          on
        </button>
      </div>
    </div>
    <p class="hud-note">takes effect on the next agent spawn</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  live: boolean;
  /** Epoch ms when the current run started */
  startedAt?: number;
  /** Short status line, e.g. running node name */
  title?: string;
  /** Extra line from recent meta (spawn / first answer) */
  detail?: string;
  harnessExtras: boolean;
  saving?: boolean;
}>();

const emit = defineEmits<{
  "update:harnessExtras": [value: boolean];
}>();

const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;

watch(
  () => props.live,
  (live) => {
    if (tick !== undefined) {
      clearInterval(tick);
      tick = undefined;
    }
    if (live) {
      now.value = Date.now();
      tick = setInterval(() => {
        now.value = Date.now();
      }, 250);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (tick !== undefined) clearInterval(tick);
});

function formatElapsed(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

const elapsedLabel = computed(() => {
  const start = props.startedAt ?? now.value;
  return formatElapsed(now.value - start);
});

const title = computed(() => props.title?.trim() || "running");
</script>

<style scoped>
.graph-run-hud {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 25;
  min-width: 200px;
  max-width: min(320px, calc(100% - 24px));
  padding: 8px 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hud-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.hud-elapsed {
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text);
  flex-shrink: 0;
}
.hud-title {
  font-size: var(--fs-xs);
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.hud-detail {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hud-extras {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.hud-note {
  margin: 0;
  font-size: 10px;
  color: var(--text-faint);
  letter-spacing: 0.02em;
}
.settings-seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.settings-seg-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  padding: 2px 8px;
  cursor: pointer;
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
