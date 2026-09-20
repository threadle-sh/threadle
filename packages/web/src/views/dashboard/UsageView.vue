<template>
  <div class="usage-chrome">
        <header class="dash-head">
          <div>
            <h1 class="dash-title">Statistics</h1>
          </div>
          <div class="view-controls">
            <ProviderFilterChips
              v-model="usageProviderF"
              :options="usageFilterChips"
            />
          </div>
        </header>
        <div class="dash-toolbar usage-toolbar">
          <input
            v-model="usageFilter"
            class="threadle-input dash-search"
            placeholder="Filter statistics…"
            spellcheck="false"
          />
        </div>
  </div>

        <div class="stat-tiles">
          <div class="stat-tile">
            <div class="micro-label">sessions</div>
            <div class="stat-num">{{ scopedSessions.length }}</div>
          </div>
          <div class="stat-tile">
            <div class="micro-label">agents</div>
            <div class="stat-num">{{ scopedAgentCount }}</div>
          </div>
          <div class="stat-tile" title="Sessions spawned from an agent definition">
            <div class="micro-label">agent instances</div>
            <div class="stat-num">
              {{ agentInstances.total
              }}<span v-if="agentInstances.live" class="stat-num-live"> · {{ agentInstances.live }} live</span>
            </div>
          </div>
          <div class="stat-tile">
            <div class="micro-label">tokens in</div>
            <div class="stat-num">{{ fmtTokens(usageTotals.in) }}</div>
          </div>
          <div class="stat-tile">
            <div class="micro-label">tokens out</div>
            <div class="stat-num">{{ fmtTokens(usageTotals.out) }}</div>
          </div>
          <div
            class="stat-tile"
            title="List price of every tracked token — what the API would have billed"
          >
            <div class="micro-label">tracked costs</div>
            <div class="stat-num">${{ usageTotals.cost.toFixed(2) }}</div>
          </div>
          <div
            class="stat-tile"
            title="What was really paid: $0 for subscription-billed claude-code sessions (configurable in Settings), API-key sessions at list price"
          >
            <div class="micro-label">actual spend</div>
            <div class="stat-num">${{ usageTotals.actual.toFixed(2) }}</div>
          </div>
          <div v-if="topModel" class="stat-tile">
            <div class="micro-label">top model</div>
            <div class="stat-num stat-num-sm">{{ shortModel(topModel.key) }}</div>
            <div class="stat-tile-sub mono">{{ fmtTokens(topModel.out) }} out total</div>
          </div>
          <div
            v-if="mostEffectiveModel"
            class="stat-tile"
            title="Highest average output tokens per session — gets the most done per run"
          >
            <div class="micro-label">most effective</div>
            <div class="stat-num stat-num-sm">{{ shortModel(mostEffectiveModel.key) }}</div>
            <div class="stat-tile-sub mono">
              {{ fmtTokens(Math.round(mostEffectiveModel.out / mostEffectiveModel.sessions)) }} out / session
            </div>
          </div>
          <div
            v-if="mostExpensiveModel"
            class="stat-tile"
            title="Highest total tracked costs (only providers that report cost)"
          >
            <div class="micro-label">most expensive</div>
            <div class="stat-num stat-num-sm">{{ shortModel(mostExpensiveModel.key) }}</div>
            <div class="stat-tile-sub mono">
              ${{ (mostExpensiveModel.cost ?? 0).toFixed(2) }} total
            </div>
          </div>
          <div
            v-if="cheapestModel"
            class="stat-tile"
            title="Lowest cost per 1k output tokens, among models with tracked costs"
          >
            <div class="micro-label">cheapest</div>
            <div class="stat-num stat-num-sm">{{ shortModel(cheapestModel.key) }}</div>
            <div class="stat-tile-sub mono">{{ perK(cheapestModel) }} / 1k out</div>
          </div>
        </div>

        <template v-if="showProviderSection('claude-code') && (claudeUsage || sub?.plan)">
          <div class="micro-label stat-section">
            <span class="prov-dot" :style="{ background: providerColor('claude-code') }" />
            claude code
          </div>
          <div class="stat-tiles">
            <div v-if="claudeUsage" class="stat-tile">
              <div class="micro-label">sessions</div>
              <div class="stat-num">{{ claudeUsage.sessions }}</div>
            </div>
            <div v-if="claudeUsage" class="stat-tile">
              <div class="micro-label">tokens out</div>
              <div class="stat-num">{{ fmtTokens(claudeUsage.out) }}</div>
            </div>
            <div
              v-if="claudeUsage"
              class="stat-tile"
              title="List price of the tokens — what the API would have billed"
            >
              <div class="micro-label">tracked costs</div>
              <div class="stat-num">${{ (claudeUsage.cost ?? 0).toFixed(2) }}</div>
            </div>
            <div
              v-if="claudeUsage"
              class="stat-tile"
              title="What you really paid (Settings → claude code billing)"
            >
              <div class="micro-label">actual spend</div>
              <div class="stat-num">${{ (claudeUsage.actual ?? 0).toFixed(2) }}</div>
              <div
                v-if="(claudeUsage.actual ?? 0) === 0 && (claudeUsage.cost ?? 0) > 0"
                class="stat-tile-sub mono"
              >
                subscription
              </div>
            </div>
            <div v-if="topClaudeModel" class="stat-tile">
              <div class="micro-label">top model</div>
              <div class="stat-num stat-num-sm">{{ shortModel(topClaudeModel.key) }}</div>
              <div class="stat-tile-sub mono">{{ fmtTokens(topClaudeModel.out) }} out total</div>
            </div>
            <div
              v-if="sub?.plan"
              class="stat-tile"
              :title="`Read from ~/.claude.json (billing: ${sub.billingType ?? 'unknown'}) — the flat rate your actual spend buys`"
            >
              <div class="micro-label">plan</div>
              <div class="stat-num stat-num-sm">{{ sub.plan }}</div>
              <div v-if="sub.subscriptionSince" class="stat-tile-sub mono">
                since {{ new Date(sub.subscriptionSince).toLocaleDateString() }}
              </div>
            </div>
            <div v-if="sub?.usage?.fiveHour" class="stat-tile" :title="subFetchedNote">
              <div class="micro-label">plan · 5h window</div>
              <div class="stat-num">{{ sub.usage.fiveHour.utilization }}%</div>
              <div class="sub-bar">
                <div
                  class="sub-bar-fill"
                  :class="subLevel(sub.usage.fiveHour.utilization)"
                  :style="{ width: Math.min(100, sub.usage.fiveHour.utilization) + '%' }"
                />
              </div>
              <div class="stat-tile-sub mono">resets {{ resetLabel(sub.usage.fiveHour.resetsAt) }}</div>
            </div>
            <div v-if="sub?.usage?.sevenDay" class="stat-tile" :title="subFetchedNote">
              <div class="micro-label">plan · 7d window</div>
              <div class="stat-num">{{ sub.usage.sevenDay.utilization }}%</div>
              <div class="sub-bar">
                <div
                  class="sub-bar-fill"
                  :class="subLevel(sub.usage.sevenDay.utilization)"
                  :style="{ width: Math.min(100, sub.usage.sevenDay.utilization) + '%' }"
                />
              </div>
              <div class="stat-tile-sub mono">resets {{ resetLabel(sub.usage.sevenDay.resetsAt) }}</div>
            </div>
            <div v-if="sub?.usage?.sevenDayOpus" class="stat-tile" :title="subFetchedNote">
              <div class="micro-label">plan · Opus 7d</div>
              <div class="stat-num">{{ sub.usage.sevenDayOpus.utilization }}%</div>
              <div class="sub-bar">
                <div
                  class="sub-bar-fill"
                  :class="subLevel(sub.usage.sevenDayOpus.utilization)"
                  :style="{ width: Math.min(100, sub.usage.sevenDayOpus.utilization) + '%' }"
                />
              </div>
              <div class="stat-tile-sub mono">resets {{ resetLabel(sub.usage.sevenDayOpus.resetsAt) }}</div>
            </div>
          </div>
        </template>

        <template v-if="showProviderSection('opencode') && opencodeUsage">
          <div class="micro-label stat-section">
            <span class="prov-dot" :style="{ background: providerColor('opencode') }" />
            opencode
          </div>
          <div class="stat-tiles">
            <div class="stat-tile">
              <div class="micro-label">sessions</div>
              <div class="stat-num">{{ opencodeUsage.sessions }}</div>
            </div>
            <div class="stat-tile">
              <div class="micro-label">tokens out</div>
              <div class="stat-num">{{ fmtTokens(opencodeUsage.out) }}</div>
            </div>
            <div
              class="stat-tile"
              title="List price of the tokens, as opencode recorded it"
            >
              <div class="micro-label">tracked costs</div>
              <div class="stat-num">${{ (opencodeUsage.cost ?? 0).toFixed(2) }}</div>
            </div>
            <div
              class="stat-tile"
              title="What opencode's own API keys were billed — for opencode both figures match"
            >
              <div class="micro-label">actual spend</div>
              <div class="stat-num">${{ (opencodeUsage.actual ?? 0).toFixed(2) }}</div>
            </div>
            <div v-if="topOpencodeModel" class="stat-tile">
              <div class="micro-label">top model</div>
              <div class="stat-num stat-num-sm">{{ shortModel(topOpencodeModel.key) }}</div>
              <div class="stat-tile-sub mono">{{ fmtTokens(topOpencodeModel.out) }} out total</div>
            </div>
          </div>
        </template>

        <template v-if="showProviderSection('cursor') && (cursorUsage || sub?.cursor?.available)">
          <div class="micro-label stat-section">
            <span class="prov-dot" :style="{ background: providerColor('cursor') }" />
            cursor
          </div>
          <div class="stat-tiles">
            <div v-if="cursorUsage" class="stat-tile">
              <div class="micro-label">sessions</div>
              <div class="stat-num">{{ cursorUsage.sessions }}</div>
            </div>
            <div
              v-if="cursorUsage"
              class="stat-tile"
              title="From CLI result usage when available; otherwise estimated from transcript chars/4"
            >
              <div class="micro-label">tokens in</div>
              <div class="stat-num">{{ fmtEstTok("cursor", cursorUsage.in) }}</div>
            </div>
            <div
              v-if="cursorUsage"
              class="stat-tile"
              title="From CLI result usage when available; otherwise estimated from transcript chars/4"
            >
              <div class="micro-label">tokens out</div>
              <div class="stat-num">{{ fmtEstTok("cursor", cursorUsage.out) }}</div>
            </div>
            <div
              v-if="cursorUsage?.reasoning !== undefined"
              class="stat-tile"
              title="Reasoning tokens from CLI usage, or thinking/reasoning blocks estimated as chars÷4"
            >
              <div class="micro-label">reasoning</div>
              <div class="stat-num">{{ fmtEstTok("cursor", cursorUsage.reasoning) }}</div>
            </div>
            <div
              v-if="cursorCacheRead !== undefined || cursorCacheWrite !== undefined"
              class="stat-tile"
              title="Prompt-cache tokens from agent CLI result usage (not present in public JSONL)"
            >
              <div class="micro-label">cache read</div>
              <div class="stat-num">{{ fmtEstTok("cursor", cursorCacheRead ?? 0) }}</div>
            </div>
            <div
              v-if="cursorCacheRead !== undefined || cursorCacheWrite !== undefined"
              class="stat-tile"
              title="Prompt-cache write tokens from agent CLI result usage"
            >
              <div class="micro-label">cache write</div>
              <div class="stat-num">{{ fmtEstTok("cursor", cursorCacheWrite ?? 0) }}</div>
            </div>
            <div
              v-if="cursorCacheHit !== undefined"
              class="stat-tile"
              title="Cache hit rate: reads ÷ (fresh in + reads + writes)"
            >
              <div class="micro-label">cache hit</div>
              <div class="stat-num">{{ cursorCacheHit }}</div>
            </div>
            <div
              v-if="cursorUsage || sub?.cursor?.billing"
              class="stat-tile"
              :title="cursorSpendTitle"
            >
              <div class="micro-label">actual spend</div>
              <div class="stat-num">${{ (cursorUsage?.actual ?? 0).toFixed(2) }}</div>
              <div
                v-if="(cursorUsage?.actual ?? 0) === 0 && sub?.cursor?.billing === 'subscription'"
                class="stat-tile-sub mono"
              >
                subscription
              </div>
              <div
                v-else-if="(cursorUsage?.actual ?? 0) === 0 && sub?.cursor?.billing === 'api'"
                class="stat-tile-sub mono"
              >
                api key
              </div>
            </div>
            <div
              v-if="sub?.cursor?.plan || sub?.cursor?.subscriptionTier"
              class="stat-tile"
              :title="cursorPlanTitle"
            >
              <div class="micro-label">plan</div>
              <div class="stat-num stat-num-sm">{{ sub?.cursor?.plan ?? "—" }}</div>
              <div v-if="sub?.cursor?.subscriptionTier" class="stat-tile-sub mono">
                {{ sub.cursor.subscriptionTier }}
              </div>
            </div>
            <div v-if="topCursorModel" class="stat-tile">
              <div class="micro-label">top model</div>
              <div class="stat-num stat-num-sm">{{ shortModel(topCursorModel.key) }}</div>
              <div class="stat-tile-sub mono">{{ fmtEstTok("cursor", topCursorModel.out) }} out total</div>
            </div>
          </div>
        </template>

        <template v-if="showProviderSection('antigravity') && (antigravityUsage || sub?.antigravity?.available)">
          <div class="micro-label stat-section">
            <span class="prov-dot" :style="{ background: providerColor('antigravity') }" />
            antigravity
          </div>
          <div class="stat-tiles">
            <div v-if="antigravityUsage" class="stat-tile">
              <div class="micro-label">sessions</div>
              <div class="stat-num">{{ antigravityUsage.sessions }}</div>
            </div>
            <div
              v-if="antigravityUsage"
              class="stat-tile"
              title="From agy CLI result usage when available; otherwise estimated from transcript chars/4"
            >
              <div class="micro-label">tokens in</div>
              <div class="stat-num">{{ fmtEstTok("antigravity", antigravityUsage.in) }}</div>
            </div>
            <div
              v-if="antigravityUsage"
              class="stat-tile"
              title="From agy CLI result usage when available; otherwise estimated from transcript chars/4"
            >
              <div class="micro-label">tokens out</div>
              <div class="stat-num">{{ fmtEstTok("antigravity", antigravityUsage.out) }}</div>
            </div>
            <div
              v-if="antigravityUsage?.reasoning !== undefined"
              class="stat-tile"
              title="Thinking tokens from agy CLI usage when present"
            >
              <div class="micro-label">reasoning</div>
              <div class="stat-num">{{ fmtEstTok("antigravity", antigravityUsage.reasoning) }}</div>
            </div>
            <div
              v-if="antigravityCacheRead !== undefined"
              class="stat-tile"
              title="Cache-read tokens from agy CLI result usage"
            >
              <div class="micro-label">cache read</div>
              <div class="stat-num">{{ fmtEstTok("antigravity", antigravityCacheRead) }}</div>
            </div>
            <div
              v-if="antigravityUsage || sub?.antigravity?.billing"
              class="stat-tile"
              :title="agySpendTitle"
            >
              <div class="micro-label">actual spend</div>
              <div class="stat-num">${{ (antigravityUsage?.actual ?? 0).toFixed(2) }}</div>
              <div
                v-if="(antigravityUsage?.actual ?? 0) === 0 && sub?.antigravity?.billing === 'subscription'"
                class="stat-tile-sub mono"
              >
                subscription
              </div>
              <div
                v-else-if="(antigravityUsage?.actual ?? 0) === 0 && sub?.antigravity?.billing === 'api'"
                class="stat-tile-sub mono"
              >
                api key
              </div>
            </div>
            <div
              v-if="sub?.antigravity?.plan || sub?.antigravity?.billing"
              class="stat-tile"
              :title="agyPlanTitle"
            >
              <div class="micro-label">plan</div>
              <div class="stat-num stat-num-sm">
                {{
                  sub?.antigravity?.plan ??
                  (sub?.antigravity?.billing === "api" ? "API key" : "—")
                }}
              </div>
              <div v-if="sub?.antigravity?.authType" class="stat-tile-sub mono">
                {{ sub.antigravity.authType }}
              </div>
            </div>
            <div v-if="topAntigravityModel" class="stat-tile">
              <div class="micro-label">top model</div>
              <div class="stat-num stat-num-sm">{{ shortModel(topAntigravityModel.key) }}</div>
              <div class="stat-tile-sub mono">{{ fmtEstTok("antigravity", topAntigravityModel.out) }} out total</div>
            </div>
          </div>
        </template>

        <template v-if="showProviderSection('codex') && (codexUsage || sub?.codex?.available)">
          <div class="micro-label stat-section">
            <span class="prov-dot" :style="{ background: providerColor('codex') }" />
            codex
          </div>
          <div class="stat-tiles">
            <div v-if="codexUsage" class="stat-tile">
              <div class="micro-label">sessions</div>
              <div class="stat-num">{{ codexUsage.sessions }}</div>
            </div>
            <div
              v-if="codexUsage"
              class="stat-tile"
              title="Estimated from rollout transcript chars÷4 — public Codex JSONL has no list-price usage"
            >
              <div class="micro-label">tokens in</div>
              <div class="stat-num">{{ fmtEstTok("codex", codexUsage.in) }}</div>
            </div>
            <div
              v-if="codexUsage"
              class="stat-tile"
              title="Estimated from rollout transcript chars÷4 — public Codex JSONL has no list-price usage"
            >
              <div class="micro-label">tokens out</div>
              <div class="stat-num">{{ fmtEstTok("codex", codexUsage.out) }}</div>
            </div>
            <div
              v-if="codexUsage?.reasoning !== undefined"
              class="stat-tile"
              title="Reasoning / thinking blocks estimated as chars÷4"
            >
              <div class="micro-label">reasoning</div>
              <div class="stat-num">{{ fmtEstTok("codex", codexUsage.reasoning) }}</div>
            </div>
            <div
              v-if="codexUsage || sub?.codex?.billing"
              class="stat-tile"
              :title="codexSpendTitle"
            >
              <div class="micro-label">actual spend</div>
              <div class="stat-num">${{ (codexUsage?.actual ?? 0).toFixed(2) }}</div>
              <div
                v-if="(codexUsage?.actual ?? 0) === 0 && sub?.codex?.billing === 'subscription'"
                class="stat-tile-sub mono"
              >
                subscription
              </div>
              <div
                v-else-if="(codexUsage?.actual ?? 0) === 0 && sub?.codex?.billing === 'api'"
                class="stat-tile-sub mono"
              >
                api key
              </div>
            </div>
            <div
              v-if="sub?.codex?.plan || sub?.codex?.billing"
              class="stat-tile"
              :title="codexPlanTitle"
            >
              <div class="micro-label">plan</div>
              <div class="stat-num stat-num-sm">
                {{ sub?.codex?.plan ?? (sub?.codex?.billing === "api" ? "API key" : "—") }}
              </div>
              <div v-if="sub?.codex?.subscriptionUntil" class="stat-tile-sub mono">
                until {{ new Date(sub.codex.subscriptionUntil).toLocaleDateString() }}
              </div>
              <div v-else-if="sub?.codex?.billing === 'api'" class="stat-tile-sub mono">
                pay per token
              </div>
            </div>
            <div v-if="topCodexModel" class="stat-tile">
              <div class="micro-label">top model</div>
              <div class="stat-num stat-num-sm">{{ shortModel(topCodexModel.key) }}</div>
              <div class="stat-tile-sub mono">{{ fmtEstTok("codex", topCodexModel.out) }} out total</div>
            </div>
          </div>
        </template>

        <template v-if="showProviderSection('copilot') && copilotUsage">
          <div class="micro-label stat-section">
            <span class="prov-dot" :style="{ background: providerColor('copilot') }" />
            copilot
          </div>
          <div class="stat-tiles">
            <div class="stat-tile">
              <div class="micro-label">sessions</div>
              <div class="stat-num">{{ copilotUsage.sessions }}</div>
            </div>
            <div
              class="stat-tile"
              title="From ~/.copilot/session-store.db assistant_usage_events"
            >
              <div class="micro-label">tokens in</div>
              <div class="stat-num">{{ fmtEstTok("copilot", copilotUsage.in) }}</div>
            </div>
            <div
              class="stat-tile"
              title="From ~/.copilot/session-store.db assistant_usage_events"
            >
              <div class="micro-label">tokens out</div>
              <div class="stat-num">{{ fmtEstTok("copilot", copilotUsage.out) }}</div>
            </div>
            <div
              v-if="copilotUsage.reasoning !== undefined"
              class="stat-tile"
              title="Reasoning tokens from Copilot usage events"
            >
              <div class="micro-label">reasoning</div>
              <div class="stat-num">{{ fmtEstTok("copilot", copilotUsage.reasoning) }}</div>
            </div>
            <div v-if="topCopilotModel" class="stat-tile">
              <div class="micro-label">top model</div>
              <div class="stat-num stat-num-sm">{{ shortModel(topCopilotModel.key) }}</div>
              <div class="stat-tile-sub mono">{{ fmtEstTok("copilot", topCopilotModel.out) }} out total</div>
            </div>
          </div>
        </template>

        <template v-if="showProviderSection('grok') && grokUsage">
          <div class="micro-label stat-section">
            <span class="prov-dot" :style="{ background: providerColor('grok') }" />
            grok
          </div>
          <div class="stat-tiles">
            <div class="stat-tile">
              <div class="micro-label">sessions</div>
              <div class="stat-num">{{ grokUsage.sessions }}</div>
            </div>
            <div
              class="stat-tile"
              title="From ~/.grok/sessions/*/usage.json"
            >
              <div class="micro-label">tokens in</div>
              <div class="stat-num">{{ fmtEstTok("grok", grokUsage.in) }}</div>
            </div>
            <div
              class="stat-tile"
              title="From ~/.grok/sessions/*/usage.json"
            >
              <div class="micro-label">tokens out</div>
              <div class="stat-num">{{ fmtEstTok("grok", grokUsage.out) }}</div>
            </div>
            <div
              v-if="grokUsage.reasoning !== undefined"
              class="stat-tile"
              title="Reasoning tokens from Grok usage.json"
            >
              <div class="micro-label">reasoning</div>
              <div class="stat-num">{{ fmtEstTok("grok", grokUsage.reasoning) }}</div>
            </div>
            <div v-if="topGrokModel" class="stat-tile">
              <div class="micro-label">top model</div>
              <div class="stat-num stat-num-sm">{{ shortModel(topGrokModel.key) }}</div>
              <div class="stat-tile-sub mono">{{ fmtEstTok("grok", topGrokModel.out) }} out total</div>
            </div>
          </div>
        </template>

        <StatsCharts :sessions="scopedSessions" />

        <div class="micro-label stat-section">by model</div>
        <div
          class="stat-table cols-8"
          v-col-resize="'usage-model'"
          data-cols="minmax(0,1fr) 70px 75px 75px 75px 65px 90px 90px"
        >
          <div class="stat-cols micro-label">
            <span class="th" @click="sortBy('model', 'key')">model{{ arrow('model', 'key') }}</span><span
              v-for="c in USAGE_COLS"
              :key="c.key"
              class="th"
              @click="sortBy('model', c.key)"
              >{{ c.label }}{{ arrow('model', c.key) }}</span
            >
          </div>
          <div v-for="r in sortedUsage('model', usageByModel)" :key="r.key" class="stat-row">
            <span class="stat-name" :title="r.key">
              <span
                class="prov-dot"
                :style="{ background: providerColor(r.provider ?? modelProvider(r.key)) }"
              />
              <span class="mono">{{ shortModel(r.key) }}</span>
            </span>
            <span class="stat-val">{{ r.sessions }}</span>
            <span class="stat-val">{{ fmtTokens(r.in) }}</span>
            <span class="stat-val">{{ fmtTokens(r.out) }}</span>
            <span class="stat-val">{{ r.reasoning !== undefined ? fmtTokens(r.reasoning) : "—" }}</span>
            <span class="stat-val">{{ rowCacheRate(r) }}</span>
            <span class="stat-val">{{ r.cost !== undefined ? "$" + r.cost.toFixed(4) : "—" }}</span>
            <span class="stat-val">{{ r.actual !== undefined ? "$" + r.actual.toFixed(4) : "—" }}</span>
          </div>
        </div>

        <div class="micro-label stat-section">by provider</div>
        <div
          class="stat-table cols-8"
          v-col-resize="'usage-provider'"
          data-cols="minmax(0,1fr) 70px 75px 75px 75px 65px 90px 90px"
        >
          <div class="stat-cols micro-label">
            <span class="th" @click="sortBy('provider', 'key')">provider{{ arrow('provider', 'key') }}</span><span
              v-for="c in USAGE_COLS"
              :key="c.key"
              class="th"
              @click="sortBy('provider', c.key)"
              >{{ c.label }}{{ arrow('provider', c.key) }}</span
            >
          </div>
          <div v-for="r in sortedUsage('provider', usageByProvider)" :key="r.key" class="stat-row">
            <span class="stat-name">
              <span class="prov-dot" :style="{ background: providerColor(r.key) }" />
              {{ r.key }}
            </span>
            <span class="stat-val">{{ r.sessions }}</span>
            <span class="stat-val">{{
              r.key === "cursor" || r.key === "antigravity" || r.key === "codex" || r.key === "copilot" || r.key === "grok"
                ? fmtEstTok(r.key, r.in)
                : fmtTokens(r.in)
            }}</span>
            <span class="stat-val">{{
              r.key === "cursor" || r.key === "antigravity" || r.key === "codex" || r.key === "copilot" || r.key === "grok"
                ? fmtEstTok(r.key, r.out)
                : fmtTokens(r.out)
            }}</span>
            <span class="stat-val">{{ r.reasoning !== undefined ? fmtTokens(r.reasoning) : "—" }}</span>
            <span class="stat-val">{{ rowCacheRate(r) }}</span>
            <span class="stat-val">{{ r.cost !== undefined ? "$" + r.cost.toFixed(4) : "—" }}</span>
            <span class="stat-val">{{ r.actual !== undefined ? "$" + r.actual.toFixed(4) : "—" }}</span>
          </div>
        </div>

        <div class="micro-label stat-section">by project</div>
        <div
          class="stat-table cols-8"
          v-col-resize="'usage-project'"
          data-cols="minmax(0,1fr) 70px 75px 75px 75px 65px 90px 90px"
        >
          <div class="stat-cols micro-label">
            <span class="th" @click="sortBy('project', 'key')">project{{ arrow('project', 'key') }}</span><span
              v-for="c in USAGE_COLS"
              :key="c.key"
              class="th"
              @click="sortBy('project', c.key)"
              >{{ c.label }}{{ arrow('project', c.key) }}</span
            >
          </div>
          <div v-for="r in sortedUsage('project', usageByProject)" :key="r.key" class="stat-row">
            <span class="stat-name" :title="r.key">{{ shortDir(r.key) }}</span>
            <span class="stat-val">{{ r.sessions }}</span>
            <span class="stat-val">{{ fmtTokens(r.in) }}</span>
            <span class="stat-val">{{ fmtTokens(r.out) }}</span>
            <span class="stat-val">{{ r.reasoning !== undefined ? fmtTokens(r.reasoning) : "—" }}</span>
            <span class="stat-val">{{ rowCacheRate(r) }}</span>
            <span class="stat-val">{{ r.cost !== undefined ? "$" + r.cost.toFixed(4) : "—" }}</span>
            <span class="stat-val">{{ r.actual !== undefined ? "$" + r.actual.toFixed(4) : "—" }}</span>
          </div>
        </div>

        <div class="micro-label stat-section">top sessions by output tokens</div>
        <div
          class="stat-table cols-8"
          v-col-resize="'usage-sessions'"
          data-cols="minmax(0,1fr) 70px 75px 75px 75px 65px 90px 90px"
        >
          <div class="stat-cols micro-label">
            <span class="th" @click="sortBy('top', 'title')">session{{ arrow('top', 'title') }}</span><span
              class="th"
              @click="sortBy('top', 'agent')"
              >agent{{ arrow('top', 'agent') }}</span
            ><span class="th" @click="sortBy('top', 'in')">in{{ arrow('top', 'in') }}</span><span
              class="th"
              @click="sortBy('top', 'out')"
              >out{{ arrow('top', 'out') }}</span
            ><span class="th" @click="sortBy('top', 'reasoning')">reason{{ arrow('top', 'reasoning') }}</span><span
              class="th"
              @click="sortBy('top', 'cache')"
              >cache{{ arrow('top', 'cache') }}</span
            ><span class="th" @click="sortBy('top', 'cost')">tracked{{ arrow('top', 'cost') }}</span><span
              class="th"
              @click="sortBy('top', 'actual')"
              >actual{{ arrow('top', 'actual') }}</span
            >
          </div>
          <div v-for="s in topSessions" :key="s.provider + s.id" class="stat-row">
            <span class="stat-name" :title="s.title">
              <span class="prov-dot" :style="{ background: providerColor(s.provider) }" />
              {{ s.title ?? shortId(s.id) }}
            </span>
            <span class="stat-val">{{ s.agent ?? "—" }}</span>
            <span class="stat-val">{{ fmtTokens(s.tokensIn, { estimate: isTokenEstimate(s.meta) }) }}</span>
            <span class="stat-val">{{ fmtTokens(s.tokensOut, { estimate: isTokenEstimate(s.meta) }) }}</span>
            <span class="stat-val">{{ s.tokensReasoning !== undefined ? fmtTokens(s.tokensReasoning) : "—" }}</span>
            <span class="stat-val">{{ sessionCacheRate(s) }}</span>
            <span class="stat-val">{{ s.cost !== undefined ? "$" + s.cost.toFixed(4) : "—" }}</span>
            <span class="stat-val">{{ s.actualCost !== undefined ? "$" + s.actualCost.toFixed(4) : "—" }}</span>
          </div>
        </div>

        <div class="micro-label stat-section">model pricing · list prices per 1M tokens</div>
        <div class="price-controls">
          <button
            class="filter-chip"
            :class="{ active: priceUsedOnly }"
            @click="priceUsedOnly = !priceUsedOnly"
          >
            used models only
          </button>
          <span class="micro-label">source: {{ priceSource }}</span>
        </div>
        <div v-for="pg in priceGroups" :key="pg.provider" class="price-group">
          <div class="micro-label sess-group-name">
            <span
              class="prov-dot"
              :style="{ background: priceGroupColor(pg.provider) }"
            />
            {{ pg.provider === "anthropic" ? "claude models (anthropic)" : `${pg.provider} gateway` }}
            · {{ pg.rows.length }}
          </div>
          <div
            class="stat-table cols-price"
            v-col-resize="`price-${pg.provider}`"
            data-cols="minmax(0,1fr) 80px 80px 70px 70px 80px 70px 60px 90px"
          >
            <div class="stat-cols micro-label">
              <span class="th" @click="sortBy('price-' + pg.provider, 'id')">model{{ arrow('price-' + pg.provider, 'id') }}</span
              ><span class="th" @click="sortBy('price-' + pg.provider, 'input')">in $/1M{{ arrow('price-' + pg.provider, 'input') }}</span
              ><span class="th" @click="sortBy('price-' + pg.provider, 'output')">out $/1M{{ arrow('price-' + pg.provider, 'output') }}</span
              ><span>cache rd</span><span>cache wr</span
              ><span class="th" @click="sortBy('price-' + pg.provider, 'context')">context{{ arrow('price-' + pg.provider, 'context') }}</span
              ><span>max out</span><span>reasoning</span
              ><span class="th" @click="sortBy('price-' + pg.provider, 'released')">released{{ arrow('price-' + pg.provider, 'released') }}</span>
            </div>
            <div v-for="r in pg.rows" :key="r.id" class="stat-row">
              <span class="stat-name mono" :title="r.name">
                {{ r.id }}
                <em v-if="isUsedModel(r)" class="price-used mono">used</em>
              </span>
              <span class="stat-val">{{ fmtPrice(r.input) }}</span>
              <span class="stat-val">{{ fmtPrice(r.output) }}</span>
              <span class="stat-val">{{ fmtPrice(r.cacheRead) }}</span>
              <span class="stat-val">{{ fmtPrice(r.cacheWrite) }}</span>
              <span class="stat-val">{{ r.context ? fmtTokens(r.context) : "—" }}</span>
              <span class="stat-val">{{ r.maxOutput ? fmtTokens(r.maxOutput) : "—" }}</span>
              <span class="stat-val">{{ r.reasoning ? "✓" : "—" }}</span>
              <span class="stat-val">{{ r.releaseDate ?? "—" }}</span>
            </div>
          </div>
        </div>
        <p v-if="!priceRows.length" class="stat-note">{{ priceSource }}</p>

        <p class="stat-note">
          <b>tracked</b> is the list-price value of the tokens (models.dev prices):
          claude-code sessions are computed from their transcripts per model — including
          the 1h-cache-write premium — and opencode reports the cost it recorded itself.
          Cursor, Antigravity, and Codex have no list-price in public storage (tokens come from CLI usage
          when captured, otherwise a chars÷4 estimate — shown with `~`).
          <b>actual</b> is what you really paid: $0 for subscription-billed claude-code,
          cursor, antigravity, and Codex ChatGPT-plan sessions, list price on an API key (Settings → claude code billing).
        </p>
        <p class="stat-note">All figures are from local sessions on this machine.</p>

</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import type { SessionRef } from "@threadle/shared";
import { isSessionLive } from "@threadle/shared";
import { shortId, fmtTokens, isTokenEstimate } from "@/lib/format";
import { providerColor, type SessionFilter } from "@/lib/providers";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { vColResize } from "@/lib/colResize";
import StatsCharts from "@/panels/StatsCharts.vue";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import "./chrome.css";

const sessions = useSessionsStore();
const settings = useSettingsStore();
void settings.load();

const usageProviderF = ref<SessionFilter>("all");
const usageFilterChips = computed(() => sessions.sessionFilterChips);
watch(usageFilterChips, (chips) => {
  if (!chips.includes(usageProviderF.value)) usageProviderF.value = "all";
});

function showProviderSection(id: string): boolean {
  return usageProviderF.value === "all" || usageProviderF.value === id;
}

const scopedSessions = computed(() =>
  usageProviderF.value === "all"
    ? sessions.sessions
    : sessions.sessions.filter((s) => s.provider === usageProviderF.value),
);

const scopedAgentCount = computed(() =>
  usageProviderF.value === "all"
    ? sessions.agents.length
    : sessions.agents.filter((a) => a.provider === usageProviderF.value).length,
);

function isSubRun(s: SessionRef): boolean {
  return s.kind === "subagent-run" || !!s.parentId;
}

const instancesAll = ref<SessionRef[] | null>(null);

async function loadInstances(): Promise<void> {
  try {
    instancesAll.value = (await (
      await fetch("/api/sessions/instances")
    ).json()) as SessionRef[];
  } catch {
    // server unreachable
  }
}

const instanceSource = computed<SessionRef[]>(() => {
  const all = instancesAll.value ?? sessions.sessions.filter((s) => s.agent);
  if (usageProviderF.value === "all") return all;
  return all.filter((s) => s.provider === usageProviderF.value);
});

const agentInstances = computed(() => ({
  total: instanceSource.value.length,
  live: instanceSource.value.filter((s) => isSessionLive(s.status)).length,
  subs: instanceSource.value.filter((s) => isSubRun(s)).length,
}));

interface UsageRow {
  key: string;
  sessions: number;
  in: number;
  out: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** tracked costs: list price of the tokens */
  cost?: number;
  /** actual spend: what was really paid (subscription sessions contribute $0) */
  actual?: number;
  /** dominant session provider for this row (by tokens out) — used for model-dot color */
  provider?: string;
}

function aggregate(keyOf: (s: SessionRef) => string): UsageRow[] {
  const rows = new Map<string, UsageRow>();
  const outByProv = new Map<string, Map<string, number>>();
  for (const s of scopedSessions.value) {
    const key = keyOf(s);
    if (!rows.has(key)) rows.set(key, { key, sessions: 0, in: 0, out: 0 });
    const r = rows.get(key)!;
    r.sessions += 1;
    r.in += s.tokensIn ?? 0;
    r.out += s.tokensOut ?? 0;
    if (s.tokensReasoning !== undefined) {
      r.reasoning = (r.reasoning ?? 0) + s.tokensReasoning;
    }
    if (s.tokensCacheRead !== undefined || s.tokensCacheWrite !== undefined) {
      r.cacheRead = (r.cacheRead ?? 0) + (s.tokensCacheRead ?? 0);
      r.cacheWrite = (r.cacheWrite ?? 0) + (s.tokensCacheWrite ?? 0);
    }
    if (s.cost !== undefined) r.cost = (r.cost ?? 0) + s.cost;
    if (s.actualCost !== undefined) r.actual = (r.actual ?? 0) + s.actualCost;
    if (!outByProv.has(key)) outByProv.set(key, new Map());
    const pb = outByProv.get(key)!;
    pb.set(s.provider, (pb.get(s.provider) ?? 0) + (s.tokensOut ?? 0));
  }
  for (const [key, r] of rows) {
    const pb = outByProv.get(key);
    if (!pb?.size) continue;
    let best = "";
    let bestOut = -1;
    for (const [p, n] of pb) {
      if (n > bestOut) {
        best = p;
        bestOut = n;
      }
    }
    r.provider = best;
  }
  return [...rows.values()].sort((a, b) => b.out - a.out);
}

const usageByProvider = computed(() => aggregate((s) => s.provider));
const usageByProject = computed(() => aggregate((s) => s.projectDir || "(unknown)"));
const usageByModel = computed(() => aggregate((s) => s.model ?? "(unknown)"));

const topModel = computed(() => usageByModel.value[0]);

// per-provider card rows (usageByModel keys: opencode models carry a "provider/" prefix)
const claudeUsage = computed(() => usageByProvider.value.find((r) => r.key === "claude-code"));
const opencodeUsage = computed(() => usageByProvider.value.find((r) => r.key === "opencode"));
const cursorUsage = computed(() => usageByProvider.value.find((r) => r.key === "cursor"));
const antigravityUsage = computed(() => usageByProvider.value.find((r) => r.key === "antigravity"));
const codexUsage = computed(() => usageByProvider.value.find((r) => r.key === "codex"));
const copilotUsage = computed(() => usageByProvider.value.find((r) => r.key === "copilot"));
const grokUsage = computed(() => usageByProvider.value.find((r) => r.key === "grok"));

function providerTokensEstimated(provider: string): boolean {
  return scopedSessions.value.some((s) => s.provider === provider && isTokenEstimate(s.meta));
}

const cursorCacheRead = computed(() => cursorUsage.value?.cacheRead);
const cursorCacheWrite = computed(() => cursorUsage.value?.cacheWrite);
const cursorCacheHit = computed(() => {
  const r = cursorUsage.value;
  if (!r) return undefined;
  if (r.cacheRead === undefined && r.cacheWrite === undefined) return undefined;
  return hitRate(r.cacheRead, r.cacheWrite, r.in);
});

const antigravityCacheRead = computed(() => antigravityUsage.value?.cacheRead);

function fmtEstTok(provider: string, n: number): string {
  return fmtTokens(n, { estimate: providerTokensEstimated(provider) });
}

/** Top model for a single provider (avoids bare Cursor ids winning the Claude card). */
function topModelOf(provider: string): UsageRow | undefined {
  const rows = new Map<string, UsageRow>();
  for (const s of scopedSessions.value) {
    if (s.provider !== provider) continue;
    const key = s.model ?? "(unknown)";
    if (!rows.has(key)) rows.set(key, { key, sessions: 0, in: 0, out: 0 });
    const r = rows.get(key)!;
    r.sessions += 1;
    r.in += s.tokensIn ?? 0;
    r.out += s.tokensOut ?? 0;
  }
  return [...rows.values()]
    .filter((r) => r.key !== "(unknown)")
    .sort((a, b) => b.out - a.out)[0];
}

const topClaudeModel = computed(() => topModelOf("claude-code"));
const topOpencodeModel = computed(() => topModelOf("opencode"));
const topCursorModel = computed(() => topModelOf("cursor"));
const topAntigravityModel = computed(() => topModelOf("antigravity"));
const topCodexModel = computed(() => topModelOf("codex"));
const topCopilotModel = computed(() => topModelOf("copilot"));
const topGrokModel = computed(() => topModelOf("grok"));

function priceGroupColor(p: string): string {
  if (p === "anthropic") return "var(--claude)";
  if (p === "antigravity" || p === "google" || p === "agy") return "var(--antigravity)";
  if (p === "cursor") return "var(--cursor)";
  if (p === "opencode") return "var(--opencode)";
  if (p === "codex" || p === "openai") return "var(--codex)";
  if (p === "copilot" || p === "github") return "var(--copilot)";
  if (p === "grok" || p === "xai") return "var(--grok)";
  return providerColor(p);
}

/** most output tokens per session — the model that gets the most done per run */
const mostEffectiveModel = computed(() => {
  const rows = usageByModel.value.filter((r) => r.out > 0 && r.key !== "(unknown)");
  if (!rows.length) return undefined;
  return [...rows].sort((a, b) => b.out / b.sessions - a.out / a.sessions)[0];
});

/** highest total tracked costs (only providers that report cost) */
const mostExpensiveModel = computed(() => {
  const rows = usageByModel.value.filter((r) => (r.cost ?? 0) > 0);
  if (!rows.length) return undefined;
  return [...rows].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0];
});

/** lowest $ per 1k output tokens (only models with tracked costs AND output) */
const cheapestModel = computed(() => {
  const rows = usageByModel.value.filter((r) => (r.cost ?? 0) > 0 && r.out > 500);
  if (rows.length < 2) return undefined; // "cheapest of one" is meaningless
  return [...rows].sort(
    (a, b) => (a.cost ?? 0) / a.out - (b.cost ?? 0) / b.out,
  )[0];
});

function perK(row: UsageRow): string {
  return `$${(((row.cost ?? 0) / row.out) * 1000).toFixed(4)}`;
}

/** cache-hit-rate: cached reads / total input (fresh + cache read + cache write) */
function hitRate(read?: number, write?: number, fresh?: number): string {
  if (read === undefined && write === undefined) return "—";
  const total = (fresh ?? 0) + (read ?? 0) + (write ?? 0);
  if (!total) return "—";
  return `${((100 * (read ?? 0)) / total).toFixed(1)}%`;
}

function rowCacheRate(r: UsageRow): string {
  return hitRate(r.cacheRead, r.cacheWrite, r.in);
}

function sessionCacheRate(s: SessionRef): string {
  return hitRate(s.tokensCacheRead, s.tokensCacheWrite, s.tokensIn);
}

// ---- generic column sorting ----

const sorts = reactive<Record<string, { key: string; dir: 1 | -1 }>>({});

function sortBy(table: string, key: string): void {
  const cur = sorts[table];
  if (cur && cur.key === key) cur.dir = (cur.dir * -1) as 1 | -1;
  else sorts[table] = { key, dir: -1 };
}

function arrow(table: string, key: string): string {
  const cur = sorts[table];
  if (!cur || cur.key !== key) return "";
  return cur.dir === -1 ? " ▾" : " ▴";
}

function applySort<T>(
  table: string,
  rows: T[],
  sel: Record<string, (r: T) => number | string>,
  defKey: string,
): T[] {
  const cur = sorts[table] ?? { key: defKey, dir: -1 as const };
  const f = sel[cur.key];
  if (!f) return rows;
  return [...rows].sort((a, b) => {
    const va = f(a);
    const vb = f(b);
    const c =
      typeof va === "string" || typeof vb === "string"
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number);
    return c * cur.dir;
  });
}

const USAGE_COLS = [
  { key: "sessions", label: "sessions" },
  { key: "in", label: "in" },
  { key: "out", label: "out" },
  { key: "reasoning", label: "reason" },
  { key: "cache", label: "cache" },
  { key: "cost", label: "tracked" },
  { key: "actual", label: "actual" },
];

function cacheRatio(read?: number, write?: number, fresh?: number): number {
  const total = (fresh ?? 0) + (read ?? 0) + (write ?? 0);
  return total ? (read ?? 0) / total : -1;
}

const USAGE_SEL: Record<string, (r: UsageRow) => number | string> = {
  key: (r) => r.key,
  sessions: (r) => r.sessions,
  in: (r) => r.in,
  out: (r) => r.out,
  reasoning: (r) => r.reasoning ?? -1,
  cache: (r) => cacheRatio(r.cacheRead, r.cacheWrite, r.in),
  cost: (r) => r.cost ?? -1,
  actual: (r) => r.actual ?? -1,
};

function sortedUsage(table: string, rows: UsageRow[]): UsageRow[] {
  const q = usageFilter.value.trim().toLowerCase();
  const filtered = !q
    ? rows
    : rows.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          shortModel(r.key).toLowerCase().includes(q) ||
          (r.provider?.toLowerCase().includes(q) ?? false),
      );
  return applySort(table, filtered, USAGE_SEL, "out");
}

const TOP_SEL: Record<string, (s: SessionRef) => number | string> = {
  title: (s) => s.title ?? "",
  agent: (s) => s.agent ?? "",
  in: (s) => s.tokensIn ?? 0,
  out: (s) => s.tokensOut ?? 0,
  reasoning: (s) => s.tokensReasoning ?? -1,
  cache: (s) => cacheRatio(s.tokensCacheRead, s.tokensCacheWrite, s.tokensIn),
  cost: (s) => s.cost ?? -1,
  actual: (s) => s.actualCost ?? -1,
};

function shortModel(id: string): string {
  return id.split("/").pop() ?? id;
}

/** Fallback when a usage row has no session-derived provider (heuristic only). */
function modelProvider(id: string): string {
  if (id.includes("/")) {
    const prefix = id.split("/")[0]!;
    if (prefix === "anthropic") return "claude-code";
    if (prefix === "opencode") return "opencode";
    if (prefix === "cursor") return "cursor";
    if (prefix === "antigravity" || prefix === "agy") return "antigravity";
    if (prefix === "codex" || prefix === "openai") return "codex";
    if (prefix === "copilot" || prefix === "github") return "copilot";
    if (prefix === "grok" || prefix === "xai") return "grok";
    return prefix;
  }
  // bare ids: Claude Code uses claude-*; Cursor-native looks like composer / auto / gpt-…
  if (/^claude/i.test(id)) return "claude-code";
  if (/^grok/i.test(id)) return "grok";
  if (/^gemini-3\.|gpt-oss/i.test(id)) return "antigravity";
  if (/^(gpt-5|o3|o4)/i.test(id)) return "codex";
  if (/^(composer|auto$|cursor|gpt-|o[1-9])/i.test(id)) return "cursor";
  return "claude-code";
}

const usageTotals = computed(() => ({
  in: usageByProvider.value.reduce((a, r) => a + r.in, 0),
  out: usageByProvider.value.reduce((a, r) => a + r.out, 0),
  cost: usageByProvider.value.reduce((a, r) => a + (r.cost ?? 0), 0),
  actual: scopedSessions.value.reduce((a, s) => a + (s.actualCost ?? 0), 0),
}));

const topSessions = computed(() => {
  const q = usageFilter.value.trim().toLowerCase();
  const list = !q
    ? scopedSessions.value
    : scopedSessions.value.filter(
        (s) =>
          (s.title?.toLowerCase().includes(q) ?? false) ||
          s.id.toLowerCase().includes(q) ||
          (s.agent?.toLowerCase().includes(q) ?? false) ||
          (s.model?.toLowerCase().includes(q) ?? false) ||
          s.provider.toLowerCase().includes(q) ||
          (s.projectDir?.toLowerCase().includes(q) ?? false),
      );
  return applySort("top", list, TOP_SEL, "out").slice(0, 15);
});

function shortDir(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : dir;
}

// ---- claude subscription (usage view) — mirrored from ~/.claude.json ----

interface SubWindow {
  utilization: number;
  resetsAt?: string;
}
interface SubInfo {
  available: boolean;
  plan?: string;
  tier?: string;
  billingType?: string;
  subscriptionSince?: string;
  usage?: { fetchedAtMs?: number; fiveHour?: SubWindow; sevenDay?: SubWindow; sevenDayOpus?: SubWindow };
  codex?: {
    available: boolean;
    authMode?: "chatgpt" | "api" | "unknown";
    billing?: "subscription" | "api";
    plan?: string;
    planType?: string;
    subscriptionUntil?: string;
  };
  antigravity?: {
    available: boolean;
    authType?: string;
    billing?: "subscription" | "api";
    plan?: string;
    audience?: "consumer" | "enterprise" | "unknown";
    loggedIn?: boolean;
  };
  cursor?: {
    available: boolean;
    billing?: "subscription" | "api" | "unknown";
    plan?: string;
    subscriptionTier?: string;
    loggedIn?: boolean;
  };
}
const sub = ref<SubInfo>();
let subLoaded = false;

async function loadSubscription(): Promise<void> {
  if (subLoaded) return;
  subLoaded = true;
  try {
    sub.value = (await (await fetch("/api/subscription")).json()) as SubInfo;
  } catch {
    sub.value = undefined;
  }
}

const subFetchedNote = computed(() => {
  const at = sub.value?.usage?.fetchedAtMs;
  const age = at ? Math.round((Date.now() - at) / 60_000) : undefined;
  return `Plan-limit utilization as Claude Code last cached it${
    age !== undefined ? ` (${age < 60 ? `${age}m` : `${Math.round(age / 60)}h`} ago)` : ""
  } — threadle reads it locally, never phones home`;
});

const codexSpendTitle = computed(() => {
  const c = sub.value?.codex;
  if (c?.billing === "subscription") {
    return `ChatGPT ${c.planType ?? "plan"} login — actual spend is $0 (subscription)`;
  }
  if (c?.billing === "api") {
    return "API-key Codex — public rollouts still have no list-price cost, so tracked/actual stay $0 here";
  }
  return "Codex billing unknown — ChatGPT plan vs API key not found in ~/.codex/auth.json";
});

const codexPlanTitle = computed(() => {
  const c = sub.value?.codex;
  if (!c?.available) return "No Codex auth on disk";
  return `From ~/.codex/auth.json (auth_mode=${c.authMode ?? "?"} · billing=${c.billing ?? "?"}) — local JWT claims only, never phones home`;
});

const agySpendTitle = computed(() => {
  const a = sub.value?.antigravity;
  if (a?.billing === "subscription") {
    return "Google account login (oauth-personal / consumer) — actual spend is $0; Gemini Advanced / Google One tier is not stored locally";
  }
  if (a?.billing === "api") {
    return "API / Vertex key auth — no list-price dollars in public storage";
  }
  return "Antigravity billing unknown — check ~/.gemini/settings.json";
});

const agyPlanTitle = computed(() => {
  const a = sub.value?.antigravity;
  if (!a?.available) return "No Antigravity / Gemini auth on disk";
  return `From ~/.gemini/settings.json + onboarding cache (auth=${a.authType ?? "?"} · audience=${a.audience ?? "?"}) — no paid-tier claim on disk`;
});

const cursorSpendTitle = computed(() => {
  const c = sub.value?.cursor;
  if (c?.billing === "subscription") {
    return `${c.plan ?? "Cursor plan"} — actual spend is $0 (subscription)`;
  }
  if (c?.billing === "api") {
    return "API-key Cursor — no list-price dollars in public storage";
  }
  return "Cursor tier unknown — run `agent about` or sign in";
});

const cursorPlanTitle = computed(() => {
  const c = sub.value?.cursor;
  if (!c?.available) return "No Cursor auth";
  return `From \`agent about --format json\` (subscriptionTier=${c.subscriptionTier ?? "?"}) — email never returned`;
});

function subLevel(pct: number): string {
  return pct >= 90 ? "sub-hot" : pct >= 70 ? "sub-warm" : "sub-ok";
}

function resetLabel(iso?: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((t - Date.now()) / 60_000));
  if (mins < 60) return `in ${mins}m`;
  if (mins < 48 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// ---- model pricing (usage view) ----

interface PriceRow {
  provider: string;
  id: string;
  name: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  context?: number;
  maxOutput?: number;
  reasoning?: boolean;
  knowledge?: string;
  releaseDate?: string;
}
const priceRows = ref<PriceRow[]>([]);
const priceSource = ref("loading…");
const usageFilter = ref("");
const priceUsedOnly = ref(false);
let pricesLoaded = false;

async function loadPrices(): Promise<void> {
  if (pricesLoaded) return;
  pricesLoaded = true;
  try {
    const body = (await (await fetch("/api/pricing")).json()) as {
      rows: PriceRow[];
      source: string;
    };
    priceRows.value = body.rows;
    priceSource.value = body.source;
  } catch {
    priceSource.value = "pricing unavailable";
  }
}

/** models this machine actually ran, matched loosely (with/without provider prefix) */
const usedModelNames = computed(() => {
  const out = new Set<string>();
  for (const s of scopedSessions.value) {
    if (!s.model) continue;
    out.add(s.model.toLowerCase());
    const slash = s.model.indexOf("/");
    if (slash > 0) out.add(s.model.slice(slash + 1).toLowerCase());
  }
  return out;
});

function isUsedModel(r: PriceRow): boolean {
  const u = usedModelNames.value;
  return u.has(r.id.toLowerCase()) || u.has(`${r.provider}/${r.id}`.toLowerCase());
}

/** Price-table provider ids that belong to a session provider filter chip. */
const PRICE_PROVS_FOR_FILTER: Record<string, readonly string[]> = {
  "claude-code": ["anthropic"],
  opencode: ["opencode"],
  cursor: ["cursor"],
  antigravity: ["antigravity"],
  codex: ["openai", "codex"],
  copilot: ["github", "copilot"],
  grok: ["grok", "xai"],
};

const filteredPrices = computed(() => {
  const q = usageFilter.value.trim().toLowerCase();
  const provAllow =
    usageProviderF.value === "all"
      ? null
      : new Set(PRICE_PROVS_FOR_FILTER[usageProviderF.value] ?? [usageProviderF.value]);
  return priceRows.value.filter(
    (r) =>
      (!provAllow || provAllow.has(r.provider)) &&
      (!priceUsedOnly.value || isUsedModel(r)) &&
      (!q || r.id.toLowerCase().includes(q) || r.provider.includes(q) || r.name.toLowerCase().includes(q)),
  );
});

const PRICE_SEL: Record<string, (r: PriceRow) => number | string> = {
  id: (r) => r.id,
  input: (r) => r.input ?? -1,
  output: (r) => r.output ?? -1,
  context: (r) => r.context ?? 0,
  released: (r) => r.releaseDate ?? "",
};

/** per-provider tables: anthropic (claude) first, then gateways; used models pinned on default sort */
const priceGroups = computed(() => {
  const byProv = new Map<string, PriceRow[]>();
  for (const r of filteredPrices.value) {
    byProv.set(r.provider, [...(byProv.get(r.provider) ?? []), r]);
  }
  const order = (p: string) =>
    p === "anthropic"
      ? 0
      : p === "opencode"
        ? 1
        : p === "cursor"
          ? 2
          : p === "antigravity"
            ? 3
            : p === "openai" || p === "codex"
              ? 4
              : p === "github" || p === "copilot"
                ? 5
                : p === "grok" || p === "xai"
                  ? 6
                  : 7;
  return [...byProv.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([provider, rows]) => ({
      provider,
      rows: applySort(
        "price-" + provider,
        [...rows].sort(
          (a, b) =>
            Number(isUsedModel(b)) - Number(isUsedModel(a)) ||
            (b.output ?? 0) - (a.output ?? 0),
        ),
        PRICE_SEL,
        "",
      ),
    }));
});

function fmtPrice(n?: number): string {
  if (n === undefined) return "—";
  if (n === 0) return "$0";
  return `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
}

onMounted(() => {
  void loadPrices();
  void loadSubscription();
  void loadInstances();
});

</script>

<style scoped>
.usage-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.usage-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.sub-bar {
  height: 4px;
  margin-top: 6px;
  background: var(--input-bg);
  border-radius: 2px;
  overflow: hidden;
}
.sub-bar-fill {
  height: 100%;
  border-radius: 2px;
}
.sub-bar-fill.sub-ok {
  background: var(--status-running);
}
.sub-bar-fill.sub-warm {
  background: var(--status-waiting);
}
.sub-bar-fill.sub-hot {
  background: var(--status-error);
}
.price-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0 10px;
}
.cols-price {
  --cols: minmax(0, 1fr) 72px 76px 72px 72px 72px 68px 76px 88px;
}
.cols-price .stat-cols,
.cols-price .stat-row {
  grid-template-columns: var(--cols);
}
.price-group {
  margin-bottom: 20px;
}
.price-group .sess-group-name {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-bottom: 6px;
}
.price-used {
  font-style: normal;
  font-size: var(--fs-2xs);
  color: var(--status-running);
  border: 1px solid rgba(74, 222, 128, 0.35);
  border-radius: 3px;
  padding: 0 5px;
  margin-left: 7px;
}

</style>
