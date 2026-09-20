<script setup lang="ts">
import { dragRules, type PaletteSkillDragRow } from "@/lib/paletteDrag";

defineProps<{
  rules: PaletteSkillDragRow[];
  ready: boolean;
}>();
</script>

<template>
  <section class="pal-section">
    <div>
      <div
        v-for="a in rules"
        :key="a.path"
        class="pal-item"
        draggable="true"
        :title="a.path"
        @dragstart="dragRules($event, a)"
      >
        <span class="pal-icon" style="background: var(--lane-session); color: #0b1c30">§</span>
        <div class="pal-item-body">
          <div class="pal-item-title mono">{{ a.name }}</div>
          <div class="pal-item-sub">{{ a.source }}</div>
        </div>
      </div>
      <p v-if="!rules.length" class="pal-empty">
        {{ ready ? "no rules files found" : "loading…" }}
      </p>
    </div>
  </section>
</template>
