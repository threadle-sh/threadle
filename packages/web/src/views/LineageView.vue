<template>
  <div class="lineage-page">
    <DashNav :items="navItems" active="lineage" @select="onNav" />
    <div class="lineage-main">
      <div class="lin-chrome">
        <header class="dash-head">
          <div>
            <h1 class="dash-title">Lineage</h1>
          </div>
          <div class="view-controls">
            <ProviderFilterChips
              v-model="providerFilter"
              :options="providerFilterChips"
            />
          </div>
        </header>

        <div class="dash-toolbar lin-toolbar">
          <input
            v-model="query"
            class="threadle-input dash-search"
            placeholder="Search context contents…"
            spellcheck="false"
          />
          <div class="chip-row">
            <button
              v-for="kf in KIND_FILTERS"
              :key="'k-' + kf.id"
              class="filter-chip"
              :class="{ active: kindFilter === kf.id }"
              @click="kindFilter = kf.id"
            >
              {{ kf.label }}
            </button>
            <button
              v-if="orphanCount"
              class="filter-chip"
              :class="{ active: showUnused }"
              :title="
                showUnused
                  ? 'Hide payloads that were never injected'
                  : `Show unused payloads (${unusedMatchingCount} match current filters · ${orphanCount} total)`
              "
              @click="toggleUnused(false)"
            >
              unused{{ showUnused ? "" : ` · ${unusedMatchingCount || orphanCount}` }}
            </button>
          </div>
          <div class="chip-row">
            <button
              class="filter-chip"
              title="Fit the full graph in view"
              @click="fitAll"
            >⊡ fit</button>
            <button
              v-if="threadRootId"
              class="filter-chip"
              title="Zoom to the focused / selected thread"
              @click="fitToThread"
            >◎ thread</button>
            <button
              v-if="focusNodeId"
              class="filter-chip active"
              title="Clear focus and show the full graph"
              @click="clearFocus"
            >clear focus</button>
          </div>
        </div>
      </div>

      <div class="lin-body-row">
        <div class="lin-canvas">
          <VueFlow
            id="lineage"
            :nodes="nodes"
            :edges="edges"
            :nodes-connectable="false"
            fit-view-on-init
            :min-zoom="0.15"
            @pane-click="onPaneClick"
          >
            <Background id="grid-minor" variant="lines" :gap="10" :line-width="1" color="var(--grid-line)" />
            <Background id="grid-major" variant="lines" :gap="100" :line-width="1" color="var(--grid-line-major)" />
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              :node-color="miniColor"
              mask-color="rgba(35, 36, 51, 0.75)"
            />
            <template #node-lin-session="{ id, data }">
              <div
                class="lin-node"
                :class="{ dimmed: isDimmed(id), sel: selected?.id === id }"
                @click.stop="pickSession(id, data)"
                @contextmenu.prevent.stop="onSessionCtx($event, id, data)"
              >
                <Handle
                  type="target"
                  :position="Position.Left"
                  class="lin-handle"
                  :style="{ borderColor: provColor(data.provider) }"
                />
                <div class="lin-tile" :style="{ background: provColor(data.provider) }">
                  <span class="lin-tile-glyph">❯</span>
                </div>
                <div class="lin-body">
                  <div class="lin-name" :title="data.title ?? data.sessionId">
                    {{ data.title ?? shortId(data.sessionId) }}
                  </div>
                  <div class="lin-meta mono">
                    {{ providerShort(data.provider) }}
                    <span
                      v-if="runsFor(data.provider, data.sessionId).length"
                      class="lin-wf-badge"
                      :title="`touched by ${runsFor(data.provider, data.sessionId).length} threadle run(s)`"
                    >workflow</span>
                  </div>
                </div>
                <Handle
                  type="source"
                  :position="Position.Right"
                  class="lin-handle"
                  :style="{ borderColor: provColor(data.provider) }"
                />
              </div>
            </template>
            <template #node-lin-payload="{ id, data }">
              <div
                class="lin-node lin-payload"
                :class="{
                  dimmed: isDimmed(id),
                  sel: selected?.id === id,
                  hit: matchedHashes?.has(data.hash),
                }"
                @click.stop="pickPayload(id, data)"
                @contextmenu.prevent.stop="onPayloadCtx($event, id, data)"
              >
                <Handle
                  type="target"
                  :position="Position.Left"
                  class="lin-handle lin-handle-context"
                />
                <div class="lin-tile" style="background: var(--context)">
                  <span class="lin-tile-glyph">❝</span>
                </div>
                <div class="lin-body">
                  <div class="lin-preview" :title="data.preview">
                    {{ data.preview || "(empty payload)" }}
                  </div>
                  <div class="lin-meta mono">
                    {{ KIND_SHORT[data.kind] ?? data.kind }} · {{ fmtChars(data.chars) }} ·
                    {{ relativeTime(data.createdAt) }} · {{ shortSource(data) }}
                  </div>
                </div>
                <Handle
                  type="source"
                  :position="Position.Right"
                  class="lin-handle lin-handle-context"
                />
              </div>
            </template>
          </VueFlow>

          <GraphLoadingOverlay
            :loading="loading"
            label="Loading lineage"
          />
          <template v-if="!loading">
            <div v-if="!allPayloads.length" class="lin-overlay lin-overlay-msg">
              no payloads yet — extract or distill context from a session first
            </div>
            <div v-else-if="!visiblePayloads.length" class="lin-overlay lin-overlay-msg">
              <template v-if="!showUnused && orphanCount && !query.trim()">
                no handoffs match these filters —
                <button
                  v-if="unusedMatchingCount"
                  class="lin-inline-btn"
                  @click="toggleUnused(false)"
                >
                  show {{ unusedMatchingCount }} unused
                </button>
                <template v-if="unusedMatchingCount && unusedMatchingCount < orphanCount"> · </template>
                <button
                  v-if="!unusedMatchingCount || unusedMatchingCount < orphanCount"
                  class="lin-inline-btn"
                  @click="toggleUnused(true)"
                >
                  show all {{ orphanCount }} unused
                </button>
              </template>
              <template v-else>no payloads match the current filters</template>
            </div>
            <div v-else-if="query.trim() && matchedHashes && !matchedHashes.size" class="lin-nores mono">
              no context matches "{{ query }}"
            </div>
          </template>
        </div>

        <aside v-if="selected" class="lin-detail">
          <div class="lin-detail-head">
            <span class="lin-detail-title">
              {{ selected.type === "payload" ? (KIND_SHORT[selected.payload!.kind] ?? selected.payload!.kind) : (selected.title ?? "session") }}
            </span>
            <button class="ap-close" @click="selected = undefined">✕</button>
          </div>

          <template v-if="selected.type === 'payload'">
            <div class="run-kv mono">
              <span class="run-key">hash</span><span class="run-val">{{ selected.payload!.hash.slice(0, 16) }}…</span>
              <span class="run-key">kind</span><span class="run-val">{{ selected.payload!.kind }}</span>
              <span class="run-key">size</span><span class="run-val">{{ fmtChars(selected.payload!.chars) }} chars</span>
              <span class="run-key">created</span><span class="run-val">{{ new Date(selected.payload!.createdAt).toLocaleString() }}</span>
              <span class="run-key">from</span><span class="run-val">{{ sourceTitle(selected.payload!) }}</span>
              <template v-if="orphanHashes.has(selected.payload!.hash)">
                <span class="run-key">status</span><span class="run-val">never injected</span>
              </template>
            </div>
            <div class="lin-actions">
              <button
                class="vsc-btn"
                title="Open"
                @click="
                  void fileViewers.openPayload({
                    hash: selected.payload!.hash,
                    name: selected.payload!.preview || selected.payload!.kind,
                  })
                "
              >
                ⧉ open
              </button>
              <button class="vsc-btn" @click="openBlueprint(selected.payload!.source)">⌗ blueprint</button>
              <a class="vsc-btn" :href="`/api/payloads/${selected.payload!.hash}`" target="_blank">⇓ raw</a>
              <button
                v-if="injectsOf(selected.payload!.hash)[0]?.result?.sessionId"
                class="vsc-btn"
                @click="diffHandoff(selected.payload!, injectsOf(selected.payload!.hash)[0]!)"
              >
                ⇆ diff
              </button>
            </div>
            <div v-if="injectsOf(selected.payload!.hash).length" class="lin-injlist">
              <div class="micro-label">injected into</div>
              <button
                v-for="(inj, ii) in injectsOf(selected.payload!.hash)"
                :key="ii"
                class="lin-inj mono"
                @click="inj.result && openBlueprint({ provider: inj.result.provider, sessionId: inj.result.sessionId })"
              >
                ⇄ {{ injTitle(inj) }}
                <em>{{ shortMode(inj.mode) }} · {{ relativeTime(inj.ts) }}</em>
              </button>
            </div>
            <div class="micro-label lin-content-label">content</div>
            <div v-if="contentLoading" class="lin-dim-sm">loading…</div>
            <pre v-else class="lin-content mono">{{ content }}</pre>
          </template>

          <template v-else>
            <div class="run-kv mono">
              <span class="run-key">provider</span><span class="run-val">{{ selected.provider }}</span>
              <span class="run-key">session</span><span class="run-val">{{ selected.sessionId }}</span>
            </div>
            <div class="lin-actions">
              <button
                class="vsc-btn"
                title="View the interactive message transcript"
                @click="fileViewers.openTranscript(selected.provider!, selected.sessionId!)"
              >
                ≡ transcript
              </button>
              <button
                class="vsc-btn"
                title="View the reconstructed model context"
                @click="void fileViewers.openContext(selected.provider!, selected.sessionId!)"
              >
                ❝ context
              </button>
              <button
                class="vsc-btn"
                @click="openBlueprint({ provider: selected.provider!, sessionId: selected.sessionId! })"
              >
                ⌗ blueprint
              </button>
              <button
                v-if="diffPeerFor(selected)"
                class="vsc-btn"
                @click="openDiff(
                  { provider: selected.provider!, sessionId: selected.sessionId! },
                  diffPeerFor(selected)!,
                )"
              >
                ⇆ diff
              </button>
            </div>
            <div v-if="runsFor(selected.provider, selected.sessionId).length" class="lin-injlist">
              <div class="micro-label">threadle runs</div>
              <button
                v-for="(r, ri) in runsFor(selected.provider, selected.sessionId)"
                :key="ri"
                class="lin-inj mono"
                @click="
                  r.graphId
                    ? router.push(`/graph/${r.graphId}`)
                    : router.push({ path: '/', query: { view: 'runs' } })
                "
              >
                ⌗ {{ r.label ?? r.kind }}
                <em>{{ r.kind }} · {{ relativeTime(r.ts) }}</em>
              </button>
            </div>
            <SessionInfoPanel
              class="lin-sip"
              :provider="selected.provider!"
              :session-id="selected.sessionId!"
            />
          </template>
        </aside>
      </div>
    <StatusBar />
    </div>

    <Teleport to="body">
      <div
        v-if="nodeCtx"
        class="menu-pop lin-node-ctx"
        :style="{ left: nodeCtx.x + 'px', top: nodeCtx.y + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <button
          v-for="(item, i) in nodeCtx.items"
          :key="i"
          type="button"
          class="menu-item"
          :disabled="item.disabled"
          @click="runCtxItem(item)"
        >
          <span class="menu-glyph">{{ item.glyph }}</span> {{ item.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { VueFlow, Handle, Position, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import type { Edge, Node } from "@vue-flow/core";
import DashNav from "@/panels/DashNav.vue";
import StatusBar from "@/panels/StatusBar.vue";
import SessionInfoPanel from "@/panels/SessionInfoPanel.vue";
import { useNavItems } from "@/panels/useNavItems";
import { useSessionsStore } from "@/stores/sessions";
import { relativeTime, shortId } from "@/lib/format";
import {
  providerColor,
  providerColorHex,
  providerShort,
  type SessionFilter,
} from "@/lib/providers";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import { useFileViewersStore } from "@/stores/fileViewers";
import "@/views/dashboard/chrome.css";

interface LineagePayload {
  hash: string;
  kind: string;
  createdAt: number;
  chars: number;
  preview: string;
  source: { provider: string; sessionId: string };
}

const KIND_SHORT: Record<string, string> = {
  "distilled-summary": "distilled",
  "transcript-excerpt": "excerpt",
  files: "files",
};
interface LineageInject {
  ts: number;
  payloadHash: string;
  mode: string;
  target: { provider: string; sessionId?: string };
  result?: { provider: string; sessionId: string };
}

const KIND_FILTERS = [
  { id: "all", label: "all" },
  { id: "distilled-summary", label: "distilled" },
  { id: "transcript-excerpt", label: "excerpts" },
  { id: "files", label: "files" },
] as const;

const router = useRouter();
const route = useRoute();
const sessions = useSessionsStore();
const fileViewers = useFileViewersStore();
const navItems = useNavItems();
sessions.ensureHydrated();

const { fitView } = useVueFlow({ id: "lineage" });

const loading = ref(true);
const allPayloads = ref<LineagePayload[]>([]);
const allInjects = ref<LineageInject[]>([]);
interface RunSession {
  provider: string;
  sessionId: string;
  kind: string;
  label?: string;
  graphId?: string;
  ts: number;
}
const runSessions = ref<RunSession[]>([]);
const runKey = (p: string, id: string) => `${p}:${id}`;
const runTouched = computed(() => {
  const m = new Map<string, RunSession[]>();
  for (const r of runSessions.value) {
    const k = runKey(r.provider, r.sessionId);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
});
function runsFor(provider?: string, sessionId?: string): RunSession[] {
  if (!provider || !sessionId) return [];
  return runTouched.value.get(runKey(provider, sessionId)) ?? [];
}

const kindFilter = ref<(typeof KIND_FILTERS)[number]["id"]>("all");
const providerFilter = ref<SessionFilter>("all");

const providerFilterChips = computed(() => sessions.sessionFilterChips);
watch(providerFilterChips, (chips) => {
  if (!chips.includes(providerFilter.value)) providerFilter.value = "all";
});

/** Unused = extracted but never injected. Hidden by default so the canvas shows real chains. */
const showUnused = ref(false);
const query = ref("");
const matchedHashes = ref<Set<string>>();
let searchTimer: ReturnType<typeof setTimeout> | undefined;

/** Locked thread from `?focus=` — selection alone also dims, but focus survives pane clicks. */
const focusNodeId = ref<string>();

const selected = ref<{
  id: string;
  type: "payload" | "session";
  payload?: LineagePayload;
  provider?: string;
  sessionId?: string;
  title?: string;
}>();
const content = ref("");
const contentLoading = ref(false);

interface CtxItem {
  glyph: string;
  label: string;
  run: () => void;
  disabled?: boolean;
}
const nodeCtx = ref<{ x: number; y: number; items: CtxItem[] }>();
let nodeCtxIgnoreClick = false;

const sessKey = (p: string, id: string) => `s:${p}:${id}`;

const injectedHashes = computed(() => new Set(allInjects.value.map((i) => i.payloadHash)));
const orphanHashes = computed(() => {
  const set = new Set<string>();
  for (const p of allPayloads.value) {
    if (!injectedHashes.value.has(p.hash)) set.add(p.hash);
  }
  return set;
});
const orphanCount = computed(() => orphanHashes.value.size);

/** Unused payloads that pass the current kind/provider filters. */
const unusedMatchingCount = computed(
  () =>
    allPayloads.value.filter((p) => {
      if (!orphanHashes.value.has(p.hash)) return false;
      if (kindFilter.value !== "all" && p.kind !== kindFilter.value) return false;
      if (providerFilter.value !== "all" && !payloadTouchesProvider(p, providerFilter.value)) {
        return false;
      }
      return true;
    }).length,
);

/**
 * @param all — if true (or nothing matches current filters), clear kind/provider so
 *   the promised unused count actually appears on the canvas.
 */
function toggleUnused(all: boolean): void {
  if (showUnused.value && !all) {
    showUnused.value = false;
    return;
  }
  showUnused.value = true;
  if (all || unusedMatchingCount.value === 0) {
    kindFilter.value = "all";
    providerFilter.value = "all";
  }
}

const payloadByHash = computed(() => {
  const m = new Map<string, LineagePayload>();
  for (const p of allPayloads.value) m.set(p.hash, p);
  return m;
});

function onNav(id: string): void {
  if (id === "lineage") return;
  if (id === "timeline") return void router.push("/timeline");
  if (id === "map") return void router.push("/map");
  void router.push({ path: "/", query: { view: id } });
}
function provColor(p: string): string {
  return providerColor(p);
}
function miniColor(n: { type?: string; data?: { provider?: string } }): string {
  if (n.type === "lin-payload") {
    // MiniMap fill needs a concrete color; match --wire-context / --context
    if (typeof document !== "undefined") {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--wire-context")
        .trim();
      if (v) return v;
    }
    return "#cfa93c";
  }
  if (n.data?.provider) return providerColorHex(n.data.provider);
  return "#888";
}
function fmtChars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
function shortMode(mode: string): string {
  if (mode === "new-session") return "new";
  if (mode === "continue") return "continue";
  if (mode === "workflow") return "workflow";
  if (mode.startsWith("handoff")) return "handoff";
  return mode.length > 14 ? `${mode.slice(0, 14)}…` : mode;
}
function openBlueprint(src: { provider: string; sessionId: string }): void {
  void router.push(`/blueprint/${src.provider}/${src.sessionId}?from=lineage`);
}
function openDiff(
  a: { provider: string; sessionId: string },
  b: { provider: string; sessionId: string },
): void {
  void router.push({
    path: "/diff",
    query: {
      a: `${a.provider}::${a.sessionId}`,
      b: `${b.provider}::${b.sessionId}`,
    },
  });
}
function diffHandoff(p: LineagePayload, inj: LineageInject): void {
  const to = inj.result;
  if (!to?.sessionId) return;
  openDiff(p.source, { provider: to.provider, sessionId: to.sessionId });
}
function sourceTitle(p: LineagePayload): string {
  const live = sessions.find(p.source.provider, p.source.sessionId);
  return live?.title ?? `${p.source.provider} · ${shortId(p.source.sessionId)}`;
}
function shortSource(p: LineagePayload): string {
  const live = sessions.find(p.source.provider, p.source.sessionId);
  const t = live?.title ?? shortId(p.source.sessionId);
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}
function injectsOf(hash: string): LineageInject[] {
  return allInjects.value.filter((i) => i.payloadHash === hash);
}
function injTitle(inj: LineageInject): string {
  const to = inj.result ?? { provider: inj.target.provider, sessionId: inj.target.sessionId ?? "" };
  const live = to.sessionId ? sessions.find(to.provider, to.sessionId) : undefined;
  return live?.title ?? `${to.provider} · ${shortId(to.sessionId)}`;
}

function diffPeerFor(
  sel: { type: string; provider?: string; sessionId?: string; id?: string },
): { provider: string; sessionId: string } | undefined {
  if (sel.type !== "session" || !sel.provider || !sel.sessionId || !sel.id) return undefined;
  const id = sel.id;
  for (const e of built.value.edges) {
    if (e.source === id && e.target.startsWith("p:")) {
      const next = built.value.edges.find((x) => x.source === e.target && x.target.startsWith("s:"));
      if (next) {
        const n = built.value.nodes.find((x) => x.id === next.target);
        const d = n?.data as { provider?: string; sessionId?: string } | undefined;
        if (d?.provider && d.sessionId) return { provider: d.provider, sessionId: d.sessionId };
      }
    }
    if (e.target === id && e.source.startsWith("p:")) {
      const prev = built.value.edges.find((x) => x.target === e.source && x.source.startsWith("s:"));
      if (prev) {
        const n = built.value.nodes.find((x) => x.id === prev.source);
        const d = n?.data as { provider?: string; sessionId?: string } | undefined;
        if (d?.provider && d.sessionId) return { provider: d.provider, sessionId: d.sessionId };
      }
    }
  }
  return undefined;
}

watch(query, (q) => {
  clearTimeout(searchTimer);
  if (!q.trim()) {
    matchedHashes.value = undefined;
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&doctype=payload&limit=100`,
      );
      const hits = ((await res.json()) as { results: Array<{ sessionId: string }> }).results;
      matchedHashes.value = new Set(hits.map((h) => h.sessionId));
    } catch {
      matchedHashes.value = new Set();
    }
  }, 250);
});

function payloadTouchesProvider(p: LineagePayload, provider: string): boolean {
  if (p.source.provider === provider) return true;
  return allInjects.value.some((inj) => {
    if (inj.payloadHash !== p.hash) return false;
    const to = inj.result ?? { provider: inj.target.provider };
    return to.provider === provider;
  });
}

const visiblePayloads = computed(() =>
  allPayloads.value.filter((p) => {
    if (kindFilter.value !== "all" && p.kind !== kindFilter.value) return false;
    if (providerFilter.value !== "all" && !payloadTouchesProvider(p, providerFilter.value)) return false;
    if (matchedHashes.value !== undefined && !matchedHashes.value.has(p.hash)) return false;
    // Search always reveals matches; otherwise unused stay off the canvas by default.
    if (!showUnused.value && orphanHashes.value.has(p.hash) && matchedHashes.value === undefined) {
      return false;
    }
    return true;
  }),
);

function isDimmed(id: string): boolean {
  return connectedIds.value !== undefined && !connectedIds.value.has(id);
}

const built = computed(() => {
  const ns = new Map<string, Node>();
  const es: Edge[] = [];
  const adj = new Map<string, string[]>();
  const edgeMeta = new Map<string, { cls: string; label: string }>();

  const addSession = (provider: string, sessionId: string): string => {
    const key = sessKey(provider, sessionId);
    if (!ns.has(key)) {
      const live = sessions.find(provider, sessionId);
      ns.set(key, {
        id: key,
        type: "lin-session",
        position: { x: 0, y: 0 },
        data: { provider, sessionId, title: live?.title },
      });
    }
    return key;
  };
  const link = (from: string, to: string, cls: string, label: string): void => {
    const id = `${from}→${to}`;
    es.push({ id, source: from, target: to, class: cls, type: "default" });
    edgeMeta.set(id, { cls, label });
    adj.set(from, [...(adj.get(from) ?? []), to]);
  };

  for (const p of visiblePayloads.value) {
    const pKey = `p:${p.hash}`;
    ns.set(pKey, { id: pKey, type: "lin-payload", position: { x: 0, y: 0 }, data: p });
    const sessId = addSession(p.source.provider, p.source.sessionId);
    // session → payload: same wire language as workflow session outs
    link(
      sessId,
      pKey,
      `src-session`,
      `extract · ${fmtChars(p.chars)}`,
    );
  }
  for (const inj of allInjects.value) {
    const pKey = `p:${inj.payloadHash}`;
    if (!ns.has(pKey)) continue;
    const to = inj.result ?? {
      provider: inj.target.provider,
      sessionId: inj.target.sessionId ?? "",
    };
    if (!to.sessionId) continue;
    const payload = payloadByHash.value.get(inj.payloadHash);
    // payload → session: same as workflow context outs; dash = inject role only
    link(
      pKey,
      addSession(to.provider, to.sessionId),
      "src-context lin-e-inject",
      `${shortMode(inj.mode)} · ${payload ? fmtChars(payload.chars) : "?"}`,
    );
  }

  const depth = new Map<string, number>();
  const indeg = new Map<string, number>();
  for (const id of ns.keys()) indeg.set(id, 0);
  for (const [, tos] of adj) for (const t of tos) indeg.set(t, (indeg.get(t) ?? 0) + 1);
  const queue = [...ns.keys()].filter((id) => !indeg.get(id));
  for (const id of queue) depth.set(id, 0);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const t of adj.get(cur) ?? []) {
      depth.set(t, Math.max(depth.get(t) ?? 0, (depth.get(cur) ?? 0) + 1));
      const d = (indeg.get(t) ?? 1) - 1;
      indeg.set(t, d);
      if (d <= 0) queue.push(t);
    }
  }
  const layers = new Map<number, string[]>();
  let maxDepth = 0;
  for (const id of ns.keys()) {
    const d = depth.get(id) ?? 0;
    maxDepth = Math.max(maxDepth, d);
    layers.set(d, [...(layers.get(d) ?? []), id]);
  }

  const preds = new Map<string, string[]>();
  for (const [from, tos] of adj) {
    for (const t of tos) preds.set(t, [...(preds.get(t) ?? []), from]);
  }

  const rowOf = new Map<string, number>();
  (layers.get(0) ?? []).forEach((id, i) => rowOf.set(id, i));
  for (let d = 1; d <= maxDepth; d++) {
    const ids = layers.get(d) ?? [];
    const bary = (id: string): number => {
      const ps = (preds.get(id) ?? []).map((p) => rowOf.get(p) ?? 0);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER;
    };
    ids.sort((a, b) => bary(a) - bary(b));
    ids.forEach((id, i) => rowOf.set(id, i));
  }
  const succs = adj;
  for (let d = maxDepth - 1; d >= 0; d--) {
    const ids = layers.get(d) ?? [];
    const bary = (id: string): number => {
      const ss = (succs.get(id) ?? []).map((sId) => rowOf.get(sId) ?? 0);
      return ss.length ? ss.reduce((a, b) => a + b, 0) / ss.length : (rowOf.get(id) ?? 0);
    };
    ids.sort((a, b) => bary(a) - bary(b));
    ids.forEach((id, i) => rowOf.set(id, i));
  }

  for (const n of ns.values()) {
    const d = depth.get(n.id) ?? 0;
    n.position = { x: d * 380, y: (rowOf.get(n.id) ?? 0) * 124 };
  }
  return { nodes: [...ns.values()], edges: es, edgeMeta };
});

const threadRootId = computed(() => focusNodeId.value ?? selected.value?.id);

const connectedIds = computed(() => {
  const root = threadRootId.value;
  if (!root) return undefined;
  const neigh = new Map<string, string[]>();
  for (const e of built.value.edges) {
    neigh.set(e.source, [...(neigh.get(e.source) ?? []), e.target]);
    neigh.set(e.target, [...(neigh.get(e.target) ?? []), e.source]);
  }
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length) {
    for (const n of neigh.get(queue.shift()!) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
});

const nodes = computed(() => built.value.nodes);
const edges = computed(() => {
  const conn = connectedIds.value;
  const labelStyle = {
    fill: "var(--text-dim)",
    fontSize: 10,
    fontFamily: "var(--mono)",
  };
  const labelBg = { fill: "var(--panel-bg)", fillOpacity: 0.92 };
  return built.value.edges.map((e) => {
    const meta = built.value.edgeMeta.get(e.id);
    const hi = conn ? conn.has(e.source) && conn.has(e.target) : false;
    const dim = conn ? !hi : false;
    return {
      ...e,
      class: `${meta?.cls ?? e.class}${hi ? " e-hi" : ""}${dim ? " e-dim" : ""}`,
      // labels only on the active thread — keeps the default canvas quiet
      label: hi ? meta?.label : undefined,
      labelStyle: hi ? labelStyle : undefined,
      labelBgStyle: hi ? labelBg : undefined,
      labelBgPadding: hi ? ([3, 5] as [number, number]) : undefined,
      labelBgBorderRadius: hi ? 3 : undefined,
    };
  });
});

function fitToThread(): void {
  void nextTick(() => {
    const ids = connectedIds.value ? [...connectedIds.value] : undefined;
    try {
      fitView({ nodes: ids, padding: 0.3, duration: 260, maxZoom: 1.1 });
    } catch {
      /* vue-flow not ready */
    }
  });
}

function fitAll(): void {
  void nextTick(() => {
    try {
      fitView({ padding: 0.22, duration: 260 });
    } catch {
      /* vue-flow not ready */
    }
  });
}

function fitNode(id: string): void {
  void nextTick(() => {
    try {
      fitView({ nodes: [id], padding: 0.4, duration: 220 });
    } catch {
      /* vue-flow not ready */
    }
  });
}

function onPaneClick(): void {
  selected.value = undefined;
  nodeCtx.value = undefined;
}

function openNodeCtx(e: MouseEvent, items: CtxItem[]): void {
  const pad = 8;
  const menuW = 220;
  const menuH = Math.min(360, 12 + items.length * 34);
  let x = e.clientX;
  let y = e.clientY;
  x = Math.max(pad, Math.min(x, window.innerWidth - menuW - pad));
  y = Math.max(pad, Math.min(y, window.innerHeight - menuH - pad));
  nodeCtxIgnoreClick = true;
  nodeCtx.value = { x, y, items };
  requestAnimationFrame(() => {
    nodeCtxIgnoreClick = false;
  });
}

function runCtxItem(item: CtxItem): void {
  nodeCtx.value = undefined;
  if (!item.disabled) item.run();
}

function onDocPointer(e: PointerEvent): void {
  if (nodeCtxIgnoreClick || !nodeCtx.value) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.(".lin-node-ctx")) return;
  nodeCtx.value = undefined;
}

function focusNode(id: string): void {
  focusNodeId.value = id;
  if (id.startsWith("s:")) {
    const rest = id.slice(2);
    const i = rest.indexOf(":");
    if (i > 0) {
      const provider = rest.slice(0, i);
      const sessionId = rest.slice(i + 1);
      void router.replace({
        query: { ...route.query, focus: `${provider}:${sessionId}` },
      });
    }
  } else {
    const q = { ...route.query } as Record<string, string>;
    delete q.focus;
    void router.replace({ query: q });
  }
  fitToThread();
}

function onSessionCtx(
  e: MouseEvent,
  id: string,
  data: { provider: string; sessionId: string; title?: string },
): void {
  const peer = diffPeerFor({ type: "session", provider: data.provider, sessionId: data.sessionId, id });
  const runs = runsFor(data.provider, data.sessionId);
  const graphRun = runs.find((r) => r.graphId);
  const items: CtxItem[] = [
    {
      glyph: "≡",
      label: "Transcript",
      run: () => fileViewers.openTranscript(data.provider, data.sessionId),
    },
    {
      glyph: "❝",
      label: "Context",
      run: () => void fileViewers.openContext(data.provider, data.sessionId),
    },
    {
      glyph: "⌗",
      label: "Blueprint",
      run: () => openBlueprint({ provider: data.provider, sessionId: data.sessionId }),
    },
  ];
  if (peer) {
    items.push({
      glyph: "⇆",
      label: "Diff handoff",
      run: () => openDiff({ provider: data.provider, sessionId: data.sessionId }, peer),
    });
  }
  if (graphRun?.graphId) {
    items.push({
      glyph: "→",
      label: "Open workflow",
      run: () => void router.push(`/graph/${graphRun.graphId}`),
    });
  } else if (runs.length) {
    items.push({
      glyph: "→",
      label: "Runs",
      run: () => void router.push({ path: "/", query: { view: "runs" } }),
    });
  }
  items.push(
    {
      glyph: "◎",
      label: focusNodeId.value === id ? "Clear focus" : "Focus thread",
      run: () => (focusNodeId.value === id ? clearFocus() : focusNode(id)),
    },
    {
      glyph: "⊡",
      label: "Fit to node",
      run: () => fitNode(id),
    },
  );
  openNodeCtx(e, items);
}

function onPayloadCtx(e: MouseEvent, id: string, data: LineagePayload): void {
  const inj = injectsOf(data.hash).find((i) => i.result?.sessionId);
  const items: CtxItem[] = [
    {
      glyph: "⧉",
      label: "Open",
      run: () =>
        void fileViewers.openPayload({
          hash: data.hash,
          name: data.preview || data.kind,
        }),
    },
    {
      glyph: "⌗",
      label: "Source blueprint",
      run: () => openBlueprint(data.source),
    },
  ];
  if (inj?.result?.sessionId) {
    items.push({
      glyph: "⇆",
      label: "Diff handoff",
      run: () => diffHandoff(data, inj),
    });
  }
  items.push(
    {
      glyph: "⇓",
      label: "Download raw",
      run: () => window.open(`/api/payloads/${data.hash}`, "_blank"),
    },
    {
      glyph: "◎",
      label: focusNodeId.value === id ? "Clear focus" : "Focus thread",
      run: () => (focusNodeId.value === id ? clearFocus() : focusNode(id)),
    },
    {
      glyph: "⊡",
      label: "Fit to node",
      run: () => fitNode(id),
    },
  );
  openNodeCtx(e, items);
}

function clearFocus(): void {
  focusNodeId.value = undefined;
  const q = { ...route.query } as Record<string, string>;
  delete q.focus;
  void router.replace({ query: q });
  void nextTick(() => {
    try {
      fitView({ padding: 0.22, duration: 260 });
    } catch {
      /* ignore */
    }
  });
}

function pickPayload(id: string, p: LineagePayload): void {
  selected.value = { id, type: "payload", payload: p };
  content.value = "";
  contentLoading.value = true;
  void fetch(`/api/payloads/${p.hash}`)
    .then((r) => (r.ok ? r.json() : undefined))
    .then((body) => {
      const c = (body as { content?: string } | undefined)?.content ?? "(unreadable)";
      content.value = c.length > 20_000 ? `${c.slice(0, 20_000)}\n… (truncated)` : c;
    })
    .catch(() => {
      content.value = "(unreadable)";
    })
    .finally(() => {
      contentLoading.value = false;
    });
}

function pickSession(
  id: string,
  data: { provider: string; sessionId: string; title?: string },
): void {
  selected.value = {
    id,
    type: "session",
    provider: data.provider,
    sessionId: data.sessionId,
    title: data.title,
  };
}

function applyFocusFromRoute(): void {
  const f = route.query.focus;
  if (typeof f !== "string" || !f.includes(":")) {
    focusNodeId.value = undefined;
    return;
  }
  const i = f.indexOf(":");
  const provider = f.slice(0, i);
  const sessionId = f.slice(i + 1);
  if (!provider || !sessionId) return;
  // Focus may land on an unused-only session — surface unused so the node exists.
  showUnused.value = true;
  kindFilter.value = "all";
  const id = sessKey(provider, sessionId);
  const live = sessions.find(provider, sessionId);
  pickSession(id, { provider, sessionId, title: live?.title });
  focusNodeId.value = id;
  fitToThread();
}

watch(showUnused, () => {
  void nextTick(() => {
    try {
      fitView({ padding: 0.22, duration: 200 });
    } catch {
      /* ignore */
    }
  });
});

onMounted(async () => {
  document.addEventListener("pointerdown", onDocPointer, true);
  try {
    const res = await fetch("/api/lineage");
    const body = (await res.json()) as {
      payloads: LineagePayload[];
      injects: LineageInject[];
      runSessions?: RunSession[];
    };
    allPayloads.value = body.payloads;
    allInjects.value = body.injects;
    runSessions.value = body.runSessions ?? [];
    sessions.noteProviders([
      ...body.payloads.map((p) => p.source.provider),
      ...body.injects.flatMap((inj) => [
        inj.target.provider,
        inj.result?.provider,
      ].filter(Boolean) as string[]),
      ...(body.runSessions ?? []).map((r) => r.provider),
    ]);
  } finally {
    loading.value = false;
    await nextTick();
    applyFocusFromRoute();
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  clearTimeout(searchTimer);
});

watch(
  () => route.query.focus,
  () => {
    if (loading.value) return;
    applyFocusFromRoute();
  },
);
</script>

<style scoped>
.lineage-page {
  display: flex;
  height: 100vh;
  background: var(--canvas-bg);
}
.lineage-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.lin-chrome {
  flex-shrink: 0;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.lin-chrome .dash-head {
  margin-bottom: 14px;
}
.lin-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.lin-node-ctx {
  position: fixed;
  right: auto;
  top: auto;
  z-index: 90;
}
.lin-inline-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.lin-inline-btn:hover {
  color: var(--text);
}
.lin-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  z-index: 5;
}
.lin-overlay-msg {
  pointer-events: auto;
  padding: 28px 36px;
  color: var(--text-faint);
  font-size: var(--fs-sm);
  text-align: center;
  max-width: 28rem;
}
.lin-dim-sm {
  color: var(--text-faint);
  font-size: var(--fs-xs);
}
.lin-body-row {
  flex: 1;
  min-height: 0;
  display: flex;
}
.lin-canvas {
  flex: 1;
  min-width: 0;
  position: relative;
}
.lin-nores {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  color: var(--text-faint);
  font-size: var(--fs-xs);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 12px;
}
.lin-node {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 250px;
  min-height: 64px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, opacity 0.15s;
}
.lin-node:hover {
  background: var(--node-bg-hover);
}
.lin-tile {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.lin-tile-glyph {
  font-size: var(--fs-2xl);
  color: #fff;
  font-family: var(--mono);
}
.lin-node.sel {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.lin-node.dimmed {
  opacity: 0.55;
  filter: saturate(0.4);
  transition: opacity 0.15s, filter 0.15s;
}
.lin-node.dimmed:hover {
  opacity: 1;
  filter: none;
}
.lin-node.hit {
  border-color: var(--context);
}
.lin-payload {
  width: 290px;
}
.lin-preview {
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.35;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  margin-bottom: 2px;
}
.lin-body {
  min-width: 0;
}
.lin-name {
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lin-meta {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  white-space: normal;
  line-height: 1.5;
}
.lin-wf-badge {
  display: inline-block;
  margin-left: 5px;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  color: var(--text-dim);
  font-size: var(--fs-2xs);
  letter-spacing: 0.04em;
}
.lin-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--wire-session);
}
.lin-handle-context {
  border-color: var(--wire-context);
}
.lin-detail {
  width: 400px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--panel-bg);
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lin-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lin-detail-title {
  font-size: var(--fs-lg);
  font-weight: 600;
}
.ap-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-md);
}
.run-kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px 14px;
  font-size: var(--fs-xs);
}
.run-key {
  color: var(--text-faint);
}
.run-val {
  color: var(--text-dim);
  word-break: break-word;
}
.lin-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.lin-injlist {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.lin-inj {
  text-align: left;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  padding: 6px 9px;
  cursor: pointer;
}
.lin-inj:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.lin-inj em {
  font-style: normal;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.lin-content-label {
  padding-top: 4px;
}
.lin-content {
  margin: 0;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: var(--fs-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-dim);
  overflow-y: auto;
  max-height: 48vh;
}
.lin-sip {
  padding-top: 4px;
}
</style>

<style>
/* Colors come from theme.css .src-session / .src-context — inject dash is role-only. */
.lin-e-inject path.vue-flow__edge-path {
  stroke-dasharray: 6 4;
}
.vue-flow__edge.e-hi path.vue-flow__edge-path {
  stroke-width: 2.5;
}
.vue-flow__edge.e-dim path.vue-flow__edge-path {
  opacity: 0.4;
}
</style>
