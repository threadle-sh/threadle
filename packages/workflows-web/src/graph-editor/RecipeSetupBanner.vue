<template>
  <div class="recipe-setup" role="region" aria-label="Recipe setup">
    <div class="recipe-setup-head">
      <span class="micro-label">recipe · fill before ▶</span>
      <button type="button" class="vsc-btn" title="Dismiss" @click="emit('dismiss')">✕</button>
    </div>
    <p v-if="setup.outcome" class="recipe-setup-outcome">{{ setup.outcome }}</p>
    <ul class="recipe-setup-list mono">
      <li v-if="setup.needs.model" :class="{ done: !gaps.model }">
        <span class="recipe-setup-mark">{{ gaps.model ? "○" : "●" }}</span>
        set a <b>model</b> on each agent node (inspector)
      </li>
      <li v-if="setup.needs.dir" :class="{ done: !gaps.dir }">
        <span class="recipe-setup-mark">{{ gaps.dir ? "○" : "●" }}</span>
        run with project <b>--dir</b>
        <span v-if="serverProjectDir" class="recipe-setup-hint">· using {{ serverProjectDir }}</span>
        <span v-else class="recipe-setup-hint">· start threadle from the repo, or open a live session there</span>
      </li>
      <li v-if="setup.needs.session" :class="{ done: !gaps.session }">
        <span class="recipe-setup-mark">{{ gaps.session ? "○" : "●" }}</span>
        wire a <b>session</b> into the context node (drag from Sessions / palette)
      </li>
      <li v-for="p in setup.params" :key="p" class="done">
        <span class="recipe-setup-mark">·</span>
        param <b>{{ p }}</b> — asked at run time
      </li>
    </ul>
    <p v-if="setup.note" class="recipe-setup-note">{{ setup.note }}</p>
    <div class="recipe-setup-actions">
      <button
        type="button"
        class="threadle-btn"
        :disabled="gaps.any"
        title="Dismiss when the contract looks filled"
        @click="emit('dismiss')"
      >
        {{ gaps.any ? "still missing slots" : "ready · dismiss" }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface RecipeSetupState {
  recipeId: string;
  outcome: string;
  needs: { model: boolean; dir: boolean; session: boolean };
  params: string[];
  note?: string;
}

export interface RecipeSetupGaps {
  model: boolean;
  dir: boolean;
  session: boolean;
  any: boolean;
}

defineProps<{
  setup: RecipeSetupState;
  gaps: RecipeSetupGaps;
  serverProjectDir: string;
}>();

const emit = defineEmits<{
  dismiss: [];
}>();
</script>

<style scoped>
.recipe-setup {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 45;
  width: min(320px, calc(100% - 24px));
  max-height: min(70%, calc(100% - 24px));
  overflow-y: auto;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.recipe-setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.recipe-setup-outcome {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text);
  line-height: 1.35;
}
.recipe-setup-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.recipe-setup-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  line-height: 1.35;
}
.recipe-setup-list li.done {
  color: var(--text-faint);
}
.recipe-setup-list b {
  color: var(--text);
  font-weight: 600;
}
.recipe-setup-mark {
  flex-shrink: 0;
  width: 1em;
  text-align: center;
}
.recipe-setup-hint {
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.recipe-setup-note {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-faint);
  line-height: 1.35;
}
.recipe-setup-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
</style>
