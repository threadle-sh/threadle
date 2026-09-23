<template>
  <header class="dash-head">
    <div class="dash-head-copy">
      <h1 class="dash-title">Settings</h1>
      <p class="micro-label dash-summary">~/.config/threadle/settings.json</p>
    </div>
  </header>

  <div class="micro-label stat-section">interface</div>

  <div class="settings-card">
    <div class="micro-label">appearance</div>
    <div class="chip-row">
      <button
        class="filter-chip"
        :class="{ active: settings.appearance === 'system' }"
        :disabled="settings.saving"
        @click="setAppearance('system')"
      >
        system
      </button>
      <button
        class="filter-chip"
        :class="{ active: settings.appearance === 'light' }"
        :disabled="settings.saving"
        @click="setAppearance('light')"
      >
        light
      </button>
      <button
        class="filter-chip"
        :class="{ active: settings.appearance === 'dark' }"
        :disabled="settings.saving"
        @click="setAppearance('dark')"
      >
        dark
      </button>
    </div>
    <p class="stat-note">
      <b>system</b> follows the OS color scheme. Preference is stored in
      <span class="mono">settings.json</span> and applied immediately.
    </p>
  </div>

  <div class="settings-card">
    <div class="micro-label">provider colors</div>
    <div class="prov-color-list">
      <div v-for="id in PROVIDER_IDS" :key="id" class="prov-color-row">
        <span class="prov-dot" :style="{ background: providerColor(id) }" />
        <span class="prov-color-name">{{ providerLabel(id) }}</span>
        <span class="prov-color-id mono">{{ id }}</span>
        <input
          class="prov-color-swatch"
          type="color"
          :value="settings.providerColorValue(id)"
          :disabled="settings.saving"
          :title="`Color for ${providerLabel(id)}`"
          @change="onProviderColorInput(id, ($event.target as HTMLInputElement).value)"
        />
        <input
          class="threadle-input mono prov-color-hex"
          :value="settings.providerColorValue(id)"
          :disabled="settings.saving"
          maxlength="7"
          spellcheck="false"
          @change="onProviderColorInput(id, ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>
    <div class="settings-row prov-color-actions">
      <button
        class="threadle-btn"
        :disabled="settings.saving || !settings.providerColorsCustomized"
        title="Restore built-in provider accents"
        @click="resetProviderColors"
      >
        Reset to defaults
      </button>
    </div>
    <p class="stat-note">
      Accents for session dots, wires, and transcript agent labels. Stored in
      <span class="mono">settings.json</span> under <span class="mono">providerColors</span>.
    </p>
  </div>

  <div class="micro-label stat-section">workspace</div>

  <div class="settings-card">
    <div class="micro-label">default file opener</div>
    <div class="settings-row">
      <select v-model="settings.mode" class="threadle-input settings-select">
        <option value="vscode">VS Code</option>
        <option value="vscode-insiders">VS Code Insiders</option>
        <option value="cursor">Cursor</option>
        <option value="zed">Zed</option>
        <option value="command">custom command…</option>
      </select>
      <input
        v-if="settings.mode === 'command'"
        v-model="settings.command"
        class="threadle-input settings-cmd"
        placeholder="e.g. emacsclient -n · gvim · subl · nvim-qt"
        spellcheck="false"
      />
      <button class="threadle-btn primary" :disabled="settings.saving" @click="saveSettings">
        {{ settings.saving ? "Saving…" : "Save" }}
      </button>
      <span v-if="settingsSaved" class="settings-saved mono">saved</span>
    </div>
    <p class="stat-note">
      URL-scheme editors (VS Code, Cursor, Zed) open directly from the browser.
      A custom command runs on the threadle server as
      <span class="mono">command &lt;path&gt;</span> — terminal editors like plain
      vim need a GUI or server flavor (gvim, nvim-qt, emacsclient -n) since there
      is no terminal attached.
    </p>
  </div>

  <div class="settings-card">
    <div class="micro-label">examples</div>
    <div class="settings-row">
      <span class="settings-opt-label">show workflow examples</span>
      <div class="settings-seg" role="group" aria-label="show workflow examples">
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !settings.showExamples }"
          :disabled="settings.saving"
          @click="setShowExamples(false)"
        >
          off
        </button>
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: settings.showExamples }"
          :disabled="settings.saving"
          @click="setShowExamples(true)"
        >
          on
        </button>
      </div>
    </div>
    <p class="stat-note">
      When on, an Examples tab appears beside Subgraphs in Workflows
      (recipes + beginner → expert canned graphs).
    </p>
  </div>

  <div class="settings-card">
    <div class="micro-label">notifications</div>
    <div class="settings-row">
      <span class="settings-opt-label">all desktop notify</span>
      <div class="settings-seg" role="group" aria-label="all desktop notifications">
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !settings.notifications.enabled }"
          :disabled="settings.saving"
          @click="setNotifyEnabled(false)"
        >
          off
        </button>
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: settings.notifications.enabled }"
          :disabled="settings.saving"
          @click="setNotifyEnabled(true)"
        >
          on
        </button>
      </div>
    </div>
    <template v-if="settings.notifications.enabled">
      <div
        v-for="row in notifyKindRows"
        :key="row.key"
        class="settings-row settings-row-nested"
      >
        <span class="settings-opt-label">{{ row.label }}</span>
        <div class="settings-seg" :role="'group'" :aria-label="row.label">
          <button
            type="button"
            class="settings-seg-btn"
            :class="{ active: !settings.notifications[row.key] }"
            :disabled="settings.saving"
            @click="setNotifyKind(row.key, false)"
          >
            off
          </button>
          <button
            type="button"
            class="settings-seg-btn"
            :class="{ active: settings.notifications[row.key] }"
            :disabled="settings.saving"
            @click="setNotifyKind(row.key, true)"
          >
            on
          </button>
        </div>
      </div>
    </template>
    <p class="stat-note">
      Browser notifications while this tab is in the background (permission prompted on
      first ≫ / ▶). Turn <b>all</b> off, or mute specific events.
    </p>
  </div>

  <div class="micro-label stat-section">providers</div>

  <div class="settings-card">
    <div class="micro-label">harness extras</div>
    <div class="settings-row">
      <span class="settings-opt-label">post-answer extras</span>
      <div class="settings-seg" role="group" aria-label="harness extras">
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !settings.harnessExtras }"
          :disabled="settings.saving"
          @click="setHarnessExtras(false)"
        >
          off
        </button>
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: settings.harnessExtras }"
          :disabled="settings.saving"
          @click="setHarnessExtras(true)"
        >
          on
        </button>
      </div>
    </div>
    <p class="stat-note">
      Provider post-answer work that holds the CLI open: Muse reminder subagents,
      Claude slash skills, Grok subagents, Antigravity slash skills.
      <b>off</b> (default) skips them for faster workflow nodes. Flipable on the
      canvas HUD while a run is live, or per agent node. Stored as
      <span class="mono">harnessExtras</span> in settings.json.
    </p>
  </div>

  <SettingsPilot />

  <div class="micro-label stat-section">costs</div>

  <div class="settings-card">
    <div class="micro-label">claude code billing</div>
    <div class="settings-row">
      <select v-model="settings.claudeBilling" class="threadle-input settings-select">
        <option value="subscription">subscription (Pro / Max)</option>
        <option value="api">API key (pay per token)</option>
      </select>
      <button class="threadle-btn primary" :disabled="settings.saving" @click="saveSettings">
        {{ settings.saving ? "Saving…" : "Save" }}
      </button>
    </div>
    <p class="stat-note">
      Splits <b>tracked costs</b> (list price of the tokens — what the API would
      bill) from <b>actual spend</b> (what you really paid). On a subscription,
      claude-code, cursor, antigravity, and Codex ChatGPT-plan sessions get $0 actual spend; with an API key both
      figures match. opencode sessions always report what their own keys were billed.
      Cursor, Antigravity, and Codex tokens come from CLI usage when captured, otherwise a chars÷4
      estimate (no list price in public Codex rollouts).
      <template v-if="sub?.plan">
        Detected from ~/.claude.json: <b>{{ sub.plan }}</b>
        <span v-if="sub.billingType"> · {{ sub.billingType.replaceAll("_", " ") }}</span>.
      </template>
    </p>
  </div>

  <div class="micro-label stat-section">extensions</div>

  <SettingsCustomNodes />
  <SettingsMcp />

  <div class="micro-label stat-section">machine</div>

  <div class="settings-card internals-card">
    <div class="micro-label">application status</div>
    <p class="stat-note internals-note">
      The threadle server process on this machine. Agent-less workflows — custom
      nodes — run right here as child processes, so this is the hardware bill.
    </p>
    <div v-if="procStatus" class="proc-grid mono">
      <div class="proc-cell"><span class="micro-label">pid</span><span class="proc-val">{{ procStatus.pid }}</span></div>
      <div class="proc-cell"><span class="micro-label">node</span><span class="proc-val">{{ procStatus.node }}</span></div>
      <div class="proc-cell"><span class="micro-label">uptime</span><span class="proc-val">{{ fmtUptimeS(procStatus.uptime) }}</span></div>
      <div class="proc-cell"><span class="micro-label">cpu (server)</span><span class="proc-val">{{ procStatus.cpuPct }}%</span></div>
      <div class="proc-cell"><span class="micro-label">rss</span><span class="proc-val">{{ fmtBytes(procStatus.mem.rss) }}</span></div>
      <div class="proc-cell"><span class="micro-label">heap used</span><span class="proc-val">{{ fmtBytes(procStatus.mem.heapUsed) }}</span></div>
      <div class="proc-cell"><span class="micro-label">worker threads</span><span class="proc-val">{{ procStatus.threadpool }} (libuv pool)</span></div>
      <div class="proc-cell" :class="{ 'proc-live': procStatus.activeCustomRuns }">
        <span class="micro-label">custom-node children</span>
        <span class="proc-val">{{ procStatus.activeCustomRuns }} running</span>
      </div>
      <div class="proc-cell" :class="{ 'proc-live': procStatus.runningJobs }">
        <span class="micro-label">agent jobs</span>
        <span class="proc-val">{{ procStatus.runningJobs }} running</span>
      </div>
      <div class="proc-cell"><span class="micro-label">cores</span><span class="proc-val">{{ procStatus.system.cores }}</span></div>
      <div class="proc-cell"><span class="micro-label">load 1/5/15m</span><span class="proc-val">{{ procStatus.system.loadavg.join(" / ") }}</span></div>
      <div class="proc-cell">
        <span class="micro-label">system memory</span>
        <span class="proc-val">{{ fmtBytes(procStatus.system.totalmem - procStatus.system.freemem) }} / {{ fmtBytes(procStatus.system.totalmem) }}</span>
      </div>
    </div>
    <p v-else class="stat-note">loading…</p>
    <p v-if="procStatus" class="stat-note">
      {{ procStatus.system.platform }} · refreshes every 5s while this view is open
    </p>
  </div>

  <div class="settings-card internals-card">
    <div class="micro-label">threadle internals</div>
    <p class="stat-note internals-note">
      Everything threadle keeps on disk under
      <span class="mono">{{ internalsRoot || "~/.config/threadle" }}</span>.
      Caches, logs and history are safe to clear and rebuild; workflows,
      favorites, and settings are listed for transparency but never bulk-cleared.
    </p>
    <div
      class="stat-table cols-internals"
      v-col-resize="'internals'"
      data-cols="300px minmax(0,1fr) 140px 100px"
    >
      <div class="stat-cols micro-label">
        <span>what</span><span>path</span><span>size</span><span></span>
      </div>
      <div v-for="it in internals" :key="it.id" class="stat-row">
        <span class="stat-name internals-name">
          <span>{{ it.label }}</span>
          <span class="internals-desc">{{ it.description }}</span>
        </span>
        <span class="stat-val pathcell">
          <button
            type="button"
            class="row-icon"
            :title="`Open in ${settings.editorLabel}`"
            @click.stop="settings.openPath(it.path)"
          >⟨/⟩</button>
          <span class="file-path" :title="it.path">{{ bidiPath(it.path) }}</span>
        </span>
        <span class="stat-val">{{
          it.exists
            ? fmtBytes(it.bytes) + (it.kind === "dir" && it.files ? ` · ${it.files} files` : "")
            : "—"
        }}</span>
        <span class="stat-val internals-action">
          <button
            v-if="it.clearable"
            class="vsc-btn internals-clear"
            :class="{ danger: internalsConfirm === it.id }"
            :disabled="internalsClearing === it.id || (!it.bytes && !it.files)"
            :title="it.danger ? 'Deletes data you created — cannot be undone' : 'Safe to clear — rebuilt or re-fetched on demand'"
            @click="clearInternal(it)"
          >{{
            internalsClearing === it.id
              ? "clearing…"
              : internalsConfirm === it.id
                ? (it.danger ? "really delete?" : "confirm")
                : "clear"
          }}</button>
          <span v-else class="internals-keep mono" title="Listed for transparency — manage these through their own views">kept</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { bidiPath } from "@/lib/format";
import { PROVIDER_IDS, providerColor, providerLabel } from "@/lib/providers";
import { vColResize } from "@/lib/colResize";
import { useSettingsStore } from "@/stores/settings";
import SettingsCustomNodes from "./settings/SettingsCustomNodes.vue";
import SettingsMcp from "./settings/SettingsMcp.vue";
import SettingsPilot from "./settings/SettingsPilot.vue";
import "./chrome.css";

interface InternalItem {
  id: string;
  label: string;
  path: string;
  kind: "file" | "dir";
  description: string;
  clearable: boolean;
  danger?: boolean;
  exists: boolean;
  bytes: number;
  files: number;
}

interface ProcStatus {
  pid: number;
  node: string;
  uptime: number;
  cpuPct: number;
  mem: { rss: number; heapUsed: number; external: number };
  threadpool: number;
  activeCustomRuns: number;
  runningJobs: number;
  system: {
    cores: number;
    loadavg: number[];
    totalmem: number;
    freemem: number;
    platform: string;
  };
}

interface SubInfo {
  available: boolean;
  plan?: string;
  billingType?: string;
}

const settings = useSettingsStore();

const settingsSaved = ref(false);
const sub = ref<SubInfo>();
const internals = ref<InternalItem[]>([]);
const internalsRoot = ref("");
const internalsClearing = ref("");
const internalsConfirm = ref("");
let internalsConfirmTimer: ReturnType<typeof setTimeout> | undefined;
const procStatus = ref<ProcStatus>();
let procTimer: ReturnType<typeof setInterval> | undefined;

const notifyKindRows: Array<{ key: "runFinished" | "approval" | "handoff"; label: string }> = [
  { key: "runFinished", label: "run finished / failed" },
  { key: "approval", label: "approval waiting" },
  { key: "handoff", label: "live handoff" },
];

async function saveSettings(): Promise<void> {
  await settings.save();
  settingsSaved.value = true;
  setTimeout(() => {
    settingsSaved.value = false;
  }, 2000);
}

async function setAppearance(next: "system" | "light" | "dark"): Promise<void> {
  await settings.setAppearance(next);
}

async function onProviderColorInput(id: (typeof PROVIDER_IDS)[number], raw: string): Promise<void> {
  await settings.setProviderColor(id, raw);
}

async function resetProviderColors(): Promise<void> {
  await settings.resetProviderColors();
}

async function setShowExamples(on: boolean): Promise<void> {
  if (settings.showExamples === on) return;
  settings.showExamples = on;
  await saveSettings();
}

async function setHarnessExtras(on: boolean): Promise<void> {
  await settings.setHarnessExtras(on);
}

async function setNotifyEnabled(on: boolean): Promise<void> {
  if (settings.notifications.enabled === on) return;
  settings.notifications.enabled = on;
  await saveSettings();
}

async function setNotifyKind(
  kind: "runFinished" | "approval" | "handoff",
  on: boolean,
): Promise<void> {
  if (settings.notifications[kind] === on) return;
  settings.notifications[kind] = on;
  await saveSettings();
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

function fmtUptimeS(sec: number): string {
  if (sec >= 86400) return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${sec}s`;
}

async function loadProcStatus(): Promise<void> {
  try {
    procStatus.value = (await (
      await fetch("/api/internals/process")
    ).json()) as ProcStatus;
  } catch {
    // server unreachable
  }
}

async function loadInternals(): Promise<void> {
  try {
    const j = (await (await fetch("/api/internals")).json()) as {
      root: string;
      items: InternalItem[];
    };
    internalsRoot.value = j.root;
    internals.value = j.items;
  } catch {
    // server unreachable — keep whatever we had
  }
}

async function clearInternal(it: InternalItem): Promise<void> {
  if (internalsConfirm.value !== it.id) {
    internalsConfirm.value = it.id;
    clearTimeout(internalsConfirmTimer);
    internalsConfirmTimer = setTimeout(() => {
      internalsConfirm.value = "";
    }, 4000);
    return;
  }
  internalsConfirm.value = "";
  clearTimeout(internalsConfirmTimer);
  internalsClearing.value = it.id;
  try {
    await fetch("/api/internals/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: it.id }),
    });
  } finally {
    internalsClearing.value = "";
  }
  await loadInternals();
}

async function loadSubscription(): Promise<void> {
  try {
    sub.value = (await (await fetch("/api/subscription")).json()) as SubInfo;
  } catch {
    sub.value = undefined;
  }
}

onMounted(() => {
  void loadInternals();
  void loadProcStatus();
  void loadSubscription();
  procTimer = setInterval(() => void loadProcStatus(), 5000);
});

onUnmounted(() => {
  clearInterval(procTimer);
  clearTimeout(internalsConfirmTimer);
});
</script>

<style scoped>
.cols-internals {
  --cols: 300px minmax(0, 1fr) 140px 100px;
}
.cols-internals .stat-cols,
.cols-internals .stat-row {
  grid-template-columns: var(--cols);
  gap: 20px;
  padding: 0 20px;
}
.cols-internals .stat-row {
  padding: 12px 20px;
}
.settings-card.internals-card {
  max-width: 1100px;
}
.internals-note {
  margin: 6px 0 12px;
}
.cols-internals .internals-name {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.proc-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.proc-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.proc-val {
  font-size: var(--fs-md);
  color: var(--text);
}
.proc-cell.proc-live {
  border-color: rgba(74, 222, 128, 0.35);
}
.proc-cell.proc-live .proc-val {
  color: var(--status-running);
}
@media (max-width: 1100px) {
  .proc-grid { grid-template-columns: repeat(2, 1fr); }
}
.internals-desc {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  font-weight: 400;
  line-height: 1.35;
  white-space: normal;
}
.internals-action {
  display: flex;
  justify-content: flex-end;
}
.internals-clear.danger {
  border-color: var(--status-error);
  color: var(--status-error);
}
.internals-keep {
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.prov-color-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.prov-color-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) minmax(0, 1.1fr) 28px 88px;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.prov-color-name {
  font-size: var(--fs-sm);
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prov-color-id {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prov-color-swatch {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  cursor: pointer;
}
.prov-color-swatch:disabled {
  opacity: 0.5;
  cursor: default;
}
.prov-color-hex {
  height: 28px;
  padding: 0 8px;
  font-size: var(--fs-xs);
  min-width: 0;
}
.prov-color-actions {
  margin-top: 10px;
}
.settings-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.settings-card + .settings-card {
  margin-top: 12px;
}
/* Child components (custom nodes / MCP) are also settings cards */
.settings-card + :deep(.settings-card),
:deep(.settings-card) + .settings-card,
:deep(.settings-card + .settings-card) {
  margin-top: 12px;
}
.stat-section + .settings-card,
.stat-section + :deep(.settings-card) {
  margin-top: 0;
}
.settings-card:not(.internals-card) + .settings-card.internals-card {
  margin-top: 12px;
}
.settings-opt-label {
  font-size: var(--fs-md);
  color: var(--text);
  margin-right: auto;
}
.settings-row-nested {
  padding-left: 12px;
  border-left: 1px solid var(--border);
  margin-left: 2px;
}
.settings-row-nested .settings-opt-label {
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.settings-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.settings-seg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  min-width: 44px;
  padding: 0 12px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}
.settings-seg-btn:hover:not(:disabled):not(.active) {
  color: var(--text-dim);
}
.settings-seg-btn.active {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.settings-seg-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.settings-select {
  width: 200px;
}
.settings-cmd {
  flex: 1;
  min-width: 220px;
  font-family: var(--mono);
  font-size: var(--fs-sm);
}
.settings-saved {
  color: var(--status-running);
  font-size: var(--fs-xs);
}
</style>
