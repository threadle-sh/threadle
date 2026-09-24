<template>
  <div
    class="node-ctx tab-ctx"
    :style="{ left: x + 'px', top: y + 'px' }"
    @click.stop
    @contextmenu.prevent
  >
    <div class="node-ctx-title mono">{{ name }}</div>
    <button class="node-ctx-item" :disabled="runDisabled" @click="emit('run')">
      ▶ run
    </button>
    <button class="node-ctx-item" @click="emit('export')">⤒ export</button>
    <button class="node-ctx-item" @click="emit('duplicate')">⊕ duplicate</button>
    <button class="node-ctx-item" @click="emit('convert-kind')">
      {{ kind === "subgraph" ? "# promote to workflow" : "⌗ convert to subgraph" }}
    </button>
    <div class="wire-sect micro-label">tabs</div>
    <button class="node-ctx-item" @click="emit('close')">× close</button>
    <button class="node-ctx-item" :disabled="!canCloseOthers" @click="emit('close-others')">
      × close others
    </button>
    <button
      class="node-ctx-item"
      :disabled="!canCloseToRight"
      @click="emit('close-to-right')"
    >
      × close to the right
    </button>
    <button class="node-ctx-item" @click="emit('close-all')">×× close all</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  x: number;
  y: number;
  name: string;
  kind: "workflow" | "subgraph";
  runDisabled: boolean;
  canCloseOthers: boolean;
  canCloseToRight: boolean;
}>();

const emit = defineEmits<{
  run: [];
  export: [];
  duplicate: [];
  "convert-kind": [];
  close: [];
  "close-others": [];
  "close-to-right": [];
  "close-all": [];
}>();
</script>

<style scoped>
.node-ctx {
  position: fixed;
  z-index: 60;
  min-width: 190px;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-strong);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.node-ctx-title {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  padding: 5px 9px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 3px;
}
.node-ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 6px 9px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-dim);
  cursor: pointer;
}
.node-ctx-item:hover:not(:disabled) {
  background: var(--input-bg);
  color: var(--text);
}
.node-ctx-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.wire-sect {
  padding: 7px 9px 3px;
  border-top: 1px solid var(--border);
  margin-top: 3px;
}
</style>
