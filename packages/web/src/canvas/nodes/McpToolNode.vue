<template>
  <div
    class="mcp-node"
    :class="{
      selected,
      [`run-${status}`]: status && status !== 'idle',
      'probe-ok': probeFlash === 'ok',
      'probe-bad': probeFlash === 'bad',
    }"
  >
    <NodeCard
      :id="id"
      glyph="◈"
      icon-bg="var(--wire-mcp)"
      :title="fallbackTitle"
      :label="data.label"
      renamable
      :subtitle="subtitle"
      :status="status ?? 'idle'"
      :run-status="status ?? 'idle'"
      :selected="selected"
      has-input
      has-output
      out-handle-color="var(--wire-mcp)"
      @update:label="(v) => (data.label = v)"
    >
      <template v-if="data.ref.server" #trailing>
        <button
          type="button"
          class="mcp-btn"
          :title="probeTip"
          :disabled="busy"
          @click.stop="runProbe"
          @pointerdown.stop
        >
          {{ probing ? "…" : "⌀" }}
        </button>
        <button
          type="button"
          class="mcp-btn"
          title="Open MCP server details (connection, tools, schemas)"
          :disabled="busy"
          @click.stop="openInfo"
          @pointerdown.stop
        >
          {{ opening ? "…" : "ⓘ" }}
        </button>
      </template>
    </NodeCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { McpToolNodeData, NodeStatus } from "@threadle/shared";
import NodeCard from "./NodeCard.vue";
import { formatProbeLine, openMcpServerInfo, probeMcpConnection } from "@/lib/mcpInfo";

const props = defineProps<{
  id: string;
  data: McpToolNodeData;
  selected?: boolean;
  status?: NodeStatus;
  /** threadle --dir / health projectDir — discovery walks up from here */
  projectDir?: string;
}>();

const opening = ref(false);
const probing = ref(false);
const probeFlash = ref<"ok" | "bad" | "">("");
const probeTip = ref("Check MCP connection (handshake + optional list-databases)");
let probeFlashTimer: ReturnType<typeof setTimeout> | undefined;

const busy = computed(() => opening.value || probing.value);

const fallbackTitle = computed(() => props.data.tool || "MCP tool");
const subtitle = computed(() => {
  if (probeFlash.value === "ok") return "connection ok";
  if (probeFlash.value === "bad") return "connection failed";
  return props.data.snapshot?.serverLabel || props.data.ref.server || "pick a server";
});

async function resolveDir(): Promise<string | undefined> {
  let dir = props.projectDir?.trim() ?? "";
  if (!dir) {
    try {
      const h = (await fetch("/api/health").then((r) => r.json())) as { projectDir?: string };
      dir = h.projectDir?.trim() ?? "";
    } catch {
      /* ignore */
    }
  }
  return dir || undefined;
}

async function openInfo(): Promise<void> {
  const serverId = props.data.ref.server?.trim();
  if (!serverId || busy.value) return;
  opening.value = true;
  try {
    await openMcpServerInfo({
      serverId,
      selectedTool: props.data.tool || undefined,
      projectDir: await resolveDir(),
    });
  } finally {
    opening.value = false;
  }
}

async function runProbe(): Promise<void> {
  const serverId = props.data.ref.server?.trim();
  if (!serverId || busy.value) return;
  probing.value = true;
  probeFlash.value = "";
  try {
    const result = await probeMcpConnection({
      serverId,
      selectedTool: props.data.tool || undefined,
      projectDir: await resolveDir(),
    });
    probeFlash.value = result.ok ? "ok" : "bad";
    probeTip.value = formatProbeLine(result);
  } finally {
    probing.value = false;
    if (probeFlashTimer) clearTimeout(probeFlashTimer);
    probeFlashTimer = setTimeout(() => {
      probeFlash.value = "";
    }, 3200);
  }
}
</script>

<style scoped>
.mcp-node.probe-ok :deep(.threadle-node) {
  border-color: var(--status-success, #3d9a6a);
}
.mcp-node.probe-bad :deep(.threadle-node) {
  border-color: var(--status-error, #c44);
}
.mcp-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.mcp-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--panel-bg-raised);
}
.mcp-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
