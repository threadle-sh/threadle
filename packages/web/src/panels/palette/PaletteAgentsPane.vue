<script setup lang="ts">
import type { AgentDef } from "@threadle/shared";
import { providerColor } from "@/lib/providers";
import { dragAgent } from "@/lib/paletteDrag";

export interface AgentProviderGroup {
  provider: string;
  label: string;
  kinds: Array<{ kind: string; agents: AgentDef[] }>;
}

defineProps<{
  groups: AgentProviderGroup[];
  empty: boolean;
}>();
</script>

<template>
  <section class="pal-section">
    <div>
      <div
        v-for="pg in groups"
        :key="pg.provider"
        class="pal-provider-group"
      >
        <div class="pal-provider-name">
          <span
            class="pal-provider-dot"
            :style="{ background: providerColor(pg.provider) }"
          />
          {{ pg.label }}
        </div>
        <div v-for="kg in pg.kinds" :key="kg.kind" class="pal-kind-group">
          <div class="pal-group-name">{{ kg.kind }}</div>
          <div
            v-for="agent in kg.agents"
            :key="agent.provider + agent.name"
            class="pal-item"
            draggable="true"
            @dragstart="dragAgent($event, agent)"
          >
            <span
              class="pal-icon"
              :style="{ background: providerColor(agent.provider) }"
              >⟨/⟩</span
            >
            <div class="pal-item-body">
              <div class="pal-item-title">{{ agent.name }}</div>
              <div class="pal-item-sub">
                {{ agent.description ?? agent.scope }}
              </div>
            </div>
          </div>
        </div>
      </div>
      <p v-if="empty" class="pal-empty">no agents found</p>
    </div>
  </section>
</template>
