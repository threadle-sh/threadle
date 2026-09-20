<script setup lang="ts">
import type { SessionRef } from "@threadle/shared";
import { providerColor } from "@/lib/providers";
import { relativeTime, shortId } from "@/lib/format";
import { dragSession } from "@/lib/paletteDrag";

export interface SessionGroup {
  dir: string;
  label: string;
  sessions: SessionRef[];
}

defineProps<{
  groups: SessionGroup[];
  empty: boolean;
  expandedSession?: string;
  sessionKey: (s: SessionRef) => string;
  subagentState: (s: SessionRef) => "unknown" | "loading" | "none" | "loaded";
  subagentsOf: (s: SessionRef) => SessionRef[];
}>();

const emit = defineEmits<{
  toggleSubagents: [s: SessionRef];
}>();
</script>

<template>
  <section class="pal-section">
    <div>
      <div v-for="group in groups" :key="group.dir" class="pal-group">
        <div class="pal-group-name" :title="group.dir">
          {{ group.label }}
        </div>
        <div v-for="s in group.sessions" :key="s.provider + s.id">
          <div
            class="pal-item"
            draggable="true"
            @dragstart="dragSession($event, s)"
          >
            <button
              class="pal-caret"
              title="Toggle subagent runs"
              @click.stop="emit('toggleSubagents', s)"
            >
              {{ subagentState(s) === "none" ? "·" : expandedSession === sessionKey(s) ? "▾" : "▸" }}
            </button>
            <span
              class="pal-icon"
              :style="{ background: providerColor(s.provider) }"
              >❯</span
            >
            <div class="pal-item-body">
              <div class="pal-item-title">{{ s.title ?? shortId(s.id) }}</div>
              <div class="pal-item-sub">
                {{ s.agent ? s.agent + " · " : "" }}{{ relativeTime(s.updatedAt) }}
              </div>
            </div>
            <span class="status-dot" :class="s.status" />
          </div>
          <template v-if="expandedSession === sessionKey(s)">
            <div v-if="subagentState(s) === 'loading'" class="pal-sub-hint">
              loading subagent runs…
            </div>
            <div v-else-if="!subagentsOf(s).length" class="pal-sub-hint">
              no subagent runs
            </div>
            <div
              v-for="c in subagentsOf(s)"
              :key="c.id"
              class="pal-item pal-subitem"
              draggable="true"
              @dragstart="dragSession($event, c)"
            >
              <span
                class="pal-icon pal-subicon"
                :style="{ background: providerColor(c.provider) }"
                >⎇</span
              >
              <div class="pal-item-body">
                <div class="pal-item-title">{{ c.title ?? shortId(c.id) }}</div>
                <div class="pal-item-sub">{{ c.agent ?? "subagent" }}</div>
              </div>
            </div>
          </template>
        </div>
      </div>
      <p v-if="empty" class="pal-empty">no sessions found</p>
    </div>
  </section>
</template>
