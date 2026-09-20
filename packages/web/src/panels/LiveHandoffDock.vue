<template>
  <div class="lh-dock" @click.stop>
    <div class="lh-dock-head mono">
      ⇄ live handoff — chat until Ready, then hand off downstream
    </div>

    <div class="lh-dock-meta">
      <label class="lh-field">
        <span class="micro-label">agent</span>
        <select
          v-model="agentKey"
          class="threadle-input"
          :disabled="!!session || busy"
        >
          <option value="">pick an agent…</option>
          <option
            v-for="a in agents"
            :key="`${a.provider}:${a.name}:${a.source}`"
            :value="`${a.provider}|${a.name}|${a.source}`"
          >
            {{ a.name }} · {{ a.provider }}
          </option>
        </select>
      </label>
      <label class="lh-field">
        <span class="micro-label">on Ready</span>
        <select v-model="kind" class="threadle-input" :disabled="busy">
          <option value="distilled-summary">distilled summary</option>
          <option value="transcript-excerpt">transcript excerpt</option>
        </select>
      </label>
    </div>

    <div v-if="session" class="lh-session mono">
      session {{ session.sessionId.slice(0, 12) }} · {{ session.provider }}
    </div>

    <div ref="scrollEl" class="lh-transcript nowheel">
      <div v-if="!session && !msgs.length" class="lh-empty">
        {{ seedPreview
          ? "Seed ready — start chat to open a session with the inbound text."
          : "Pick an agent and send a message, or Start with seed." }}
      </div>
      <div v-for="(m, i) in msgs" :key="i" class="lh-msg" :class="m.role">
        <span class="lh-role micro-label">{{ m.role }}</span>
        <pre class="lh-text">{{ m.text }}</pre>
      </div>
      <div v-if="busy" class="lh-busy mono">{{ progress || "working…" }}</div>
    </div>

    <div class="lh-compose">
      <textarea
        v-model="draft"
        class="threadle-input lh-input"
        rows="2"
        spellcheck="false"
        :disabled="busy"
        :placeholder="session ? 'message…' : 'first message (or Start with seed)'"
        @keydown.meta.enter.prevent="send"
        @keydown.ctrl.enter.prevent="send"
      />
      <div class="lh-compose-actions">
        <button
          v-if="!session"
          class="threadle-btn"
          :disabled="busy || !canStart"
          @click="startChat"
        >
          Start chat
        </button>
        <button class="threadle-btn" :disabled="busy || !canSend" @click="send">
          Send
        </button>
      </div>
    </div>

    <div v-if="error" class="lh-error">{{ error }}</div>

    <div class="lh-actions">
      <button
        class="threadle-btn primary"
        :disabled="busy || !session"
        title="Distill or excerpt this session and continue the run"
        @click="ready"
      >
        ⇄ Ready · hand off
      </button>
      <button class="threadle-btn danger" :disabled="busy && finishing" @click="abort">
        ✕ Abort · stop run
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type {
  AgentDef,
  ContextPayload,
  NormalizedMessage,
  ProviderId,
  ServerEvent,
} from "@threadle/shared";
import { defaultConfigFor } from "@threadle/shared";
import { api } from "@/api/client";

export interface LiveHandoffSession {
  provider: ProviderId;
  sessionId: string;
}

const props = defineProps<{
  seed: string;
  initialSession?: LiveHandoffSession;
  initialAgent?: { provider: ProviderId; name: string; source: string };
  initialKind?: "distilled-summary" | "transcript-excerpt";
  model?: string;
  agents: AgentDef[];
  projectDir: string;
  graphId?: string;
}>();

const emit = defineEmits<{
  ready: [payload: { text: string; session: LiveHandoffSession; kind: string }];
  abort: [];
  "bind-agent": [ref: { provider: ProviderId; name: string; source: string }];
  "bind-kind": [kind: "distilled-summary" | "transcript-excerpt"];
}>();

const session = ref<LiveHandoffSession | undefined>(
  props.initialSession ? { ...props.initialSession } : undefined,
);
const kind = ref<"distilled-summary" | "transcript-excerpt">(
  props.initialKind === "transcript-excerpt" ? "transcript-excerpt" : "distilled-summary",
);
const agentKey = ref("");
const draft = ref("");
const msgs = ref<Array<{ role: string; text: string }>>([]);
const busy = ref(false);
const finishing = ref(false);
const progress = ref("");
const error = ref("");
const scrollEl = ref<HTMLElement>();

const seedPreview = computed(() => props.seed.trim().slice(0, 120));

const selectedAgent = computed(() => {
  if (!agentKey.value) return undefined;
  const [provider, name, ...rest] = agentKey.value.split("|");
  if (!provider || !name) return undefined;
  return { provider: provider as ProviderId, name, source: rest.join("|") };
});

const canStart = computed(
  () => Boolean(selectedAgent.value || session.value) && !busy.value,
);
const canSend = computed(() => {
  if (busy.value || !draft.value.trim()) return false;
  if (session.value) return true;
  return Boolean(selectedAgent.value);
});

watch(
  () => props.initialAgent,
  (a) => {
    if (!a || agentKey.value) return;
    agentKey.value = `${a.provider}|${a.name}|${a.source}`;
  },
  { immediate: true },
);

watch(kind, (k) => emit("bind-kind", k));
watch(selectedAgent, (a) => {
  if (a) emit("bind-agent", a);
});

async function waitJob(jobId: string): Promise<ServerEvent> {
  for (;;) {
    const j = await api.job(jobId);
    if (j.status === "done" && j.result) return j.result;
    if (j.status === "error") throw new Error(j.error || "job failed");
    if (j.status === "cancelled") throw new Error("cancelled");
    await new Promise((r) => setTimeout(r, 450));
  }
}

function flattenMessages(messages: NormalizedMessage[]): Array<{ role: string; text: string }> {
  const out: Array<{ role: string; text: string }> = [];
  for (const m of messages) {
    const text = m.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n")
      .trim();
    if (!text) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    out.push({ role: m.role, text });
  }
  return out.slice(-40);
}

async function refreshTranscript(): Promise<void> {
  if (!session.value) return;
  const t = await api
    .transcript(session.value.provider, session.value.sessionId, 0, 200)
    .catch(() => undefined);
  if (!t) return;
  msgs.value = flattenMessages(t.messages);
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
}

onMounted(() => {
  void refreshTranscript();
});

async function startChat(): Promise<void> {
  error.value = "";
  if (session.value) {
    await refreshTranscript();
    return;
  }
  const agent = selectedAgent.value;
  if (!agent) {
    error.value = "pick an agent first";
    return;
  }
  const prompt =
    props.seed.trim() ||
    draft.value.trim() ||
    "Continue from here — I will chat with you until I hand off.";
  busy.value = true;
  progress.value = "starting session…";
  try {
    const { jobId } = await api.runAgent({
      provider: agent.provider,
      agent: agent.name,
      model: props.model,
      prompt,
      projectDir: props.projectDir,
      graphId: props.graphId,
    });
    const evt = await waitJob(jobId);
    if (evt.type === "job.error") throw new Error(evt.error);
    const result = evt.type === "job.done" ? evt.inject : undefined;
    if (!result) throw new Error("no session returned");
    session.value = { provider: result.provider, sessionId: result.newSessionId };
    draft.value = "";
    await refreshTranscript();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
    progress.value = "";
  }
}

async function send(): Promise<void> {
  error.value = "";
  const text = draft.value.trim();
  if (!text) return;
  if (!session.value) {
    draft.value = text;
    await startChat();
    return;
  }
  busy.value = true;
  progress.value = "sending…";
  try {
    const agent = selectedAgent.value;
    const { jobId } = await api.runSession({
      provider: session.value.provider,
      sessionId: session.value.sessionId,
      prompt: text,
      projectDir: props.projectDir,
      model: props.model,
      agent: agent?.name,
      graphId: props.graphId,
    });
    draft.value = "";
    const evt = await waitJob(jobId);
    if (evt.type === "job.error") throw new Error(evt.error);
    await refreshTranscript();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
    progress.value = "";
  }
}

async function ready(): Promise<void> {
  if (!session.value) {
    error.value = "start a chat session first";
    return;
  }
  error.value = "";
  busy.value = true;
  finishing.value = true;
  progress.value =
    kind.value === "transcript-excerpt" ? "extracting excerpt…" : "distilling…";
  try {
    const source = {
      provider: session.value.provider,
      sessionId: session.value.sessionId,
    };
    const config = defaultConfigFor(kind.value);
    let payload: ContextPayload;
    if (kind.value === "distilled-summary") {
      const { jobId } = await api.distillContext({ source, config });
      const evt = await waitJob(jobId);
      if (evt.type === "job.error") throw new Error(evt.error);
      if (evt.type !== "job.done" || !evt.payload) throw new Error("distill returned nothing");
      payload = evt.payload;
    } else {
      payload = await api.extractContext({ source, config });
    }
    void fetch("/api/lineage/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payloadHash: payload.hash,
        mode: "handoff",
        result: source,
      }),
    }).catch(() => undefined);
    emit("ready", {
      text: payload.content,
      session: session.value,
      kind: kind.value,
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    busy.value = false;
    finishing.value = false;
    progress.value = "";
  }
}

function abort(): void {
  emit("abort");
}
</script>

<style scoped>
.lh-dock {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 56px;
  z-index: 40;
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  max-height: min(520px, 70vh);
}
.lh-dock-head {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.lh-dock-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.lh-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.lh-session {
  font-size: var(--fs-2xs);
  color: var(--text-dim);
}
.lh-transcript {
  flex: 1;
  min-height: 140px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--canvas-bg);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lh-empty {
  color: var(--text-faint);
  font-size: var(--fs-xs);
  padding: 12px 4px;
}
.lh-msg {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lh-role {
  color: var(--text-faint);
}
.lh-msg.user .lh-role { color: var(--text-dim); }
.lh-msg.assistant .lh-role { color: var(--lane-session); }
.lh-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font);
  font-size: var(--fs-sm);
  color: var(--text);
  line-height: 1.4;
}
.lh-busy {
  font-size: var(--fs-2xs);
  color: var(--status-waiting);
}
.lh-compose {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lh-input {
  resize: vertical;
  min-height: 48px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.lh-compose-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.lh-error {
  color: var(--status-error);
  font-size: var(--fs-xs);
  font-family: var(--mono);
}
.lh-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
</style>
