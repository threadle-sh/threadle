<template>
  <div class="judge-panel">
    <label class="cfg-row">
      <span>label</span>
      <input
        class="threadle-input cfg-label"
        :value="data.label ?? ''"
        placeholder="judge"
        spellcheck="false"
        @input="onLabel"
      />
    </label>

    <label class="cfg-row">
      <span>on miss</span>
      <select
        class="threadle-input cfg-select"
        :value="data.unmatched"
        @change="onUnmatched"
      >
        <option value="unsure">unsure</option>
        <option value="park">park · approve</option>
      </select>
    </label>

    <p class="hint">{{ missHint }}</p>

    <div class="section-label">out labels</div>
    <label v-for="port in JUDGE_PORTS" :key="port" class="cfg-row">
      <span class="port-key">{{ port }}</span>
      <input
        class="threadle-input cfg-label"
        :value="data.portLabels?.[port] ?? ''"
        :placeholder="port"
        spellcheck="false"
        @input="onPortLabel(port, $event)"
      />
    </label>

    <div class="section-label">
      matchers
      <button type="button" class="add" @click="addMatcher">+ add</button>
    </div>
    <div v-if="!data.matchers?.length" class="empty mono">none — all traffic → miss</div>
    <div v-for="(m, i) in data.matchers" :key="m.id" class="matcher">
      <div class="m-row">
        <select class="threadle-input m-port" :value="m.port" @change="onMatcherPort(m, $event)">
          <option value="pass">pass</option>
          <option value="fail">fail</option>
        </select>
        <select class="threadle-input m-kind" :value="m.kind" @change="onMatcherKind(m, $event)">
          <option value="contains">contains</option>
          <option value="regex">regex</option>
        </select>
        <button type="button" class="rm" title="remove" @click="removeMatcher(i)">×</button>
      </div>
      <input
        class="threadle-input m-pat mono"
        :value="m.pattern"
        :placeholder="m.kind === 'regex' ? 'regex pattern' : 'substring'"
        spellcheck="false"
        @input="onMatcherPattern(m, $event)"
      />
      <label class="case">
        <input
          type="checkbox"
          :checked="!!m.caseSensitive"
          @change="onMatcherCase(m, $event)"
        />
        case-sensitive
      </label>
    </div>

    <div class="meta mono">
      {{ data.matchers?.length ?? 0 }} matcher{{ (data.matchers?.length ?? 0) === 1 ? "" : "s" }}
      · first hit wins · 1 in · 3 out
    </div>

    <p class="hint">
      Ordered regex / contains only — no expression language, no LLM. Losing
      out-ports stay empty so only the winning arm continues.
    </p>

    <dl class="facts">
      <div class="fact">
        <dt>ports</dt>
        <dd>out:pass · out:fail · out:unsure</dd>
      </div>
      <div class="fact">
        <dt>order</dt>
        <dd>first matcher that hits wins</dd>
      </div>
      <div class="fact">
        <dt>miss</dt>
        <dd>{{ data.unmatched === "park" ? "park dock → unsure" : "emit on unsure" }}</dd>
      </div>
      <div class="fact">
        <dt>cycles</dt>
        <dd>not supported — keep fix linear</dd>
      </div>
      <div class="fact">
        <dt>vs ‡</dt>
        <dd>breaker = fuse; judge = route</dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  JudgeMatcher,
  JudgeMatcherKind,
  JudgeNodeData,
  JudgePort,
  JudgeUnmatchedAction,
} from "@threadle/shared";
import { JUDGE_PORTS } from "@threadle/shared";

const props = defineProps<{ data: JudgeNodeData }>();

const missHint = computed(() =>
  props.data.unmatched === "park"
    ? "No matcher hit → park for splice; approve continues on unsure."
    : "No matcher hit → emit inbound text on the unsure out-port.",
);

function ensureMatchers(): JudgeMatcher[] {
  return (props.data.matchers ??= []);
}

function onLabel(e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  props.data.label = v || undefined;
}

function onUnmatched(e: Event): void {
  props.data.unmatched = (e.target as HTMLSelectElement).value as JudgeUnmatchedAction;
}

function onPortLabel(port: JudgePort, e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  if (!v || v === port) {
    if (props.data.portLabels) {
      delete props.data.portLabels[port];
      if (!Object.keys(props.data.portLabels).length) delete props.data.portLabels;
    }
    return;
  }
  (props.data.portLabels ??= {})[port] = v;
}

function addMatcher(): void {
  ensureMatchers().push({
    id: `m-${crypto.randomUUID().slice(0, 6)}`,
    port: "pass",
    kind: "contains",
    pattern: "",
  });
}

function removeMatcher(i: number): void {
  ensureMatchers().splice(i, 1);
}

function onMatcherPort(m: JudgeMatcher, e: Event): void {
  m.port = (e.target as HTMLSelectElement).value as "pass" | "fail";
}

function onMatcherKind(m: JudgeMatcher, e: Event): void {
  m.kind = (e.target as HTMLSelectElement).value as JudgeMatcherKind;
}

function onMatcherPattern(m: JudgeMatcher, e: Event): void {
  m.pattern = (e.target as HTMLInputElement).value;
}

function onMatcherCase(m: JudgeMatcher, e: Event): void {
  const on = (e.target as HTMLInputElement).checked;
  if (on) m.caseSensitive = true;
  else delete m.caseSensitive;
}
</script>

<style scoped>
.judge-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.cfg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.cfg-select {
  width: auto;
  min-width: 140px;
  font-size: var(--fs-xs);
}
.cfg-label {
  flex: 1;
  min-width: 0;
  width: auto;
  font-size: var(--fs-xs);
  text-align: left;
}
.port-key {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  width: 52px;
  flex-shrink: 0;
}
.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  margin-top: 4px;
}
.add {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  padding: 0;
}
.add:hover {
  color: var(--text);
}
.empty {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.matcher {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg-raised, var(--input-bg));
}
.m-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.m-port,
.m-kind {
  width: auto;
  min-width: 0;
  flex: 1;
  font-size: var(--fs-xs);
  font-family: var(--mono);
}
.m-pat {
  width: 100%;
  font-size: var(--fs-xs);
}
.rm {
  flex-shrink: 0;
  width: 22px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: var(--fs-md);
  line-height: 1;
  padding: 0;
}
.rm:hover {
  color: var(--text);
}
.case {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  cursor: pointer;
}
.meta {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.45;
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
}
</style>
