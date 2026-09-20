<script setup lang="ts">
defineProps<{
  open: boolean;
  x: number;
  y: number;
  title: string;
  hasKey: boolean;
  hasNonempty?: boolean;
}>();

const emit = defineEmits<{
  only: [];
  except: [];
  add: [];
  hide: [];
  showAll: [];
  hideAll: [];
  invert: [];
  nonempty: [];
}>();
</script>

<template>
  <div
    v-if="open"
    class="filter-chip-menu"
    :style="{ left: x + 'px', top: y + 'px' }"
    @click.stop
    @contextmenu.prevent
  >
    <div class="filter-chip-menu-title mono">{{ title }}</div>
    <button
      class="filter-chip-menu-item"
      :disabled="!hasKey"
      title="Turn on only this"
      @click="emit('only')"
    >
      only these
    </button>
    <button
      class="filter-chip-menu-item"
      :disabled="!hasKey"
      title="Turn on everything except this"
      @click="emit('except')"
    >
      all except these
    </button>
    <button
      class="filter-chip-menu-item"
      :disabled="!hasKey"
      title="Turn this on (leave others as-is)"
      @click="emit('add')"
    >
      also show
    </button>
    <button
      class="filter-chip-menu-item"
      :disabled="!hasKey"
      title="Turn this off (leave others as-is)"
      @click="emit('hide')"
    >
      hide these
    </button>
    <div class="filter-chip-menu-sep" />
    <button class="filter-chip-menu-item" title="Show every option" @click="emit('showAll')">
      show all
    </button>
    <button class="filter-chip-menu-item" title="Hide every option" @click="emit('hideAll')">
      hide all
    </button>
    <button class="filter-chip-menu-item" title="Flip every option on/off" @click="emit('invert')">
      invert
    </button>
    <button
      v-if="hasNonempty"
      class="filter-chip-menu-item"
      title="Show only options that have at least one item"
      @click="emit('nonempty')"
    >
      only nonempty
    </button>
  </div>
</template>
