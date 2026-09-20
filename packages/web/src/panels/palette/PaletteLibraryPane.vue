<script setup lang="ts">
import { dragLibrary, type PaletteLibraryDragItem } from "@/lib/paletteDrag";

defineProps<{
  items: PaletteLibraryDragItem[];
}>();
</script>

<template>
  <section class="pal-section">
    <div>
      <div
        v-for="pl in items"
        :key="pl.hash"
        class="pal-item"
        draggable="true"
        :title="pl.preview"
        @dragstart="dragLibrary($event, pl)"
      >
        <span class="pal-icon" style="background: var(--context)">❝</span>
        <div class="pal-item-body">
          <div class="pal-item-title pal-ellipsis">{{ pl.preview || pl.kind }}</div>
          <div class="pal-item-sub">
            {{ pl.kind }} · {{ pl.tags?.length ? pl.tags.join(", ") : "untagged" }}
          </div>
        </div>
      </div>
      <p v-if="!items.length" class="pal-empty">
        no saved payloads yet — extract or distill context first
      </p>
    </div>
  </section>
</template>
