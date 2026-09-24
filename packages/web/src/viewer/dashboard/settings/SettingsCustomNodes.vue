<template>
  <div class="settings-card internals-card">
    <div class="micro-label">custom nodes</div>
    <p class="stat-note internals-note">
      User-authored workflow nodes from
      <span class="mono">{{ customStatus?.dir ?? "~/.config/threadle/nodes" }}</span> —
      a TypeScript class in <span class="mono">node.ts</span> (or a
      <span class="mono">node.json</span> command manifest for any other language).
      Text in, text out, typed ports. Imports are validated on install; broken
      packages stay listed here with the error until you fix or remove them.
    </p>
    <div class="settings-row">
      <input
        v-model="newNodeName"
        class="threadle-input settings-cmd"
        placeholder="new node name, e.g. summarize-diff"
        spellcheck="false"
        @keydown.enter="createCustomNode"
      />
      <button class="threadle-btn primary" :disabled="!newNodeName.trim() || creatingNode" @click="createCustomNode">
        {{ creatingNode ? "Creating…" : "＋ Create node" }}
      </button>
    </div>
    <p v-if="newNodeError" class="stat-note cnode-err">{{ newNodeError }}</p>
    <div class="settings-row">
      <input
        v-model="importNodeUrl"
        class="threadle-input settings-cmd"
        placeholder="import — git URL or local path (https://github.com/… · ~/projects/my-node)"
        spellcheck="false"
        @keydown.enter="importCustomNode"
      />
      <button class="threadle-btn" :disabled="!importNodeUrl.trim() || importingNode" @click="importCustomNode">
        {{ importingNode ? "Cloning…" : "⇣ Import" }}
      </button>
      <button class="threadle-btn" :disabled="importingNode" title="Pick a node folder from disk" @click="browseInput?.click()">
        ⌸ Browse…
      </button>
      <input
        ref="browseInput"
        type="file"
        webkitdirectory
        multiple
        class="browse-hidden"
        @change="uploadNodeFolder"
      />
    </div>
    <p v-if="importNodeError" class="stat-note cnode-err">{{ importNodeError }}</p>
    <p v-else-if="importNodeNote" class="stat-note">{{ importNodeNote }}</p>
    <p class="stat-note">
      Imported nodes run as <em>you</em> — install only nodes you trust. Nothing
      executes on import: metadata is validated in a sandboxed child, and the code runs
      only when you wire the node and press Run. Disable a node to hide it from the
      palette without deleting the folder.
    </p>
    <p v-if="customStatus?.nodes.length" class="stat-note mono cnode-summary">
      {{ customNodeCounts.installed }} installed
      · {{ customNodeCounts.enabled }} enabled
      · {{ customNodeCounts.disabled }} disabled
      · {{ customNodeCounts.error }} error{{ customNodeCounts.error === 1 ? "" : "s" }}
    </p>
    <div
      v-if="customStatus?.nodes.length"
      class="stat-table cols-cnodes"
      v-col-resize="'cnodes'"
      data-cols="minmax(0,1fr) 88px minmax(0,1fr) 168px"
    >
      <div class="stat-cols micro-label">
        <span>node</span><span class="num">status</span><span>command</span><span></span>
      </div>
      <div
        v-for="n in customStatus.nodes"
        :key="n.id + ':' + n.dir"
        class="stat-row"
        :class="{
          'cnode-broken': n.status === 'error',
          'cnode-disabled': n.status === 'disabled',
        }"
      >
        <span class="stat-name internals-name">
          <span>
            <span class="cnode-glyph mono">{{ n.glyph ?? (n.status === "error" ? "✗" : "⌁") }}</span>
            {{ n.label ?? n.id }}
          </span>
          <span
            class="internals-desc"
            :class="{ 'cnode-err': n.status === 'error' }"
            :title="n.status === 'error' ? n.error : n.description ?? n.id"
          >{{ n.status === "error" ? n.error : (n.description ?? n.id) }}</span>
        </span>
        <span class="stat-val num">
          <span class="cnode-status" :data-status="n.status">{{ n.status }}</span>
        </span>
        <span
          class="stat-val cnode-cmd mono"
          :title="
            n.status === 'error'
              ? n.error
              : n.kind === 'class'
                ? `TypeScript class · ${n.file}`
                : n.command?.join(' ')
          "
        >{{
          n.status === "error"
            ? "—"
            : n.kind === "class"
              ? `⌁ class · ${n.file}`
              : n.command?.join(" ")
        }}</span>
        <span class="stat-val internals-action cnode-actions">
          <div
            v-if="n.status !== 'error'"
            class="settings-seg"
            role="group"
            :aria-label="`${n.label ?? n.id} palette`"
          >
            <button
              type="button"
              class="settings-seg-btn"
              :class="{ active: n.status === 'disabled' }"
              :disabled="togglingNode === n.id"
              title="Hide from palette (keep on disk)"
              @click.stop="setCustomNodeEnabled(n, false)"
            >
              off
            </button>
            <button
              type="button"
              class="settings-seg-btn"
              :class="{ active: n.status === 'enabled' }"
              :disabled="togglingNode === n.id"
              title="Show in palette"
              @click.stop="setCustomNodeEnabled(n, true)"
            >
              on
            </button>
          </div>
          <button
            type="button"
            class="row-icon"
            :title="`Open in ${settings.editorLabel}`"
            @click.stop="settings.openPath(`${customStatus.dir}/${n.dir}`)"
          >
            ⟨/⟩
          </button>
        </span>
      </div>
    </div>
    <p v-else class="stat-note">
      none yet — create <span class="mono">~/.config/threadle/nodes/&lt;name&gt;/node.json</span>
      with a <span class="mono">command</span> array and it appears here, in the palette
      and in the canvas menus.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { vColResize } from "@/lib/colResize";
import { useSettingsStore } from "@/stores/settings";
import { useCustomNodes } from "@/stores/custom-nodes";
import "../chrome.css";

interface CustomNodeStatusRow {
  id: string;
  dir: string;
  status: "enabled" | "disabled" | "error";
  error?: string;
  label?: string;
  glyph?: string;
  description?: string;
  kind?: "class" | "command";
  command?: string[];
  file?: string;
  envInherit?: boolean;
}

interface CustomNodeStatus {
  dir: string;
  nodes: CustomNodeStatusRow[];
}

const settings = useSettingsStore();
const customNodes = useCustomNodes();

const customStatus = ref<CustomNodeStatus>();
const newNodeName = ref("");
const newNodeError = ref("");
const creatingNode = ref(false);
const importNodeUrl = ref("");
const importNodeError = ref("");
const importNodeNote = ref("");
const importingNode = ref(false);
const togglingNode = ref<string>();
const browseInput = ref<HTMLInputElement>();

const customNodeCounts = computed(() => {
  const nodes = customStatus.value?.nodes ?? [];
  return {
    installed: nodes.length,
    enabled: nodes.filter((n) => n.status === "enabled").length,
    disabled: nodes.filter((n) => n.status === "disabled").length,
    error: nodes.filter((n) => n.status === "error").length,
  };
});

async function loadCustomStatus(): Promise<void> {
  try {
    const body = (await (await fetch("/api/custom-nodes/status")).json()) as {
      dir: string;
      nodes?: CustomNodeStatusRow[];
      defs?: Array<{
        name: string;
        dir: string;
        kind: "class" | "command";
        label: string;
        glyph: string;
        description?: string;
        command?: string[];
        file?: string;
      }>;
      invalid?: Array<{ name: string; error: string }>;
    };
    const nodes: CustomNodeStatusRow[] = Array.isArray(body.nodes)
      ? body.nodes
      : [
          ...(body.defs ?? []).map((d) => ({
            id: d.name,
            dir: d.dir,
            status: "enabled" as const,
            label: d.label,
            glyph: d.glyph,
            description: d.description,
            kind: d.kind,
            command: d.command,
            file: d.file,
          })),
          ...(body.invalid ?? []).map((b) => ({
            id: b.name,
            dir: b.name,
            status: "error" as const,
            error: b.error,
            glyph: "✗",
            label: b.name,
          })),
        ];
    customStatus.value = { dir: body.dir, nodes };
    void customNodes.load(true);
  } catch {
    // server unreachable — keep whatever we had
  }
}

async function setCustomNodeEnabled(n: CustomNodeStatusRow, enabled: boolean): Promise<void> {
  if (n.status === "error" || togglingNode.value) return;
  if ((n.status === "enabled") === enabled) return;
  togglingNode.value = n.id;
  importNodeError.value = "";
  try {
    const r = await fetch("/api/custom-nodes/enabled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n.id, enabled }),
    });
    const body = (await r.json()) as { ok?: boolean; error?: string };
    if (!r.ok || !body.ok) {
      importNodeError.value = body.error ?? `toggle failed (${r.status})`;
      return;
    }
    await loadCustomStatus();
  } catch (err) {
    importNodeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    togglingNode.value = undefined;
  }
}

async function uploadNodeFolder(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (!files.length) return;
  importingNode.value = true;
  importNodeError.value = "";
  importNodeNote.value = "";
  try {
    const first = files[0] as File & { webkitRelativePath?: string };
    const folder = first.webkitRelativePath?.split("/")[0] ?? "imported-node";
    const payload: Array<{ path: string; b64: string }> = [];
    for (const f of files as Array<File & { webkitRelativePath?: string }>) {
      const rel = f.webkitRelativePath?.split("/").slice(1).join("/") || f.name;
      if (/(^|\/)(\.git|node_modules)(\/|$)/.test(rel)) continue;
      if (f.size > 2 * 1024 * 1024) {
        importNodeError.value = `${rel} exceeds 2 MB — not a node folder?`;
        return;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      payload.push({ path: rel, b64: btoa(bin) });
    }
    const r = await fetch("/api/custom-nodes/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder, files: payload }),
    });
    const body = (await r.json()) as {
      ok?: boolean;
      invalid?: { error: string };
      warning?: string;
      error?: string;
      name?: string;
    };
    if (!r.ok || !body.ok) {
      importNodeError.value = body.error ?? `upload failed (${r.status})`;
      return;
    }
    importNodeNote.value = `installed “${body.name ?? folder}”`;
    await loadCustomStatus();
  } catch (err) {
    importNodeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    importingNode.value = false;
  }
}

async function importCustomNode(): Promise<void> {
  if (!importNodeUrl.value.trim() || importingNode.value) return;
  importingNode.value = true;
  importNodeError.value = "";
  importNodeNote.value = "";
  try {
    const r = await fetch("/api/custom-nodes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: importNodeUrl.value }),
    });
    const body = (await r.json()) as {
      ok?: boolean;
      invalid?: { error: string };
      warning?: string;
      error?: string;
      name?: string;
    };
    if (!r.ok || !body.ok) {
      importNodeError.value = body.error ?? `import failed (${r.status})`;
      return;
    }
    importNodeNote.value = `installed “${body.name ?? "node"}”`;
    importNodeUrl.value = "";
    await loadCustomStatus();
  } catch (err) {
    importNodeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    importingNode.value = false;
  }
}

async function createCustomNode(): Promise<void> {
  if (!newNodeName.value.trim() || creatingNode.value) return;
  creatingNode.value = true;
  newNodeError.value = "";
  try {
    const r = await fetch("/api/custom-nodes/scaffold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newNodeName.value }),
    });
    const body = (await r.json()) as { ok?: boolean; path?: string; error?: string };
    if (!r.ok || !body.ok) {
      newNodeError.value = body.error ?? `scaffold failed (${r.status})`;
      return;
    }
    newNodeName.value = "";
    await loadCustomStatus();
    if (body.path) settings.openPath(body.path);
  } catch (err) {
    newNodeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    creatingNode.value = false;
  }
}

onMounted(() => {
  void loadCustomStatus();
});
</script>
