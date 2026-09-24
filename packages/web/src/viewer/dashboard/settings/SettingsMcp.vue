<template>
  <div class="settings-card internals-card">
    <div class="micro-label">MCP</div>
    <p class="stat-note internals-note">
      Two directions:
      <b>server</b> — <span class="mono">threadle mcp</span> exposes saved workflows as
      <span class="mono">wf_&lt;graphId&gt;</span> (publish allowlist below — empty by default);
      <b>client</b> — canvas <b>◈ MCP tool</b> calls discovered stdio / HTTP / SSE servers.
      Also reads <span class="mono">~/.config/threadle/mcp/servers.json</span>.
      Docs: <span class="mono">docs/mcp.md</span>.
    </p>
    <div class="settings-row" title="When off, canvas MCP tool discovery and calls are refused">
      <span class="settings-opt-label">MCP client</span>
      <div class="settings-seg" role="group" aria-label="MCP client">
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !settings.mcpClientEnabled }"
          :disabled="settings.saving"
          @click="setMcpClientEnabled(false)"
        >
          off
        </button>
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: settings.mcpClientEnabled }"
          :disabled="settings.saving"
          @click="setMcpClientEnabled(true)"
        >
          on
        </button>
      </div>
    </div>
    <label class="field" style="display:flex;flex-direction:column;gap:4px;margin:8px 0">
      <span class="micro-label">publish allowlist (graph ids)</span>
      <textarea
        class="threadle-input mono"
        rows="3"
        :value="
          settings.mcpPublishAllowlist === null
            ? '*'
            : (settings.mcpPublishAllowlist ?? []).join('\n')
        "
        placeholder="empty = publish none · one graph id per line · * alone = all"
        spellcheck="false"
        @change="onPublishAllowlist(($event.target as HTMLTextAreaElement).value)"
      />
    </label>
    <div class="mcp-snippet mono">
      <div class="micro-label">host .mcp.json</div>
      <pre class="mcp-pre">{
  "mcpServers": {
    "threadle": {
      "command": "threadle",
      "args": ["mcp"]
    }
  }
}</pre>
    </div>
    <div class="settings-row">
      <button
        class="threadle-btn"
        :disabled="mcpLoading"
        title="Re-scan project, threadle registry, and user MCP configs"
        @click="loadMcpServers"
      >{{ mcpLoading ? "Scanning…" : "⟳ Refresh servers" }}</button>
      <button
        v-if="mcpRegistryDir"
        type="button"
        class="row-icon"
        title="Open threadle MCP registry folder"
        @click="settings.openPath(mcpRegistryDir)"
      >⟨/⟩</button>
      <span v-if="mcpServers.length" class="stat-note mono cnode-summary">
        {{ mcpServers.length }} server{{ mcpServers.length === 1 ? "" : "s" }}
        <template v-if="!settings.mcpClientEnabled"> · client off</template>
      </span>
    </div>
    <p v-if="mcpError" class="stat-note cnode-err">{{ mcpError }}</p>
    <div
      v-if="mcpServers.length"
      class="stat-table cols-mcp"
      v-col-resize="'mcp'"
      data-cols="minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr) 7rem"
    >
      <div class="stat-cols micro-label">
        <span>server</span><span>endpoint</span><span>source</span><span></span>
      </div>
      <div v-for="s in mcpServers" :key="s.id" class="stat-row">
        <span class="stat-name internals-name">
          <span>
            <span class="cnode-glyph mono">◈</span>
            {{ s.id }}
            <span v-if="s.threadle" class="mcp-badge mono" title="This entry runs threadle mcp">threadle</span>
            <span class="mcp-badge mono" :title="s.transport">{{ s.transport || "stdio" }}</span>
          </span>
          <span class="internals-desc" :title="s.label">{{ s.label !== s.id ? s.label : (s.transport || "stdio") }}</span>
        </span>
        <span
          class="stat-val cnode-cmd mono"
          :title="formatMcpEndpoint(s)"
        >{{ formatMcpEndpoint(s) }}</span>
        <span class="stat-val mcp-source mono" :title="s.source">{{ shortMcpSource(s.source) }}</span>
        <span class="stat-val internals-action cnode-actions">
          <div class="settings-seg" role="group" :aria-label="`MCP server ${s.id}`">
            <button
              type="button"
              class="settings-seg-btn"
              :class="{ active: isMcpDisabled(s.id) }"
              :disabled="settings.saving"
              title="Disable for canvas client"
              @click="setMcpServerEnabled(s.id, false)"
            >
              off
            </button>
            <button
              type="button"
              class="settings-seg-btn"
              :class="{ active: !isMcpDisabled(s.id) }"
              :disabled="settings.saving"
              title="Enable for canvas client"
              @click="setMcpServerEnabled(s.id, true)"
            >
              on
            </button>
          </div>
        </span>
      </div>
    </div>
    <p v-else-if="!mcpLoading" class="stat-note">
      No MCP servers found. Add
      <span class="mono">.mcp.json</span> /
      <span class="mono">~/.config/threadle/mcp/servers.json</span> /
      host configs, then refresh.
    </p>
    <p class="stat-note">
      Palette: drop <b>◈ MCP tool</b>, pick a server and tool in the inspector.
      Nested calls into <span class="mono">threadle mcp</span> from a workflow that was
      itself started via MCP are refused (<span class="mono">THREADLE_MCP_DEPTH</span>).
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { vColResize } from "@/lib/colResize";
import { useSettingsStore } from "@/stores/settings";
import "../chrome.css";

interface McpServerRow {
  id: string;
  label: string;
  source: string;
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  threadle?: boolean;
  disabled?: boolean;
}

const settings = useSettingsStore();

const mcpServers = ref<McpServerRow[]>([]);
const mcpLoading = ref(false);
const mcpError = ref("");
const mcpRegistryDir = ref("");

function formatMcpEndpoint(s: McpServerRow): string {
  if (s.url) {
    return s.url.length > 64 ? `${s.url.slice(0, 61)}…` : s.url;
  }
  const parts = [s.command, ...(s.args ?? [])].filter(Boolean);
  const joined = parts.join(" ");
  return joined.length > 64 ? `${joined.slice(0, 61)}…` : joined || "—";
}

function shortMcpSource(source: string): string {
  if (source.includes("/mcp/servers.json") || source.endsWith("mcp/servers.json")) {
    return "threadle registry";
  }
  const home = source.includes("/.cursor/")
    ? source.replace(/^.*(\/\.cursor\/.*)$/, "~$1").replace(/^.*(\\.cursor\\.*)$/i, "~$1")
    : source.includes("/.claude.json")
      ? "~/.claude.json"
      : source.includes("/.config/opencode/")
        ? source.replace(/^.*(\/\.config\/opencode\/[^/]+)$/, "~$1")
        : source;
  const base = home.split(/[/\\]/).slice(-2).join("/");
  if (source.endsWith(".mcp.json") || source.endsWith("mcp.json")) {
    return source.includes(".cursor") ? ".cursor/mcp.json" : ".mcp.json";
  }
  return base || source;
}

function isMcpDisabled(id: string): boolean {
  return settings.mcpDisabledServers.includes(id);
}

async function setMcpServerEnabled(id: string, enabled: boolean): Promise<void> {
  const disabled = isMcpDisabled(id);
  if (enabled === !disabled) return;
  const cur = new Set(settings.mcpDisabledServers);
  if (enabled) cur.delete(id);
  else cur.add(id);
  settings.mcpDisabledServers = [...cur];
  await settings.save();
  await loadMcpServers();
}

function onPublishAllowlist(raw: string): void {
  const trimmed = raw.trim();
  if (trimmed === "*") {
    settings.mcpPublishAllowlist = null;
    void settings.save();
    return;
  }
  const ids = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  settings.mcpPublishAllowlist = ids;
  void settings.save();
}

async function setMcpClientEnabled(on: boolean): Promise<void> {
  if (settings.mcpClientEnabled === on) return;
  settings.mcpClientEnabled = on;
  await settings.save();
}

async function loadMcpServers(): Promise<void> {
  mcpLoading.value = true;
  mcpError.value = "";
  try {
    const r = await fetch("/api/mcp/servers");
    const body = (await r.json()) as {
      servers?: McpServerRow[];
      error?: string;
      registryDir?: string;
      mcpClientEnabled?: boolean;
      mcpDisabledServers?: string[];
    };
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
    mcpServers.value = body.servers ?? [];
    mcpRegistryDir.value = body.registryDir ?? "";
    if (typeof body.mcpClientEnabled === "boolean") {
      settings.mcpClientEnabled = body.mcpClientEnabled;
    }
    if (Array.isArray(body.mcpDisabledServers)) {
      settings.mcpDisabledServers = body.mcpDisabledServers;
    }
  } catch (err) {
    mcpServers.value = [];
    mcpError.value = err instanceof Error ? err.message : String(err);
  } finally {
    mcpLoading.value = false;
  }
}

onMounted(() => {
  void loadMcpServers();
});
</script>
