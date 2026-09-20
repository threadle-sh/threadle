<script setup lang="ts">
import type { ContextKind, NodeType } from "@threadle/shared";
import { dragBlock, dragContext, dragCustom } from "@/lib/paletteDrag";

export interface PaletteBlockRow {
  type: NodeType;
  label: string;
  hint: string;
  glyph: string;
  iconBg: string;
  iconFg?: string;
}

export interface PaletteCustomRow {
  name: string;
  label: string;
  glyph: string;
  description?: string;
  kind: string;
  file?: string;
  command?: string[];
}

export interface PaletteContextKindRow {
  kind: ContextKind;
  glyph: string;
  label: string;
  hint: string;
}

defineProps<{
  blocks: PaletteBlockRow[];
  custom: PaletteCustomRow[];
  contextKinds: PaletteContextKindRow[];
}>();
</script>

<template>
  <div>
    <section class="pal-section">
      <div class="micro-label pal-sub-heading">blocks</div>
      <div>
        <div
          v-for="b in blocks"
          :key="b.type"
          class="pal-item"
          draggable="true"
          @dragstart="dragBlock($event, b.type)"
        >
          <span
            class="pal-icon"
            :style="{ background: b.iconBg, color: b.iconFg || undefined }"
          >{{ b.glyph }}</span>
          <div class="pal-item-body">
            <div class="pal-item-title">{{ b.label }}</div>
            <div class="pal-item-sub">{{ b.hint }}</div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="custom.length" class="pal-section">
      <div class="micro-label pal-sub-heading">custom · ~/.config/threadle/nodes</div>
      <div>
        <div
          v-for="d in custom"
          :key="d.name"
          class="pal-item"
          draggable="true"
          :title="d.description ?? (d.kind === 'class' ? `class · ${d.file}` : d.command?.join(' '))"
          @dragstart="dragCustom($event, d.name)"
        >
          <span class="pal-icon" style="background: var(--context)">{{ d.glyph }}</span>
          <div class="pal-item-body">
            <div class="pal-item-title">{{ d.label }}</div>
            <div class="pal-item-sub">{{ d.description ?? "text in → text out" }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="pal-section">
      <div class="micro-label pal-sub-heading">context</div>
      <div>
        <div
          v-for="ck in contextKinds"
          :key="ck.kind"
          class="pal-item"
          draggable="true"
          @dragstart="dragContext($event, ck.kind)"
        >
          <span class="pal-icon" style="background: var(--context)">{{
            ck.glyph
          }}</span>
          <div class="pal-item-body">
            <div class="pal-item-title">{{ ck.label }}</div>
            <div class="pal-item-sub">{{ ck.hint }}</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
