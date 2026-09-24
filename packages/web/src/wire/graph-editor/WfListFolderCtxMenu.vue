<template>
  <Teleport to="body">
    <div
      v-if="ctx"
      class="menu-pop wf-folder-ctx"
      :style="{
        position: 'fixed',
        left: ctx.x + 'px',
        top: ctx.y + 'px',
        zIndex: 200,
      }"
      @click.stop
      @mousedown.stop
      @contextmenu.prevent
    >
      <button class="menu-item" @click="emit('new-workflow')">
        <span class="menu-glyph">+</span> New workflow
      </button>
      <button class="menu-item" @click="emit('new-subfolder')">
        <span class="menu-glyph"><FolderMark /></span> New subfolder
      </button>
      <button class="menu-item" @click="emit('rename')">
        <span class="menu-glyph">✎</span> Rename
      </button>
      <button class="menu-item menu-danger" @click="emit('delete')">
        <span class="menu-glyph">⌫</span> Delete folder
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import FolderMark from "@/panels/FolderMark.vue";

defineProps<{
  ctx?: { id: string; name: string; x: number; y: number };
}>();

const emit = defineEmits<{
  "new-workflow": [];
  "new-subfolder": [];
  rename: [];
  delete: [];
}>();
</script>

<style scoped>
.menu-pop {
  position: absolute;
  z-index: 30;
  min-width: 205px;
  background: var(--panel-bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.wf-folder-ctx {
  position: fixed;
  z-index: 80;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: var(--fs-sm);
  font-family: var(--font);
  padding: 7px 10px;
  cursor: pointer;
  text-align: left;
}
.menu-item:hover {
  background: var(--node-bg-hover);
  color: var(--text);
}
.menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.menu-item:disabled:hover {
  background: none;
  color: var(--text-dim);
}
.menu-item.menu-danger:hover {
  color: var(--status-error);
}
.menu-glyph {
  font-family: var(--mono);
  width: 1.1em;
  text-align: center;
  color: var(--text-faint);
}
.menu-glyph :deep(.folder-mark) {
  width: 12px;
  height: 12px;
  color: currentColor;
}
</style>
