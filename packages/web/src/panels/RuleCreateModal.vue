<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <header class="modal-head">
        <div class="modal-title">
          {{
            mode === "skill"
              ? initialContent
                ? "Import skillset"
                : "New skillset"
              : "New rules file"
          }}
        </div>
        <button class="modal-close" @click="emit('close')">✕</button>
      </header>

      <div class="modal-body">
        <label class="field">
          <span class="field-label">scope</span>
          <select v-model="scope" class="threadle-input">
            <option value="global">global (~)</option>
            <option v-for="d in projectDirs" :key="d" :value="d">{{ d }}</option>
          </select>
        </label>

        <label v-if="mode === 'rules' && scope !== 'global'" class="field">
          <span class="field-label">file</span>
          <select v-model="ruleType" class="threadle-input">
            <option>CLAUDE.md</option>
            <option>CLAUDE.local.md</option>
            <option>AGENTS.md</option>
            <option>.cursorrules</option>
          </select>
        </label>
        <p v-else-if="mode === 'rules'" class="field-hint">
          global rules are written to ~/.claude/CLAUDE.md
        </p>

        <template v-if="mode === 'skill'">
          <label class="field">
            <span class="field-label">name (kebab-case)</span>
            <input
              v-model="skillName"
              class="threadle-input mono-input"
              placeholder="my-review-checklist"
              spellcheck="false"
            />
          </label>
          <label class="field">
            <span class="field-label">library</span>
            <select v-model="skillLocation" class="threadle-input" :disabled="!!initialContent">
              <option value="threadle-custom">threadle custom (authored)</option>
              <option value="threadle-imported">threadle imported</option>
              <option value="claude">.claude/skills (Claude Code)</option>
              <option value="opencode">.opencode/skills (opencode)</option>
              <option value="cursor">.cursor/skills (Cursor)</option>
              <option value="agents">.agents/skills (shared)</option>
            </select>
          </label>
          <p class="field-hint">
            {{ skillHomeHint }}
          </p>
        </template>

        <label class="field">
          <span class="field-label">content</span>
          <textarea
            v-model="content"
            class="threadle-input modal-editor"
            rows="12"
            spellcheck="false"
          />
        </label>

        <div v-if="error" class="modal-error">{{ error }}</div>
      </div>

      <footer class="modal-foot">
        <button class="threadle-btn" @click="emit('close')">Cancel</button>
        <button class="threadle-btn primary" :disabled="busy || !valid" @click="create">
          {{ busy ? (initialContent ? "Importing…" : "Creating…") : initialContent ? "Import" : "Create" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  mode: "rules" | "skill";
  projectDirs: string[];
  /** Prefill when importing a SKILL.md */
  initialName?: string;
  initialContent?: string;
  initialLocation?: "claude" | "opencode" | "cursor" | "agents" | "threadle-custom" | "threadle-imported";
  initialScope?: string;
}>();

const emit = defineEmits<{
  close: [];
  created: [
    artifact: {
      path: string;
      name: string;
      kind: string;
      source: string;
      size: number;
      mtime: number;
      description?: string;
      autoInvoke?: boolean;
      origin?: string;
      layer?: number;
      shadowedBy?: string;
    },
  ];
}>();

const scope = ref(props.initialScope || props.projectDirs[0] || "global");
const ruleType = ref("CLAUDE.md");
const skillName = ref(props.initialName ?? "");
const skillLocation = ref<
  "claude" | "opencode" | "cursor" | "agents" | "threadle-custom" | "threadle-imported"
>(props.initialLocation ?? (props.initialContent ? "threadle-imported" : "threadle-custom"));
const busy = ref(false);
const error = ref<string>();

const skillHomeHint = computed(() => {
  const loc = skillLocation.value;
  const proj = scope.value !== "global";
  if (loc === "threadle-custom") {
    return proj
      ? "writes to <project>/.threadle/skills/custom — project skills override threadle libraries on name clash"
      : "writes to ~/.config/threadle/skills/custom — overridden by any same-named project skill";
  }
  if (loc === "threadle-imported") {
    return proj
      ? "writes to <project>/.threadle/skills/imported"
      : "writes to ~/.config/threadle/skills/imported";
  }
  if (proj) return `writes to <project>/.${loc === "opencode" ? "opencode" : loc === "cursor" ? "cursor" : loc === "agents" ? "agents" : "claude"}/skills`;
  return `writes under the global ${loc} skills home`;
});

const RULES_TEMPLATE = `# Project instructions

## Context

- What this project is, in one paragraph.

## Rules

- Conventions the agent must follow.
- Commands to run before considering a change done.
`;

const SKILL_TEMPLATE = (name: string) => `---
name: ${name || "my-skill"}
description: One line describing when an agent should reach for this skill.
---

# ${name || "my-skill"}

## When to use

Describe the trigger conditions.

## Steps

1. …
2. …
`;

const content = ref(
  props.initialContent
    ? props.initialContent
    : props.mode === "skill"
      ? SKILL_TEMPLATE(props.initialName ?? "")
      : RULES_TEMPLATE,
);

watch(skillName, (n) => {
  // keep the frontmatter name in sync while the template is untouched enough
  if (props.mode === "skill" && content.value.includes("name: ")) {
    content.value = content.value.replace(/name: [^\n]*/, `name: ${n || "my-skill"}`);
    content.value = content.value.replace(/^# .*$/m, `# ${n || "my-skill"}`);
  }
});

const valid = computed(() =>
  props.mode === "skill"
    ? /^[a-z0-9][a-z0-9-]{1,63}$/.test(skillName.value) && content.value.trim().length > 0
    : content.value.trim().length > 0,
);

async function create(): Promise<void> {
  busy.value = true;
  error.value = undefined;
  try {
    const importing = props.mode === "skill" && !!props.initialContent;
    const res = await fetch(importing ? "/api/rules/skill/import" : "/api/rules/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        importing
          ? {
              scope: scope.value,
              name: skillName.value,
              location: skillLocation.value,
              content: content.value,
            }
          : {
              kind: props.mode,
              scope: scope.value,
              type: ruleType.value,
              name: skillName.value,
              location: skillLocation.value,
              content: content.value,
            },
      ),
    });
    const body = (await res.json()) as {
      error?: string;
      artifact?: {
        path: string;
        name: string;
        kind: string;
        source: string;
        size: number;
        mtime: number;
        description?: string;
        autoInvoke?: boolean;
        origin?: string;
        layer?: number;
        shadowedBy?: string;
      };
    };
    if (!res.ok || !body.artifact) throw new Error(body.error ?? `${res.status}`);
    emit("created", body.artifact);
  } catch (err) {
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
  width: 560px;
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
.field-hint {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  margin: 0;
}
.mono-input {
  font-family: var(--mono);
  font-size: var(--fs-sm);
}
.modal-editor {
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: 1.5;
  resize: vertical;
  min-height: 200px;
}
.modal-error {
  font-size: var(--fs-sm);
  color: var(--status-error);
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 18px;
}
</style>
