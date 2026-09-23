<template>
  <aside class="ap">
    <div class="ap-head">
      <div class="ap-title-wrap">
        <span class="op-badge" :class="'rule-' + artifact.kind">{{ artifact.kind }}</span>
        <span class="ap-title mono" :title="artifact.path">{{ artifact.name }}</span>
        <span
          v-if="artifact.kind === 'skill'"
          class="ap-state micro-label"
          :class="effectiveAuto ? 'on' : 'off'"
        >{{ effectiveAuto ? "auto" : "manual" }}</span>
      </div>
      <DetailExpandControls @expand="expanded = true" @close="emit('close')" />
    </div>
    <div class="ap-meta micro-label">
      {{ artifact.source }} · {{ fmtBytes(displaySize) }}
      <span v-if="artifact.description" class="ap-desc"> · {{ artifact.description }}</span>
    </div>
    <div class="ap-actions">
      <button
        v-if="isLikelyTextPath(artifact.path)"
        class="vsc-btn"
        title="Open"
        @click="fileViewers.open(artifact.path)"
      >
        ⧉ open
      </button>
      <button class="vsc-btn" @click="settings.openPath(artifact.path)">
        open in {{ settings.editorLabel }}
      </button>
      <button v-if="!editing" class="vsc-btn" @click="startEdit">edit</button>
      <template v-else>
        <button class="vsc-btn primary" :disabled="busy" @click="save">
          {{ busy ? "saving…" : "save" }}
        </button>
        <button class="vsc-btn" :disabled="busy" @click="cancelEdit">cancel</button>
      </template>
      <button
        v-if="artifact.kind === 'skill' && !editing"
        class="vsc-btn"
        :disabled="busy"
        :title="effectiveAuto ? 'Turn off auto-invoke (explicit /name only)' : 'Allow model auto-invoke'"
        @click="toggleAuto"
      >
        {{ effectiveAuto ? "auto → off" : "off → auto" }}
      </button>
      <button
        v-if="artifact.kind === 'skill'"
        class="vsc-btn"
        :disabled="busy"
        @click="exportSkill"
      >
        export
      </button>
      <button
        class="vsc-btn"
        :title="
          isArtFavorite ? 'Remove from favorites' : 'Add to favorites'
        "
        @click="toggleArtFavorite"
      >
        {{ isArtFavorite ? "☆ unfavorite" : "★ favorite" }}
      </button>
    </div>
    <div v-if="actionError" class="ap-err">{{ actionError }}</div>
    <div v-if="loading" class="ap-dim">loading…</div>
    <div v-else-if="error" class="ap-dim">{{ error }}</div>
    <textarea
      v-else-if="editing"
      v-model="draft"
      class="ap-editor threadle-input"
      spellcheck="false"
    />
    <div
      v-else
      class="ap-body t-text"
      v-html="rendered"
      @click="onBodyClick"
    />
  </aside>

  <DetailExpandModal
    :open="expanded"
    :label="artifact.name"
    @close="expanded = false"
  >
    <div class="ap-modal-panel">
      <div class="ap-head">
        <div class="ap-title-wrap">
          <span class="op-badge" :class="'rule-' + artifact.kind">{{ artifact.kind }}</span>
          <span class="ap-title mono" :title="artifact.path">{{ artifact.name }}</span>
        </div>
        <DetailExpandControls hide-expand @close="expanded = false" />
      </div>
      <div class="ap-meta micro-label">
        {{ artifact.source }} · {{ fmtBytes(displaySize) }}
        <span v-if="artifact.description" class="ap-desc"> · {{ artifact.description }}</span>
      </div>
      <div class="ap-actions">
        <button
          v-if="isLikelyTextPath(artifact.path)"
          class="vsc-btn"
          title="Open"
          @click="fileViewers.open(artifact.path)"
        >
          ⧉ open
        </button>
        <button class="vsc-btn" @click="settings.openPath(artifact.path)">
          open in {{ settings.editorLabel }}
        </button>
        <button v-if="!editing" class="vsc-btn" @click="startEdit">edit</button>
        <template v-else>
          <button class="vsc-btn primary" :disabled="busy" @click="save">
            {{ busy ? "saving…" : "save" }}
          </button>
          <button class="vsc-btn" :disabled="busy" @click="cancelEdit">cancel</button>
        </template>
      </div>
      <div v-if="actionError" class="ap-err">{{ actionError }}</div>
      <div v-if="loading" class="ap-dim">loading…</div>
      <div v-else-if="error" class="ap-dim">{{ error }}</div>
      <textarea
        v-else-if="editing"
        v-model="draft"
        class="ap-editor threadle-input ap-editor-lg"
        spellcheck="false"
      />
      <div
        v-else
        class="ap-body t-text ap-body-lg"
        v-html="rendered"
        @click="onBodyClick"
      />
    </div>
  </DetailExpandModal>

  <ConfirmModal
    v-model="outboundDlg"
    @confirm="onConfirmOutbound"
    @cancel="pendingOutbound = undefined"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { escapeHtml, renderMd } from "@/lib/safeHtml";
import { interceptContentLinkClick } from "@/lib/contentLinks";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";
import { useFavoritesStore } from "@/stores/favorites";
import ConfirmModal, { type ConfirmModel } from "@/panels/ConfirmModal.vue";
import DetailExpandControls from "@/panels/DetailExpandControls.vue";
import DetailExpandModal from "@/panels/DetailExpandModal.vue";

export interface PreviewArtifact {
  path: string;
  name: string;
  kind: string;
  source: string;
  size: number;
  mtime?: number;
  description?: string;
  autoInvoke?: boolean;
}

const props = defineProps<{ artifact: PreviewArtifact }>();
const emit = defineEmits<{
  close: [];
  updated: [artifact: PreviewArtifact];
}>();

const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const favorites = useFavoritesStore();
void settings.load();
void favorites.ensureLoaded();

const outboundDlg = ref<ConfirmModel>();
const pendingOutbound = ref<string>();

function artifactBaseDir(): string | undefined {
  const n = props.artifact.path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  if (i <= 0) return undefined;
  return n.slice(0, i);
}

function onBodyClick(e: MouseEvent): void {
  interceptContentLinkClick(e, {
    baseDir: artifactBaseDir(),
    onLocal: (filePath) => {
      void fileViewers.open(filePath);
    },
    onExternal: (url, domain) => {
      pendingOutbound.value = url;
      outboundDlg.value = {
        title: "Open URL",
        emphasis: domain,
        body: " — leave threadle and open this site?",
        detail: url,
        confirmLabel: "Open",
        cancelLabel: "Cancel",
      };
    },
  });
}

function onConfirmOutbound(): void {
  const url = pendingOutbound.value;
  pendingOutbound.value = undefined;
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function artFavoriteInput() {
  if (props.artifact.kind === "skill") {
    return {
      kind: "skill" as const,
      path: props.artifact.path,
      label: props.artifact.name,
    };
  }
  return {
    kind: "rules" as const,
    path: props.artifact.path,
    label: props.artifact.name,
  };
}
const isArtFavorite = computed(() => favorites.isFavorite(artFavoriteInput()));
function toggleArtFavorite(): void {
  void favorites.toggle(artFavoriteInput());
}

const content = ref("");
const draft = ref("");
const loading = ref(true);
const error = ref<string>();
const actionError = ref<string>();
const editing = ref(false);
const busy = ref(false);
const localAuto = ref<boolean | undefined>();
const expanded = ref(false);

const effectiveAuto = computed(() => localAuto.value ?? props.artifact.autoInvoke !== false);
const displaySize = computed(() =>
  editing.value ? new TextEncoder().encode(draft.value).length : props.artifact.size,
);

watch(
  () => props.artifact.path,
  async (p) => {
    loading.value = true;
    error.value = undefined;
    actionError.value = undefined;
    editing.value = false;
    localAuto.value = undefined;
    expanded.value = false;
    try {
      const res = await fetch(`/api/rules/content?path=${encodeURIComponent(p)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      content.value = ((await res.json()) as { content: string }).content;
    } catch (err) {
      error.value = `could not read file (${err instanceof Error ? err.message : err})`;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

watch(
  () => props.artifact.autoInvoke,
  () => {
    localAuto.value = undefined;
  },
);

const rendered = computed(() =>
  props.artifact.name.endsWith(".md") ||
  props.artifact.kind === "skill" ||
  props.artifact.kind === "agent"
    ? renderMd(content.value)
    : `<pre class="ap-pre">${escapeHtml(content.value)}</pre>`,
);

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

function startEdit(): void {
  draft.value = content.value;
  editing.value = true;
  actionError.value = undefined;
}

function cancelEdit(): void {
  editing.value = false;
  draft.value = "";
}

async function save(): Promise<void> {
  busy.value = true;
  actionError.value = undefined;
  try {
    const res = await fetch("/api/rules/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: props.artifact.path, content: draft.value }),
    });
    const body = (await res.json()) as { error?: string; artifact?: PreviewArtifact };
    if (!res.ok || !body.artifact) throw new Error(body.error ?? `${res.status}`);
    content.value = draft.value;
    editing.value = false;
    localAuto.value = body.artifact.autoInvoke;
    emit("updated", body.artifact);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function toggleAuto(): Promise<void> {
  busy.value = true;
  actionError.value = undefined;
  try {
    const next = !effectiveAuto.value;
    const res = await fetch("/api/rules/skill/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: props.artifact.path, autoInvoke: next }),
    });
    const body = (await res.json()) as { error?: string; artifact?: PreviewArtifact };
    if (!res.ok || !body.artifact) throw new Error(body.error ?? `${res.status}`);
    localAuto.value = body.artifact.autoInvoke;
    // refresh preview content so frontmatter matches disk
    const cr = await fetch(`/api/rules/content?path=${encodeURIComponent(props.artifact.path)}`);
    if (cr.ok) content.value = ((await cr.json()) as { content: string }).content;
    emit("updated", body.artifact);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function exportSkill(): Promise<void> {
  actionError.value = undefined;
  try {
    const res = await fetch(`/api/rules/skill/export?path=${encodeURIComponent(props.artifact.path)}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.artifact.name}.SKILL.md`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<style scoped>
.ap {
  width: 420px;
  flex-shrink: 0;
  position: sticky;
  top: 12px;
  align-self: flex-start;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-bg);
  padding: 14px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ap-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ap-title {
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-state {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.ap-state.on {
  color: var(--text);
}
.ap-state.off {
  color: var(--text-faint);
}
.ap-desc {
  color: var(--text-dim);
}
.ap-modal-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
}
.ap-editor-lg,
.ap-body-lg {
  flex: 1;
  min-height: 420px;
  max-height: none;
}
.ap-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ap-dim {
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.ap-err {
  font-size: var(--fs-sm);
  color: var(--status-error);
}
.ap-editor {
  flex: 1;
  min-height: 280px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.5;
  resize: vertical;
}
.ap-body {
  font-size: var(--fs-sm);
  line-height: 1.55;
}
.ap-body :deep(pre),
.ap-body :deep(.ap-pre) {
  background: var(--input-bg);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.ap-body :deep(code) {
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.ap-body :deep(h1),
.ap-body :deep(h2),
.ap-body :deep(h3) {
  font-size: 1.05em;
  margin: 0.7em 0 0.3em;
}
.ap-body :deep(p),
.ap-body :deep(li) {
  margin: 0.3em 0;
}
</style>
