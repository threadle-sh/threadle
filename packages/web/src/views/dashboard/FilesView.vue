<template>
  <div class="files-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Files</h1>
      </div>
      <div class="view-controls">
        <ProviderFilterChips
          v-model="groupF"
          :options="filterChipOptions"
          :label-for="groupLabel"
        />
      </div>
    </header>

    <div class="dash-toolbar files-toolbar">
      <input
        v-model="fileFilter"
        class="threadle-input dash-search"
        placeholder="Filter…"
        spellcheck="false"
      />
      <select v-model="fileSort" class="threadle-input sort-select">
        <option value="mtime">recent first</option>
        <option value="size">largest first</option>
        <option value="name">name A–Z</option>
      </select>
    </div>
  </div>

  <div class="sess-layout dash-load-host">
    <GraphLoadingOverlay
      :loading="!filesLoaded"
      label="Loading files"
    />
    <div class="sess-list">
      <template v-if="filesLoaded && !visibleGroups.length">
        <p class="stat-note">
          {{
            fileGroups.some((g) => g.entries.length)
              ? "no files match these filters"
              : "no files found"
          }}
        </p>
        <button
          v-if="fileGroups.some((g) => g.entries.length) && filtersActive"
          class="vsc-btn"
          @click="clearFilters"
        >
          clear filters
        </button>
      </template>

      <template v-if="filesLoaded">
      <div v-for="g in visibleGroups" :key="g.name" class="sess-group">
        <div class="sess-group-head">
          <span class="micro-label sess-group-name" :title="g.name">
            <span class="prov-dot" :style="{ background: providerColor(g.name) }" />
            {{ groupLabel(g.name) }}
          </span>
          <span class="sess-group-spacer" />
          <span class="sess-meta mono">{{ g.entries.length }}</span>
        </div>
        <div
          v-for="f in g.entries"
          :key="f.path"
          class="sess-block"
        >
          <div
            class="sess-row"
            :class="{
              picked: picked?.path === f.path,
              ctx: fileCtx?.entry.path === f.path,
            }"
            @click="pickFile(f, g.name)"
            @contextmenu.prevent.stop="openFileCtxMenu($event, f, g.name)"
            @mousedown="onFileRowMouseDown($event, f, g.name)"
          >
            <span
              class="file-kind"
              :title="f.kind === 'dir' ? 'directory' : 'file'"
            >
              <FolderMark v-if="f.kind === 'dir'" />
              <FileMark v-else />
            </span>
            <span class="sess-title" :title="f.label || fileBasename(f.path)">
              {{ f.label?.trim() || fileBasename(f.path) }}
            </span>
            <span v-if="f.note" class="sess-meta mono" :title="f.note">{{ f.note }}</span>
            <span class="sess-meta mono">{{ fmtBytes(f.size) }}</span>
            <span
              class="sess-meta"
              :title="f.mtime ? new Date(f.mtime).toLocaleString() : undefined"
            >{{ f.mtime ? relativeTime(f.mtime) : "—" }}</span>
            <div
              class="row-actions"
              :class="{ pinned: openMenu === f.path }"
              @click.stop
            >
              <button
                v-if="canPreview(f)"
                type="button"
                class="row-icon"
                title="Open"
                @click="fileViewers.open(f.path)"
              >
                ⧉
              </button>
              <button
                type="button"
                class="row-icon"
                :title="`Open in ${settings.editorLabel}`"
                @click="settings.openPath(f.path)"
              >
                ⟨/⟩
              </button>
              <div class="row-menu">
                <button
                  type="button"
                  class="row-icon menu-btn"
                  :class="{ open: openMenu === f.path }"
                  title="More actions"
                  @click="toggleMenu(f)"
                >
                  ⋯
                </button>
                <div v-if="openMenu === f.path" class="menu-pop">
                  <button
                    v-if="canPreview(f)"
                    type="button"
                    class="menu-item"
                    @click="menuAction(() => fileViewers.open(f.path))"
                  >
                    <span class="menu-glyph">⧉</span> Open
                  </button>
                  <button
                    type="button"
                    class="menu-item"
                    @click="menuAction(() => settings.openPath(f.path))"
                  >
                    <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
                  </button>
                  <button
                    type="button"
                    class="menu-item"
                    @click="menuAction(() => copyPath(f.path))"
                  >
                    <span class="menu-glyph">❐</span> Copy path
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </template>
    </div>

    <aside v-if="picked" class="sess-detail">
      <div class="sess-detail-head">
        <div class="sess-detail-titles">
          <div
            class="sess-detail-title"
            :title="picked.label || fileBasename(picked.path)"
          >
            {{ picked.label?.trim() || fileBasename(picked.path) }}
          </div>
          <div class="sess-detail-meta mono">
            <span>{{ picked.kind }}</span>
            <span v-if="picked.note">{{ picked.note }}</span>
            <span>{{ fmtBytes(picked.size) }}</span>
          </div>
        </div>
        <button type="button" class="sess-detail-close" @click="picked = undefined">✕</button>
      </div>
      <div class="sess-detail-actions">
        <button
          v-if="canPreview(picked)"
          type="button"
          class="vsc-btn"
          title="Open"
          @click="fileViewers.open(picked.path)"
        >
          ⧉ open
        </button>
        <button
          type="button"
          class="vsc-btn"
          :title="`Open in ${settings.editorLabel}`"
          @click="settings.openPath(picked.path)"
        >
          ⟨/⟩ {{ settings.editorLabel }}
        </button>
        <button
          type="button"
          class="vsc-btn"
          title="Copy absolute path"
          @click="copyPath(picked.path)"
        >
          {{ pathCopied ? "✓ copied" : "❐ path" }}
        </button>
        <button
          type="button"
          class="vsc-btn"
          :title="
            isFileFavorite(picked) ? 'Remove from favorites' : 'Add to favorites'
          "
          @click="toggleFileFavorite(picked)"
        >
          {{ isFileFavorite(picked) ? "☆ unfavorite" : "★ favorite" }}
        </button>
      </div>
      <div class="run-kv mono">
        <span class="run-key">group</span>
        <span class="run-val">{{ groupLabel(pickedGroup) }}</span>
        <span class="run-key">kind</span>
        <span class="run-val">{{ picked.kind }}</span>
        <span v-if="picked.note" class="run-key">note</span>
        <span v-if="picked.note" class="run-val">{{ picked.note }}</span>
        <span class="run-key">size</span>
        <span class="run-val">{{ fmtBytes(picked.size) }}</span>
        <span class="run-key">modified</span>
        <span class="run-val" :title="picked.mtime ? new Date(picked.mtime).toLocaleString() : undefined">
          {{
            picked.mtime
              ? `${relativeTime(picked.mtime)} · ${new Date(picked.mtime).toLocaleString()}`
              : "—"
          }}
        </span>
        <span class="run-key">path</span>
        <span class="run-val file-path" :title="picked.path">{{
          bidiPath(tildePath(picked.path))
        }}</span>
      </div>
    </aside>
  </div>

  <Teleport to="body">
    <div
      v-if="fileCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: fileCtx.x + 'px', top: fileCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        v-if="canPreview(fileCtx.entry)"
        type="button"
        class="menu-item"
        @click="menuAction(() => fileViewers.open(fileCtx!.entry.path))"
      >
        <span class="menu-glyph">⧉</span> Open
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => settings.openPath(fileCtx!.entry.path))"
      >
        <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => copyPath(fileCtx!.entry.path))"
      >
        <span class="menu-glyph">❐</span> Copy path
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => toggleFileFavorite(fileCtx!.entry, fileCtx!.group))"
      >
        <span class="menu-glyph">{{
          isFileFavorite(fileCtx!.entry) ? "☆" : "★"
        }}</span>
        {{
          isFileFavorite(fileCtx!.entry)
            ? "Remove from favorites"
            : "Add to favorites"
        }}
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { bidiPath, relativeTime, tildePath } from "@/lib/format";
import { providerColor, providerShort } from "@/lib/providers";
import { copyToClipboard } from "@/lib/pathActions";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import FileMark from "@/panels/FileMark.vue";
import FolderMark from "@/panels/FolderMark.vue";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";
import { useFavoritesStore } from "@/stores/favorites";
import "./chrome.css";

interface FileEntry {
  path: string;
  label?: string;
  size: number;
  mtime?: number;
  kind: "file" | "dir";
  note?: string;
}
interface FileGroup {
  name: string;
  entries: FileEntry[];
}

const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const favorites = useFavoritesStore();
void favorites.ensureLoaded();

function fileFavoriteInput(f: FileEntry, group?: string) {
  const g = group ?? pickedGroup.value;
  return {
    kind: "file" as const,
    path: f.path,
    label: f.label?.trim() || fileBasename(f.path),
    provider:
      g && g !== "threadle" && g !== "all" ? g : undefined,
  };
}
function isFileFavorite(f: FileEntry): boolean {
  return favorites.isFavorite(fileFavoriteInput(f));
}
function toggleFileFavorite(f: FileEntry, group?: string): void {
  void favorites.toggle(fileFavoriteInput(f, group));
}

const fileGroups = ref<FileGroup[]>([]);
const filesLoaded = ref(false);
const fileFilter = ref("");
const groupF = ref("all");
const fileSort = ref<"mtime" | "size" | "name">("mtime");
const picked = ref<FileEntry>();
const pickedGroup = ref("");
const openMenu = ref<string>();
const fileCtx = ref<{ entry: FileEntry; group: string; x: number; y: number }>();
const pathCopied = ref(false);
let fileCtxIgnoreClick = false;
let pathCopiedTimer: ReturnType<typeof setTimeout> | undefined;

function fileBasename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function groupLabel(name: string): string {
  if (name === "all") return "all";
  if (name === "threadle") return "threadle";
  return providerShort(name);
}

const groupOptions = computed(() =>
  fileGroups.value.filter((g) => g.entries.length > 0),
);

const filterChipOptions = computed(() => [
  "all",
  ...groupOptions.value.map((g) => g.name),
]);

function canPreview(f: FileEntry): boolean {
  return f.kind === "file" && isLikelyTextPath(f.path);
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

const filtersActive = computed(
  () => groupF.value !== "all" || !!fileFilter.value.trim(),
);

function clearFilters(): void {
  groupF.value = "all";
  fileFilter.value = "";
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  const rows = [...entries];
  if (fileSort.value === "size") {
    rows.sort((a, b) => b.size - a.size || (b.mtime ?? 0) - (a.mtime ?? 0));
  } else if (fileSort.value === "name") {
    rows.sort((a, b) =>
      (a.label || fileBasename(a.path)).localeCompare(
        b.label || fileBasename(b.path),
        undefined,
        { sensitivity: "base" },
      ),
    );
  } else {
    rows.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || b.size - a.size);
  }
  return rows;
}

const visibleGroups = computed(() => {
  const q = fileFilter.value.trim().toLowerCase();
  const out: FileGroup[] = [];
  for (const g of fileGroups.value) {
    if (groupF.value !== "all" && g.name !== groupF.value) continue;
    const entries = sortEntries(
      g.entries.filter((f) => {
        if (!q) return true;
        return (
          f.path.toLowerCase().includes(q) ||
          (f.label?.toLowerCase().includes(q) ?? false) ||
          (f.note?.toLowerCase().includes(q) ?? false)
        );
      }),
    );
    if (entries.length) out.push({ name: g.name, entries });
  }
  return out;
});

watch(groupOptions, (opts) => {
  if (groupF.value !== "all" && !opts.some((g) => g.name === groupF.value)) {
    groupF.value = "all";
  }
});

watch(visibleGroups, (groups) => {
  if (!picked.value) return;
  const still = groups.some((g) => g.entries.some((e) => e.path === picked.value!.path));
  if (!still) {
    picked.value = undefined;
    pickedGroup.value = "";
  }
});

function pickFile(f: FileEntry, group: string): void {
  if (picked.value?.path === f.path) {
    picked.value = undefined;
    pickedGroup.value = "";
    return;
  }
  picked.value = f;
  pickedGroup.value = group;
  pathCopied.value = false;
}

function toggleMenu(f: FileEntry): void {
  fileCtx.value = undefined;
  openMenu.value = openMenu.value === f.path ? undefined : f.path;
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    openMenu.value = undefined;
    fileCtx.value = undefined;
  }
}

function openFileCtxMenu(e: MouseEvent, entry: FileEntry, group: string): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  const pad = 8;
  const w = 248;
  const h = 140;
  const x = Math.min(e.clientX, window.innerWidth - w - pad);
  const y = Math.min(e.clientY, window.innerHeight - h - pad);
  fileCtxIgnoreClick = true;
  fileCtx.value = { entry, group, x: Math.max(pad, x), y: Math.max(pad, y) };
  window.setTimeout(() => {
    fileCtxIgnoreClick = false;
  }, 400);
}

function onFileRowMouseDown(e: MouseEvent, entry: FileEntry, group: string): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openFileCtxMenu(e, entry, group);
}

async function copyPath(p: string): Promise<void> {
  const ok = await copyToClipboard(p);
  if (!ok) return;
  pathCopied.value = true;
  if (pathCopiedTimer) clearTimeout(pathCopiedTimer);
  pathCopiedTimer = setTimeout(() => {
    pathCopied.value = false;
  }, 1500);
}

function onDocClick(e: MouseEvent): void {
  if (fileCtxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".row-menu") && !t.closest?.(".wf-folder-ctx")) {
    openMenu.value = undefined;
    fileCtx.value = undefined;
  }
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  if (!filesLoaded.value) {
    void fetch("/api/files")
      .then((r) => r.json() as Promise<FileGroup[]>)
      .then((g) => {
        fileGroups.value = g;
        filesLoaded.value = true;
      })
      .catch(() => {
        filesLoaded.value = true;
      });
  }
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  if (pathCopiedTimer) clearTimeout(pathCopiedTimer);
});
</script>

<style scoped>
.files-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.files-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.file-kind {
  width: 14px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
}
.file-kind :deep(.file-mark),
.file-kind :deep(.folder-mark) {
  color: inherit;
}
.sess-group-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.wf-folder-ctx {
  position: fixed;
  right: auto;
  top: auto;
  z-index: 80;
}
</style>
