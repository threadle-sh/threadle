<template>
  <div class="agent-node" :class="{ 'menu-open': menuOpen }">
    <div
      v-if="hasExtras && !extrasEffective"
      class="extras-skip-banner"
      title="Post-answer harness extras skipped for this node"
    >
      ⊘ extras off
    </div>
    <div
      v-if="data.ignoreLocalMarkdown"
      class="extras-skip-banner bare-md-banner"
      title="Runs in bare workspace — AGENTS.md / CLAUDE.md / rules skipped"
    >
      ⊘ ignore local md
    </div>
    <NodeCard
      :id="id"
      glyph="⟨/⟩"
      :icon-bg="providerColor"
      :title="fallbackTitle"
      :label="data.label"
      renamable
      :subtitle="subtitle"
      :status="status ?? 'idle'"
      :run-status="status ?? 'idle'"
      :selected="selected"
      has-input
      has-output
      has-err-output
      :out-handle-color="providerColor"
      @update:label="(v) => (data.label = v)"
    >
      <template #trailing>
        <span
          v-if="usageBadge"
          class="usage-badge"
          :class="{ exhausted: usageBadge.exhausted }"
          :title="usageBadge.title"
        >{{ usageBadge.text }}</span>
        <span
          v-if="securityBadge"
          class="sec-badge"
          :class="{ elevated: securityElevated }"
          :title="securityBadgeTitle"
        >{{ securityBadge }}</span>
        <button
          v-if="hasExtras"
          type="button"
          class="extras-btn nodrag nopan"
          :class="{ on: extrasEffective, off: !extrasEffective }"
          :title="extrasBtnTitle"
          @click.stop="toggleExtras"
          @pointerdown.stop
        >
          {{ extrasEffective ? "✦" : "⊘" }}
        </button>
        <button
          ref="btnEl"
          type="button"
          class="model-btn nodrag nopan"
          :class="{ unset: !data.model, open: menuOpen }"
          :title="modelBtnTitle"
          @click.stop="toggleMenu"
          @pointerdown.stop
        >
          {{ modelBtnLabel }}
        </button>
      </template>
    </NodeCard>

    <Teleport to="body">
      <div
        v-if="menuOpen"
        class="model-menu nodrag nopan nowheel"
        :style="menuStyle"
        @click.stop
        @pointerdown.stop
        @wheel.stop
      >
        <div class="model-menu-head micro-label">model</div>
        <button
          type="button"
          class="model-item"
          :class="{ current: !data.model }"
          @click="pickModel(undefined)"
        >
          default
        </button>
        <button
          v-for="m in models"
          :key="m"
          type="button"
          class="model-item"
          :class="{ current: data.model === m }"
          :disabled="data.model === m"
          :title="m"
          @click="pickModel(m)"
        >
          {{ m }}
        </button>
        <div v-if="!models.length" class="model-empty">
          no models for {{ data.ref.provider }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { AgentDefNodeData, NodeStatus } from "@threadle/shared";
import {
  claudeExhaustedForModel,
  isSessionLive,
  nodeHarnessExtrasField,
  providerHasHarnessExtras,
  resolveHarnessExtras,
  setNodeHarnessExtras,
} from "@threadle/shared";
import NodeCard from "./NodeCard.vue";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { providerColor as colorFor } from "@/lib/providers";
import { useSubscription } from "@/lib/useSubscription";

const props = defineProps<{
  id: string;
  data: AgentDefNodeData;
  selected?: boolean;
  status?: NodeStatus;
  /** Provider model ids from /api/models */
  models?: string[];
}>();

const sessions = useSessionsStore();
const settings = useSettingsStore();
const { snap, refresh: refreshSub } = useSubscription();
const menuOpen = ref(false);
const btnEl = ref<HTMLButtonElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

const models = computed(() => props.models ?? []);
const hasExtras = computed(() => providerHasHarnessExtras(props.data.ref.provider));

/** Effective extras for this node (node override, else Settings). */
const extrasEffective = computed(() =>
  resolveHarnessExtras(nodeHarnessExtrasField(props.data), settings.harnessExtras),
);

const extrasBtnTitle = computed(() => {
  const src =
    nodeHarnessExtrasField(props.data) !== undefined
      ? "this node"
      : "Settings default";
  return extrasEffective.value
    ? `Harness extras on (${src}) — click to skip post-answer work`
    : `Harness extras off (${src}) — click to allow post-answer work`;
});

function toggleExtras(): void {
  // Pin an explicit override on the node so the graph is portable.
  setNodeHarnessExtras(props.data, !extrasEffective.value);
}

const usageBadge = computed(() => {
  if (props.data.ref.provider !== "claude-code") return null;
  const blocked = claudeExhaustedForModel(props.data.model, snap.value?.usage);
  const hot = (snap.value?.claudeWindows ?? []).filter((w) => w.hot || w.exhausted);
  const show = blocked.length ? blocked : hot;
  if (!show.length) return null;
  const exhausted = show.some((w) => w.exhausted);
  const text = show
    .map(
      (w) =>
        `${w.label.replace(/^Claude\s+/, "")}${w.exhausted ? " 100%" : ` ${Math.round(w.utilization)}%`}`,
    )
    .join(" · ");
  const title = [
    exhausted
      ? "Plan usage exhausted — pick another model or wait for reset"
      : "Plan usage nearly exhausted (≥90%)",
    ...show.map(
      (w) =>
        `${w.label}: ${w.utilization}%` +
        (w.resetsAt ? ` (resets ${new Date(w.resetsAt).toLocaleString()})` : ""),
    ),
    "Claude windows are 5h + 7d (weekly). Cursor pools are monthly — see Spending if an agent fails mid-run.",
  ].join("\n");
  return { text: text.slice(0, 36), title, exhausted };
});

const providerColor = computed(() => colorFor(props.data.ref.provider));
const fallbackTitle = computed(() => props.data.ref.name);

/** sessions spawned from this definition = its instances */
const instances = computed(() =>
  sessions.sessions.filter(
    (s) =>
      s.provider === props.data.ref.provider &&
      s.agent?.toLowerCase() === props.data.ref.name.toLowerCase(),
  ),
);
const liveCount = computed(
  () => instances.value.filter((s) => isSessionLive(s.status)).length,
);

const subtitle = computed(() => {
  const agent = props.data.label ? props.data.ref.name : undefined;
  const base =
    props.data.model ??
    sessions.agents.find(
      (a) => a.provider === props.data.ref.provider && a.name === props.data.ref.name,
    )?.description ??
    (agent ? `${props.data.ref.provider} · ${agent}` : "agent definition");
  const inst = liveCount.value
    ? `● ${liveCount.value} live`
    : instances.value.length
      ? `${instances.value.length} inst`
      : "";
  const rem =
    hasExtras.value && !extrasEffective.value ? " · extras off" : "";
  const bare = props.data.ignoreLocalMarkdown ? " · ignore md" : "";
  return inst ? `${base} · ${inst}${rem}${bare}` : `${base}${rem}${bare}`;
});

const securityBadge = computed(() => {
  const d = props.data;
  if (d.ref.provider === "claude-code" && d.permissionMode && d.permissionMode !== "default") {
    return d.permissionMode === "bypassPermissions" ? "bypass" : d.permissionMode.slice(0, 8);
  }
  if (d.ref.provider === "codex") {
    if (d.sandbox && d.sandbox !== "workspace-write") {
      return d.sandbox === "danger-full-access" ? "full" : d.sandbox.slice(0, 8);
    }
    if (d.askForApproval && d.askForApproval !== "never") {
      return d.askForApproval.slice(0, 8);
    }
  }
  return "";
});

const securityElevated = computed(() => {
  const d = props.data;
  return (
    d.permissionMode === "bypassPermissions" ||
    d.sandbox === "danger-full-access"
  );
});

const securityBadgeTitle = computed(() => {
  const parts: string[] = [];
  if (props.data.permissionMode) parts.push(`permission: ${props.data.permissionMode}`);
  if (props.data.sandbox) parts.push(`sandbox: ${props.data.sandbox}`);
  if (props.data.askForApproval) parts.push(`ask: ${props.data.askForApproval}`);
  return parts.join(" · ");
});

const modelBtnLabel = computed(() => {
  const m = props.data.model?.trim();
  if (!m) return "◇";
  const leaf = m.includes("/") ? m.slice(m.lastIndexOf("/") + 1) : m;
  return leaf.length > 8 ? `${leaf.slice(0, 7)}…` : leaf;
});

const modelBtnTitle = computed(() =>
  props.data.model
    ? `Model: ${props.data.model} — click to change`
    : "Select model — click to choose",
);

function placeMenu(): void {
  const btn = btnEl.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const pad = 6;
  const width = Math.min(280, Math.max(200, r.width + 120));
  const spaceBelow = window.innerHeight - r.bottom - pad;
  const spaceAbove = r.top - pad;
  const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
  const maxH = Math.max(120, Math.min(320, preferBelow ? spaceBelow : spaceAbove));
  let left = r.right - width;
  left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
  const top = preferBelow ? r.bottom + 4 : Math.max(pad, r.top - 4 - maxH);
  menuStyle.value = {
    position: "fixed",
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxH)}px`,
    zIndex: "80",
  };
}

async function toggleMenu(): Promise<void> {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) {
    await nextTick();
    placeMenu();
  }
}

function pickModel(m: string | undefined): void {
  props.data.model = m || undefined;
  menuOpen.value = false;
}

function onDocPointerDown(e: PointerEvent): void {
  if (!menuOpen.value) return;
  const t = e.target as Node | null;
  if (!(t instanceof Element)) return;
  if (t.closest(".model-menu") || t.closest(".model-btn")) return;
  menuOpen.value = false;
}

function onViewportChange(e?: Event): void {
  if (!menuOpen.value) return;
  // Allow scrolling inside the teleported menu itself.
  if (e?.target instanceof Element && e.target.closest(".model-menu")) return;
  // Canvas pan/zoom moves the anchor — close rather than chase (keeps text crisp).
  menuOpen.value = false;
}

watch(menuOpen, (open) => {
  if (!open) return;
  void nextTick(() => placeMenu());
});

onMounted(() => {
  void refreshSub();
  void settings.load();
  window.addEventListener("pointerdown", onDocPointerDown, true);
  window.addEventListener("resize", onViewportChange);
  // Vue Flow viewport uses transform (not always scroll); wheel on the pane still fires.
  document.addEventListener("scroll", onViewportChange, true);
  document.addEventListener("wheel", onViewportChange, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onDocPointerDown, true);
  window.removeEventListener("resize", onViewportChange);
  document.removeEventListener("scroll", onViewportChange, true);
  document.removeEventListener("wheel", onViewportChange, true);
});
</script>

<style scoped>
.agent-node {
  position: relative;
}
.extras-skip-banner {
  position: absolute;
  left: 0;
  bottom: calc(100% + 4px);
  z-index: 6;
  padding: 2px 6px;
  border: 1px solid color-mix(in srgb, var(--status-waiting) 40%, var(--border));
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--status-waiting);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  line-height: 1.2;
  letter-spacing: 0.02em;
  white-space: nowrap;
  pointer-events: none;
}
.extras-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}
.extras-btn.on {
  color: var(--text);
}
.extras-btn.off {
  color: var(--status-waiting);
  border-color: color-mix(in srgb, var(--status-waiting) 40%, var(--border));
}
.extras-btn:hover {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--panel-bg-raised);
}
.sec-badge {
  max-width: 56px;
  height: 18px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--status-waiting);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.sec-badge.elevated {
  color: var(--status-error);
  border-color: color-mix(in srgb, var(--status-error) 40%, var(--border));
}
.usage-badge {
  max-width: 88px;
  height: 18px;
  padding: 0 4px;
  border: 1px solid color-mix(in srgb, var(--status-waiting) 45%, var(--border));
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--status-waiting);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.usage-badge.exhausted {
  color: var(--status-error);
  border-color: color-mix(in srgb, var(--status-error) 45%, var(--border));
}
.model-btn {
  max-width: 72px;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  line-height: 1;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-btn.unset {
  color: var(--text-faint);
}
.model-btn:hover,
.model-btn.open {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--panel-bg-raised);
}
</style>

<!-- Teleported menu is outside the node; unscoped under a unique class is fine. -->
<style>
.model-menu {
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-strong);
  padding: 4px;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
}
.model-menu .model-menu-head {
  flex: 0 0 auto;
  padding: 4px 8px 2px;
  color: var(--text-faint);
}
.model-menu .model-item {
  display: block;
  flex: 0 0 auto;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 6px 9px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.3;
  color: var(--text-dim);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-menu .model-item:hover:not(:disabled) {
  background: var(--input-bg);
  color: var(--text);
}
.model-menu .model-item.current,
.model-menu .model-item:disabled {
  opacity: 0.5;
  cursor: default;
}
.model-menu .model-empty {
  flex: 0 0 auto;
  padding: 8px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-faint);
}
</style>
