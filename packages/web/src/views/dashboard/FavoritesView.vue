<template>
  <div class="fav-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Favorites</h1>
      </div>
      <div class="view-controls">
        <ProviderFilterChips
          v-model="providerF"
          :options="favProviderChips"
        />
        <button
          v-if="missingCount"
          class="threadle-btn"
          :disabled="busy"
          title="Remove favorites whose targets no longer exist"
          @click="onPrune"
        >
          prune missing{{ missingCount ? ` · ${missingCount}` : "" }}
        </button>
      </div>
    </header>
    <div class="dash-toolbar fav-toolbar">
      <input
        v-model="filter"
        class="threadle-input dash-search"
        placeholder="Filter favorites…"
        spellcheck="false"
      />
      <div class="chip-row">
        <button
          v-for="k in kindChips"
          :key="k.id"
          type="button"
          class="filter-chip"
          :class="{ active: kindFilter === k.id }"
          @click="kindFilter = k.id"
        >
          {{ k.label }}{{ k.count ? ` · ${k.count}` : "" }}
        </button>
      </div>
    </div>
  </div>

  <div class="sess-layout dash-load-host">
    <GraphLoadingOverlay :loading="loading" label="Loading favorites" />
    <div class="sess-list">
      <template v-if="!loading && !visibleGroups.length">
        <p class="stat-note">
          {{
            favorites.items.length
              ? "no favorites match these filters"
              : "Right-click any session, workflow, skill… and choose Add to favorites."
          }}
        </p>
        <button
          v-if="favorites.items.length && filtersActive"
          class="vsc-btn"
          @click="clearFilters"
        >
          clear filters
        </button>
      </template>

      <template v-if="!loading">
        <div v-for="g in visibleGroups" :key="g.kind" class="sess-group">
          <div class="sess-group-head">
            <span class="micro-label sess-group-name">{{ g.label }}</span>
            <span class="sess-group-spacer" />
            <span class="sess-meta mono">{{ g.items.length }}</span>
          </div>
          <div
            v-for="item in g.items"
            :key="item.id"
            class="sess-block"
          >
            <div
              class="sess-row"
              :class="{ missing: item.alive === false }"
              @click="openItem(item)"
              @contextmenu.prevent.stop="openCtx($event, item)"
            >
              <span class="sess-title" :title="rowTitle(item)">{{ rowTitle(item) }}</span>
              <span
                v-if="item.alive === false"
                class="sess-meta mono fav-missing"
              >missing</span>
              <span class="sess-meta mono">{{ rowMeta(item) }}</span>
              <span
                class="sess-meta"
                :title="new Date(item.createdAt).toLocaleString()"
              >{{ relativeTime(item.createdAt) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="ctx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        v-if="ctx.item.alive !== false"
        type="button"
        class="menu-item"
        @click="menuAction(() => openItem(ctx!.item))"
      >
        <span class="menu-glyph">↗</span> Open
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => favorites.remove(ctx!.item.id))"
      >
        <span class="menu-glyph">☆</span> Remove from favorites
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  FAVORITE_KIND_LABEL,
  type FavoriteKind,
} from "@threadle/shared";
import { relativeTime } from "@/lib/format";
import { type SessionFilter } from "@/lib/providers";
import { useFavoritesStore, type FavoriteAlive } from "@/stores/favorites";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useSessionsStore } from "@/stores/sessions";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import "./chrome.css";

const emit = defineEmits<{
  "open-session": [payload: { provider: string; id: string }];
}>();

const favorites = useFavoritesStore();
const fileViewers = useFileViewersStore();
const sessions = useSessionsStore();
const router = useRouter();

const filter = ref("");
const kindFilter = ref<FavoriteKind | "all">("all");
const providerF = ref<SessionFilter>("all");
const busy = ref(false);
const loading = computed(() => favorites.loading && !favorites.loaded);

const KIND_ORDER: FavoriteKind[] = (
  Object.keys(FAVORITE_KIND_LABEL) as FavoriteKind[]
).sort((a, b) =>
  FAVORITE_KIND_LABEL[a].localeCompare(FAVORITE_KIND_LABEL[b], undefined, {
    sensitivity: "base",
  }),
);

const favProviderChips = computed(() => sessions.sessionFilterChips);
watch(favProviderChips, (chips) => {
  if (!chips.includes(providerF.value)) providerF.value = "all";
});

/** Best-effort provider for filter chips (stored field, session, or path cues). */
function favoriteProvider(item: FavoriteAlive): string | undefined {
  if (item.kind === "session") return item.provider;
  if (item.kind === "workflow") return undefined;
  if (item.kind === "payload") return item.provider;
  return item.provider ?? inferProviderFromPath(item.path);
}

function inferProviderFromPath(raw: string): string | undefined {
  const p = raw.replace(/\\/g, "/").toLowerCase();
  if (p.includes("/.claude/") || p.includes("/claude/projects/")) return "claude-code";
  if (p.includes("/.cursor/") || p.includes("/cursor/")) return "cursor";
  if (p.includes("/.opencode/") || p.includes("/opencode/")) return "opencode";
  if (p.includes("/antigravity")) return "antigravity";
  if (p.includes("/.codex/") || p.includes("/codex/")) return "codex";
  if (p.includes("/copilot")) return "copilot";
  if (p.includes("/.grok/") || p.includes("/grok/")) return "grok";
  if (p.includes("/.muse/") || p.includes("/.local/share/muse/")) return "muse";
  return undefined;
}

const missingCount = computed(
  () => favorites.items.filter((i) => i.alive === false).length,
);

const kindChips = computed(() => {
  const counts = new Map<FavoriteKind | "all", number>();
  counts.set("all", favorites.items.length);
  for (const k of KIND_ORDER) counts.set(k, 0);
  for (const i of favorites.items) {
    counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  }
  return [
    { id: "all" as const, label: "all", count: counts.get("all") ?? 0 },
    ...KIND_ORDER.map((k) => ({
      id: k,
      label: FAVORITE_KIND_LABEL[k].toLowerCase(),
      count: counts.get(k) ?? 0,
    })).filter((c) => c.count > 0 || kindFilter.value === c.id),
  ];
});

const filtersActive = computed(
  () =>
    !!filter.value.trim() ||
    kindFilter.value !== "all" ||
    providerF.value !== "all",
);

function clearFilters(): void {
  filter.value = "";
  kindFilter.value = "all";
  providerF.value = "all";
}

function rowTitle(item: FavoriteAlive): string {
  if (item.label?.trim()) return item.label.trim();
  switch (item.kind) {
    case "workflow":
      return item.graphId;
    case "session":
      return item.sessionId;
    case "payload":
      return item.hash.slice(0, 12) + "…";
    case "skill":
    case "rules":
    case "file": {
      const parts = item.path.split(/[/\\]/);
      return parts[parts.length - 1] || item.path;
    }
  }
}

function rowMeta(item: FavoriteAlive): string {
  switch (item.kind) {
    case "workflow":
      return item.graphId.slice(0, 8);
    case "session":
      return item.provider;
    case "payload":
      return "payload";
    case "skill":
    case "rules":
    case "file":
      return item.kind;
  }
}

const visibleGroups = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const items = favorites.items.filter((i) => {
    if (kindFilter.value !== "all" && i.kind !== kindFilter.value) return false;
    if (providerF.value !== "all") {
      const p = favoriteProvider(i);
      if (p !== providerF.value) return false;
    }
    if (!q) return true;
    const hay = `${rowTitle(i)} ${rowMeta(i)} ${i.kind}`.toLowerCase();
    return hay.includes(q);
  });
  return KIND_ORDER.map((kind) => ({
    kind,
    label: FAVORITE_KIND_LABEL[kind],
    items: items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length);
});

function openItem(item: FavoriteAlive): void {
  if (item.alive === false) return;
  switch (item.kind) {
    case "workflow":
      void router.push(`/graph/${item.graphId}`);
      break;
    case "session":
      emit("open-session", { provider: item.provider, id: item.sessionId });
      break;
    case "payload":
      void fileViewers.openPayload({
        hash: item.hash,
        name: item.label || item.hash.slice(0, 12),
      });
      break;
    case "skill":
      void router.replace({
        query: { view: "skills", skill: item.path },
      });
      break;
    case "rules":
      void router.replace({
        query: { view: "rules", path: item.path },
      });
      break;
    case "file":
      void fileViewers.open(item.path);
      break;
  }
}

async function onPrune(): Promise<void> {
  busy.value = true;
  try {
    await favorites.prune();
  } finally {
    busy.value = false;
  }
}

const ctx = ref<{ x: number; y: number; item: FavoriteAlive }>();
let ctxIgnoreClick = false;

function openCtx(e: MouseEvent, item: FavoriteAlive): void {
  ctx.value = { x: e.clientX, y: e.clientY, item };
  ctxIgnoreClick = true;
  nextTick(() => {
    ctxIgnoreClick = false;
  });
}

function dismissCtx(): void {
  if (ctxIgnoreClick) return;
  ctx.value = undefined;
}

function menuAction(fn: () => void): void {
  ctx.value = undefined;
  fn();
}

onMounted(() => {
  sessions.ensureHydrated();
  void favorites.load({ check: true });
  document.addEventListener("click", dismissCtx);
  document.addEventListener("contextmenu", dismissCtx);
});

onUnmounted(() => {
  document.removeEventListener("click", dismissCtx);
  document.removeEventListener("contextmenu", dismissCtx);
});
</script>

<style scoped>
.fav-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.fav-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.fav-missing {
  color: var(--fg-dim, #888);
  letter-spacing: 0.04em;
}
.sess-row.missing {
  opacity: 0.55;
}
.sess-row.missing:hover {
  opacity: 0.75;
}
</style>
