<script setup lang="ts">
import type { WorkflowFolder } from "@threadle/shared";
import FolderMark from "@/panels/FolderMark.vue";
import { dragSubgraph } from "@/lib/paletteDrag";

export interface PaletteGraphListItem {
  id: string;
  name: string;
  kind?: "workflow" | "subgraph";
  nodeCount: number;
  edgeCount?: number;
  usedBy?: number;
}

export type PaletteGraphRow =
  | { kind: "folder"; key: string; folder: WorkflowFolder; depth: number; graphCount: number }
  | { kind: "graph"; key: string; graph: PaletteGraphListItem; depth: number };

defineProps<{
  workflowRows: PaletteGraphRow[];
  subgraphRows: PaletteGraphRow[];
  subgraphEmpty: boolean;
  collapsed: Set<string>;
  activeFolderId?: string;
  activeGraphId?: string;
}>();

const emit = defineEmits<{
  toggleFolder: [id: string];
  openGraph: [g: PaletteGraphListItem];
  dragEnd: [];
  graphDragStart: [];
  folderContextmenu: [e: MouseEvent, folder: WorkflowFolder];
  folderMousedown: [e: MouseEvent, folder: WorkflowFolder];
  folderMore: [e: MouseEvent, folder: WorkflowFolder];
  graphContextmenu: [e: MouseEvent, g: PaletteGraphListItem];
  graphMousedown: [e: MouseEvent, g: PaletteGraphListItem];
  graphMore: [e: MouseEvent, g: PaletteGraphListItem];
}>();

function onDragGraph(e: DragEvent, g: PaletteGraphListItem): void {
  emit("graphDragStart");
  dragSubgraph(e, g);
}
</script>

<template>
  <section class="pal-section">
    <template v-for="row in workflowRows" :key="'pw-' + row.key">
      <div
        v-if="row.kind === 'folder'"
        class="pal-folder"
        :class="{ open: activeFolderId === row.folder.id }"
        :style="{ '--pal-depth': row.depth }"
        @contextmenu.capture.prevent.stop="emit('folderContextmenu', $event, row.folder)"
        @mousedown.capture="emit('folderMousedown', $event, row.folder)"
      >
        <button
          type="button"
          class="pal-folder-main"
          @click="emit('toggleFolder', row.folder.id)"
        >
          <span class="pal-folder-caret">{{ collapsed.has(row.folder.id) ? "▸" : "▾" }}</span>
          <FolderMark :open="!collapsed.has(row.folder.id)" />
          <span class="pal-folder-label">{{ row.folder.name }}</span>
          <span class="pal-folder-n mono">{{ row.graphCount }}</span>
        </button>
        <button
          type="button"
          class="pal-folder-more"
          title="Folder actions"
          @click.stop="emit('folderMore', $event, row.folder)"
        >
          ⋯
        </button>
      </div>
      <div
        v-else
        class="pal-item pal-item-clickable pal-graph"
        :class="{ open: activeGraphId === row.graph.id }"
        :style="{ '--pal-depth': row.depth }"
        draggable="true"
        @click="emit('openGraph', row.graph)"
        @dragstart="onDragGraph($event, row.graph)"
        @dragend="emit('dragEnd')"
        @contextmenu.capture.prevent.stop="emit('graphContextmenu', $event, row.graph)"
        @mousedown.capture="emit('graphMousedown', $event, row.graph)"
      >
        <span class="pal-icon" style="background: var(--accent-soft); color: var(--text)">#</span>
        <div class="pal-item-body">
          <div class="pal-item-title pal-ellipsis">{{ row.graph.name }}</div>
          <div class="pal-item-sub">{{ row.graph.nodeCount }} nodes · workflow</div>
        </div>
        <button
          type="button"
          class="pal-folder-more"
          title="Workflow actions"
          @click.stop="emit('graphMore', $event, row.graph)"
        >
          ⋯
        </button>
      </div>
    </template>
    <p v-if="!workflowRows.length" class="pal-empty">no other workflows</p>

    <div v-if="subgraphRows.length || subgraphEmpty" class="micro-label pal-sub-heading">subgraphs</div>
    <template v-for="row in subgraphRows" :key="'ps-' + row.key">
      <div
        v-if="row.kind === 'folder'"
        class="pal-folder"
        :class="{ open: activeFolderId === row.folder.id }"
        :style="{ '--pal-depth': row.depth }"
        @contextmenu.capture.prevent.stop="emit('folderContextmenu', $event, row.folder)"
        @mousedown.capture="emit('folderMousedown', $event, row.folder)"
      >
        <button
          type="button"
          class="pal-folder-main"
          @click="emit('toggleFolder', row.folder.id)"
        >
          <span class="pal-folder-caret">{{ collapsed.has(row.folder.id) ? "▸" : "▾" }}</span>
          <FolderMark :open="!collapsed.has(row.folder.id)" />
          <span class="pal-folder-label">{{ row.folder.name }}</span>
          <span class="pal-folder-n mono">{{ row.graphCount }}</span>
        </button>
        <button
          type="button"
          class="pal-folder-more"
          title="Folder actions"
          @click.stop="emit('folderMore', $event, row.folder)"
        >
          ⋯
        </button>
      </div>
      <div
        v-else
        class="pal-item pal-item-clickable pal-graph"
        :class="{ open: activeGraphId === row.graph.id }"
        :style="{ '--pal-depth': row.depth }"
        draggable="true"
        @click="emit('openGraph', row.graph)"
        @dragstart="onDragGraph($event, row.graph)"
        @dragend="emit('dragEnd')"
        @contextmenu.capture.prevent.stop="emit('graphContextmenu', $event, row.graph)"
        @mousedown.capture="emit('graphMousedown', $event, row.graph)"
      >
        <span class="pal-icon" style="background: var(--panel-bg-raised); color: var(--text-dim)">⌗</span>
        <div class="pal-item-body">
          <div class="pal-item-title pal-ellipsis">{{ row.graph.name }}</div>
          <div class="pal-item-sub">
            {{ row.graph.nodeCount }} nodes
            <template v-if="row.graph.usedBy"> · used {{ row.graph.usedBy }}×</template>
          </div>
        </div>
        <button
          type="button"
          class="pal-folder-more"
          title="Subgraph actions"
          @click.stop="emit('graphMore', $event, row.graph)"
        >
          ⋯
        </button>
      </div>
    </template>
    <p v-if="subgraphEmpty" class="pal-empty">no subgraphs yet — extract a selection on the canvas</p>
  </section>
</template>
