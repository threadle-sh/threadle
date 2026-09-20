<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <header class="modal-head">
        <div>
          <div class="modal-title">Inject context</div>
          <div class="modal-sub">
            into {{ provider }} · {{ targetTitle ?? shortId(sessionId) }}
          </div>
        </div>
        <button class="ins-close" @click="emit('close')">✕</button>
      </header>

      <div class="modal-body">
        <label class="field">
          <span class="field-label">mode</span>
          <select v-model="mode" class="threadle-input">
            <option v-for="m in modes" :key="m.value" :value="m.value">
              {{ m.label }}
            </option>
          </select>
          <span class="field-hint">{{ activeMode?.hint }}</span>
        </label>

        <label v-if="mode !== 'synthetic'" class="field">
          <span class="field-label">model</span>
          <select v-model="model" class="threadle-input">
            <option value="">(provider default)</option>
            <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>

        <label v-if="mode !== 'synthetic'" class="field">
          <span class="field-label">kickoff prompt</span>
          <textarea
            v-model="kickoff"
            class="threadle-input"
            rows="4"
            placeholder="What should the target session do with this context?"
          />
        </label>

        <div v-if="error" class="modal-error">{{ error }}</div>
        <div v-if="progress" class="modal-progress">{{ progress }}</div>
      </div>

      <footer class="modal-foot">
        <button class="threadle-btn" @click="emit('close')">Cancel</button>
        <button class="threadle-btn primary" :disabled="busy" @click="run">
          {{ busy ? "Injecting…" : "Inject" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { InjectMode, ProviderId } from "@threadle/shared";
import { shortId } from "@/lib/format";

const props = defineProps<{
  provider: ProviderId;
  sessionId: string;
  targetTitle?: string;
  busy?: boolean;
  error?: string;
  progress?: string;
  models?: string[];
}>();

const emit = defineEmits<{
  close: [];
  run: [mode: InjectMode, kickoff: string, model?: string];
}>();

interface ModeOption {
  value: InjectMode;
  label: string;
  hint: string;
}

const modes = computed<ModeOption[]>(() => {
  if (props.provider === "claude-code") {
    return [
      {
        value: "resume-fork",
        label: "Fork this session",
        hint: "Branches the target conversation into a new session that has both its full history and the injected context.",
      },
      {
        value: "new-session",
        label: "New session in project dir",
        hint: "Starts a fresh claude session with the context as appended system prompt.",
      },
    ];
  }
  if (props.provider === "cursor") {
    return [
      {
        value: "continue",
        label: "Continue session with context",
        hint: "Sends context + kickoff via `agent --resume`; the session replies.",
      },
      {
        value: "new-session",
        label: "New session in project dir",
        hint: "Starts a fresh Cursor Agent chat seeded with the context.",
      },
    ];
  }
  if (props.provider === "antigravity") {
    return [
      {
        value: "continue",
        label: "Continue session with context",
        hint: "Sends context + kickoff via `agy --conversation`; the session replies.",
      },
      {
        value: "new-session",
        label: "New session in project dir",
        hint: "Starts a fresh Antigravity print session seeded with the context.",
      },
    ];
  }
  if (props.provider === "codex") {
    return [
      {
        value: "continue",
        label: "Continue session with context",
        hint: "Sends context + kickoff via `codex exec resume`; the session replies.",
      },
      {
        value: "new-session",
        label: "New session in project dir",
        hint: "Starts a fresh Codex exec session seeded with the context.",
      },
    ];
  }
  if (props.provider === "copilot") {
    return [
      {
        value: "continue",
        label: "Continue session with context",
        hint: "Sends context + kickoff via `copilot -p --resume`; the session replies.",
      },
      {
        value: "new-session",
        label: "New session in project dir",
        hint: "Starts a fresh Copilot `-p` session seeded with the context.",
      },
    ];
  }
  if (props.provider === "grok") {
    return [
      {
        value: "continue",
        label: "Continue session with context",
        hint: "Sends context + kickoff via `grok -p --resume`; the session replies.",
      },
      {
        value: "new-session",
        label: "New session in project dir",
        hint: "Starts a fresh Grok Build `-p` session seeded with the context.",
      },
    ];
  }
  return [
    {
      value: "synthetic",
      label: "Insert context silently",
      hint: "Adds the context to the session as a synthetic message — no reply is generated.",
    },
    {
      value: "continue",
      label: "Continue session with context",
      hint: "Sends context + kickoff as a prompt via `opencode run`; the session replies.",
    },
    {
      value: "new-session",
      label: "New session in project dir",
      hint: "Starts a fresh opencode session seeded with the context.",
    },
  ];
});

const mode = ref<InjectMode>(modes.value[0]!.value);
const kickoff = ref("");
const model = ref("");
const busy = computed(() => props.busy);
const activeMode = computed(() => modes.value.find((m) => m.value === mode.value));

function run(): void {
  emit("run", mode.value, kickoff.value, model.value || undefined);
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  z-index: 100;
}
.modal {
  width: 480px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 18px 12px;
}
.modal-title {
  font-weight: 600;
  font-size: var(--fs-xl);
}
.modal-sub {
  font-size: var(--fs-sm);
  color: var(--text-dim);
  margin-top: 2px;
}
.ins-close {
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
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
}
.field-hint {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  line-height: 1.4;
}
.modal-error {
  font-size: var(--fs-sm);
  color: var(--status-error);
}
.modal-progress {
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
}
</style>
