<template>
  <div class="custom-panel">
    <div class="meta mono">
      <span>{{ def?.kind ?? "custom" }}</span>
      <span v-if="capacityLabel">· {{ capacityLabel }}</span>
    </div>

    <p v-if="description" class="hint">{{ description }}</p>
    <p v-else class="hint dim">No description in the manifest.</p>

    <div v-if="inPorts.length || outPorts.length" class="sect">
      <div class="micro-label">ports</div>
      <div v-for="p in inPorts" :key="'in:' + p.name" class="port-row">
        <span class="side">in</span>
        <span class="pname">{{ p.name }}</span>
        <span class="ptype mono">{{ p.type }}</span>
        <span class="pcap mono">{{ capLabel(p.maxConnections) }}</span>
        <span v-if="p.required === false" class="opt">optional</span>
      </div>
      <div v-for="p in outPorts" :key="'out:' + p.name" class="port-row">
        <span class="side out">out</span>
        <span class="pname">{{ p.name }}</span>
        <span class="ptype mono">{{ p.type }}</span>
        <span class="pcap mono">{{ capLabel(p.maxConnections) }}</span>
      </div>
    </div>
    <div v-else class="sect">
      <div class="micro-label">ports</div>
      <div class="port-row">
        <span class="side">in</span>
        <span class="pname dim">{{ scalarIn }}</span>
        <span class="pcap mono">1</span>
      </div>
      <div class="port-row">
        <span class="side out">out</span>
        <span class="pname dim">{{ scalarOut }}</span>
        <span class="pcap mono">1</span>
      </div>
    </div>

    <div v-if="params.length" class="sect">
      <div class="micro-label">params</div>
      <div v-for="p in params" :key="p.name" class="param-row">
        <span class="pname">{{ p.label ?? p.name }}</span>
        <span class="ptype mono">{{ p.type }}</span>
      </div>
    </div>

    <dl class="facts">
      <div class="fact">
        <dt>id</dt>
        <dd class="mono">{{ data.ref.name }}</dd>
      </div>
      <div v-if="def?.timeoutMs" class="fact">
        <dt>timeout</dt>
        <dd>{{ Math.round(def.timeoutMs / 1000) }}s</dd>
      </div>
      <div class="fact">
        <dt>capacity</dt>
        <dd>extra wires refused when a port is full</dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { CustomNodeData, CustomParamDef, CustomPortDef } from "@threadle/shared";
import { useCustomNodes, type CustomNodeDef } from "@/stores/custom-nodes";

const props = defineProps<{ data: CustomNodeData }>();

const customNodes = useCustomNodes();
void customNodes.load();

const def = computed<CustomNodeDef | undefined>(() =>
  customNodes.defs.find((d) => d.name === props.data.ref.name),
);

const description = computed(
  () => def.value?.description ?? props.data.snapshot?.description,
);

const inPorts = computed<CustomPortDef[]>(
  () => def.value?.inputs ?? props.data.snapshot?.inputs ?? [],
);
const outPorts = computed<CustomPortDef[]>(
  () => def.value?.outputs ?? props.data.snapshot?.outputs ?? [],
);
const params = computed<CustomParamDef[]>(() => def.value?.params ?? []);

const scalarIn = computed(
  () => def.value?.input ?? props.data.snapshot?.input ?? "text",
);
const scalarOut = computed(
  () => def.value?.output ?? props.data.snapshot?.output ?? "text",
);

const capacityLabel = computed(() => {
  if (inPorts.value.length || outPorts.value.length) {
    const ni = inPorts.value.length;
    const no = outPorts.value.length;
    return `${ni} in · ${no} out`;
  }
  return "1 in · 1 out";
});

function capLabel(max?: number): string {
  const n = max ?? 1;
  return n >= 64 ? "∞" : `×${n}`;
}
</script>

<style scoped>
.custom-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.meta {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  display: flex;
  gap: 6px;
}
.hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.45;
}
.hint.dim {
  color: var(--text-faint);
  font-style: italic;
}
.sect {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.micro-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-faint);
}
.port-row,
.param-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto auto;
  gap: 8px;
  align-items: baseline;
  font-size: var(--fs-xs);
}
.param-row {
  grid-template-columns: minmax(0, 1fr) auto;
}
.side {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}
.side.out {
  color: var(--text-dim);
}
.pname {
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pname.dim {
  color: var(--text-faint);
}
.ptype,
.pcap {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.opt {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.facts {
  margin: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fact {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  font-size: var(--fs-xs);
  align-items: baseline;
}
.fact dt {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.fact dd {
  margin: 0;
  color: var(--text-dim);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--mono);
}
</style>
