<template>
  <div v-if="open" class="wf-backdrop" @click.self="emit('close')">
    <div class="wf-modal">
      <div class="wf-modal-head mono">≫ detached run</div>
      <p class="wf-hint">
        Runs on the threadle server and survives closing this tab. Statuses and outputs
        write back to the graph when finished.
        Server jobs cannot pause for splice / live chat — use ▶ in this tab when you need the dock.
      </p>
      <div v-if="blockers.length" class="wf-gate-block">
        <div class="micro-label">blocked — fix before starting</div>
        <ul class="wf-gate-list mono">
          <li
            v-for="(i, idx) in blockers"
            :key="i.nodeId + idx"
            class="wf-gate-item"
            @click="emit('focus-issue', i)"
          >
            <template v-if="i.kind === 'context'">
              ❝ {{ i.label }} — {{ i.message ?? "wire a session source, Library payload, or mute" }}
            </template>
            <template v-else-if="i.kind === 'model'">
              {{ i.label }} — {{ i.message ?? "model not set" }}
            </template>
            <template v-else-if="i.kind === 'wiring'">
              {{ i.label }} — {{ i.message ?? "unwired input" }}
            </template>
            <template v-else-if="i.kind === 'artifact'">
              {{ i.label }} — {{ i.message ?? "pick a skill/rules file or mute" }}
            </template>
            <template v-else-if="i.kind === 'frame'">
              {{ i.label }}
            </template>
            <template v-else-if="i.kind === 'custom'">
              {{ i.label }} — {{ i.message ?? "required port missing" }}
            </template>
            <template v-else>{{ i.label }}{{ i.message ? ` — ${i.message}` : "" }}</template>
          </li>
        </ul>
        <p v-if="blockers.some((b) => b.kind === 'context')" class="wf-hint">
          Context needs a wired session / agent (extracts mid-run) or a Library
          payload — or mute the ❝ node.
        </p>
      </div>
      <div v-if="approvals.length" class="wf-gate-block">
        <div class="micro-label">gates — will auto-approve (no splice)</div>
        <ul class="wf-gate-list mono">
          <li
            v-for="i in approvals"
            :key="i.nodeId"
            class="wf-gate-item"
            @click="emit('focus-issue', i)"
          >
            {{ i.kind === "live-handoff" ? "⇄" : "✓" }} {{ i.label }}
          </li>
        </ul>
        <p class="wf-hint">
          Confirm to pass <span class="mono">approveAll</span> (same as
          <span class="mono">threadle run … --approve-all</span>), or use
          <b>Run with splice</b> for the interactive dock.
        </p>
      </div>
      <div class="wf-modal-actions">
        <button class="threadle-btn" @click="emit('close')">Cancel</button>
        <button
          v-if="approvals.length && !blockers.length"
          class="threadle-btn"
          title="Run in this tab with the approval dock (splice / live handoff)"
          @click="emit('run-interactive')"
        >
          Run with splice
        </button>
        <span class="wf-spacer" />
        <button
          v-if="!blockers.length"
          class="threadle-btn primary"
          @click="emit('confirm')"
        >
          {{ approvals.length ? "Approve all & ≫" : "≫ Run" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DetachedIssue } from "@threadle/shared";

defineProps<{
  open: boolean;
  blockers: DetachedIssue[];
  approvals: DetachedIssue[];
}>();

const emit = defineEmits<{
  close: [];
  "focus-issue": [issue: DetachedIssue];
  "run-interactive": [];
  confirm: [];
}>();
</script>

<style scoped>
.wf-backdrop {
  position: absolute;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
}
.wf-modal {
  width: 480px;
  max-width: 92%;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wf-modal-head {
  font-size: var(--fs-md);
  font-weight: 700;
}
.wf-hint {
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.wf-gate-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg-raised);
}
.wf-gate-list {
  margin: 0;
  padding-left: 1.2em;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.55;
}
.wf-gate-item {
  cursor: pointer;
  list-style: disc;
  margin: 4px 0;
}
.wf-gate-item:hover {
  color: var(--text);
}
.wf-modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.wf-spacer { flex: 1; }
</style>
