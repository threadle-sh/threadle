<template>
  <div class="lib-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Library</h1>
      </div>
      <div class="view-controls">
        <ProviderFilterChips
          v-model="libProviderF"
          :options="libProviders"
        />
      </div>
    </header>
    <div class="dash-toolbar lib-toolbar">
      <input
        v-model="libFilter"
        class="threadle-input dash-search"
        placeholder="Filter payloads…"
        spellcheck="false"
      />
      <select v-model="libKindF" class="threadle-input sort-select">
        <option value="all">any kind</option>
        <option value="distilled-summary">distilled</option>
        <option value="transcript-excerpt">excerpt</option>
        <option value="files">files</option>
      </select>
      <select v-model="libSort" class="threadle-input sort-select">
        <option value="updated">recent first</option>
        <option value="size">largest first</option>
        <option value="title">title A–Z</option>
      </select>
    </div>
  </div>

  <div class="sess-layout dash-load-host">
    <GraphLoadingOverlay
      :loading="libLoading"
      label="Loading library"
    />
    <div class="sess-list">
      <template v-if="!libLoading && !filteredLibrary.length">
        <p class="stat-note">
          {{
            library.length
              ? "no payloads match these filters"
              : "no payloads yet — extract or distill context from a session"
          }}
        </p>
        <button
          v-if="library.length && libFiltersActive"
          class="vsc-btn"
          @click="clearLibFilters"
        >
          clear filters
        </button>
      </template>
      <template v-if="!libLoading">
      <div v-for="g in libGroups" :key="g.key" class="sess-group">
        <div class="sess-group-head">
          <button
            class="micro-label sess-group-name lib-src-btn"
            :title="g.title"
            @click="openLibSource(g)"
          >
            <span class="prov-dot" :style="{ background: providerColor(g.provider) }" />
            {{ g.title }}
          </button>
          <span class="sess-group-spacer" />
          <div class="group-actions">
            <button
              class="vsc-btn"
              title="Open source session"
              @click="openLibSource(g)"
            >
              ❯ session
            </button>
          </div>
        </div>
        <div v-for="pl in g.items" :key="pl.hash" class="sess-block">
          <div
            class="sess-row"
            :class="{
              picked: libPicked?.hash === pl.hash,
              ctx: libCtx?.hash === pl.hash,
            }"
            @click="pickLib(pl)"
            @contextmenu.prevent.stop="openLibCtx($event, pl)"
            @mousedown="onLibRowMouseDown($event, pl)"
          >
            <span class="sess-title" :title="pl.preview || '(empty payload)'">
              {{ pl.preview || "(empty payload)" }}
            </span>
            <span class="sess-meta mono">{{ LIB_KIND_SHORT[pl.kind] ?? pl.kind }}</span>
            <span class="sess-meta mono">{{ fmtLibChars(pl.chars) }}</span>
            <span
              class="sess-meta"
              :title="new Date(pl.createdAt).toLocaleString()"
            >{{ relativeTime(pl.createdAt) }}</span>
            <div
              class="row-actions"
              :class="{ pinned: openMenu === 'lib-' + pl.hash }"
              @click.stop
            >
              <button
                class="row-icon"
                title="Create a workflow seeded with this context"
                @click="useLibInWorkflowFrom(pl)"
              >
                →
              </button>
              <div class="row-menu">
                <button
                  class="row-icon menu-btn"
                  :class="{ open: openMenu === 'lib-' + pl.hash }"
                  title="More actions"
                  @click="openMenu = openMenu === 'lib-' + pl.hash ? undefined : 'lib-' + pl.hash"
                >
                  ⋯
                </button>
                <div v-if="openMenu === 'lib-' + pl.hash" class="menu-pop">
                  <button
                    class="menu-item"
                    @click="
                      menuAction(() =>
                        void fileViewers.openPayload({
                          hash: pl.hash,
                          name: pl.preview || pl.kind,
                        }),
                      )
                    "
                  >
                    <span class="menu-glyph">⧉</span> Open
                  </button>
                  <button
                    class="menu-item"
                    @click="
                      menuAction(() =>
                        fileViewers.openTranscript(pl.source.provider, pl.source.sessionId),
                      )
                    "
                  >
                    <span class="menu-glyph">≡</span> Source transcript
                  </button>
                  <button
                    class="menu-item"
                    @click="menuAction(() => router.push(`/blueprint/${pl.source.provider}/${pl.source.sessionId}`))"
                  >
                    <span class="menu-glyph">⌗</span> Source blueprint
                  </button>
                  <button
                    class="menu-item"
                    @click="menuAction(() => openLibLineageFor(pl))"
                  >
                    <span class="menu-glyph">⇄</span> Lineage
                  </button>
                  <button
                    class="menu-item"
                    @click="menuAction(() => useLibInWorkflowFrom(pl))"
                  >
                    <span class="menu-glyph">→</span> Workflow
                  </button>
                  <button
                    class="menu-item"
                    @click="menuAction(() => downloadLibRawFor(pl))"
                  >
                    <span class="menu-glyph">⇓</span> Download raw
                  </button>
                  <button
                    class="menu-item"
                    @click="menuAction(() => toggleLibFavorite(pl))"
                  >
                    <span class="menu-glyph">{{
                      isLibFavorite(pl) ? "☆" : "★"
                    }}</span>
                    {{
                      isLibFavorite(pl)
                        ? "Remove from favorites"
                        : "Add to favorites"
                    }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </template>
    </div>

    <aside v-if="libPicked" class="sess-detail">
      <div class="sess-detail-head">
        <div class="sess-detail-titles">
          <div class="sess-detail-title" :title="libPicked.preview || '(empty payload)'">
            {{ libPicked.preview || "(empty payload)" }}
          </div>
          <div class="sess-detail-meta mono">
            <span>{{ LIB_KIND_SHORT[libPicked.kind] ?? libPicked.kind }}</span>
            <span>{{ fmtLibChars(libPicked.chars) }}</span>
          </div>
        </div>
        <button class="sess-detail-close" @click="libPicked = undefined">✕</button>
      </div>
      <div class="sess-detail-actions">
        <button
          class="vsc-btn"
          title="Open"
          @click="
            void fileViewers.openPayload({
              hash: libPicked.hash,
              name: libPicked.preview || libPicked.kind,
            })
          "
        >
          ⧉ open
        </button>
        <button class="vsc-btn" title="Create a workflow seeded with this context" @click="useLibInWorkflow">
          → workflow
        </button>
        <button
          class="vsc-btn"
          title="Copy the full content"
          :disabled="libContentLoading || !libContent"
          @click="copyLib"
        >
          {{ libCopied ? "✓ copied" : "❐ copy" }}
        </button>
        <button class="vsc-btn" title="Download payload JSON" @click="downloadLibRaw">
          ⇓ raw
        </button>
        <button
          class="vsc-btn"
          title="Open source session blueprint"
          @click="router.push(`/blueprint/${libPicked.source.provider}/${libPicked.source.sessionId}`)"
        >
          ⌗ source
        </button>
        <button
          class="vsc-btn"
          title="Open source session"
          @click="openLibSource({ key: '', provider: libPicked.source.provider, items: [libPicked] })"
        >
          ❯ session
        </button>
        <button
          class="vsc-btn"
          :title="
            isLibFavorite(libPicked) ? 'Remove from favorites' : 'Add to favorites'
          "
          @click="toggleLibFavorite(libPicked)"
        >
          {{ isLibFavorite(libPicked) ? "☆ unfavorite" : "★ favorite" }}
        </button>
      </div>
      <div class="run-kv mono">
        <span class="run-key">hash</span><span class="run-val" :title="libPicked.hash">{{ libPicked.hash.slice(0, 16) }}…</span>
        <span class="run-key">created</span><span class="run-val">{{ new Date(libPicked.createdAt).toLocaleString() }}</span>
        <span class="run-key">from</span><span class="run-val">{{ libSourceTitle(libPicked) }}</span>
      </div>
      <div class="micro-label">tags</div>
      <div class="lib-tag-edit">
        <span v-for="t in libPicked.tags" :key="t" class="threadle-chip mono">
          {{ t }}
          <button class="lib-tag-x" title="Remove tag" @click="removeLibTag(t)">✕</button>
        </span>
        <input
          v-model="libTagInput"
          class="threadle-input lib-tag-input mono"
          placeholder="add tag ⏎"
          spellcheck="false"
          @keydown.enter.prevent="addLibTag"
        />
      </div>
      <div class="micro-label">content</div>
      <div v-if="libContentLoading" class="stat-note">loading…</div>
      <pre v-else class="lib-content mono">{{ libContent }}</pre>
    </aside>
  </div>

  <Teleport to="body">
    <div
      v-if="libCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: libCtx.x + 'px', top: libCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        class="menu-item"
        @click="
          menuAction(() =>
            void fileViewers.openPayload({
              hash: libCtx!.hash,
              name: libCtx!.preview || libCtx!.kind,
            }),
          )
        "
      >
        <span class="menu-glyph">⧉</span> Open
      </button>
      <button
        class="menu-item"
        @click="
          menuAction(() =>
            fileViewers.openTranscript(libCtx!.source.provider, libCtx!.source.sessionId),
          )
        "
      >
        <span class="menu-glyph">≡</span> Source transcript
      </button>
      <button
        class="menu-item"
        @click="
          menuAction(() =>
            router.push(`/blueprint/${libCtx!.source.provider}/${libCtx!.source.sessionId}`),
          )
        "
      >
        <span class="menu-glyph">⌗</span> Source blueprint
      </button>
      <button
        class="menu-item"
        @click="menuAction(() => openLibLineageFor(libCtx!))"
      >
        <span class="menu-glyph">⇄</span> Lineage
      </button>
      <button
        class="menu-item"
        @click="menuAction(() => useLibInWorkflowFrom(libCtx!))"
      >
        <span class="menu-glyph">→</span> Workflow
      </button>
      <button
        class="menu-item"
        @click="menuAction(() => downloadLibRawFor(libCtx!))"
      >
        <span class="menu-glyph">⇓</span> Download raw
      </button>
      <button
        class="menu-item"
        @click="menuAction(() => toggleLibFavorite(libCtx!))"
      >
        <span class="menu-glyph">{{ isLibFavorite(libCtx!) ? "☆" : "★" }}</span>
        {{
          isLibFavorite(libCtx!)
            ? "Remove from favorites"
            : "Add to favorites"
        }}
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { SessionRef } from "@threadle/shared";
import { relativeTime, shortId } from "@/lib/format";
import { providerColor, providerShort, type SessionFilter } from "@/lib/providers";
import { downloadUrl, payloadToWorkflow } from "@/lib/convert";
import { useSessionsStore } from "@/stores/sessions";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useFavoritesStore } from "@/stores/favorites";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import "./chrome.css";

interface LibPayload {
  hash: string;
  kind: string;
  createdAt: number;
  chars: number;
  preview: string;
  source: { provider: string; sessionId: string };
  tags: string[];
}

const emit = defineEmits<{
  nav: [id: string];
  "open-session": [session: SessionRef];
}>();

const router = useRouter();
const sessions = useSessionsStore();
const fileViewers = useFileViewersStore();
const favorites = useFavoritesStore();
void favorites.ensureLoaded();

function libFavoriteInput(pl: LibPayload) {
  return {
    kind: "payload" as const,
    hash: pl.hash,
    label: pl.preview || undefined,
    provider: pl.source.provider || undefined,
  };
}
function isLibFavorite(pl: LibPayload): boolean {
  return favorites.isFavorite(libFavoriteInput(pl));
}
function toggleLibFavorite(pl: LibPayload): void {
  void favorites.toggle(libFavoriteInput(pl));
}

const library = ref<LibPayload[]>([]);
const libLoading = ref(false);
const libFilter = ref("");
const libKindF = ref<"all" | "distilled-summary" | "transcript-excerpt" | "files">("all");
const libProviderF = ref<SessionFilter>("all");
const libSort = ref<"updated" | "size" | "title">("updated");
const libPicked = ref<LibPayload>();
const libContent = ref("");
const libContentLoading = ref(false);
const libTagInput = ref("");
const libCopied = ref(false);
const openMenu = ref<string>();
const libCtx = ref<{
  hash: string;
  kind: string;
  createdAt: number;
  chars: number;
  preview: string;
  source: { provider: string; sessionId: string };
  tags: string[];
  x: number;
  y: number;
}>();
let libCtxIgnoreClick = false;

function openLibCtx(e: MouseEvent, pl: LibPayload): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  const pad = 8;
  const w = 260;
  const h = 280;
  const x = Math.min(e.clientX, window.innerWidth - w - pad);
  const y = Math.min(e.clientY, window.innerHeight - h - pad);
  libCtxIgnoreClick = true;
  libCtx.value = { ...pl, x: Math.max(pad, x), y: Math.max(pad, y) };
  window.setTimeout(() => {
    libCtxIgnoreClick = false;
  }, 400);
}

function onLibRowMouseDown(e: MouseEvent, pl: LibPayload): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openLibCtx(e, pl);
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    openMenu.value = undefined;
    libCtx.value = undefined;
  }
}

function onDocClick(e: MouseEvent): void {
  if (libCtxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".row-menu") && !t.closest?.(".wf-folder-ctx")) {
    openMenu.value = undefined;
    libCtx.value = undefined;
  }
}

const libProviders = computed(() => sessions.sessionFilterChips);
watch(libProviders, (chips) => {
  if (!chips.includes(libProviderF.value)) libProviderF.value = "all";
});

const LIB_KIND_SHORT: Record<string, string> = {
  "distilled-summary": "distilled",
  "transcript-excerpt": "excerpt",
  files: "files",
};

const libFiltersActive = computed(
  () =>
    !!libFilter.value.trim() ||
    libKindF.value !== "all" ||
    libProviderF.value !== "all",
);

async function loadLibrary(): Promise<void> {
  libLoading.value = true;
  try {
    library.value = (await (await fetch("/api/payloads")).json()) as LibPayload[];
    sessions.noteProviders(library.value.map((p) => p.source.provider));
  } catch {
    library.value = [];
  } finally {
    libLoading.value = false;
  }
}

function clearLibFilters(): void {
  libFilter.value = "";
  libKindF.value = "all";
  libProviderF.value = "all";
}

async function copyLib(): Promise<void> {
  if (!libContent.value || libContentLoading.value) return;
  await navigator.clipboard.writeText(libContent.value).catch(() => undefined);
  libCopied.value = true;
  setTimeout(() => {
    libCopied.value = false;
  }, 1600);
}

async function downloadLibRawFor(p: LibPayload): Promise<void> {
  await downloadUrl(`/api/payloads/${p.hash}`, `payload-${p.hash.slice(0, 8)}.json`);
}

async function downloadLibRaw(): Promise<void> {
  const p = libPicked.value;
  if (!p) return;
  await downloadLibRawFor(p);
}

function openLibLineageFor(p: LibPayload): void {
  void router.push({
    path: "/lineage",
    query: { focus: `${p.source.provider}:${p.source.sessionId}` },
  });
}

async function useLibInWorkflowFrom(p: LibPayload): Promise<void> {
  const id = await payloadToWorkflow(p);
  void router.push(`/graph/${id}`);
}

async function useLibInWorkflow(): Promise<void> {
  const p = libPicked.value;
  if (!p) return;
  await useLibInWorkflowFrom(p);
}

function openLibSource(g: { key: string; provider: string; items: LibPayload[] }): void {
  const src = g.items[0]?.source;
  if (!src) return;
  const session =
    sessions.find(src.provider, src.sessionId) ??
    ({
      provider: src.provider,
      id: src.sessionId,
      projectDir: "",
      updatedAt: Date.now(),
      status: "unknown",
      kind: "session",
      meta: {},
    } as SessionRef);
  emit("open-session", session);
  emit("nav", "sessions");
}

const filteredLibrary = computed(() => {
  const q = libFilter.value.trim().toLowerCase();
  let rows = library.value.filter(
    (p) =>
      (libKindF.value === "all" || p.kind === libKindF.value) &&
      (libProviderF.value === "all" || p.source.provider === libProviderF.value) &&
      (!q ||
        p.preview.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        libSourceTitle(p).toLowerCase().includes(q) ||
        p.hash.toLowerCase().includes(q)),
  );
  rows = [...rows].sort((a, b) => {
    if (libSort.value === "size") return b.chars - a.chars;
    if (libSort.value === "title") {
      return (a.preview || a.hash).localeCompare(b.preview || b.hash);
    }
    return b.createdAt - a.createdAt;
  });
  return rows;
});

const libGroups = computed(() => {
  const groups = new Map<
    string,
    { key: string; title: string; provider: string; items: LibPayload[] }
  >();
  for (const p of filteredLibrary.value) {
    const key = `${p.source.provider}:${p.source.sessionId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: libSourceTitle(p),
        provider: p.source.provider,
        items: [],
      });
    }
    groups.get(key)!.items.push(p);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Math.max(...b.items.map((i) => i.createdAt)) -
      Math.max(...a.items.map((i) => i.createdAt)),
  );
});

function fmtLibChars(n: number): string {
  if (n <= 0) return "empty";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function libSourceTitle(p: LibPayload): string {
  const live = sessions.find(p.source.provider, p.source.sessionId);
  return live?.title ?? `${providerShort(p.source.provider)} · ${shortId(p.source.sessionId)}`;
}

function pickLib(p: LibPayload): void {
  if (libPicked.value?.hash === p.hash) {
    libPicked.value = undefined;
    return;
  }
  libPicked.value = p;
  libTagInput.value = "";
  libContent.value = "";
  libContentLoading.value = true;
  void fetch(`/api/payloads/${p.hash}`)
    .then((r) => (r.ok ? r.json() : undefined))
    .then((body) => {
      const c = (body as { content?: string } | undefined)?.content ?? "(unreadable)";
      libContent.value = c.length > 20_000 ? `${c.slice(0, 20_000)}\n… (truncated)` : c;
    })
    .catch(() => {
      libContent.value = "(unreadable)";
    })
    .finally(() => {
      libContentLoading.value = false;
    });
}

async function saveLibTags(p: LibPayload, tags: string[]): Promise<void> {
  try {
    await fetch(`/api/payloads/${p.hash}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    p.tags = tags;
  } catch {
    // tag save failed — leave UI unchanged
  }
}

function addLibTag(): void {
  const p = libPicked.value;
  const t = libTagInput.value.trim();
  if (!p || !t) return;
  libTagInput.value = "";
  if (p.tags.includes(t)) return;
  void saveLibTags(p, [...p.tags, t]);
}

function removeLibTag(t: string): void {
  const p = libPicked.value;
  if (!p) return;
  void saveLibTags(p, p.tags.filter((x) => x !== t));
}

onMounted(() => {
  sessions.ensureHydrated();
  void loadLibrary();
  document.addEventListener("click", onDocClick);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
});
</script>

<style scoped>
.lib-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.lib-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.lib-src-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  padding: 0 2px;
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-src-btn:hover {
  color: var(--text-dim);
}
.lib-tag-edit {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}
.lib-tag-x {
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: var(--fs-2xs);
  padding: 0 0 0 3px;
}
.lib-tag-x:hover {
  color: var(--status-error);
}
.lib-tag-input {
  width: 110px;
  height: 24px;
  padding: 2px 8px;
  font-size: var(--fs-xs);
}
.lib-content {
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
  max-height: 44vh;
}
</style>
