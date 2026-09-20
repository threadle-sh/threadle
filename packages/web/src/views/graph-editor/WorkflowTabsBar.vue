<template>
  <div class="wf-tabs-stack">
    <div class="wf-tabs" @click.stop>
      <div
        class="wf-tabs-scroll"
        @dragover="emit('tab-bar-dragover', $event)"
        @drop="emit('tab-bar-drop', $event)"
      >
        <button
          v-for="tid in openIds"
          :key="tid"
          class="wf-tab"
          :class="{
            active: tid === activeGraphId,
            dragging: tabDragId === tid,
            'drop-before': tabDropBefore === tid,
            'drop-after': tabDropAfter === tid,
            [`run-${tabPhase(tid)}`]: tabPhase(tid) !== 'idle',
          }"
          :title="tabTitle(tid)"
          draggable="true"
          @mousedown="emit('clear-selection')"
          @contextmenu.prevent.stop="emit('tab-contextmenu', $event, tid)"
          @click="emit('tab-click', tid)"
          @auxclick.middle.prevent="emit('tab-close', tid)"
          @dragstart="emit('tab-dragstart', $event, tid)"
          @dragend="emit('tab-dragend')"
          @dragover="emit('tab-dragover', $event, tid)"
          @drop="emit('tab-drop', $event, tid)"
        >
          <span class="wf-tab-name">{{ tabLabel(tid) }}</span>
          <span class="wf-tab-x" title="Close tab" @click.stop="emit('tab-close', tid)">×</span>
          <span
            v-if="tid !== activeGraphId && tabPhase(tid) !== 'idle'"
            class="wf-tab-status"
            :class="tabPhase(tid)"
            aria-hidden="true"
          >
            <span class="wf-tab-status-fill" :style="{ width: tabPct(tid) + '%' }" />
          </span>
        </button>
      </div>
      <button class="wf-tab-btn" title="New workflow" @click="emit('new-workflow')">+</button>
      <button
        class="wf-tab-btn"
        :class="{ open: listOpen }"
        title="All workflows"
        @click="emit('toggle-list')"
      >
        ▤
      </button>
      <button
        v-if="openCount > 0"
        class="wf-tab-btn wf-tab-close-all"
        title="Close all tabs"
        @click="emit('close-all')"
      >
        ××
      </button>
      <slot />
    </div>
    <div
      class="wf-run-rail"
      :class="{ active: runRail.visible }"
      :title="runRail.title"
    >
      <div
        class="wf-run-rail-fill"
        :class="runRail.tone"
        :style="{ width: runRail.pct + '%' }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  openIds: string[];
  openCount: number;
  activeGraphId: string;
  tabDragId?: string;
  tabDropBefore?: string;
  tabDropAfter?: string;
  listOpen: boolean;
  tabLabel: (id: string) => string;
  tabPhase: (id: string) => string;
  tabPct: (id: string) => number;
  tabTitle: (id: string) => string;
  runRail: { visible: boolean; pct: number; tone: string; title: string };
}>();

const emit = defineEmits<{
  "tab-bar-dragover": [e: DragEvent];
  "tab-bar-drop": [e: DragEvent];
  "clear-selection": [];
  "tab-contextmenu": [e: MouseEvent, tid: string];
  "tab-click": [tid: string];
  "tab-close": [tid: string];
  "tab-dragstart": [e: DragEvent, tid: string];
  "tab-dragend": [];
  "tab-dragover": [e: DragEvent, tid: string];
  "tab-drop": [e: DragEvent, tid: string];
  "new-workflow": [];
  "toggle-list": [];
  "close-all": [];
}>();
</script>

<style scoped>
.wf-tabs-stack {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  user-select: none;
  -webkit-user-select: none;
}
.wf-tabs-stack *,
.wf-tabs-stack *::before,
.wf-tabs-stack *::after {
  user-select: none;
  -webkit-user-select: none;
}
.wf-tabs-stack *::selection {
  background: transparent;
  color: inherit;
}
.wf-tabs {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 32px;
  padding: 0 8px 0 12px;
  background: transparent;
  border-bottom: none;
  flex-shrink: 0;
}
.wf-run-rail {
  height: 3px;
  width: 100%;
  background: transparent;
  overflow: hidden;
  flex-shrink: 0;
}
.wf-run-rail.active {
  background: var(--border);
}
.wf-run-rail-fill {
  height: 100%;
  width: 0;
  transition: width 0.25s ease-out, background-color 0.2s ease;
  background: var(--status-running);
}
.wf-run-rail-fill.waiting {
  background: var(--status-waiting);
}
.wf-run-rail-fill.error {
  background: var(--status-error);
}
.wf-run-rail-fill.success {
  background: var(--status-success);
}
.wf-run-rail-fill.running {
  background: var(--status-running);
}
.wf-tabs-scroll {
  display: flex;
  align-items: stretch;
  gap: 2px;
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}
.wf-tabs-scroll::-webkit-scrollbar {
  display: none;
}
.wf-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 0 8px 0 10px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  cursor: grab;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  user-select: none;
}
.wf-tab-status {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: color-mix(in srgb, var(--border) 70%, transparent);
  pointer-events: none;
  overflow: hidden;
}
.wf-tab-status-fill {
  display: block;
  height: 100%;
  width: 0;
  transition: width 0.28s ease-out;
  background: var(--status-running);
}
.wf-tab-status.running .wf-tab-status-fill {
  background: var(--status-running);
}
.wf-tab-status.waiting .wf-tab-status-fill {
  background: var(--status-waiting);
}
.wf-tab-status.error .wf-tab-status-fill {
  background: var(--status-error);
}
.wf-tab-status.success .wf-tab-status-fill {
  background: var(--status-success);
}
.wf-tab:active {
  cursor: grabbing;
}
.wf-tab:hover {
  color: var(--text);
  background: var(--node-bg);
}
.wf-tab.active {
  color: var(--text);
  background: var(--canvas-bg);
  border-color: var(--border);
}
.wf-tab.dragging {
  opacity: 0.45;
}
.wf-tab.drop-before::before,
.wf-tab.drop-after::after {
  content: "";
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--text);
  pointer-events: none;
}
.wf-tab.drop-before::before {
  left: -1px;
}
.wf-tab.drop-after::after {
  right: -1px;
}
.wf-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.wf-tab-x {
  color: var(--text-faint);
  font-size: var(--fs-sm);
  line-height: 1;
  padding: 0 2px;
  border-radius: 2px;
  cursor: pointer;
}
.wf-tab-x:hover {
  color: var(--text);
  background: var(--panel-bg-raised);
}
.wf-tab-btn {
  width: 28px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-md);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.wf-tab-btn:hover,
.wf-tab-btn.open {
  color: var(--text);
  background: var(--node-bg);
}
.wf-tab-close-all {
  margin-left: auto;
}
</style>
