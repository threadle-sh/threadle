<template>
  <div class="art-panel">
    <div class="art-meta micro-label">
      <span class="op-badge" :class="'rule-' + kind">{{ kind }}</span>
      <span v-if="kind === 'skill'" class="art-state" :class="effectiveAuto ? 'on' : 'off'">
        {{ effectiveAuto ? "auto" : "manual" }}
      </span>
      <span>{{ source || "—" }}</span>
    </div>
    <p v-if="description" class="art-desc">{{ description }}</p>
    <div class="art-actions">
      <button
        v-if="isLikelyTextPath(path)"
        class="vsc-btn"
        title="Open"
        @click="fileViewers.open(path)"
      >
        ⧉ open
      </button>
      <button class="vsc-btn" @click="settings.openPath(path)">
        open in {{ settings.editorLabel }}
      </button>
      <button
        v-if="kind === 'skill'"
        class="vsc-btn"
        :disabled="busy"
        :title="effectiveAuto ? 'Turn off auto-invoke' : 'Allow model auto-invoke'"
        @click="toggleAuto"
      >
        {{ effectiveAuto ? "auto → off" : "off → auto" }}
      </button>
    </div>
    <div v-if="actionError" class="art-err">{{ actionError }}</div>
    <div v-if="loading" class="art-dim">loading…</div>
    <div v-else-if="error" class="art-dim">{{ error }}</div>
    <div v-else class="art-body t-text" v-html="rendered" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { renderMd } from "@/lib/safeHtml";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";

const props = defineProps<{
  path: string;
  name: string;
  kind: "skill" | "rules";
  source?: string;
  description?: string;
  autoInvoke?: boolean;
}>();

const emit = defineEmits<{
  updated: [
    patch: {
      path: string;
      autoInvoke?: boolean;
      description?: string;
      shadowedBy?: string;
    },
  ];
}>();

const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
void settings.load();

const content = ref("");
const loading = ref(true);
const error = ref<string>();
const actionError = ref<string>();
const busy = ref(false);
const localAuto = ref<boolean | undefined>();

const effectiveAuto = computed(() => localAuto.value ?? props.autoInvoke !== false);

const rendered = computed(() => renderMd(content.value));

watch(
  () => [props.path, props.name, props.kind] as const,
  async ([p, name, kind]) => {
    loading.value = true;
    error.value = undefined;
    actionError.value = undefined;
    localAuto.value = undefined;
    try {
      const qs = p
        ? `path=${encodeURIComponent(p)}`
        : `name=${encodeURIComponent(name)}&kind=${kind}${
            props.source ? `&source=${encodeURIComponent(props.source)}` : ""
          }`;
      const res = await fetch(`/api/rules/content?${qs}`);
      if (!res.ok) throw new Error(`${res.status}`);
      content.value = ((await res.json()) as { content: string }).content;
    } catch (err) {
      error.value = `could not read file (${err instanceof Error ? err.message : err})`;
      content.value = "";
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

watch(
  () => props.autoInvoke,
  () => {
    localAuto.value = undefined;
  },
);

async function toggleAuto(): Promise<void> {
  busy.value = true;
  actionError.value = undefined;
  try {
    const next = !effectiveAuto.value;
    const res = await fetch("/api/rules/skill/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: props.path, autoInvoke: next }),
    });
    const body = (await res.json()) as {
      error?: string;
      artifact?: { autoInvoke?: boolean; description?: string; shadowedBy?: string };
    };
    if (!res.ok || !body.artifact) throw new Error(body.error ?? `${res.status}`);
    localAuto.value = body.artifact.autoInvoke;
    const cr = await fetch(`/api/rules/content?path=${encodeURIComponent(props.path)}`);
    if (cr.ok) content.value = ((await cr.json()) as { content: string }).content;
    emit("updated", {
      path: props.path,
      autoInvoke: body.artifact.autoInvoke,
      description: body.artifact.description,
      shadowedBy: body.artifact.shadowedBy,
    });
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.art-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.art-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.art-state {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.art-state.on {
  color: var(--text);
}
.art-state.off {
  color: var(--text-faint);
}
.art-desc {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-dim);
  line-height: 1.4;
}
.art-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.art-dim {
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.art-err {
  font-size: var(--fs-sm);
  color: var(--status-error);
}
.art-body {
  font-size: var(--fs-sm);
  line-height: 1.55;
}
.art-body :deep(pre) {
  background: var(--input-bg);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.art-body :deep(code) {
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.art-body :deep(h1),
.art-body :deep(h2),
.art-body :deep(h3) {
  font-size: 1.05em;
  margin: 0.7em 0 0.3em;
}
.art-body :deep(p),
.art-body :deep(li) {
  margin: 0.3em 0;
}
.op-badge {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.op-badge.rule-skill {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}
.op-badge.rule-rules {
  color: var(--lane-session);
  border-color: rgba(95, 159, 232, 0.35);
}
</style>
