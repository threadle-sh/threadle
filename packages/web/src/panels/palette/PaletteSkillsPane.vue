<script setup lang="ts">
import { dragSkill, type PaletteSkillDragRow } from "@/lib/paletteDrag";

defineProps<{
  skills: PaletteSkillDragRow[];
  ready: boolean;
}>();
</script>

<template>
  <section class="pal-section">
    <div>
      <div
        v-for="a in skills"
        :key="a.path"
        class="pal-item"
        draggable="true"
        :title="a.description || a.path"
        @dragstart="dragSkill($event, a)"
      >
        <span class="pal-icon" style="background: var(--accent); color: var(--accent-fg)">✦</span>
        <div class="pal-item-body">
          <div class="pal-item-title mono">{{ a.name }}</div>
          <div class="pal-item-sub">{{ a.source }}</div>
        </div>
      </div>
      <p v-if="!skills.length" class="pal-empty">
        {{ ready ? "no skills found" : "loading…" }}
      </p>
    </div>
  </section>
</template>
