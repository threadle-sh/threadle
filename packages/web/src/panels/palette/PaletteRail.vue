<script setup lang="ts">
import { PAL_RAIL_GROUPS, type PalTab } from "@/lib/paletteTabs";

defineProps<{
  activeTab: PalTab;
  isSearching: boolean;
}>();

const emit = defineEmits<{
  select: [tab: PalTab];
}>();
</script>

<template>
  <div class="pal-rail">
    <template v-for="(group, gi) in PAL_RAIL_GROUPS" :key="group.id">
      <div v-if="gi > 0" class="pal-rail-sep" :title="group.label" />
      <button
        v-for="t in group.tabs"
        :key="t.id"
        class="pal-rail-btn"
        :class="{ active: !isSearching && activeTab === t.id }"
        :title="t.label"
        @click="emit('select', t.id)"
      >
        {{ t.glyph }}
      </button>
    </template>
  </div>
</template>
