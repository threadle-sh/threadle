<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { AgentDef, SessionRef } from "@threadle/shared";
import { isSessionLive } from "@threadle/shared";
import {
  VueFlow,
  Handle,
  Position,
  useVueFlow,
  type Edge,
  type Node,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { basename, shortId } from "@/lib/format";
import { providerColor, providerShort } from "@/lib/providers";
import { useSessionsStore } from "@/stores/sessions";
import SessionLivePill from "@/panels/SessionLivePill.vue";
import { useJobPhases } from "@/lib/useJobPhases";

const INST_CAP = 8;
const COL_DEF = 40;
const COL_PARENT = 340;
const COL_SUB = 680;
const ROW_H = 100;
const DEF_GAP = 48;
const DEF_H = 72;

const RANGES = [
  { id: "24h", label: "24h", ms: 24 * 3_600_000 },
  { id: "7d", label: "7d", ms: 7 * 24 * 3_600_000 },
  { id: "30d", label: "30d", ms: 30 * 24 * 3_600_000 },
  { id: "all", label: "all", ms: Infinity },
] as const;

type GraphRangeId = (typeof RANGES)[number]["id"];

export type GraphPick =
  | { kind: "def"; agent: AgentDef }
  | { kind: "run"; session: SessionRef };

const props = defineProps<{
  agents: AgentDef[];
  instances: SessionRef[];
  filter: string;
  providerFilter: string;
  pickedDef?: AgentDef;
  pickedRun?: SessionRef;
}>();

const emit = defineEmits<{
  pick: [GraphPick];
  "open-run": [SessionRef];
  "more-runs": [AgentDef];
  clear: [];
  "ctx-def": [payload: { event: MouseEvent; agent: AgentDef }];
  "ctx-run": [payload: { event: MouseEvent; session: SessionRef }];
}>();

const sessions = useSessionsStore();
const { phaseForSession } = useJobPhases();
const { fitView } = useVueFlow({ id: "agents-graph" });
const hoverId = ref<string>();
const range = ref<GraphRangeId>("all");
const paneCtx = ref<{ x: number; y: number }>();
let paneCtxIgnore = false;

function isSubRun(s: SessionRef): boolean {
  return s.kind === "subagent-run" || !!s.parentId;
}

function runKey(s: SessionRef): string {
  return `run:${s.provider}:${s.id}`;
}

function defKey(a: AgentDef): string {
  return `def:${a.provider}:${a.name}`;
}

function mergedStatus(s: SessionRef): SessionRef["status"] {
  return sessions.find(s.provider, s.id)?.status ?? s.status;
}

function liveOf(s: SessionRef): boolean {
  return isSessionLive(mergedStatus(s));
}

type Built = {
  nodes: Node[];
  edges: Edge[];
  empty: boolean;
};

const built = computed<Built>(() => {
  // Track live status merges from the sessions store so run dots update
  void sessions.sessions.map((s) => `${s.provider}:${s.id}:${s.status}`).join("|");

  const q = props.filter.trim().toLowerCase();
  const pf = props.providerFilter;

  function instanceMatches(s: SessionRef, a?: AgentDef): boolean {
    if (pf && pf !== "all" && s.provider !== pf) return false;
    const rangeSpec = RANGES.find((r) => r.id === range.value) ?? RANGES[3];
    if (rangeSpec.ms !== Infinity) {
      const cutoff = Date.now() - rangeSpec.ms;
      if (!s.updatedAt || s.updatedAt < cutoff) return false;
    }
    if (!q) return true;
    const hay = [
      s.title ?? "",
      s.id,
      s.agent ?? "",
      s.projectDir ?? "",
      a?.name ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function defMatches(a: AgentDef): boolean {
    if (pf && pf !== "all" && a.provider !== pf) return false;
    if (!q) return true;
    if (
      a.name.toLowerCase().includes(q) ||
      (a.description ?? "").toLowerCase().includes(q) ||
      a.provider.toLowerCase().includes(q)
    ) {
      return true;
    }
    return props.instances.some(
      (s) =>
        s.provider === a.provider &&
        s.agent?.toLowerCase() === a.name.toLowerCase() &&
        instanceMatches(s, a),
    );
  }

  const catalogDefs = props.agents.filter(defMatches);
  // Instance agent tags often don't match catalog names (Cursor explore/generalPurpose
  // vs agent/plan/ask; Grok grok-build-plan vs grok). Synthesize def nodes for those.
  const seenKeys = new Set(
    catalogDefs.map((a) => `${a.provider}:${a.name.toLowerCase()}`),
  );
  const syntheticDefs: AgentDef[] = [];
  for (const s of props.instances) {
    if (!s.agent?.trim()) continue;
    if (!instanceMatches(s)) continue;
    const key = `${s.provider}:${s.agent.toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    syntheticDefs.push({
      provider: s.provider,
      name: s.agent,
      source: "session-tag",
      scope: "builtin",
      kind: "runtime",
      description: "From session agent tag (no matching catalog def)",
    });
  }
  const defs = [...catalogDefs, ...syntheticDefs].sort((a, b) => {
    const pc = a.provider.localeCompare(b.provider);
    if (pc !== 0) return pc;
    return a.name.localeCompare(b.name);
  });

  const instByKey = new Map<string, SessionRef>();
  for (const s of props.instances) {
    instByKey.set(`${s.provider}:${s.id}`, s);
  }

  // Parent stubs from main session list when child points outside instances
  for (const s of props.instances) {
    if (!s.parentId) continue;
    const pk = `${s.provider}:${s.parentId}`;
    if (instByKey.has(pk)) continue;
    const parent = sessions.find(s.provider, s.parentId);
    if (parent) instByKey.set(pk, parent);
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const placedRuns = new Set<string>();
  let defY = 0;

  for (const a of defs) {
    const allForDef = [...instByKey.values()]
      .filter(
        (s) =>
          s.provider === a.provider &&
          s.agent?.toLowerCase() === a.name.toLowerCase() &&
          instanceMatches(s, a),
      )
      .sort((x, y) => {
        const lx = liveOf(x) ? 1 : 0;
        const ly = liveOf(y) ? 1 : 0;
        if (lx !== ly) return ly - lx;
        return y.updatedAt - x.updatedAt;
      });

    const liveOnes = allForDef.filter(liveOf);
    const rest = allForDef.filter((s) => !liveOf(s));
    const capped = [
      ...liveOnes,
      ...rest.slice(0, Math.max(0, INST_CAP - liveOnes.length)),
    ];
    const overflow = Math.max(0, allForDef.length - capped.length);
    const liveCount = liveOnes.length;

    const dk = defKey(a);
    nodes.push({
      id: dk,
      type: "ag-def",
      position: { x: COL_DEF, y: defY },
      data: {
        agent: a,
        liveCount,
        overflow,
        picked:
          props.pickedDef?.provider === a.provider &&
          props.pickedDef?.name === a.name,
      },
      draggable: false,
      selectable: false,
    });

    const parents = capped.filter((s) => !isSubRun(s));
    const subs = capped.filter((s) => isSubRun(s));
    /** Parent-column node ids belonging to this def (for uses edges) */
    const colParentIds = new Set<string>();

    function ensureParentNode(parent: SessionRef, y: number): string {
      const pid = runKey(parent);
      if (!nodes.some((n) => n.id === pid)) {
        nodes.push({
          id: pid,
          type: "ag-run",
          position: { x: COL_PARENT, y },
          data: {
            session: parent,
            status: mergedStatus(parent),
            live: liveOf(parent),
            sub: false,
            stub: !parents.some((p) => runKey(p) === pid),
            picked:
              props.pickedRun?.provider === parent.provider &&
              props.pickedRun?.id === parent.id,
          },
          draggable: false,
          selectable: false,
        });
        placedRuns.add(pid);
      }
      colParentIds.add(pid);
      return pid;
    }

    let py = defY;
    for (const s of parents) {
      ensureParentNode(s, py);
      py += ROW_H;
    }

    let sy = defY;
    for (const s of subs) {
      const rk = runKey(s);
      placedRuns.add(rk);
      let parentNodeId: string | undefined;
      if (s.parentId) {
        const pk = `${s.provider}:${s.parentId}`;
        const parent = instByKey.get(pk);
        if (parent) parentNodeId = ensureParentNode(parent, sy);
      }

      nodes.push({
        id: rk,
        type: "ag-run",
        position: { x: COL_SUB, y: sy },
        data: {
          session: s,
          status: mergedStatus(s),
          live: liveOf(s),
          sub: true,
          picked:
            props.pickedRun?.provider === s.provider &&
            props.pickedRun?.id === s.id,
        },
        draggable: false,
        selectable: false,
      });
      if (parentNodeId) {
        edges.push({
          id: `sub-${parentNodeId}-${rk}`,
          source: parentNodeId,
          target: rk,
          class: "edge-child",
        });
      } else {
        edges.push({
          id: `uses-${dk}-${rk}`,
          source: dk,
          target: rk,
          class: "edge-child",
        });
      }
      sy += ROW_H;
    }

    // Always link def → every parent-column node for this agent
    for (const pid of colParentIds) {
      edges.push({
        id: `uses-${dk}-${pid}`,
        source: dk,
        target: pid,
        class: "edge-child",
      });
    }

    const blockH = Math.max(
      DEF_H,
      colParentIds.size * ROW_H,
      subs.length * ROW_H,
      1 * ROW_H,
    );
    defY += blockH + DEF_GAP;
  }

  // Deduplicate edges by id
  const seenE = new Set<string>();
  const uniqEdges = edges.filter((e) => {
    if (seenE.has(e.id)) return false;
    seenE.add(e.id);
    return true;
  });

  return {
    nodes,
    edges: uniqEdges,
    empty: !defs.length,
  };
});

/** Sticky selection from aside pick; hover previews a different focus */
const focusId = computed(() => {
  if (hoverId.value) return hoverId.value;
  if (props.pickedRun) return runKey(props.pickedRun);
  if (props.pickedDef) return defKey(props.pickedDef);
  return undefined;
});

const related = computed(() => {
  const id = focusId.value;
  if (!id) return null;
  const set = new Set<string>([id]);
  for (const e of built.value.edges) {
    if (e.source === id || e.target === id) {
      set.add(e.source);
      set.add(e.target);
    }
  }
  // one hop further for def→run→sub
  for (const e of built.value.edges) {
    if (set.has(e.source) || set.has(e.target)) {
      set.add(e.source);
      set.add(e.target);
    }
  }
  return set;
});

const displayEdges = computed((): Edge[] => {
  const focus = focusId.value;
  const rel = related.value;
  return built.value.edges.map((e) => {
    // Direct edges on the focused node, plus any edge fully inside the related
    // neighborhood (keeps def → parent visible when a parent/sub is selected).
    const incident = !!focus && (e.source === focus || e.target === focus);
    const inNeighborhood = !!rel && rel.has(e.source) && rel.has(e.target);
    const onPath = incident || inNeighborhood;
    const classes = ["edge-child"];
    if (rel) classes.push(onPath ? "ag-edge-hi" : "ag-edge-dim");
    return {
      ...e,
      class: classes.join(" "),
      animated: false,
    };
  });
});

function isDimmed(id: string): boolean {
  const rel = related.value;
  if (!rel) return false;
  return !rel.has(id);
}

watch(
  () =>
    [
      props.providerFilter,
      props.filter,
      range.value,
      built.value.nodes.map((n) => n.id).join("\0"),
      built.value.edges.map((e) => e.id).join("\0"),
    ].join("|"),
  async () => {
    await nextTick();
    // Vue Flow often needs a frame after node swap before fit measures correctly
    requestAnimationFrame(() => {
      try {
        fitView({ padding: 0.2, duration: 180, maxZoom: 1.2 });
      } catch {
        /* flow may not be ready */
      }
    });
  },
);

function fitAll(): void {
  fitView({ padding: 0.2, duration: 260 });
}

function onPaneClick(): void {
  hoverId.value = undefined;
  paneCtx.value = undefined;
  emit("clear");
}

function placePaneCtx(e: MouseEvent): { x: number; y: number } {
  const pad = 8;
  const mw = 200;
  const mh = 160;
  return {
    x: Math.min(e.clientX, window.innerWidth - mw - pad),
    y: Math.min(e.clientY, window.innerHeight - mh - pad),
  };
}

function onPaneCtx(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  paneCtxIgnore = true;
  paneCtx.value = placePaneCtx(e);
  requestAnimationFrame(() => {
    paneCtxIgnore = false;
  });
}

function onNodeCtx(payload: { event: MouseEvent | TouchEvent; node: Node }): void {
  const e = payload.event;
  if (!("clientX" in e)) return;
  e.preventDefault();
  e.stopPropagation();
  paneCtx.value = undefined;
  const n = payload.node;
  const me = e as MouseEvent;
  if (n.type === "ag-def" && n.data?.agent) {
    const agent = n.data.agent as AgentDef;
    emit("pick", { kind: "def", agent });
    emit("ctx-def", { event: me, agent });
  } else if (n.type === "ag-run" && n.data?.session) {
    const session = n.data.session as SessionRef;
    emit("pick", { kind: "run", session });
    emit("ctx-run", { event: me, session });
  }
}

function paneMenuAction(fn: () => void): void {
  try {
    fn();
  } finally {
    paneCtx.value = undefined;
  }
}

function dismissPaneCtx(e: MouseEvent): void {
  if (paneCtxIgnore || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".ag-pane-ctx")) paneCtx.value = undefined;
}

onMounted(() => {
  document.addEventListener("click", dismissPaneCtx);
  document.addEventListener("contextmenu", dismissPaneCtx);
});
onUnmounted(() => {
  document.removeEventListener("click", dismissPaneCtx);
  document.removeEventListener("contextmenu", dismissPaneCtx);
});

function onDefClick(a: AgentDef): void {
  emit("pick", { kind: "def", agent: a });
}

function onRunClick(s: SessionRef): void {
  emit("pick", { kind: "run", session: s });
}

function onRunDbl(s: SessionRef): void {
  emit("open-run", s);
}

function onMore(a: AgentDef): void {
  emit("more-runs", a);
}

function onNodeClick(payload: { node: Node }): void {
  const n = payload.node;
  if (n.type === "ag-def" && n.data?.agent) onDefClick(n.data.agent as AgentDef);
  else if (n.type === "ag-run" && n.data?.session) onRunClick(n.data.session as SessionRef);
}

function onNodeDbl(payload: { node: Node }): void {
  const n = payload.node;
  if (n.type === "ag-run" && n.data?.session) onRunDbl(n.data.session as SessionRef);
}

defineExpose({ fitAll });
</script>

<template>
  <div class="ag-graph">
    <div class="ag-graph-toolbar chip-row">
      <button
        v-for="r in RANGES"
        :key="r.id"
        type="button"
        class="filter-chip"
        :class="{ active: range === r.id }"
        :title="
          r.ms === Infinity
            ? 'Show all instances'
            : `Instances updated within the last ${r.label}`
        "
        @click="range = r.id"
      >
        {{ r.label }}
      </button>
      <button
        type="button"
        class="filter-chip"
        title="Fit the full graph in view"
        @click="fitAll"
      >
        ⊡ fit
      </button>
      <span class="ag-graph-hint mono micro-label">
        defs → instances → subs
      </span>
    </div>
    <div class="ag-graph-body">
      <div class="ag-graph-canvas">
        <VueFlow
          :key="`ag-flow-${providerFilter}-${range}`"
          id="agents-graph"
          :nodes="built.nodes"
          :edges="displayEdges"
          :nodes-connectable="false"
          :edges-updatable="false"
          :nodes-draggable="false"
          fit-view-on-init
          :min-zoom="0.12"
          :max-zoom="1.4"
          @pane-click="onPaneClick"
          @pane-context-menu="onPaneCtx"
          @node-click="onNodeClick"
          @node-double-click="onNodeDbl"
          @node-context-menu="onNodeCtx"
          @node-mouse-enter="(p) => (hoverId = p.node.id)"
          @node-mouse-leave="hoverId = undefined"
        >
          <Background
            id="ag-grid-minor"
            variant="lines"
            :gap="10"
            :line-width="1"
            color="var(--grid-line)"
          />
          <Background
            id="ag-grid-major"
            variant="lines"
            :gap="100"
            :line-width="1"
            color="var(--grid-line-major)"
          />
          <Controls position="bottom-left" />

          <template #node-ag-def="{ id, data }">
            <div
              class="ag-node ag-def"
              :class="{
                dimmed: isDimmed(id),
                sel: data.picked,
                live: data.liveCount > 0,
              }"
            >
              <Handle
                type="source"
                :position="Position.Right"
                class="ag-handle"
                :style="{ borderColor: providerColor(data.agent.provider) }"
              />
              <div
                class="ag-tile"
                :style="{ background: providerColor(data.agent.provider) }"
              >
                <span class="ag-glyph">⟨/⟩</span>
                <span
                  v-if="data.liveCount"
                  class="ag-live-mark"
                  :title="`${data.liveCount} live`"
                />
              </div>
              <div class="ag-body">
                <div class="ag-name mono" :title="data.agent.name">
                  {{ data.agent.name }}
                </div>
                <div class="ag-meta mono">
                  {{ providerShort(data.agent.provider) }}
                  <span v-if="data.agent.kind === 'runtime'" class="dim">· session tag</span>
                  <span v-else-if="data.agent.scope" class="dim">· {{ data.agent.scope }}</span>
                  <span v-if="data.liveCount" class="ag-live">● {{ data.liveCount }} live</span>
                </div>
                <button
                  v-if="data.overflow"
                  type="button"
                  class="ag-more mono"
                  @click.stop="onMore(data.agent)"
                >
                  +{{ data.overflow }} more
                </button>
              </div>
            </div>
          </template>

          <template #node-ag-run="{ id, data }">
            <div
              class="ag-node ag-run"
              :class="{
                dimmed: isDimmed(id),
                sel: data.picked,
                live: data.live,
                sub: data.sub,
                stub: data.stub,
              }"
            >
              <Handle
                type="target"
                :position="Position.Left"
                class="ag-handle"
                :style="{ borderColor: providerColor(data.session.provider) }"
              />
              <Handle
                type="source"
                :position="Position.Right"
                class="ag-handle"
                :style="{ borderColor: providerColor(data.session.provider) }"
              />
              <div
                class="ag-tile"
                :style="{ background: providerColor(data.session.provider) }"
              >
                <span class="ag-glyph">{{ data.sub ? "⎇" : "❯" }}</span>
                <span
                  v-if="data.live"
                  class="ag-live-mark"
                  :class="data.status"
                  :title="data.status"
                />
                <span
                  v-else
                  class="status-dot ag-status"
                  :class="data.status"
                />
              </div>
              <div class="ag-body">
                <div
                  class="ag-name"
                  :title="data.session.title ?? data.session.id"
                >
                  {{ data.session.title ?? shortId(data.session.id) }}
                </div>
                <div class="ag-meta mono">
                  <SessionLivePill
                    :status="data.status"
                    :phase="phaseForSession(data.session.provider, data.session.id)"
                  />
                  <span class="ag-meta-rest">
                    <template v-if="data.sub && data.session.parentId">
                      ↑ {{ shortId(data.session.parentId) }}
                    </template>
                    <template v-else>
                      {{ shortId(data.session.id) }}
                      <span v-if="data.session.projectDir" class="dim">
                        · {{ basename(data.session.projectDir) }}
                      </span>
                    </template>
                    <span v-if="data.session.agent" class="dim">
                      · ⟨/⟩ {{ data.session.agent }}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </template>
        </VueFlow>

        <div v-if="built.empty" class="ag-empty mono">
          no agents match these filters
        </div>
      </div>
      <slot name="aside" />
    </div>

    <Teleport to="body">
      <div
        v-if="paneCtx"
        class="menu-pop wf-folder-ctx ag-pane-ctx"
        :style="{ left: paneCtx.x + 'px', top: paneCtx.y + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <button
          type="button"
          class="menu-item"
          @click="paneMenuAction(() => fitAll())"
        >
          <span class="menu-glyph">⊡</span> Fit graph
        </button>
        <button
          type="button"
          class="menu-item"
          @click="
            paneMenuAction(() => {
              emit('clear');
            })
          "
        >
          <span class="menu-glyph">✕</span> Clear selection
        </button>
        <button
          type="button"
          class="menu-item"
          :class="{ toggled: range === '24h' }"
          @click="paneMenuAction(() => (range = '24h'))"
        >
          <span class="menu-glyph">◷</span> Range 24h
        </button>
        <button
          type="button"
          class="menu-item"
          :class="{ toggled: range === '7d' }"
          @click="paneMenuAction(() => (range = '7d'))"
        >
          <span class="menu-glyph">◷</span> Range 7d
        </button>
        <button
          type="button"
          class="menu-item"
          :class="{ toggled: range === '30d' }"
          @click="paneMenuAction(() => (range = '30d'))"
        >
          <span class="menu-glyph">◷</span> Range 30d
        </button>
        <button
          type="button"
          class="menu-item"
          :class="{ toggled: range === 'all' }"
          @click="paneMenuAction(() => (range = 'all'))"
        >
          <span class="menu-glyph">◷</span> Range all
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ag-graph {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ag-graph-toolbar {
  flex-shrink: 0;
  align-items: center;
}
.ag-graph-hint {
  color: var(--text-faint);
}
.ag-graph-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
  align-items: stretch;
}
.ag-graph-canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 420px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg);
}
.ag-graph-canvas :deep(.vue-flow__node) {
  pointer-events: all;
}
.ag-graph-canvas :deep(.vue-flow__edges) {
  pointer-events: none;
}
.ag-graph-canvas :deep(.vue-flow__edge.ag-edge-hi .vue-flow__edge-path) {
  stroke: var(--text-dim) !important;
  stroke-width: 1.75;
  opacity: 0.9;
  stroke-dasharray: none;
}
.ag-graph-canvas :deep(.vue-flow__edge.ag-edge-dim .vue-flow__edge-path) {
  opacity: 0.14;
  stroke-width: 1;
}
.ag-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: var(--fs-sm);
  pointer-events: none;
}
.ag-node {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
  max-width: 280px;
  padding: 8px 10px 8px 8px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  box-shadow: var(--shadow);
}
.ag-node.sel {
  border-color: var(--border-strong);
  outline: 1px solid var(--accent);
}
.ag-node.live {
  border-color: color-mix(in srgb, var(--status-live, #3ecf8e) 55%, var(--border));
  box-shadow:
    var(--shadow),
    0 0 0 1px color-mix(in srgb, var(--status-live, #3ecf8e) 35%, transparent);
}
.ag-node.dimmed {
  opacity: 0.28;
}
.ag-node.stub {
  opacity: 0.7;
  border-style: dashed;
}
.ag-tile {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #000;
}
.ag-glyph {
  font-size: var(--fs-sm);
  line-height: 1;
}
.ag-status {
  position: absolute;
  right: -3px;
  bottom: -3px;
}
.ag-live-mark {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--status-live, #3ecf8e);
  border: 2px solid var(--panel-bg);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-live, #3ecf8e) 55%, transparent);
  animation: ag-live-pulse 1.4s ease-out infinite;
}
.ag-live-mark.running {
  background: var(--status-running);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-running) 55%, transparent);
  animation-name: ag-run-pulse;
}
.ag-live-mark.waiting {
  background: var(--status-waiting);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-waiting) 55%, transparent);
  animation-name: ag-wait-pulse;
  animation-duration: 1.1s;
}
@keyframes ag-live-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-live, #3ecf8e) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 6px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
@keyframes ag-run-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-running) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 6px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
@keyframes ag-wait-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-waiting) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 6px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
.ag-body {
  min-width: 0;
  flex: 1;
}
.ag-name {
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ag-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
}
.ag-meta-rest {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ag-meta .session-live-pill {
  height: 16px;
  padding: 0 5px;
  font-size: 9px;
  letter-spacing: 0.04em;
}
.ag-meta .dim {
  color: var(--text-faint);
}
.ag-live {
  color: var(--status-live, #3ecf8e);
  animation: pulse 1.4s ease-in-out infinite;
}
.ag-more {
  appearance: none;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-xs);
  padding: 0;
  margin-top: 2px;
}
.ag-more:hover {
  color: var(--text);
}
.ag-handle {
  width: 8px !important;
  height: 8px !important;
  background: var(--panel-bg) !important;
}
</style>
