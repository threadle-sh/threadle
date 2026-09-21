<template>
  <aside
    class="dash-side"
    :class="{ collapsed }"
    :style="{ width: (collapsed ? 52 : width) + 'px' }"
  >
    <div
      v-if="!collapsed"
      class="resize-grip grip-right"
      title="Drag to resize · double-click to reset"
      @mousedown="startDrag"
      @dblclick="resetWidth"
    />
    <div class="dash-logo-row">
      <router-link to="/" class="dash-logo" :title="collapsed ? 'threadle' : undefined">
        <span class="logo-text">{{ collapsed ? "t" : "threadle" }}</span>
      </router-link>
      <span
        v-if="!collapsed"
        class="app-version"
        :title="`threadle v${appVersion}`"
        >v{{ appVersion }}</span
      >
    </div>

    <nav class="dash-nav" :class="{ compact: compact && !collapsed }">
      <template v-for="(section, si) in sections" :key="section.id">
        <div
          v-if="si > 0"
          class="nav-section-rule"
          aria-hidden="true"
        />
        <button
          v-for="item in section.items"
          :key="item.id"
          class="nav-item"
          :class="{ active: active === item.id }"
          :title="collapsed || compact ? item.label : undefined"
          @click="emit('select', item.id)"
        >
          <span class="nav-glyph">
            <FileMark v-if="item.id === 'files'" />
            <FolderMark v-else-if="item.id === 'library'" />
            <template v-else>{{ item.glyph }}</template>
          </span>
          <span v-if="!collapsed && !compact" class="nav-label">{{ item.label }}</span>
          <span v-if="!collapsed && !compact" class="nav-count">{{ item.count ?? "" }}</span>
        </button>
      </template>
    </nav>

    <div v-if="$slots.default && !collapsed" class="nav-body">
      <slot />
    </div>

    <div class="dash-side-foot">
      <div class="foot-row">
        <button
          type="button"
          class="report-issue"
          :title="collapsed ? 'Report an issue' : undefined"
          @click="onReportIssue"
        >
          <span v-if="!collapsed">Report issue</span>
          <span v-else aria-hidden="true">?</span>
        </button>
        <button
          class="collapse-btn"
          :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="toggleCollapsed"
        >
          {{ collapsed ? "»" : "«" }}
        </button>
      </div>
    </div>
  </aside>
  <ConfirmModal v-model="reportDlg" @confirm="openReportIssue" />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useHorizontalResize } from "@/lib/useHorizontalResize";
import ConfirmModal, { type ConfirmModel } from "./ConfirmModal.vue";
import FileMark from "./FileMark.vue";
import FolderMark from "./FolderMark.vue";
import { NAV_SECTIONS, type NavItem, type NavSection } from "./nav-items";

const REPORT_ISSUE_URL = "https://github.com/threadle-sh/threadle/issues";

const appVersion = __APP_VERSION__;

const props = defineProps<{
  items: NavItem[];
  active?: string;
  /** icon-row nav (used when a page embeds its own panel below, e.g. the editor palette) */
  compact?: boolean;
  /** independent persisted collapse/width state (e.g. the editor keeps its own) */
  stateKey?: string;
  defaultCollapsed?: boolean;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const reportDlg = ref<ConfirmModel>();

function onReportIssue(): void {
  reportDlg.value = {
    title: "Report issue",
    emphasis: "github.com",
    body: " — leave threadle and open GitHub Issues?",
    detail:
      `${REPORT_ISSUE_URL}\n\n` +
      "For threadle bugs only (UI, graphs, CLI, wiring). Not for external agents or services — e.g. can't log in to Cursor, Claude outages, or opencode crashes belong with those vendors.",
    confirmLabel: "Open",
    cancelLabel: "Cancel",
  };
}

function openReportIssue(): void {
  window.open(REPORT_ISSUE_URL, "_blank", "noopener,noreferrer");
}

const stateKey = props.stateKey ?? "threadle.dashnav";
const widthKey = `${stateKey}.width`;
// Migrate pre–type-scale default (220) so denser fonts don't keep a cramped rail.
{
  const raw = localStorage.getItem(widthKey);
  if (raw === "220") localStorage.setItem(widthKey, "240");
}
// min is below the collapse threshold so dragging can cross it
const { width, startDrag, resetWidth } = useHorizontalResize(
  widthKey,
  240,
  90,
  360,
  "left",
);
const storedCollapsed = localStorage.getItem(`${stateKey}.collapsed`);
const collapsed = ref(
  storedCollapsed === null ? (props.defaultCollapsed ?? false) : storedCollapsed === "1",
);

const COLLAPSE_AT = 150;
let lastComfortable = width.value >= 180 ? width.value : 240;

/** Merge live counts onto the canonical section order; drop empty sections. */
const sections = computed<NavSection[]>(() => {
  const byId = new Map(props.items.map((i) => [i.id, i]));
  return NAV_SECTIONS.map((sec) => ({
    id: sec.id,
    label: sec.label,
    items: sec.items
      .map((base) => {
        const live = byId.get(base.id);
        return live ? { ...base, ...live, glyph: base.glyph, label: base.label } : undefined;
      })
      .filter((i): i is NavItem => !!i),
  })).filter((s) => s.items.length > 0);
});

// dragging below the threshold snaps into the collapsed rail
watch(width, (w) => {
  if (w >= 180) lastComfortable = w;
  if (w < COLLAPSE_AT && !collapsed.value) {
    setCollapsed(true);
    width.value = lastComfortable; // restore for the next expand
  }
});

function setCollapsed(v: boolean): void {
  collapsed.value = v;
  localStorage.setItem(`${stateKey}.collapsed`, v ? "1" : "0");
}

function toggleCollapsed(): void {
  setCollapsed(!collapsed.value);
}

// narrow windows: collapse width rail
function onWindowResize(): void {
  if (window.innerWidth < 900 && !collapsed.value) collapsed.value = true;
}
onMounted(() => {
  onWindowResize();
  window.addEventListener("resize", onWindowResize);
});
onUnmounted(() => window.removeEventListener("resize", onWindowResize));
</script>

<style scoped>
.dash-side {
  position: relative;
  flex-shrink: 0;
  background: var(--panel-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 20px 12px 16px;
}
.dash-logo-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 0 8px 36px;
  min-width: 0;
}
.dash-logo {
  display: flex;
  align-items: center;
  min-width: 0;
  color: var(--text);
  text-decoration: none;
}
.logo-text {
  font-family: var(--font);
  font-size: var(--fs-title);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1;
}
.app-version {
  flex-shrink: 0;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1;
  opacity: 0.85;
  user-select: text;
  transform: translateY(-1px);
}
.dash-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: thin;
}
.nav-section-rule {
  height: 1px;
  margin: 10px 8px;
  background: var(--border);
  flex-shrink: 0;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: var(--fs-md);
  font-family: var(--font);
  cursor: pointer;
  text-align: left;
}
.nav-item:hover,
.nav-item.active {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.nav-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 26px;
  height: 1.15em;
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 400;
  font-style: normal;
  line-height: 1;
  letter-spacing: 0;
  color: var(--text-faint);
  text-align: center;
  /* Prefer text glyphs over emoji presentation (⚙ ✦ etc. blow up on macOS). */
  font-variant-emoji: text;
  font-variation-settings: normal;
}
.nav-item.active .nav-glyph {
  color: var(--text);
}
.nav-glyph :deep(.file-mark),
.nav-glyph :deep(.folder-mark) {
  width: 13px;
  height: 13px;
  color: inherit;
}
.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-count {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-faint);
  text-align: right;
  font-variant-numeric: tabular-nums;
  padding-left: 4px;
}

/* MacBook / short laptop: denser rail so the full nav fits without scrolling */
@media (max-height: 920px) {
  .dash-side {
    padding: 14px 12px 12px;
  }
  .dash-logo-row {
    padding-bottom: 28px;
  }
  .logo-text {
    font-size: var(--fs-2xl);
  }
  .nav-section-rule {
    margin: 6px 8px;
  }
  .nav-item {
    padding: 6px 10px;
  }
  .dash-side-foot {
    padding-top: 8px;
  }
}
@media (max-height: 760px) {
  .nav-item {
    padding: 5px 10px;
  }
  .dash-nav {
    gap: 1px;
  }
}
.dash-nav.compact {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.dash-nav.compact .nav-item {
  padding: 6px 8px;
}
.dash-nav.compact .nav-section-rule {
  display: none;
}
.nav-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 0 -12px; /* let the embedded panel use the full sidebar width */
}
.dash-side-foot {
  margin-top: auto;
  padding: 12px 8px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.dash-side.collapsed .dash-side-foot {
  align-items: center;
  padding: 10px 0 0;
  margin-top: 8px;
  border-top: 1px solid var(--border);
}
.dash-side.collapsed .foot-row {
  flex-direction: column;
  gap: 8px;
}
.report-issue {
  appearance: none;
  background: none;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 2px 0;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  font-weight: 500;
  letter-spacing: 0.02em;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
}
.report-issue:hover {
  color: var(--text-dim);
  opacity: 1;
}
.dash-side.collapsed .report-issue {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  letter-spacing: 0;
  font-size: var(--fs-sm);
  font-weight: 400;
  opacity: 0.85;
}
.dash-side.collapsed .report-issue:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.collapse-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-size: var(--fs-sm);
  flex-shrink: 0;
}
.collapse-btn:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
.dash-side.collapsed .dash-logo-row {
  justify-content: center;
  padding: 0 0 14px;
}
.dash-side.collapsed .logo-text {
  font-size: var(--fs-2xl);
  font-weight: 600;
  letter-spacing: -0.04em;
}
.dash-side.collapsed .nav-item {
  justify-content: center;
  padding: 7px 0;
}
.dash-side.collapsed .nav-glyph {
  width: auto;
}
.dash-side.collapsed .nav-section-rule {
  margin: 6px 8px;
}
.grip-right {
  left: auto;
  right: -3px;
}
</style>
