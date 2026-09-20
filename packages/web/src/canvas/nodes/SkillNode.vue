<template>
  <NodeCard
    :id="id"
    glyph="✦"
    icon-bg="var(--accent)"
    :title="fallbackTitle"
    :label="data.label"
    renamable
    :subtitle="subtitle"
    :status="nodeStatus"
    :run-status="nodeStatus"
    :selected="selected"
    :has-input="true"
    has-output
    out-handle-color="var(--wire-skill)"
    @update:label="(v) => (data.label = v)"
  >
    <template #trailing>
      <button
        v-if="mode === 'invoke'"
        type="button"
        class="skill-mode"
        :title="`Invoke via ${providerLabel} (click to cycle provider)`"
        @click.stop="cycleProvider"
      >
        {{ providerShort }}
      </button>
      <button
        type="button"
        class="skill-mode"
        :title="modeTitle"
        @click.stop="toggleMode"
      >
        {{ modeGlyph }}
      </button>
    </template>
  </NodeCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { NodeStatus, ProviderId, SkillNodeData, SkillRunMode } from "@threadle/shared";
import {
  DEFAULT_SKILL_INVOKE_PROVIDER,
  skillInvokeProvider,
} from "@threadle/shared";
import NodeCard from "./NodeCard.vue";
import { PROVIDER_IDS, providerLabel as labelOf, providerShort as shortOf } from "@/lib/providers";

const props = defineProps<{
  id: string;
  data: SkillNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const fallbackTitle = computed(() => props.data.name || "Skill");

const mode = computed<SkillRunMode>(() => props.data.mode ?? "inject");
const modeGlyph = computed(() => (mode.value === "invoke" ? "▶" : "↦"));
const modeTitle = computed(() =>
  mode.value === "invoke"
    ? "Invoke via provider CLI /skill (click → inject)"
    : "Inject SKILL.md into lane (click → invoke)",
);

const provider = computed(() => skillInvokeProvider(props.data));
const providerShort = computed(() => shortOf(provider.value));
const providerLabel = computed(() => labelOf(provider.value));

function toggleMode(): void {
  props.data.mode = mode.value === "invoke" ? "inject" : "invoke";
  if (props.data.mode === "invoke" && !props.data.provider) {
    props.data.provider = DEFAULT_SKILL_INVOKE_PROVIDER;
  }
}

function cycleProvider(): void {
  const cur = skillInvokeProvider(props.data);
  const i = PROVIDER_IDS.indexOf(cur);
  const next = PROVIDER_IDS[(i + 1) % PROVIDER_IDS.length] as ProviderId;
  props.data.provider = next;
}

const subtitle = computed(() => {
  const bits: string[] = [];
  if (mode.value === "invoke") {
    bits.push("invoke");
    bits.push(providerShort.value);
  } else {
    bits.push("inject");
  }
  if (props.data.shadowedBy) bits.push("shadowed");
  if (props.data.label && props.data.name) bits.push(props.data.name);
  if (props.data.source) bits.push(props.data.source);
  else if (props.data.description) bits.push(props.data.description);
  else bits.push("SKILL.md");
  return bits.join(" · ");
});
const nodeStatus = computed(() => props.status ?? "idle");
</script>

<style scoped>
.skill-mode {
  font: inherit;
  font-size: var(--fs-2xs);
  line-height: 1;
  padding: 2px 5px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--bg-elevated, transparent);
  color: var(--muted);
  cursor: pointer;
}
.skill-mode:hover {
  color: var(--fg);
  border-color: var(--fg-dim, var(--border));
}
</style>
