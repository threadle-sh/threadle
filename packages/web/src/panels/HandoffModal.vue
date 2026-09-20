<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <header class="modal-head">
        <div class="modal-title">⇄ Hand off context</div>
        <button class="modal-close" @click="emit('close')">✕</button>
      </header>

      <div class="modal-body">
        <div class="ho-source mono">
          <span class="micro-label">from</span>
          {{ source.title ?? source.sessionId.slice(0, 12) }}
          <em>{{ source.provider }}</em>
        </div>

        <label class="field">
          <span class="field-label">context</span>
          <select v-model="kind" class="threadle-input">
            <option value="distilled-summary">distilled summary (AI brief — goal, state, decisions)</option>
            <option value="transcript-excerpt">transcript excerpt (raw conversation text)</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">target agent</span>
          <div class="ho-row">
            <select v-model="targetProvider" class="threadle-input ho-prov">
              <option value="claude-code">claude</option>
              <option value="opencode">opencode</option>
              <option value="cursor">cursor</option>
              <option value="antigravity">antigravity</option>
              <option value="codex">codex</option>
              <option value="copilot">copilot</option>
              <option value="grok">grok</option>
            </select>
            <select v-model="agent" class="threadle-input">
              <option v-for="a in targetAgents" :key="a.name" :value="a.name">{{ a.name }}</option>
            </select>
          </div>
        </label>

        <label class="field">
          <span class="field-label">model</span>
          <select v-model="model" class="threadle-input">
            <option value="">provider default</option>
            <option v-for="m in targetModels" :key="m.id" :value="m.id">{{ m.id }}</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">instruction for the target agent</span>
          <textarea
            v-model="instruction"
            class="threadle-input modal-editor ho-instruction"
            rows="4"
            spellcheck="false"
            placeholder="e.g. Continue this work — implement the plan above."
          />
        </label>

        <div v-if="progress" class="ho-progress mono">{{ progress }}</div>
        <div v-if="error" class="modal-error">{{ error }}</div>

        <div v-if="result" class="ho-result">
          <div class="micro-label">handoff complete — new session</div>
          <div class="ho-result-title mono">❯ {{ result.title }}</div>
          <div class="sess-detail-actions">
            <button class="vsc-btn" @click="emit('open-session', result.provider, result.sessionId)">
              ❯ open session
            </button>
            <button
              class="vsc-btn"
              @click="router.push(`/blueprint/${result.provider}/${result.sessionId}`)"
            >
              ⌗ blueprint
            </button>
            <button class="vsc-btn" @click="router.push('/lineage')">⇄ lineage</button>
          </div>
        </div>
      </div>

      <footer class="modal-foot">
        <button class="threadle-btn" @click="emit('close')">{{ result ? "Done" : "Cancel" }}</button>
        <button
          v-if="!result"
          class="threadle-btn primary"
          :disabled="busy || !agent || !instruction.trim()"
          @click="run"
        >
          {{ busy ? "Handing off…" : "⇄ Hand off" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { AgentDef, ModelInfo, ProviderId } from "@threadle/shared";
import { defaultConfigFor } from "@threadle/shared";
import { api } from "@/api/client";
import { defaultHandoffTarget } from "@/lib/providers";

const props = defineProps<{
  source: { provider: string; sessionId: string; title?: string; projectDir?: string };
}>();

const emit = defineEmits<{
  close: [];
  "open-session": [provider: string, sessionId: string];
}>();

const router = useRouter();

const kind = ref<"distilled-summary" | "transcript-excerpt">("distilled-summary");
const targetProvider = ref<ProviderId>(defaultHandoffTarget(props.source.provider));
const agent = ref("");
const model = ref("");
const instruction = ref("Continue this work. Use the context above as the full state of the task.");
const busy = ref(false);
const progress = ref("");
const error = ref<string>();
const result = ref<{ provider: string; sessionId: string; title: string }>();

const agents = ref<AgentDef[]>([]);
const models = ref<ModelInfo[]>([]);

onMounted(async () => {
  [agents.value, models.value] = await Promise.all([
    api.agents().catch(() => []),
    api.models().catch(() => []),
  ]);
  pickDefaultAgent();
});

const targetAgents = computed(() =>
  agents.value.filter((a) => a.provider === targetProvider.value),
);
const targetModels = computed(() =>
  models.value.filter((m) => m.provider === targetProvider.value),
);

watch(targetProvider, pickDefaultAgent);

function pickDefaultAgent(): void {
  const list = targetAgents.value;
  agent.value =
    list.find((a) =>
      a.name ===
      (targetProvider.value === "opencode"
        ? "build"
        : targetProvider.value === "cursor" || targetProvider.value === "antigravity"
          ? "agent"
          : targetProvider.value === "codex"
            ? "codex"
            : targetProvider.value === "copilot"
              ? "copilot"
              : targetProvider.value === "grok"
                ? "grok"
                : "general-purpose"),
    )?.name ??
    list[0]?.name ??
    "";
  model.value = "";
}

/** poll a job to its terminal state (SSE lives in the editor; polling is enough here) */
async function awaitJob(jobId: string): Promise<{
  status: string;
  error?: string;
  result?: { inject?: { provider: string; newSessionId: string }; payload?: { hash: string; content: string } };
}> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const job = (await (await fetch(`/api/jobs/${jobId}`)).json()) as {
      status: string;
      error?: string;
      result?: { inject?: { provider: string; newSessionId: string }; payload?: { hash: string; content: string } };
    };
    if (job.status !== "running") return job;
  }
}

async function run(): Promise<void> {
  busy.value = true;
  error.value = undefined;
  try {
    // 1) capture context from the source session
    progress.value =
      kind.value === "distilled-summary"
        ? "distilling the source session into a brief…"
        : "extracting transcript excerpt…";
    const req = {
      source: { provider: props.source.provider as never, sessionId: props.source.sessionId },
      config: defaultConfigFor(kind.value) as never,
    };
    let payload: { hash: string; content: string };
    if (kind.value === "distilled-summary") {
      const { jobId } = await api.distillContext(req);
      const job = await awaitJob(jobId);
      if (job.status !== "done" || !job.result?.payload) {
        throw new Error(job.error ?? "distill failed");
      }
      payload = job.result.payload;
    } else {
      payload = await api.extractContext(req);
    }

    // 2) run the target agent with context + instruction
    progress.value = `running ${targetProvider.value} agent "${agent.value}"…`;
    const { jobId } = await api.runAgent({
      provider: targetProvider.value,
      agent: agent.value,
      model: model.value || undefined,
      prompt: `${payload.content}\n\n---\n\n${instruction.value.trim()}`,
      projectDir: props.source.projectDir ?? "",
    });
    const job = await awaitJob(jobId);
    if (job.status !== "done" || !job.result?.inject) {
      throw new Error(job.error ?? "target agent run failed");
    }
    const inject = job.result.inject;

    // 3) record the handoff in lineage
    void fetch("/api/lineage/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payloadHash: payload.hash,
        mode: "handoff",
        result: { provider: inject.provider, sessionId: inject.newSessionId },
      }),
    }).catch(() => undefined);

    progress.value = "";
    result.value = {
      provider: inject.provider,
      sessionId: inject.newSessionId,
      title: `${agent.value} · ${inject.newSessionId.slice(0, 10)}…`,
    };
  } catch (err) {
    progress.value = "";
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  z-index: 100;
}
.modal {
  width: 540px;
  max-height: 86vh;
  overflow-y: auto;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 10px;
}
.modal-title {
  font-weight: 600;
  font-size: var(--fs-xl);
}
.modal-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-lg);
}
.modal-body {
  padding: 0 18px 8px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}
.modal-error {
  font-size: var(--fs-sm);
  color: var(--status-error);
}
.ho-source {
  font-size: var(--fs-sm);
  color: var(--text);
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ho-source em {
  font-style: normal;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.ho-row {
  display: flex;
  gap: 8px;
}
.ho-prov {
  width: 130px;
  flex-shrink: 0;
}
.ho-instruction {
  font-family: var(--mono);
  font-size: var(--fs-sm);
  resize: vertical;
  min-height: 70px;
}
.ho-progress {
  font-size: var(--fs-xs);
  color: var(--status-waiting);
}
.ho-result {
  border: 1px solid rgba(74, 222, 128, 0.35);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ho-result-title {
  font-size: var(--fs-md);
  font-weight: 600;
}
.sess-detail-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
