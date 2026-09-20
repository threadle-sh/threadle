<template>
  <aside class="inspector" :style="{ width: inspectorWidth + 'px' }">
    <div
      class="resize-grip"
      title="Drag to resize · double-click to reset"
      @mousedown="startInspectorDrag"
      @dblclick="resetInspectorWidth"
    />
    <header class="ins-header">
      <div class="ins-title-wrap">
        <div class="ins-title" :title="title">{{ title }}</div>
        <div class="ins-sub">
          <SessionLivePill v-if="sessionRef" :status="inspectorLiveStatus" />
          <span>{{ subtitle }}</span>
        </div>
      </div>
      <button
        v-if="sessionRef"
        class="vsc-btn ins-bp"
        title="Open session blueprint"
        @click="openBlueprint"
      >
        ⌗ map
      </button>
      <button class="ins-close" @click="emit('close')">✕</button>
    </header>

    <!-- session / subagent-run -->
    <template v-if="sessionRef">
      <nav class="ins-tabs">
        <button
          v-for="tab in tabs"
          :key="tab"
          class="ins-tab"
          :class="{ active: activeTab === tab }"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
        <button
          v-if="selection"
          class="threadle-btn primary extract-btn"
          @click="emit('extract-selection', selection)"
        >
          Extract {{ selection[1] - selection[0] + 1 }} msg
        </button>
        <button
          v-else-if="canInject"
          class="threadle-btn primary extract-btn"
          @click="emit('inject')"
        >
          ⇥ Inject context
        </button>
      </nav>

      <div class="ins-body">
        <div v-if="activeTab === 'info'" class="ins-pad">
          <SessionInfoPanel
            :provider="sessionRef!.provider"
            :session-id="sessionRef!.sessionId"
          />
        </div>

        <TranscriptView
          v-else-if="activeTab === 'transcript'"
          :provider="sessionRef.provider"
          :session-id="sessionRef.sessionId"
          @selection="selection = $event"
        />

        <div v-else-if="activeTab === 'files'" class="ins-pad">
          <div v-if="filesLoading" class="ins-dim">loading…</div>
          <div v-else-if="!files.length" class="ins-dim">no files touched</div>
          <div v-for="f in files" :key="f.path" class="file-row">
            <span class="file-op" :class="f.op">{{ f.op }}</span>
            <span class="file-path" :title="f.path">{{ bidiPath(f.path) }}</span>
            <span v-if="f.additions || f.deletions" class="diffstat">
              <span class="add">+{{ f.additions }}</span>
              <span class="del">−{{ f.deletions }}</span>
            </span>
            <button
              v-if="isLikelyTextPath(f.path)"
              class="vsc-btn"
              title="Open"
              @click.stop="fileViewers.open(f.path)"
            >
              ⧉ open
            </button>
            <button
              class="vsc-btn"
              title="Open in your editor"
              @click.stop="settings.openPath(f.path)"
            >
              {{ settings.editorLabel }}
            </button>
          </div>
        </div>

        <div v-else-if="activeTab === 'subagents'" class="ins-pad">
          <div v-if="childrenLoading" class="ins-dim">loading…</div>
          <div v-else-if="!children.length" class="ins-dim">no subagent runs</div>
          <div v-for="c in children" :key="c.id" class="child-row">
            <div class="child-body">
              <div class="child-title">{{ c.title ?? c.id }}</div>
              <div class="ins-dim">{{ c.agent ?? c.kind }}</div>
            </div>
            <button class="threadle-btn" @click="emit('add-child', c)">+ canvas</button>
          </div>
        </div>
      </div>
    </template>

    <!-- agent definition -->
    <div v-else-if="agentNodeData" class="ins-body ins-pad">
      <slot name="agent" />
    </div>

    <!-- context node -->
    <div v-else-if="contextData" class="ins-body ins-pad">
      <slot name="context" />
    </div>

    <!-- skill / rules node -->
    <div v-else-if="artifactData" class="ins-body ins-pad">
      <slot name="artifact" />
    </div>

    <!-- output node -->
    <div v-else-if="outputData" class="ins-body ins-pad">
      <slot name="output" />
    </div>

    <!-- prompt node -->
    <div v-else-if="promptData" class="ins-body ins-pad">
      <slot name="prompt" />
    </div>

    <!-- knot / merge node -->
    <div v-else-if="knotData" class="ins-body ins-pad">
      <slot name="knot" />
    </div>

    <!-- judge node -->
    <div v-else-if="judgeData" class="ins-body ins-pad">
      <slot name="judge" />
    </div>

    <!-- delay node -->
    <div v-else-if="delayData" class="ins-body ins-pad">
      <slot name="delay" />
    </div>

    <!-- data node -->
    <div v-else-if="dataNodeData" class="ins-body ins-pad">
      <slot name="data" />
    </div>

    <!-- custom node -->
    <div v-else-if="customData" class="ins-body ins-pad">
      <slot name="custom" />
    </div>

    <!-- MCP tool node -->
    <div v-else-if="mcpToolData" class="ins-body ins-pad">
      <slot name="mcp-tool" />
    </div>

    <div v-else class="ins-body ins-pad">
      <div class="ins-dim">
        No inspector for this node — edit it on the canvas.
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  AgentDef,
  AgentDefNodeData,
  ContextNodeData,
  CustomNodeData,
  DataNodeData,
  DelayNodeData,
  JudgeNodeData,
  KnotNodeData,
  McpToolNodeData,
  OutputNodeData,
  PromptNodeData,
  RulesNodeData,
  SessionRef,
  SkillNodeData,
  TouchedFile,
} from "@threadle/shared";
import TranscriptView from "./TranscriptView.vue";
import SessionInfoPanel from "./SessionInfoPanel.vue";
import SessionLivePill from "./SessionLivePill.vue";
import { api } from "@/api/client";
import { bidiPath, shortId } from "@/lib/format";
import { useSettingsStore } from "@/stores/settings";
import { useSessionsStore } from "@/stores/sessions";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";
import { useHorizontalResize } from "@/lib/useHorizontalResize";

const props = defineProps<{
  sessionRef?: { provider: string; sessionId: string; title?: string };
  agentDef?: AgentDef;
  agentNodeData?: AgentDefNodeData;
  contextData?: ContextNodeData;
  contextTitle?: string;
  artifactData?: SkillNodeData | RulesNodeData;
  outputData?: OutputNodeData;
  promptData?: PromptNodeData;
  knotData?: KnotNodeData;
  judgeData?: JudgeNodeData;
  delayData?: DelayNodeData;
  dataNodeData?: DataNodeData;
  customData?: CustomNodeData;
  mcpToolData?: McpToolNodeData;
  canInject?: boolean;
}>();

const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const sessions = useSessionsStore();

const inspectorLiveStatus = computed(() => {
  const ref_ = props.sessionRef;
  if (!ref_) return undefined;
  return sessions.find(ref_.provider, ref_.sessionId)?.status;
});
const emit = defineEmits<{
  close: [];
  "extract-selection": [range: [number, number]];
  "add-child": [child: SessionRef];
  inject: [];
}>();

void settings.load();

const {
  width: inspectorWidth,
  startDrag: startInspectorDrag,
  resetWidth: resetInspectorWidth,
} = useHorizontalResize(
  "threadle.inspector.width",
  480,
  340,
  860,
);

function openBlueprint(): void {
  if (!props.sessionRef) return;
  window.open(
    `/blueprint/${props.sessionRef.provider}/${props.sessionRef.sessionId}`,
    "_blank",
  );
}

const tabs = ["info", "transcript", "files", "subagents"] as const;
const activeTab = ref<(typeof tabs)[number]>("info");
const selection = ref<[number, number]>();

const files = ref<TouchedFile[]>([]);
const filesLoading = ref(false);
const children = ref<SessionRef[]>([]);
const childrenLoading = ref(false);

const title = computed(
  () =>
    props.sessionRef?.title ??
    props.agentDef?.name ??
    props.agentNodeData?.ref.name ??
    props.contextTitle ??
    props.artifactData?.name ??
    props.promptData?.label ??
    (props.promptData ? "Prompt" : undefined) ??
    props.knotData?.label ??
    (props.knotData ? "Merge" : undefined) ??
    props.judgeData?.label ??
    (props.judgeData ? "Judge" : undefined) ??
    props.delayData?.label ??
    (props.delayData ? "Delay" : undefined) ??
    props.dataNodeData?.label ??
    (props.dataNodeData ? "Data" : undefined) ??
    props.customData?.snapshot?.label ??
    props.customData?.ref.name ??
    props.mcpToolData?.label ??
    (props.mcpToolData ? props.mcpToolData.tool || "MCP tool" : undefined) ??
    (props.outputData ? "Output" : undefined) ??
    (props.sessionRef ? shortId(props.sessionRef.sessionId) : "Inspector"),
);

const subtitle = computed(() => {
  if (props.sessionRef) {
    return `${props.sessionRef.provider} · ${shortId(props.sessionRef.sessionId)}`;
  }
  if (props.agentDef) return props.agentDef.source;
  if (props.agentNodeData) return props.agentNodeData.ref.provider;
  if (props.contextData) return props.contextData.kind;
  if (props.artifactData) {
    const d = props.artifactData;
    return d.type === "skill"
      ? `skill · ${d.source ?? "SKILL.md"}`
      : `rules · ${d.source ?? d.name}`;
  }
  if (props.promptData) {
    const n = props.promptData.text?.length ?? 0;
    const t = props.promptData.valueType ?? "text";
    return n ? `${t} · ${n} chars · ∞ out` : `${t} · ∞ out`;
  }
  if (props.knotData) return `⋈ ${props.knotData.strategy} · multi-in · 1 out`;
  if (props.judgeData) {
    const n = props.judgeData.matchers?.length ?? 0;
    const miss = props.judgeData.unmatched === "park" ? "park" : "unsure";
    return `? ${n} matcher${n === 1 ? "" : "s"} · miss→${miss} · 1/3`;
  }
  if (props.delayData) {
    const s = Math.round((props.delayData.ms ?? 0) / 1000);
    if (s < 60) return `◷ ${s}s · 1 in · 1 out`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `◷ ${m}m ${rem}s · 1 in · 1 out` : `◷ ${m}m · 1 in · 1 out`;
  }
  if (props.dataNodeData) {
    const t = props.dataNodeData.valueType ?? "text";
    const n = props.dataNodeData.value?.length ?? 0;
    return n ? `◇ ${t} · ${n} chars · 1/1` : `◇ ${t} · 1 in · 1 out`;
  }
  if (props.customData) {
    const snap = props.customData.snapshot;
    const ni = snap?.inputs?.length;
    const no = snap?.outputs?.length;
    if (ni || no) return `⌁ ${(ni ?? 0)} in · ${(no ?? 0)} out`;
    return "⌁ 1 in · 1 out";
  }
  if (props.mcpToolData) {
    return `◈ ${props.mcpToolData.ref.server || "—"} · ${props.mcpToolData.tool || "—"}`;
  }
  if (props.outputData) {
    const mode = props.outputData.renderMode ?? "auto";
    const n = props.outputData.content?.length ?? 0;
    return n ? `${mode} · ${n} chars · 1/1` : `${mode} · 1 in · 1 out`;
  }
  return "";
});

watch(
  () => [props.sessionRef?.provider, props.sessionRef?.sessionId, activeTab.value],
  async () => {
    const ref_ = props.sessionRef;
    if (!ref_) return;
    if (activeTab.value === "files") {
      filesLoading.value = true;
      try {
        files.value = await api.files(ref_.provider, ref_.sessionId);
      } catch {
        files.value = [];
      } finally {
        filesLoading.value = false;
      }
    } else if (activeTab.value === "subagents") {
      childrenLoading.value = true;
      try {
        children.value = await api.children(ref_.provider, ref_.sessionId);
      } catch {
        children.value = [];
      } finally {
        childrenLoading.value = false;
      }
    }
  },
  { immediate: true },
);

watch(
  () => props.sessionRef?.sessionId,
  () => {
    activeTab.value = "info";
    selection.value = undefined;
  },
);
</script>

<style scoped>
.inspector {
  position: relative;
  flex-shrink: 0;
  background: var(--panel-bg);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  height: 100%;
}
.ins-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.ins-title-wrap {
  flex: 1;
  min-width: 0;
}
.ins-title {
  font-weight: 600;
  font-size: var(--fs-lg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ins-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  margin-top: 8px;
}
.ins-bp {
  flex-shrink: 0;
}
.ins-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-lg);
  padding: 6px;
  border-radius: var(--radius-sm);
}
.ins-close:hover {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.ins-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.ins-tab {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-transform: capitalize;
  font-family: var(--font);
}
.ins-tab:hover {
  color: var(--text);
}
.ins-tab.active {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.extract-btn {
  margin-left: auto;
  padding: 5px 10px;
  font-size: var(--fs-sm);
}
.ins-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ins-pad {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
.ins-dim {
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: var(--fs-sm);
}
.file-op {
  font-size: var(--fs-2xs);
  font-weight: 700;
  text-transform: uppercase;
  width: 44px;
  flex-shrink: 0;
  color: var(--text-dim);
}
.file-op.write,
.file-op.create {
  color: var(--status-running);
}
.file-op.edit,
.file-op.patch {
  color: var(--status-waiting);
}
.file-path {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.child-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.child-body {
  flex: 1;
  min-width: 0;
}
.child-title {
  font-size: var(--fs-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-meta {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.agent-raw {
  font-size: var(--fs-md);
}
</style>
