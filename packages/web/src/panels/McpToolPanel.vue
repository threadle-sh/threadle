<template>
  <div class="mcp-panel">
    <p v-if="data.snapshot?.toolDescription" class="hint">{{ data.snapshot.toolDescription }}</p>
    <p v-else class="hint dim">Pick a discovered MCP server and tool. Inbound text fills argPort when set.</p>
    <p v-if="data.argPort" class="hint dim">
      Wire inbound text into <span class="mono">{{ data.argPort }}</span> — leave that param empty below.
    </p>

    <div class="mcp-actions">
      <button
        type="button"
        class="threadle-btn mcp-action-btn"
        :disabled="!data.ref.server || busy"
        :title="data.ref.server ? `Check connection for ${data.ref.server}` : 'Pick a server first'"
        @click="runProbe"
      >
        {{ probing ? "…" : "⌀" }} check
      </button>
      <button
        type="button"
        class="threadle-btn mcp-action-btn"
        :disabled="!data.ref.server || busy"
        :title="data.ref.server ? `Open details for ${data.ref.server}` : 'Pick a server first'"
        @click="openInfo"
      >
        {{ openingInfo ? "…" : "ⓘ" }} details
      </button>
    </div>
    <p v-if="probeLine" class="probe-line mono" :class="{ ok: probeOk === true, bad: probeOk === false }">
      {{ probeLine }}
    </p>

    <label class="field field-row">
      <span class="micro-label">label</span>
      <input
        class="threadle-input field-label"
        :value="data.label ?? ''"
        placeholder="optional"
        spellcheck="false"
        @input="onLabel(($event.target as HTMLInputElement).value)"
      />
    </label>

    <label class="field">
      <span class="micro-label">server</span>
      <select
        class="threadle-input"
        :value="data.ref.server"
        :disabled="loadingServers"
        @change="onServer(($event.target as HTMLSelectElement).value)"
      >
        <option value="">—</option>
        <option v-for="s in servers" :key="s.id" :value="s.id">
          {{ s.id }}{{ s.transport && s.transport !== "stdio" ? ` · ${s.transport}` : "" }}{{ s.source ? ` · ${shortSource(s.source)}` : "" }}
        </option>
      </select>
    </label>

    <label class="field">
      <span class="micro-label">tool</span>
      <select
        class="threadle-input"
        :value="data.tool"
        :disabled="!data.ref.server || loadingTools"
        @change="onTool(($event.target as HTMLSelectElement).value)"
      >
        <option value="">—</option>
        <option v-for="t in tools" :key="t.name" :value="t.name">{{ t.name }}</option>
      </select>
    </label>

    <label class="field">
      <span class="micro-label">arg port (inbound text)</span>
      <input
        class="threadle-input mono"
        :value="data.argPort ?? ''"
        placeholder="optional arg name"
        spellcheck="false"
        @input="setArgPort(($event.target as HTMLInputElement).value)"
      />
    </label>

    <div v-if="paramDefs.length" class="sect">
      <div class="micro-label">params</div>
      <label v-for="p in paramDefs" :key="p.name" class="field">
        <span class="micro-label">{{ p.label ?? p.name }}</span>
        <input
          v-if="p.type === 'bool'"
          type="checkbox"
          :checked="/^(true|1)$/i.test(valueOf(p))"
          @change="setParam(p.name, ($event.target as HTMLInputElement).checked ? 'true' : 'false')"
        />
        <textarea
          v-else-if="p.type === 'json' || p.multiline"
          class="threadle-input mono"
          rows="2"
          spellcheck="false"
          :value="valueOf(p)"
          :placeholder="p.default ?? ''"
          @input="setParam(p.name, ($event.target as HTMLTextAreaElement).value)"
        />
        <input
          v-else
          class="threadle-input"
          :class="{ mono: p.type === 'int' || p.type === 'float' }"
          :type="p.type === 'int' || p.type === 'float' ? 'number' : 'text'"
          :value="valueOf(p)"
          :placeholder="p.default ?? ''"
          spellcheck="false"
          @input="setParam(p.name, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <div v-if="!loadingServers && !servers.length" class="empty mono">
      <p>No MCP servers available for <span class="path">{{ projectDir || "—" }}</span>.</p>
      <p class="dim">
        Add <span class="path">.mcp.json</span>,
        <span class="path">~/.config/threadle/mcp/servers.json</span>,
        or host configs (Cursor / Claude / opencode / Antigravity / Codex).
        Enable the MCP client in Settings if it is off; disabled servers are hidden here.
      </p>
      <button type="button" class="threadle-btn" :disabled="loadingServers" @click="loadServers">
        ⟳ Refresh
      </button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { CustomParamDef, McpToolNodeData } from "@threadle/shared";
import { formatProbeLine, openMcpServerInfo, probeMcpConnection } from "@/lib/mcpInfo";

const props = defineProps<{
  data: McpToolNodeData;
  /** threadle --dir / health projectDir — discovery walks up to the git root from here */
  projectDir?: string;
}>();

interface ServerRow {
  id: string;
  label: string;
  source: string;
  transport?: string;
  disabled?: boolean;
}
interface ToolRow {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const servers = ref<ServerRow[]>([]);
const tools = ref<ToolRow[]>([]);
const loadingServers = ref(false);
const loadingTools = ref(false);
const openingInfo = ref(false);
const probing = ref(false);
const probeLine = ref("");
const probeOk = ref<boolean | null>(null);
const error = ref("");

const busy = computed(() => openingInfo.value || probing.value || loadingServers.value);

const paramDefs = computed<CustomParamDef[]>(() => props.data.snapshot?.params ?? []);

function serversUrl(): string {
  const dir = props.projectDir?.trim();
  if (!dir) return "/api/mcp/servers";
  return `/api/mcp/servers?dir=${encodeURIComponent(dir)}`;
}

function toolsUrl(serverId: string): string {
  const base = `/api/mcp/servers/${encodeURIComponent(serverId)}/tools`;
  const dir = props.projectDir?.trim();
  if (!dir) return base;
  return `${base}?dir=${encodeURIComponent(dir)}`;
}

function shortSource(source: string): string {
  if (source.includes(`${pathSep()}mcp${pathSep()}servers.json`) || source.endsWith("mcp/servers.json")) {
    return "threadle registry";
  }
  if (source.includes(`${pathSep()}.cursor${pathSep()}mcp.json`) || source.endsWith(".cursor/mcp.json")) {
    return ".cursor/mcp.json";
  }
  if (source.endsWith(".mcp.json") || source.endsWith("mcp.json")) return ".mcp.json";
  if (source.endsWith("mcp_config.json")) return "antigravity";
  if (source.endsWith("mcp-config.json") || source.includes(".copilot")) return "copilot";
  if (source.includes(".grok")) return "grok";
  if (source.endsWith("config.toml")) return "codex";
  if (source.includes("opencode")) return "opencode";
  if (source.endsWith(".claude.json")) return "claude";
  if (source.includes(".github") && source.endsWith("mcp.json")) return "copilot";
  const parts = source.split(/[/\\]/);
  return parts[parts.length - 1] || source;
}

function pathSep(): string {
  return props.projectDir?.includes("\\") ? "\\" : "/";
}

function valueOf(p: CustomParamDef): string {
  return props.data.params?.[p.name] ?? p.default ?? "";
}

function setParam(name: string, value: string): void {
  props.data.params = { ...(props.data.params ?? {}), [name]: value };
}

function schemaToParams(schema: Record<string, unknown> | undefined): CustomParamDef[] {
  if (!schema || typeof schema !== "object") return [];
  const propsObj = schema.properties;
  if (!propsObj || typeof propsObj !== "object") return [];
  const out: CustomParamDef[] = [];
  for (const [name, def] of Object.entries(propsObj as Record<string, unknown>)) {
    const d = (def && typeof def === "object" ? def : {}) as { type?: string; description?: string };
    const type: CustomParamDef["type"] =
      d.type === "integer"
        ? "int"
        : d.type === "number"
          ? "float"
          : d.type === "boolean"
            ? "bool"
            : d.type === "object" || d.type === "array"
              ? "json"
              : "text";
    out.push({ name, type, description: d.description });
  }
  return out;
}

async function loadServers(): Promise<void> {
  loadingServers.value = true;
  error.value = "";
  try {
    const r = await fetch(serversUrl());
    const body = (await r.json()) as {
      servers?: ServerRow[];
      error?: string;
      mcpClientEnabled?: boolean;
    };
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
    if (body.mcpClientEnabled === false) {
      servers.value = [];
      error.value = "MCP client is disabled in Settings";
      return;
    }
    servers.value = (body.servers ?? []).filter((s) => !s.disabled);
  } catch (err) {
    servers.value = [];
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingServers.value = false;
  }
}

async function loadTools(serverId: string): Promise<void> {
  if (!serverId) {
    tools.value = [];
    return;
  }
  loadingTools.value = true;
  error.value = "";
  try {
    const r = await fetch(toolsUrl(serverId));
    const body = (await r.json()) as { tools?: ToolRow[]; error?: string };
    if (!r.ok || body.error) throw new Error(body.error ?? `HTTP ${r.status}`);
    tools.value = body.tools ?? [];
  } catch (err) {
    tools.value = [];
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingTools.value = false;
  }
}

function onServer(id: string): void {
  props.data.ref.server = id;
  props.data.tool = "";
  props.data.argPort = undefined;
  props.data.params = {};
  props.data.snapshot = {
    ...(props.data.snapshot ?? {}),
    serverLabel: id,
    params: [],
    toolDescription: undefined,
  };
  void loadTools(id);
}

function onTool(name: string): void {
  props.data.tool = name;
  const t = tools.value.find((x) => x.name === name);
  const params = schemaToParams(t?.inputSchema);
  const allowed = new Set(params.map((p) => p.name));
  // Drop leftover params / argPort from a previous tool (e.g. mongodb → echo).
  const prev = props.data.params ?? {};
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(prev)) {
    if (allowed.has(k) && v !== undefined && v !== "") next[k] = v;
  }
  props.data.params = next;
  if (props.data.argPort && !allowed.has(props.data.argPort)) {
    props.data.argPort = undefined;
  }
  props.data.snapshot = {
    ...(props.data.snapshot ?? {}),
    toolDescription: t?.description,
    params,
  };
  if (!props.data.argPort && params[0]?.type === "text") {
    props.data.argPort = params[0].name;
  }
}

function setArgPort(v: string): void {
  props.data.argPort = v.trim() || undefined;
}

function onLabel(v: string): void {
  props.data.label = v.trim() || undefined;
}

async function openInfo(): Promise<void> {
  const serverId = props.data.ref.server?.trim();
  if (!serverId || busy.value) return;
  openingInfo.value = true;
  try {
    await openMcpServerInfo({
      serverId,
      selectedTool: props.data.tool || undefined,
      projectDir: props.projectDir,
    });
  } finally {
    openingInfo.value = false;
  }
}

async function runProbe(): Promise<void> {
  const serverId = props.data.ref.server?.trim();
  if (!serverId || busy.value) return;
  probing.value = true;
  probeLine.value = "checking…";
  probeOk.value = null;
  error.value = "";
  try {
    const result = await probeMcpConnection({
      serverId,
      selectedTool: props.data.tool || undefined,
      projectDir: props.projectDir,
    });
    probeOk.value = result.ok;
    probeLine.value = formatProbeLine(result);
    if (result.deepPreview) {
      probeLine.value += ` · ${result.deepPreview.replace(/\s+/g, " ").slice(0, 80)}`;
    }
    if (!result.ok && result.error) error.value = result.error;
    // Refresh tool dropdown from a successful handshake.
    if (result.ok && props.data.ref.server) void loadTools(props.data.ref.server);
  } finally {
    probing.value = false;
  }
}

onMounted(() => {
  void loadServers().then(() => {
    if (props.data.ref.server) void loadTools(props.data.ref.server);
  });
});

watch(
  () => props.projectDir,
  () => {
    void loadServers().then(() => {
      if (props.data.ref.server) void loadTools(props.data.ref.server);
    });
  },
);

watch(
  () => props.data.ref.server,
  (id) => {
    if (id && !tools.value.length) void loadTools(id);
  },
);
</script>

<style scoped>
.mcp-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hint {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  line-height: 1.4;
}
.hint.dim,
.dim {
  opacity: 0.7;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.field-row .micro-label {
  flex: 0 0 auto;
}
.field-label {
  flex: 1;
  min-width: 0;
  width: auto;
  text-align: left;
}
.sect {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 8px 0 0;
  font-size: var(--fs-sm);
  color: var(--fg-muted);
  line-height: 1.4;
}
.empty p {
  margin: 0;
}
.path {
  color: var(--fg);
}
.err {
  margin: 0;
  color: var(--status-error);
  font-size: var(--fs-sm);
}
.mcp-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mcp-action-btn {
  font-family: var(--mono);
  font-size: var(--fs-sm);
}
.probe-line {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.35;
}
.probe-line.ok {
  color: var(--status-success, #3d9a6a);
}
.probe-line.bad {
  color: var(--status-error);
}
</style>
