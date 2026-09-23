<template>
  <div
    class="log-dock"
    :class="{ open }"
    :style="open ? { height: dockHeight + 'px' } : undefined"
  >
    <div
      v-if="open"
      class="log-resize-grip"
      title="Drag to resize · double-click to reset height"
      @mousedown="startDockDrag"
      @dblclick.stop="resetDockHeight"
    />
    <div
      class="log-header"
      :title="open ? 'Double-click to close' : 'Double-click to open'"
      @dblclick="onHeaderDblClick"
    >
      <button
        class="log-toggle"
        :title="open ? 'Collapse' : 'Expand'"
        @click="emit('toggle')"
      >
        <span class="log-toggle-glyph">{{ open ? "⊟" : "⊞" }}</span>
      </button>
      <button
        class="log-tab"
        :class="{ active: tab === 'log' }"
        @click="selectTab('log')"
      >
        Run log
        <span v-if="entries.length" class="log-count">{{ entries.length }}</span>
        <span v-if="live" class="status-dot running" />
        <span v-if="live && phase" class="log-phase mono">{{ phase }}</span>
      </button>
      <button
        class="log-tab"
        :class="{ active: tab === 'issues' }"
        @click="selectTab('issues')"
      >
        ✗ Issues
        <span v-if="workflowIssues.length" class="log-count warn">{{ workflowIssues.length }}</span>
      </button>
      <button
        class="log-tab"
        :class="{ active: tab === 'loose' }"
        @click="selectTab('loose')"
      >
        ⌀ Graph lint
        <span v-if="looseEnds.length" class="log-count">{{ looseEnds.length }}</span>
      </button>
      <span class="log-spacer" />
      <button
        v-if="tab === 'log' && entries.length"
        class="log-clear"
        title="Clear log"
        @click.stop="emit('clear')"
      >
        clear
      </button>
    </div>
    <div v-if="open" ref="scroller" class="log-body nowheel">
      <template v-if="tab === 'log'">
        <div v-if="!entries.length" class="log-empty">
          Agent output streams here while the graph runs.
        </div>
        <div
          v-for="(e, i) in entries"
          :key="i"
          class="log-line"
          :class="[e.lane, { expandable: isLong(e), expanded: expanded.has(i) }]"
          @click="toggleRow(i, e)"
        >
          <span class="log-caret">{{
            isLong(e) ? (expanded.has(i) ? "▾" : "▸") : ""
          }}</span>
          <span class="log-time">{{ time(e.ts) }}</span>
          <span v-if="e.label" class="log-label">{{ e.label }}</span>
          <span class="log-lane-icon">{{ laneIcon(e.lane) }}</span>
          <span class="log-text">{{ expanded.has(i) ? e.line : firstLine(e.line) }}</span>
        </div>
      </template>
      <template v-else-if="tab === 'issues'">
        <div v-if="!workflowIssues.length" class="log-empty">
          No issues — graph is ready to run.
        </div>
        <button
          v-for="(issue, i) in workflowIssues"
          :key="issue.nodeId + issue.kind + i"
          class="loose-end-item issue-item"
          @click="emit('focus-issue', issue)"
        >
          <span class="loose-kind mono">{{ issue.kind }}</span>
          <span class="loose-label">{{ issue.label }}</span>
          <span class="loose-msg">{{ issue.message }}</span>
        </button>
      </template>
      <template v-else>
        <div v-if="!looseEnds.length" class="log-empty">
          No lint — ports wired, graph reachable, params used.
        </div>
        <button
          v-for="(le, i) in looseEnds"
          :key="(le.nodeId ?? le.label) + le.kind + i"
          class="loose-end-item"
          @click="emit('focus-loose', le)"
        >
          <span class="loose-kind mono">{{ le.kind }}</span>
          <span class="loose-label">{{ le.label }}</span>
          <span class="loose-msg">{{ le.message }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import type { LooseEnd, WorkflowIssue } from "@threadle/shared";
import { useVerticalResize } from "@/lib/useVerticalResize";

export interface LogEntry {
  jobId: string;
  label?: string;
  lane: "text" | "thinking" | "tool" | "raw" | "meta";
  line: string;
  ts: number;
}

const props = defineProps<{
  entries: LogEntry[];
  open: boolean;
  live?: boolean;
  /** Live deriveRunPhase label while a run is in flight */
  phase?: string;
  looseEnds?: LooseEnd[];
  workflowIssues?: WorkflowIssue[];
}>();

const emit = defineEmits<{
  toggle: [];
  clear: [];
  "focus-loose": [le: LooseEnd];
  "focus-issue": [issue: WorkflowIssue];
}>();

const {
  height: dockHeight,
  startDrag: startDockDrag,
  resetHeight: resetDockHeight,
} = useVerticalResize("threadle.runLog.height", 220, 100, 720);

const tab = ref<"log" | "issues" | "loose">("log");
const scroller = ref<HTMLElement>();
const expanded = reactive(new Set<number>());
const looseEnds = computed(() => props.looseEnds ?? []);
const workflowIssues = computed(() => props.workflowIssues ?? []);

function onHeaderDblClick(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  // Tabs/clear/toggle keep their own click behavior (avoids open-then-close on dblclick).
  if (t?.closest(".log-tab, .log-clear, .log-toggle")) return;
  emit("toggle");
}

function selectTab(next: "log" | "issues" | "loose"): void {
  tab.value = next;
  if (!props.open) emit("toggle");
}

watch(
  () => props.entries.length,
  async (len, prev) => {
    if (len < (prev ?? 0)) expanded.clear(); // log was cleared/trimmed
    if (tab.value !== "log") return;
    await nextTick();
    const el = scroller.value;
    if (!el) return;
    // stick to bottom unless the user scrolled up to read
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  },
);

const LONG_CHARS = 160;

function isLong(e: LogEntry): boolean {
  return e.line.includes("\n") || e.line.length > LONG_CHARS;
}

function firstLine(line: string): string {
  const first = line.split("\n", 1)[0] ?? "";
  return first.length > LONG_CHARS ? `${first.slice(0, LONG_CHARS)}…` : first;
}

function toggleRow(i: number, e: LogEntry): void {
  if (!isLong(e)) return;
  if (expanded.has(i)) expanded.delete(i);
  else expanded.add(i);
}

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function laneIcon(lane: LogEntry["lane"]): string {
  switch (lane) {
    case "tool":
      return "⚙";
    case "thinking":
      return "…";
    case "meta":
      return "◷";
    case "raw":
      return "·";
    default:
      return "";
  }
}

/** Switch to the Issues tab (e.g. when a run is blocked). */
function showIssues(): void {
  tab.value = "issues";
  if (!props.open) emit("toggle");
}

defineExpose({ showIssues });
</script>

<style scoped>
.log-dock {
  position: relative;
  flex-shrink: 0;
  background: var(--panel-bg);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.log-dock.open {
  overflow: hidden;
  min-height: 100px;
  max-height: 70vh;
}
.log-resize-grip {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 5px;
  cursor: row-resize;
  z-index: 2;
}
.log-resize-grip:hover,
.log-resize-grip:active {
  background: color-mix(in srgb, var(--accent) 35%, transparent);
}
.log-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 4px 8px;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  font-weight: 600;
  font-family: var(--font);
  flex-shrink: 0;
  cursor: default;
  user-select: none;
}
.log-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: inherit;
  cursor: pointer;
  padding: 2px 6px;
  font-family: var(--mono);
  font-size: var(--fs-md);
  line-height: 1;
  min-width: 24px;
}
.log-toggle:hover {
  color: var(--text);
  background: var(--panel-bg-raised);
  border-color: var(--border);
}
.log-toggle-glyph {
  display: block;
}
.log-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  border-bottom: 1px solid transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
  padding: 6px 8px;
}
.log-tab:hover {
  color: var(--text-dim);
}
.log-tab.active {
  color: var(--text);
  border-bottom-color: var(--text);
}
.log-count {
  font-weight: 400;
  color: var(--text-faint);
}
.log-count.warn {
  color: var(--status-error);
}
.log-phase {
  margin-left: 4px;
  font-size: 10px;
  color: var(--text-faint);
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-spacer {
  flex: 1;
  align-self: stretch;
  min-width: 12px;
}
.log-clear {
  background: none;
  border: none;
  color: var(--text-faint);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.log-clear:hover {
  color: var(--text);
}
.log-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 14px 10px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.log-empty {
  color: var(--text-faint);
  font-family: var(--font);
  font-style: italic;
  padding: 8px 0;
}
.log-line {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 2px 4px;
  border-radius: 4px;
}
.log-line.expandable {
  cursor: pointer;
}
.log-line.expandable:hover {
  background: var(--panel-bg-raised);
}
.log-caret {
  flex-shrink: 0;
  width: 10px;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.log-time {
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  flex-shrink: 0;
}
.log-label {
  color: var(--text);
  flex-shrink: 0;
  font-weight: 600;
}
.log-lane-icon {
  flex-shrink: 0;
  width: 12px;
  color: var(--text-faint);
}
.log-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.log-line.expanded .log-text {
  white-space: pre-wrap;
  overflow: visible;
  text-overflow: clip;
  word-break: break-word;
}
.log-line.text .log-text {
  color: var(--text);
}
.log-line.thinking .log-text {
  color: var(--text-faint);
  font-style: italic;
}
.log-line.tool .log-text {
  color: var(--status-waiting);
}
.log-line.raw .log-text {
  color: var(--text-dim);
}
.log-line.meta .log-text {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.loose-end-item {
  display: grid;
  grid-template-columns: 88px minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 8px;
  align-items: center;
  width: 100%;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  font-family: var(--font);
  text-align: left;
  padding: 5px 6px;
  cursor: pointer;
}
.loose-end-item:hover {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.issue-item .loose-kind {
  color: var(--status-error);
}
.loose-kind {
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
}
.loose-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
}
.loose-msg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
}
</style>
