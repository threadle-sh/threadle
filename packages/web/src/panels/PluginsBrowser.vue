<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  providerColor,
  providerLabel,
} from "@/lib/providers";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useSettingsStore } from "@/stores/settings";
import { vColResize } from "@/lib/colResize";
import DetailExpandControls from "@/panels/DetailExpandControls.vue";
import DetailExpandModal from "@/panels/DetailExpandModal.vue";
import "@/views/dashboard/chrome.css";

export type PluginChildKind = "skill" | "agent" | "mcp" | "command";

export interface PluginChild {
  kind: PluginChildKind;
  name: string;
  description?: string;
  path?: string;
}

export interface PluginEntry {
  provider: string;
  id: string;
  name: string;
  version?: string;
  description?: string;
  origin: {
    kind: "marketplace-catalog" | "installed-tree" | "cache" | "skill-bundle";
    path: string;
    marketplaceId?: string;
  };
  state: "catalog-only" | "cached" | "installed";
  children: PluginChild[];
}

const props = defineProps<{
  filter: string;
  providerFilter: string;
  /** Deep-link focus: provider:id */
  focusKey?: string;
}>();

const emit = defineEmits<{
  loaded: [count: number];
}>();

const fileViewers = useFileViewersStore();
const settings = useSettingsStore();
const items = ref<PluginEntry[] | undefined>(undefined);
const picked = ref<PluginEntry>();
const expanded = ref(false);
const plugCtx = ref<{ x: number; y: number; entry: PluginEntry }>();
let ctxIgnoreClick = false;

async function load(): Promise<void> {
  try {
    const res = await fetch("/api/plugins");
    items.value = (await res.json()) as PluginEntry[];
  } catch {
    items.value = [];
  }
  emit("loaded", items.value.length);
  applyFocus();
}

function entryKey(e: PluginEntry): string {
  return `${e.provider}:${e.id}`;
}

function applyFocus(): void {
  const key = props.focusKey?.trim();
  if (!key || !items.value?.length) return;
  const hit = items.value.find((e) => entryKey(e) === key);
  if (hit) picked.value = hit;
}

onMounted(() => {
  void load();
  document.addEventListener("click", dismissCtx);
  document.addEventListener("contextmenu", dismissCtx);
  document.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  document.removeEventListener("click", dismissCtx);
  document.removeEventListener("contextmenu", dismissCtx);
  document.removeEventListener("keydown", onKey);
});

watch(
  () => items.value?.length,
  (n) => {
    if (n != null) emit("loaded", n);
  },
);

watch(
  () => props.focusKey,
  () => applyFocus(),
);

const filtered = computed(() => {
  const q = props.filter.trim().toLowerCase();
  const pf = props.providerFilter;
  return (items.value ?? []).filter((e) => {
    if (pf && pf !== "all" && e.provider !== pf) return false;
    if (!q) return true;
    const hay = [
      e.name,
      e.id,
      e.description ?? "",
      e.version ?? "",
      e.state,
      e.origin.kind,
      e.origin.marketplaceId ?? "",
      e.origin.path,
      e.provider,
      ...e.children.map((c) => `${c.kind} ${c.name}`),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
});

function childCount(e: PluginEntry, kind: PluginChildKind): number {
  return e.children.filter((c) => c.kind === kind).length;
}

interface ProvGroup {
  provider: string;
  entries: PluginEntry[];
}

const groups = computed((): ProvGroup[] => {
  const map = new Map<string, ProvGroup>();
  for (const e of filtered.value) {
    let g = map.get(e.provider);
    if (!g) {
      g = { provider: e.provider, entries: [] };
      map.set(e.provider, g);
    }
    g.entries.push(e);
  }
  return [...map.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider),
  );
});

function pick(e: PluginEntry): void {
  if (picked.value && entryKey(picked.value) === entryKey(e)) {
    picked.value = undefined;
    expanded.value = false;
  } else {
    picked.value = e;
  }
}

function openChild(c: PluginChild): void {
  if (!c.path) return;
  void fileViewers.open(c.path);
}

function openPack(e?: PluginEntry): void {
  const p = e ?? picked.value;
  if (!p?.origin.path) return;
  void settings.openPath(p.origin.path);
}

function childGlyph(kind: PluginChildKind): string {
  if (kind === "skill") return "✦";
  if (kind === "agent") return "⟨/⟩";
  if (kind === "mcp") return "◈";
  return "›";
}

function placeCtxMenu(e: MouseEvent): { x: number; y: number } {
  const pad = 8;
  const mw = 220;
  const mh = 240;
  return {
    x: Math.min(e.clientX, window.innerWidth - mw - pad),
    y: Math.min(e.clientY, window.innerHeight - mh - pad),
  };
}

function openPlugCtx(e: MouseEvent, entry: PluginEntry): void {
  e.preventDefault();
  e.stopPropagation();
  picked.value = entry;
  plugCtx.value = { ...placeCtxMenu(e), entry };
  ctxIgnoreClick = true;
  requestAnimationFrame(() => {
    ctxIgnoreClick = false;
  });
}

function dismissCtx(e: MouseEvent): void {
  if (ctxIgnoreClick) return;
  if (e.type === "click" && e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".plug-ctx")) {
    plugCtx.value = undefined;
  }
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    plugCtx.value = undefined;
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function openFirstSkill(e: PluginEntry): void {
  const skill = e.children.find((c) => c.kind === "skill" && c.path);
  if (skill?.path) void fileViewers.open(skill.path);
}

function showDetails(e: PluginEntry): void {
  picked.value = e;
}

function closeAside(): void {
  picked.value = undefined;
  expanded.value = false;
}

function openExpand(e?: PluginEntry): void {
  if (e) picked.value = e;
  if (!picked.value) return;
  expanded.value = true;
}

function closeExpand(): void {
  expanded.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  if (plugCtx.value) {
    plugCtx.value = undefined;
    e.preventDefault();
    return;
  }
  if (expanded.value) {
    closeExpand();
    e.preventDefault();
    return;
  }
  if (picked.value) {
    closeAside();
    e.preventDefault();
  }
}

const loading = computed(() => items.value === undefined);
</script>

<template>
  <div class="plug-layout">
    <div class="plug-main">
      <p v-if="loading" class="stat-note">loading plugins…</p>
      <p v-else-if="!filtered.length" class="stat-note">
        no plugins found
        <span v-if="filter || (providerFilter && providerFilter !== 'all')">
          · try clearing filters</span
        >
      </p>
      <template v-else>
        <section v-for="g in groups" :key="g.provider" class="plug-group">
          <div class="micro-label plug-group-label">
            <span
              class="plug-dot"
              :style="{ background: providerColor(g.provider) }"
            />
            {{ providerLabel(g.provider) }}
            <span class="plug-group-count">{{ g.entries.length }}</span>
          </div>
          <div
            class="stat-table cols-plug"
            v-col-resize="'plug-v2'"
            data-cols="minmax(0,1fr) 72px 88px 120px 56px 56px 64px"
          >
            <div class="stat-cols micro-label">
              <span>name</span><span>ver</span><span>state</span
              ><span>origin</span
              ><span class="num">commands</span
              ><span class="num">agents</span
              ><span class="num">children</span>
            </div>
            <button
              v-for="e in g.entries"
              :key="entryKey(e)"
              type="button"
              class="stat-row"
              :class="{ picked: picked && entryKey(picked) === entryKey(e) }"
              @click="pick(e)"
              @contextmenu.prevent.stop="openPlugCtx($event, e)"
            >
              <span class="mono ellip" :title="e.origin.path">{{ e.name }}</span>
              <span class="mono dim">{{ e.version || "—" }}</span>
              <span class="mono dim">{{ e.state }}</span>
              <span class="mono dim ellip" :title="e.origin.marketplaceId || e.origin.kind">{{
                e.origin.marketplaceId || e.origin.kind
              }}</span>
              <span class="num mono">{{ childCount(e, "command") }}</span>
              <span class="num mono">{{ childCount(e, "agent") }}</span>
              <span class="num mono">{{ e.children.length }}</span>
            </button>
          </div>
        </section>
      </template>
    </div>

    <aside v-if="picked" class="plug-aside">
      <div class="plug-aside-head">
        <div class="plug-aside-titles">
          <div class="plug-aside-title mono" :title="picked.name">{{ picked.name }}</div>
          <div class="plug-aside-meta mono">
            <span>{{ providerLabel(picked.provider) }}</span>
            <span v-if="picked.version">{{ picked.version }}</span>
            <span>{{ picked.state }}</span>
          </div>
        </div>
        <DetailExpandControls @expand="openExpand()" @close="closeAside" />
      </div>
      <div class="plug-meta mono">
        <div>
          <span class="dim">origin</span> {{ picked.origin.kind }}
        </div>
        <div v-if="picked.origin.marketplaceId">
          <span class="dim">marketplace</span>
          {{ picked.origin.marketplaceId }}
        </div>
        <div class="ellip" :title="picked.origin.path">
          <span class="dim">path</span> {{ picked.origin.path }}
        </div>
      </div>
      <p v-if="picked.description" class="plug-desc">{{ picked.description }}</p>
      <div class="plug-actions">
        <button type="button" class="vsc-btn" @click="openPack()">
          open in {{ settings.editorLabel }}
        </button>
      </div>
      <div class="micro-label plug-kids-label">
        children{{ picked.children.length ? ` · ${picked.children.length}` : "" }}
      </div>
      <p v-if="!picked.children.length" class="stat-note">no skills / agents</p>
      <ul v-else class="plug-kids">
        <li v-for="(c, i) in picked.children" :key="i">
          <button
            type="button"
            class="plug-kid"
            :disabled="!c.path"
            :title="c.description || c.path"
            @click="openChild(c)"
          >
            <span class="plug-kid-glyph">{{ childGlyph(c.kind) }}</span>
            <span class="mono ellip">{{ c.name }}</span>
            <span class="dim mono">{{ c.kind }}</span>
          </button>
        </li>
      </ul>
    </aside>
  </div>

  <DetailExpandModal
    :open="!!picked && expanded"
    :label="picked ? `Plugin ${picked.name}` : 'Plugin'"
    @close="closeExpand"
  >
    <template v-if="picked">
      <header class="plug-modal-head">
        <div class="plug-modal-titles">
          <div class="plug-modal-title mono" :title="picked.name">{{ picked.name }}</div>
          <div class="plug-aside-meta mono">
            <span>{{ providerLabel(picked.provider) }}</span>
            <span v-if="picked.version">{{ picked.version }}</span>
            <span>{{ picked.state }}</span>
          </div>
        </div>
        <div class="plug-modal-actions">
          <button type="button" class="vsc-btn" @click="openPack()">
            open in {{ settings.editorLabel }}
          </button>
          <DetailExpandControls hide-expand @close="closeExpand" />
        </div>
      </header>

      <div class="plug-modal-body">
          <div class="plug-modal-meta">
            <div class="plug-meta mono">
              <div>
                <span class="dim">origin</span> {{ picked.origin.kind }}
              </div>
              <div v-if="picked.origin.marketplaceId">
                <span class="dim">marketplace</span>
                {{ picked.origin.marketplaceId }}
              </div>
              <div class="plug-path" :title="picked.origin.path">
                <span class="dim">path</span>
                <span class="mono">{{ picked.origin.path }}</span>
              </div>
            </div>
            <p v-if="picked.description" class="plug-desc">{{ picked.description }}</p>
          </div>

          <div class="plug-modal-kids">
            <div class="micro-label plug-kids-label">
              children{{ picked.children.length ? ` · ${picked.children.length}` : "" }}
            </div>
            <p v-if="!picked.children.length" class="stat-note">no skills / agents</p>
            <ul v-else class="plug-kids">
              <li v-for="(c, i) in picked.children" :key="i">
                <button
                  type="button"
                  class="plug-kid"
                  :disabled="!c.path"
                  :title="c.description || c.path"
                  @click="openChild(c)"
                >
                  <span class="plug-kid-glyph">{{ childGlyph(c.kind) }}</span>
                  <span class="mono ellip">{{ c.name }}</span>
                  <span class="dim mono">{{ c.kind }}</span>
                </button>
              </li>
            </ul>
          </div>
        </div>
    </template>
  </DetailExpandModal>

  <Teleport to="body">
    <div
      v-if="plugCtx"
      class="menu-pop wf-folder-ctx plug-ctx"
      :style="{ left: plugCtx.x + 'px', top: plugCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => showDetails(plugCtx!.entry))"
      >
        <span class="menu-glyph">▸</span> Details
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => openExpand(plugCtx!.entry))"
      >
        <span class="menu-glyph">□</span> Expand
      </button>
      <button
        v-if="plugCtx.entry.children.some((c) => c.kind === 'skill' && c.path)"
        type="button"
        class="menu-item"
        @click="menuAction(() => openFirstSkill(plugCtx!.entry))"
      >
        <span class="menu-glyph">✦</span> Open skill
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => openPack(plugCtx!.entry))"
      >
        <span class="menu-glyph">✎</span> {{ settings.editorLabel }}
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => copyText(plugCtx!.entry.origin.path))"
      >
        <span class="menu-glyph">❐</span> Copy path
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => copyText(plugCtx!.entry.name))"
      >
        <span class="menu-glyph">❐</span> Copy name
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => copyText(entryKey(plugCtx!.entry)))"
      >
        <span class="menu-glyph">❐</span> Copy id
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.plug-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
}
.plug-main {
  flex: 1;
  min-width: 0;
  padding: 0 0 16px;
}
/* Align sticky aside with NAME/VER header row (skip provider group label) */
.plug-aside {
  width: min(320px, 36vw);
  flex-shrink: 0;
  position: sticky;
  top: 12px;
  align-self: flex-start;
  margin-top: calc(1em + 6px);
  max-height: calc(100vh - 160px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px 16px;
  background: var(--panel-bg);
  display: flex;
  flex-direction: column;
  gap: 0;
}
.plug-aside-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.plug-aside-titles {
  min-width: 0;
  flex: 1;
}
.plug-aside-title {
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plug-aside-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
  color: var(--text-dim);
  font-size: var(--fs-sm);
}
.plug-group {
  margin-bottom: 16px;
}
.plug-group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.plug-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.plug-group-count {
  color: var(--text-faint);
  font-weight: 400;
}
.cols-plug .stat-row {
  cursor: pointer;
  text-align: left;
  width: 100%;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
}
.cols-plug .stat-row.picked {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.ellip {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dim {
  color: var(--text-dim);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.plug-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--fs-xs);
  margin-bottom: 10px;
}
.plug-meta .dim {
  display: inline-block;
  min-width: 5.5em;
  margin-right: 6px;
}
.plug-desc {
  font-size: var(--fs-sm);
  color: var(--text-dim);
  margin: 0 0 12px;
  line-height: 1.45;
}
.plug-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.plug-kids-label {
  margin-bottom: 6px;
}
.plug-kids {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.plug-kid {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.plug-kid:hover:not(:disabled) {
  border-color: var(--border);
  background: color-mix(in srgb, var(--text-faint) 8%, transparent);
}
.plug-kid:disabled {
  cursor: default;
  opacity: 0.55;
}
.plug-kid-glyph {
  color: var(--text-dim);
  font-size: var(--fs-xs);
}
.stat-note {
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  padding: 8px 0;
}
.plug-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.plug-modal-titles {
  min-width: 0;
}
.plug-modal-title {
  font-size: var(--fs-lg);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plug-modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.plug-modal-body {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 18px 24px;
  min-height: 0;
  overflow: hidden;
  flex: 1;
}
.plug-modal-meta,
.plug-modal-kids {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.plug-path {
  display: grid;
  grid-template-columns: 5.5em minmax(0, 1fr);
  gap: 6px;
  align-items: start;
}
.plug-path .mono {
  word-break: break-all;
  color: var(--text-dim);
}
.plug-ctx {
  z-index: 140;
}
@media (max-width: 900px) {
  .plug-layout {
    flex-direction: column;
  }
  .plug-aside {
    width: 100%;
    position: static;
    margin-top: 0;
    max-height: none;
  }
}
@media (max-width: 720px) {
  .plug-modal-body {
    grid-template-columns: 1fr;
  }
}
</style>
