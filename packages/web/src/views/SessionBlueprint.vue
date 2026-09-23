<template>
  <div class="bp-page">
    <DashNav :items="navItems" active="sessions" @select="goDash" />

    <div class="bp-layout">
      <div class="bp-chrome">
        <header class="bp-head">
          <div class="bp-head-copy">
            <div class="bp-title-row">
              <button
                class="bp-back"
                :title="parentRef ? 'Back to parent blueprint' : 'Back to sessions'"
                @click="goBack"
              >
                ←
              </button>
              <button
                v-if="parentRef"
                class="bp-crumb mono"
                :title="'Parent blueprint: ' + (parentTitle ?? '')"
                @click="goBack"
              >
                ❯ {{ parentTitle ?? "parent" }}
              </button>
              <span v-if="parentRef" class="bp-crumb-sep">/</span>
              <span v-if="parentRef" class="bp-subbadge mono">⎇ sub</span>
              <h1 class="bp-title">{{ data?.ref?.title ?? shortId(sessionId) }}</h1>
            </div>
          </div>
          <div class="bp-controls">
            <input
              v-model="bpFilter"
              class="threadle-input bp-search"
              placeholder="Filter nodes…"
              spellcheck="false"
            />
            <button
              class="vsc-btn"
              title="Open project in your editor"
              @click="data?.ref && settings.openPath(data.ref.projectDir)"
            >
              {{ settings.editorLabel }}
            </button>
            <button
              class="vsc-btn"
              title="View the interactive message transcript in a floating window"
              @click="fileViewers.openTranscript(provider, sessionId)"
            >
              ≡ transcript
            </button>
            <button
              class="vsc-btn"
              title="List outbound http(s) URLs called by tools in this session"
              :disabled="!data"
              @click="urlsOpen = true"
            >
              ↗ urls
            </button>
            <button
              class="vsc-btn"
              title="Create an editable workflow seeded with this session and its subagents"
              :disabled="converting"
              @click="convertToWorkflow"
            >
              {{ converting ? "…" : "→ workflow" }}
            </button>
            <button
              class="vsc-btn"
              title="Download blueprint + context + reasoning + meta for this session and all subagents as one JSON bundle"
              @click="downloadBundle"
            >
              ⇓ bundle
            </button>
          </div>
        </header>

        <div class="bp-toolbar type-filterbar">
          <span
            class="micro-label type-filter-label"
            title="Right-click for filter options"
            @contextmenu.prevent="openFilterMenu($event)"
          >show</span>
          <button
            v-for="t in TYPE_TOGGLES"
            :key="t.key"
            class="type-chip"
            :class="{ active: typeFilters[t.key] }"
            :title="`${t.label} — click to toggle, right-click for options`"
            @click="typeFilters[t.key] = !typeFilters[t.key]"
            @contextmenu.prevent="openFilterMenu($event, t.key)"
          >
            {{ t.glyph }} {{ t.label }}
            <em v-if="typeCount(t.key)">{{
              t.key === "files" && hiddenFileCount > 0
                ? `${sortedFiles.length}/${typeCount(t.key)}`
                : typeCount(t.key)
            }}</em>
          </button>
          <FilterChipMenu
            :open="!!filterMenu"
            :x="filterMenu?.x ?? 0"
            :y="filterMenu?.y ?? 0"
            :title="filterMenuTitle"
            :has-key="!!filterMenu?.key"
            :has-nonempty="filterHasNonempty"
            @only="applyFilterOnly"
            @except="applyFilterExcept"
            @add="applyFilterAdd"
            @hide="applyFilterHide"
            @show-all="applyFilterShowAll"
            @hide-all="applyFilterHideAll"
            @invert="applyFilterInvert"
            @nonempty="applyFilterNonempty"
          />
        </div>
      </div>

      <div class="bp-body">
        <div class="bp-canvas">
          <VueFlow
            :nodes="nodes"
            :edges="edges"
            :nodes-connectable="false"
            :edges-updatable="false"
            fit-view-on-init
            :min-zoom="0.2"
            @node-click="onNodeClick"
            @node-context-menu="onNodeCtxMenu"
            @pane-click="dismissCtxMenu"
            @pane-context-menu.prevent="dismissCtxMenu"
            @move-start="dismissCtxMenu"
          >
            <Background id="grid-minor" variant="lines" :gap="10" :line-width="1" color="var(--grid-line)" />
            <Background id="grid-major" variant="lines" :gap="100" :line-width="1" color="var(--grid-line-major)" />
            <Controls position="bottom-left" />

            <template #node-bp="props">
              <div
                class="bp-node"
                :class="[
                  props.data.kind,
                  {
                    picked: selectedId === props.id,
                    missing: !!props.data.missing,
                  },
                ]"
              >
                <Handle
                  v-if="props.data.kind !== 'root'"
                  type="target"
                  :position="Position.Left"
                  class="bp-handle"
                />
                <div class="bp-node-head">
                  <span class="bp-glyph">{{ props.data.glyph }}</span>
                  <span class="bp-name" :title="props.data.title">{{
                    props.data.title
                  }}</span>
                  <span v-if="props.data.badge" class="bp-badge mono">{{
                    props.data.badge
                  }}</span>
                </div>
                <div v-if="props.data.sub" class="bp-node-sub">{{ props.data.sub }}</div>
                <div v-if="props.data.sub2" class="bp-node-sub2 mono">{{
                  props.data.sub2
                }}</div>
                <div v-if="props.data.missing" class="bp-missing-tag micro-label">
                  missing
                </div>
                <Handle
                  v-if="props.data.kind === 'root'"
                  type="source"
                  :position="Position.Right"
                  class="bp-handle"
                />
              </div>
            </template>
          </VueFlow>
          <GraphLoadingOverlay
            :loading="loading"
            :error="error"
            label="Loading blueprint"
          />
          <div
            v-if="ctxMenu"
            class="bp-ctx"
            :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
            @click.stop
            @contextmenu.prevent
          >
            <div class="bp-ctx-title mono">{{ ctxMenu.label }}</div>
            <template v-if="ctxMenu.contextOf">
              <button
                v-if="ctxMenu.hasTranscript"
                class="bp-ctx-item"
                title="View the interactive message transcript in a floating window"
                @click="ctxOpenTranscript"
              >
                view transcript
              </button>
              <button
                class="bp-ctx-item"
                title="View the reconstructed model context in a floating window (large contexts are preview-capped)"
                @click="ctxOpenContext"
              >
                open context
              </button>
              <button
                class="bp-ctx-item"
                :title="`Write context to a temp .md and open in ${settings.editorLabel}`"
                @click="ctxOpenContextInCode"
              >
                open context in {{ settings.editorLabel }}
              </button>
              <button
                v-if="ctxMenu.path"
                class="bp-ctx-item"
                title="Copy absolute path"
                @click="ctxCopyPath"
              >
                copy path
              </button>
              <button
                class="bp-ctx-item"
                title="Download the active thread rendered to markdown"
                @click="ctxDownloadContext"
              >
                ⇓ download context (.md)
              </button>
              <button
                class="bp-ctx-item"
                :disabled="ctxRefBusy"
                title="Save context to the library with tag “reference”, then open a new workflow seeded with it"
                @click="ctxReferenceToWorkflow"
              >
                {{ ctxRefBusy ? "…" : "→ workflow · reference" }}
              </button>
              <button
                class="bp-ctx-item"
                :disabled="ctxRefBusy"
                title="Save context to the library with tag “reference” — drag it onto any workflow from the palette"
                @click="ctxReferenceToLibrary"
              >
                {{ ctxRefBusy ? "…" : "library · reference" }}
              </button>
            </template>
            <template v-else-if="ctxMenu.path && isLikelyTextPath(ctxMenu.path)">
              <button
                class="bp-ctx-item"
                title="Open"
                @click="ctxOpenViewer"
              >
                ⧉ open
              </button>
              <button
                class="bp-ctx-item"
                :title="`Open in ${settings.editorLabel}`"
                @click="ctxOpenInCode"
              >
                open in {{ settings.editorLabel }}
              </button>
              <button
                class="bp-ctx-item"
                title="Copy absolute path"
                @click="ctxCopyPath"
              >
                copy path
              </button>
              <button
                class="bp-ctx-item"
                :disabled="ctxCopyBusy"
                title="Copy file contents to the clipboard"
                @click="ctxCopyContent"
              >
                {{ ctxCopyBusy ? "copying…" : "copy content" }}
              </button>
            </template>
            <template v-else-if="ctxMenu.path">
              <button
                class="bp-ctx-item"
                :title="`Open in ${settings.editorLabel}`"
                @click="ctxOpenInCode"
              >
                open in {{ settings.editorLabel }}
              </button>
              <button
                class="bp-ctx-item"
                title="Copy absolute path"
                @click="ctxCopyPath"
              >
                copy path
              </button>
            </template>
            <button
              v-if="ctxMenu.invocations"
              class="bp-ctx-item"
              :title="
                ctxMenu.invocationsKind === 'reasoning'
                  ? 'View every thinking block in a floating window'
                  : 'View invocations in a floating window (large dumps are preview-capped)'
              "
              @click="ctxOpenInvocations"
            >
              {{
                ctxMenu.invocationsKind === "reasoning"
                  ? "view reasoning"
                  : "view invocations"
              }}
            </button>
            <button
              v-if="ctxMenu.invocations"
              class="bp-ctx-item"
              :title="
                ctxMenu.invocationsKind === 'reasoning'
                  ? 'Download every thinking block as markdown'
                  : 'Download every invocation as markdown (not capped)'
              "
              @click="ctxDownloadInvocations"
            >
              {{
                ctxMenu.invocationsKind === "reasoning"
                  ? "⇓ download reasoning (.md)"
                  : "⇓ download invocations (.md)"
              }}
            </button>
            <button
              v-if="ctxMenu.payloadOf"
              class="bp-ctx-item"
              title="View this context payload in a floating window"
              @click="ctxOpenPayload"
            >
              view context
            </button>
            <button
              v-if="ctxMenu.payloadOf"
              class="bp-ctx-item"
              title="Download raw payload JSON"
              @click="ctxDownloadPayload"
            >
              ⇓ download payload
            </button>
            <button
              v-if="ctxMenu.blueprintOf"
              class="bp-ctx-item"
              @click="ctxOpenBlueprint"
            >
              ⌗ open blueprint
            </button>
            <button
              v-if="ctxMenu.reasoningOf && !ctxMenu.invocations"
              class="bp-ctx-item"
              title="Download every thinking block as markdown"
              @click="ctxDownloadReasoning"
            >
              ⇓ download reasoning (.md)
            </button>
            <div
              v-if="
                !ctxMenu.path &&
                !ctxMenu.blueprintOf &&
                !ctxMenu.contextOf &&
                !ctxMenu.reasoningOf &&
                !ctxMenu.invocations &&
                !ctxMenu.payloadOf
              "
              class="bp-ctx-empty"
            >
              no actions
            </div>
          </div>
        </div>

        <!-- detail panel -->
        <aside v-if="detail" class="bp-detail" :style="{ width: detailWidth + 'px' }">
          <div
            class="resize-grip"
            title="Drag to resize · double-click to reset"
            @mousedown="startDetailDrag"
            @dblclick="resetDetailWidth"
          />
          <div class="bp-detail-head">
            <span class="micro-label">{{ detail.kindLabel }}</span>
            <DetailExpandControls @expand="detailExpanded = true" @close="closeBlueprintDetail" />
          </div>
          <div class="bp-detail-title" :title="detail.title">{{ detail.title }}</div>
          <div class="meta-kv mono">
            <template v-for="[k, v] in detail.rows" :key="k">
              <span class="kv-key" :title="METRIC_HINTS[k]">{{ k }}</span
              ><span>{{
                k === "status" ? (liveSessionStatus ?? v) : v
              }}</span>
            </template>
          </div>
          <div v-if="selectedId === 'root' && internals" class="bp-internals">
            <div class="micro-label bp-hunks-label">
              context per request
              <span
                v-if="internals.contextEstimated"
                class="bp-est"
                title="Estimated from transcript size (chars÷4)"
                >~est</span
              >
            </div>
            <svg
              v-if="sparkPoints"
              class="bp-spark"
              viewBox="0 0 100 44"
              preserveAspectRatio="none"
              role="img"
              aria-label="context tokens per request over the session"
            >
              <line
                v-for="x in compactionTicks"
                :key="x"
                :x1="x"
                :x2="x"
                y1="3"
                y2="41"
                class="bp-spark-compact"
              />
              <polyline :points="sparkPoints" class="bp-spark-line" />
            </svg>
            <div class="bp-spark-labels mono">
              <span
                >peak
                {{
                  fmtTokens(internals.peakContext, {
                    estimate: internals.contextEstimated,
                  })
                }}</span
              >
              <span
                >now
                {{
                  fmtTokens(internals.lastContext, {
                    estimate: internals.contextEstimated,
                  })
                }}</span
              >
            </div>
            <div class="meta-kv mono">
              <span class="kv-key" :title="METRIC_HINTS.compactions">compactions</span
              ><span>{{ internals.compactions }}</span>
              <span class="kv-key" :title="METRIC_HINTS.thinking">thinking</span
              ><span
                >{{ internals.thinkingBlocks }} blocks ·
                {{ fmtTokens(Math.round(internals.thinkingChars / 4)) }} tok est</span
              >
              <span class="kv-key" :title="METRIC_HINTS['tool errors']">tool errors</span
              ><span>{{ internals.toolErrors }}</span>
              <span class="kv-key" :title="METRIC_HINTS.duration">duration</span
              ><span>{{ fmtDuration(internals.durationMs) }}</span>
            </div>
          </div>
          <div v-if="detail.calls?.length" class="bp-calls">
            <div class="micro-label bp-hunks-label">invocations</div>
            <div class="bp-call-list nowheel">
              <div v-for="(call, i) in detail.calls" :key="i" class="bp-call">
                <span class="bp-call-time">{{ callTime(call.ts) }}</span>
                <span class="bp-call-text">{{ call.summary }}</span>
              </div>
              <div v-if="detail.callsTruncated" class="bp-call-more">
                +{{ detail.callsTruncated }} more not shown · download for full
              </div>
            </div>
          </div>
          <div v-if="detail.hasTranscript" class="bp-calls">
            <div class="micro-label bp-hunks-label">transcript</div>
            <div v-if="transcriptPreviewLoading" class="bp-call-more">loading…</div>
            <div v-else-if="transcriptPreviewError" class="bp-call-more">{{ transcriptPreviewError }}</div>
            <div v-else class="bp-call-list nowheel">
              <div
                v-for="(row, i) in transcriptPreview"
                :key="i"
                class="bp-call"
              >
                <span class="bp-call-time">{{ displayMessageRole(row.role) }}</span>
                <span class="bp-call-text">{{ row.summary }}</span>
              </div>
              <div v-if="transcriptPreviewMore" class="bp-call-more">
                +{{ transcriptPreviewMore }} more · view transcript for full
              </div>
              <div v-else-if="!transcriptPreview.length" class="bp-call-more">
                no messages
              </div>
            </div>
          </div>
          <div v-if="detail.hunks?.length" class="bp-hunks">
            <div class="micro-label bp-hunks-label">edited lines</div>
            <div class="bp-hunk-chips">
              <span v-for="h in detail.hunks" :key="h" class="threadle-chip mono">{{ h }}</span>
            </div>
          </div>
          <div class="bp-detail-actions">
            <template v-if="detail.invocationsOf">
              <button
                class="threadle-btn"
                :title="
                  detail.invocationsOf.kind === 'reasoning'
                    ? 'View every thinking block in a floating window — large dumps are preview-capped at 1.5 MB'
                    : 'View invocations in a floating window — large dumps are preview-capped at 1.5 MB; download for the full list'
                "
                @click="openInvocations(detail)"
              >
                {{
                  detail.invocationsOf.kind === "reasoning"
                    ? "view reasoning"
                    : "view invocations"
                }}
              </button>
              <button
                class="threadle-btn"
                :title="
                  detail.invocationsOf.kind === 'reasoning'
                    ? 'Download every thinking block as markdown (not capped)'
                    : 'Download every invocation as markdown (not capped)'
                "
                @click="downloadInvocations(detail.invocationsOf)"
              >
                {{
                  detail.invocationsOf.kind === "reasoning"
                    ? "⇓ download reasoning (.md)"
                    : "⇓ download invocations (.md)"
                }}
              </button>
            </template>
            <template v-if="detail.payloadOf">
              <button
                class="threadle-btn"
                title="View this context payload in a floating window"
                @click="openPayload(detail.payloadOf)"
              >
                view context
              </button>
              <button
                class="threadle-btn"
                title="Download raw payload JSON"
                @click="downloadPayload(detail.payloadOf)"
              >
                ⇓ download payload
              </button>
            </template>
            <template v-if="detail.contextOf">
              <button
                v-if="detail.hasTranscript"
                class="threadle-btn"
                title="View the interactive message transcript in a floating window"
                @click="fileViewers.openTranscript(detail.contextOf.provider, detail.contextOf.id)"
              >
                view transcript
              </button>
              <button
                class="threadle-btn"
                title="View the reconstructed model context in a floating window — large contexts are preview-capped at 1.5 MB"
                @click="fileViewers.openContext(detail.contextOf.provider, detail.contextOf.id)"
              >
                open context
              </button>
              <button
                class="threadle-btn"
                :title="`Write context to a temp .md and open in ${settings.editorLabel}`"
                @click="openContextInCode(detail.contextOf)"
              >
                open context in {{ settings.editorLabel }}
              </button>
              <button
                v-if="detail.openPath"
                class="threadle-btn"
                title="Copy absolute path"
                @click="copyPath(detail.openPath)"
              >
                copy path
              </button>
              <button
                class="threadle-btn"
                title="Download the active thread rendered to markdown — the reconstructed model context (the provider-side cache itself is not inspectable)"
                @click="downloadContext(detail.contextOf)"
              >
                ⇓ download context (.md)
              </button>
              <button
                class="threadle-btn"
                :disabled="ctxRefBusy"
                title="Save context to the library with tag “reference”, then open a new workflow seeded with it"
                @click="referenceToWorkflow(detail.contextOf)"
              >
                {{ ctxRefBusy ? "…" : "→ workflow · reference" }}
              </button>
              <button
                class="threadle-btn"
                :disabled="ctxRefBusy"
                title="Save context to the library with tag “reference” — drag it onto any workflow from the palette"
                @click="referenceToLibrary(detail.contextOf)"
              >
                {{ ctxRefBusy ? "…" : "library · reference" }}
              </button>
            </template>
            <template v-else-if="detail.openPath && isLikelyTextPath(detail.openPath)">
              <p
                v-if="fileViewers.isMissing(detail.openPath)"
                class="bp-missing-note micro-label"
              >
                missing from disk — deleted or moved
              </p>
              <button
                class="threadle-btn"
                :class="{ 'bp-btn-missing': fileViewers.isMissing(detail.openPath) }"
                :title="
                  fileViewers.isMissing(detail.openPath)
                    ? 'File is missing from disk'
                    : 'Open'
                "
                @click="fileViewers.open(detail.openPath)"
              >
                ⧉ open
              </button>
              <button
                class="threadle-btn"
                :class="{ 'bp-btn-missing': fileViewers.isMissing(detail.openPath) }"
                @click="settings.openPath(detail.openPath)"
              >
                open in {{ settings.editorLabel }}
              </button>
              <button
                class="threadle-btn"
                title="Copy absolute path"
                @click="copyPath(detail.openPath)"
              >
                copy path
              </button>
            </template>
            <template v-else-if="detail.openPath">
              <button class="threadle-btn" @click="settings.openPath(detail.openPath)">
                open in {{ settings.editorLabel }}
              </button>
              <button
                class="threadle-btn"
                title="Copy absolute path"
                @click="copyPath(detail.openPath)"
              >
                copy path
              </button>
            </template>
            <div v-if="ctxRefNote" class="bp-ref-note micro-label mono">{{ ctxRefNote }}</div>
            <button
              v-if="detail.blueprintOf"
              class="threadle-btn"
              @click="openChildBlueprint(detail.blueprintOf)"
            >
              ⌗ open blueprint
            </button>
            <button
              v-if="detail.pluginsBrowse"
              class="threadle-btn"
              @click="openPluginsInventory(detail.pluginsBrowse)"
            >
              ▣ plugins inventory
            </button>
            <button
              v-if="detail.reasoningOf && !detail.invocationsOf"
              class="threadle-btn"
              title="Download every thinking block of this session as markdown"
              @click="downloadReasoning(detail.reasoningOf)"
            >
              ⇓ download reasoning (.md)
            </button>
          </div>
        </aside>

        <DetailExpandModal
          :open="!!detail && detailExpanded"
          :label="blueprintDetailLabel"
          @close="detailExpanded = false"
        >
          <template v-if="detail">
            <div class="bp-detail-head">
              <span class="micro-label">{{ detail.kindLabel }}</span>
              <DetailExpandControls hide-expand @close="detailExpanded = false" />
            </div>
            <div class="bp-detail-title" :title="detail.title">{{ detail.title }}</div>
            <div class="meta-kv mono">
              <template v-for="[k, v] in detail.rows" :key="k">
                <span class="kv-key" :title="METRIC_HINTS[k]">{{ k }}</span
                ><span>{{
                  k === "status" ? (liveSessionStatus ?? v) : v
                }}</span>
              </template>
            </div>
            <div v-if="selectedId === 'root' && internals" class="bp-internals">
              <div class="micro-label bp-hunks-label">
                context per request
                <span
                  v-if="internals.contextEstimated"
                  class="bp-est"
                  title="Estimated from transcript size (chars÷4)"
                  >~est</span
                >
              </div>
              <svg
                v-if="sparkPoints"
                class="bp-spark"
                viewBox="0 0 100 44"
                preserveAspectRatio="none"
                role="img"
                aria-label="context tokens per request over the session"
              >
                <line
                  v-for="x in compactionTicks"
                  :key="x"
                  :x1="x"
                  :x2="x"
                  y1="3"
                  y2="41"
                  class="bp-spark-compact"
                />
                <polyline :points="sparkPoints" class="bp-spark-line" />
              </svg>
              <div class="bp-spark-labels mono">
                <span
                  >peak
                  {{
                    fmtTokens(internals.peakContext, {
                      estimate: internals.contextEstimated,
                    })
                  }}</span
                >
                <span
                  >now
                  {{
                    fmtTokens(internals.lastContext, {
                      estimate: internals.contextEstimated,
                    })
                  }}</span
                >
              </div>
              <div class="meta-kv mono">
                <span class="kv-key" :title="METRIC_HINTS.compactions">compactions</span
                ><span>{{ internals.compactions }}</span>
                <span class="kv-key" :title="METRIC_HINTS.thinking">thinking</span
                ><span
                  >{{ internals.thinkingBlocks }} blocks ·
                  {{ fmtTokens(Math.round(internals.thinkingChars / 4)) }} tok est</span
                >
                <span class="kv-key" :title="METRIC_HINTS['tool errors']">tool errors</span
                ><span>{{ internals.toolErrors }}</span>
                <span class="kv-key" :title="METRIC_HINTS.duration">duration</span
                ><span>{{ fmtDuration(internals.durationMs) }}</span>
              </div>
            </div>
            <div v-if="detail.calls?.length" class="bp-calls">
              <div class="micro-label bp-hunks-label">invocations</div>
              <div class="bp-call-list nowheel">
                <div v-for="(call, i) in detail.calls" :key="i" class="bp-call">
                  <span class="bp-call-time">{{ callTime(call.ts) }}</span>
                  <span class="bp-call-text">{{ call.summary }}</span>
                </div>
                <div v-if="detail.callsTruncated" class="bp-call-more">
                  +{{ detail.callsTruncated }} more not shown · download for full
                </div>
              </div>
            </div>
            <div v-if="detail.hasTranscript" class="bp-calls">
              <div class="micro-label bp-hunks-label">transcript</div>
              <div v-if="transcriptPreviewLoading" class="bp-call-more">loading…</div>
              <div v-else-if="transcriptPreviewError" class="bp-call-more">{{ transcriptPreviewError }}</div>
              <div v-else class="bp-call-list nowheel">
                <div
                  v-for="(row, i) in transcriptPreview"
                  :key="i"
                  class="bp-call"
                >
                  <span class="bp-call-time">{{ displayMessageRole(row.role) }}</span>
                  <span class="bp-call-text">{{ row.summary }}</span>
                </div>
                <div v-if="transcriptPreviewMore" class="bp-call-more">
                  +{{ transcriptPreviewMore }} more · view transcript for full
                </div>
                <div v-else-if="!transcriptPreview.length" class="bp-call-more">
                  no messages
                </div>
              </div>
            </div>
            <div v-if="detail.hunks?.length" class="bp-hunks">
              <div class="micro-label bp-hunks-label">edited lines</div>
              <div class="bp-hunk-chips">
                <span v-for="h in detail.hunks" :key="h" class="threadle-chip mono">{{ h }}</span>
              </div>
            </div>
          </template>
        </DetailExpandModal>
      </div>
    <StatusBar />
    </div>

    <OutboundUrlsModal
      v-if="urlsOpen && data"
      :provider="provider"
      :session-id="sessionId"
      :tools="data.tools"
      @close="urlsOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  VueFlow,
  Handle,
  Position,
  type Edge as VFEdge,
  type Node as VFNode,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import type { NormalizedMessage, SessionRef, SessionStatus, TouchedFile } from "@threadle/shared";
import DashNav from "@/panels/DashNav.vue";
import StatusBar from "@/panels/StatusBar.vue";
import OutboundUrlsModal from "@/panels/OutboundUrlsModal.vue";
import { useNavItems } from "@/panels/useNavItems";
import { bidiPath, relativeTime, shortId, fmtTokens, isTokenEstimate } from "@/lib/format";
import { providerShort } from "@/lib/providers";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";
import { useSessionsStore } from "@/stores/sessions";
import { subscribeEvents } from "@/api/client";
import { copyToClipboard, fetchFileText } from "@/lib/pathActions";
import { api } from "@/api/client";
import { downloadUrl, sessionsToWorkflow, referenceContextToWorkflow, referenceContextToLibrary } from "@/lib/convert";
import { useHorizontalResize } from "@/lib/useHorizontalResize";
import { useFilterChipMenu } from "@/lib/useFilterChipMenu";
import { displayMessageRole } from "@/lib/messageRole";
import FilterChipMenu from "@/components/FilterChipMenu.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import DetailExpandControls from "@/panels/DetailExpandControls.vue";
import DetailExpandModal from "@/panels/DetailExpandModal.vue";
import "@/views/dashboard/chrome.css";

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const sessions = useSessionsStore();
const navItems = useNavItems();
void settings.load();

const provider = computed(() => String(route.params.provider));
const sessionId = computed(() => String(route.params.id));

const liveSessionStatus = computed<SessionStatus | undefined>(() => {
  const fromStore = sessions.find(provider.value, sessionId.value)?.status;
  if (fromStore) return fromStore;
  return data.value?.ref?.status;
});

let unsubEvents: (() => void) | undefined;
function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") dismissCtxMenu();
}
onMounted(() => {
  if (!sessions.sessions.length) void sessions.refresh();
  document.addEventListener("keydown", onDocKeydown);
  unsubEvents = subscribeEvents((ev) => {
    if (ev.type === "live.status") {
      sessions.applyLiveStatuses(ev.statuses);
      const hit = ev.statuses.find(
        (s) => s.provider === provider.value && s.id === sessionId.value,
      );
      if (hit && data.value?.ref) data.value.ref.status = hit.status;
      return;
    }
    if (ev.type === "sessions.changed" && ev.provider === provider.value) {
      void sessions.refresh();
    }
  });
});
onUnmounted(() => {
  document.removeEventListener("keydown", onDocKeydown);
  unsubEvents?.();
});

/** set when this blueprint was opened from a parent session's blueprint */
const parentRef = computed(() => {
  const q = route.query.parent;
  if (typeof q !== "string" || !q.includes("::")) return undefined;
  const [pProvider, pId] = q.split("::", 2);
  return pProvider && pId ? { provider: pProvider, id: pId } : undefined;
});
const parentTitle = computed(() =>
  typeof route.query.ptitle === "string" ? route.query.ptitle : undefined,
);


function goDash(view: string): void {
  if (view === "lineage") {
    void router.push({
      path: "/lineage",
      query: { focus: `${provider.value}:${sessionId.value}` },
    });
    return;
  }
  if (view === "timeline") {
    void router.push("/timeline");
    return;
  }
  if (view === "map") {
    const projectDir = data.value?.ref?.projectDir;
    void router.push({
      path: "/map",
      query: projectDir ? { dir: projectDir } : undefined,
    });
    return;
  }
  void router.push({ path: "/", query: { view } });
}

function openChildBlueprint(ref: { provider: string; id: string }): void {
  void router.push({
    path: `/blueprint/${ref.provider}/${ref.id}`,
    query: {
      parent: `${provider.value}::${sessionId.value}`,
      ptitle: data.value?.ref?.title ?? shortId(sessionId.value),
    },
  });
}

function goBack(): void {
  if (parentRef.value) {
    void router.push(`/blueprint/${parentRef.value.provider}/${parentRef.value.id}`);
    return;
  }
  // return to wherever the user came from (timeline, lineage, map, …)
  const from = route.query.from;
  if (from === "timeline") return void router.push("/timeline");
  if (from === "lineage") return void router.push("/lineage");
  if (from === "map" || from === "atlas") {
    const projectDir = data.value?.ref?.projectDir;
    return void router.push({
      path: "/map",
      query: projectDir ? { dir: projectDir } : undefined,
    });
  }
  goDash("sessions");
}

interface Invocation {
  summary: string;
  body?: string;
  ts?: number;
}

interface Counted {
  name: string;
  count: number;
  calls: Invocation[];
}

interface BlueprintInternals {
  timeline: Array<{ ts?: number; context: number }>;
  peakContext: number;
  lastContext: number;
  contextEstimated?: boolean;
  compactions: number;
  thinkingBlocks: number;
  thinkingChars: number;
  toolErrors: number;
  durationMs?: number;
}

interface RuleFile {
  path: string;
  name: string;
  kind: "rules" | "agent" | "skill";
  source: string;
  size: number;
  mtime: number;
  scope: "global" | "project";
}

interface CtxMeta {
  hash: string;
  kind: string;
  createdAt: number;
  chars: number;
  preview: string;
  source: { provider: string; sessionId: string };
}

interface Blueprint {
  ref?: SessionRef;
  rulesFiles?: RuleFile[];
  contexts?: { extracted: CtxMeta[]; injected: CtxMeta[] };
  reasoning?: { count: number; chars: number; samples: Invocation[] };
  internals?: BlueprintInternals;
  stats: { userTurns: number; assistantTurns: number; messages: number };
  tools: Counted[];
  skills: Counted[];
  files: TouchedFile[];
  children: SessionRef[];
}

interface PluginPack {
  provider: string;
  id: string;
  name: string;
  version?: string;
  description?: string;
  origin: {
    kind: string;
    path: string;
    marketplaceId?: string;
  };
  state: string;
  children: Array<{
    kind: string;
    name: string;
    path?: string;
    description?: string;
  }>;
}

interface MatchedPlugin extends PluginPack {
  matched: string[];
}

const data = ref<Blueprint>();
const plugins = ref<PluginPack[]>([]);
const loading = ref(true);
const error = ref<string>();
const selectedId = ref<string>();
const detailExpanded = ref(false);
const bpFilter = ref("");

function closeBlueprintDetail(): void {
  selectedId.value = undefined;
  detailExpanded.value = false;
}

const blueprintDetailLabel = computed(() => detail.value?.title ?? detail.value?.kindLabel ?? "Details");
const urlsOpen = ref(false);

const sessionHasTranscript = computed(() => {
  const d = data.value;
  if (!d?.ref) return false;
  if ((d.stats?.messages ?? d.ref.messageCount ?? 0) > 0) return true;
  const path =
    d.ref.meta && typeof d.ref.meta.transcriptPath === "string"
      ? d.ref.meta.transcriptPath
      : "";
  return path.length > 0;
});

const PREVIEW_MSGS = 40;
const transcriptPreview = ref<Array<{ role: string; summary: string }>>([]);
const transcriptPreviewMore = ref(0);
const transcriptPreviewLoading = ref(false);
const transcriptPreviewError = ref<string>();

function messagePreviewLine(m: NormalizedMessage): string {
  for (const p of m.parts) {
    if (p.type === "text" && p.text?.trim()) {
      const one = p.text.replace(/\s+/g, " ").trim();
      return one.length > 140 ? `${one.slice(0, 140)}…` : one;
    }
    if (p.type === "thinking" && p.text?.trim()) {
      const one = p.text.replace(/\s+/g, " ").trim();
      return `thinking: ${one.length > 120 ? `${one.slice(0, 120)}…` : one}`;
    }
    if (p.type === "tool_use") return `⚙ ${p.toolName ?? "tool"}`;
    if (p.type === "tool_result") return p.isError ? "→ result (error)" : "→ result";
  }
  return "(empty)";
}

async function loadTranscriptPreview(prov: string, id: string): Promise<void> {
  transcriptPreviewLoading.value = true;
  transcriptPreviewError.value = undefined;
  transcriptPreview.value = [];
  transcriptPreviewMore.value = 0;
  try {
    const res = await api.transcript(prov, id, 0, PREVIEW_MSGS, true);
    transcriptPreview.value = res.messages.map((m) => ({
      role: m.role,
      summary: messagePreviewLine(m),
    }));
    transcriptPreviewMore.value = Math.max(0, res.total - res.messages.length);
  } catch (err) {
    transcriptPreviewError.value = err instanceof Error ? err.message : String(err);
  } finally {
    transcriptPreviewLoading.value = false;
  }
}

const TYPE_TOGGLES = [
  { key: "agent", glyph: "⟨/⟩", label: "agent" },
  { key: "tools", glyph: "⚙", label: "tools" },
  { key: "skills", glyph: "✦", label: "skills used" },
  { key: "rules", glyph: "§", label: "rules" },
  { key: "skillsets", glyph: "✦", label: "skillsets" },
  { key: "plugins", glyph: "▣", label: "plugins" },
  { key: "contexts", glyph: "❝", label: "contexts" },
  { key: "reasoning", glyph: "∴", label: "reasoning" },
  { key: "subagents", glyph: "⎇", label: "subagents" },
  { key: "files", glyph: "▤", label: "files" },
] as const;

const typeFilters = reactive<Record<string, boolean>>({
  agent: true,
  tools: true,
  skills: true,
  rules: true,
  skillsets: true,
  plugins: true,
  contexts: true,
  reasoning: true,
  subagents: true,
  files: true,
});

type FilterKey = (typeof TYPE_TOGGLES)[number]["key"];

const {
  menu: filterMenu,
  menuTitle: filterMenuTitle,
  openMenu: openFilterChipMenu,
  dismissMenu: dismissFilterMenu,
  applyOnly: applyFilterOnly,
  applyExcept: applyFilterExcept,
  applyAdd: applyFilterAdd,
  applyHide: applyFilterHide,
  applyShowAll: applyFilterShowAll,
  applyHideAll: applyFilterHideAll,
  applyInvert: applyFilterInvert,
  applyNonempty: applyFilterNonempty,
  hasNonempty: filterHasNonempty,
} = useFilterChipMenu<FilterKey>({
  keys: () => TYPE_TOGGLES.map((t) => t.key),
  isOn: (k) => !!typeFilters[k],
  setAll: (next) => {
    for (const t of TYPE_TOGGLES) typeFilters[t.key] = !!next[t.key];
  },
  count: (k) => typeCount(k),
  labelFor: (k) => {
    const t = TYPE_TOGGLES.find((x) => x.key === k);
    return t ? `${t.glyph} ${t.label}` : k;
  },
});

function openFilterMenu(e: MouseEvent, seed?: FilterKey): void {
  ctxMenu.value = undefined;
  ctxCopyBusy.value = false;
  openFilterChipMenu(e, seed);
}

function typeCount(key: string): number {
  const d = data.value;
  if (!d) return 0;
  switch (key) {
    case "agent": {
      const files = (d.rulesFiles ?? []).filter((r) => r.kind === "agent");
      const sessAgent = d.ref?.agent?.trim();
      const extras = files.filter(
        (r) => !(sessAgent && r.name.toLowerCase() === sessAgent.toLowerCase()),
      ).length;
      return (sessAgent ? 1 : 0) + extras;
    }
    case "tools":
      return d.tools.length;
    case "skills":
      return d.skills.length;
    case "rules":
      return (d.rulesFiles ?? []).filter((r) => r.kind === "rules").length;
    case "skillsets":
      return (d.rulesFiles ?? []).filter((r) => r.kind === "skill").length;
    case "plugins":
      return matchedPlugins(d).length;
    case "contexts":
      return (
        (d.contexts?.extracted.length ?? 0) +
        (d.contexts?.injected.length ?? 0) +
        // reconstructed session context node when transcript exists
        (d.ref &&
        ((d.stats?.messages ?? d.ref.messageCount ?? 0) > 0 ||
          !!(
            d.ref.meta &&
            typeof d.ref.meta.transcriptPath === "string" &&
            d.ref.meta.transcriptPath
          ))
          ? 1
          : 0)
      );
    case "reasoning":
      return d.reasoning?.count ? 1 : 0;
    case "subagents":
      return d.children.length;
    case "files":
      return d.files.length;
    default:
      return 0;
  }
}

const {
  width: detailWidth,
  startDrag: startDetailDrag,
  resetWidth: resetDetailWidth,
} = useHorizontalResize(
  "threadle.blueprint.detailWidth",
  320,
  260,
  680,
);

function bpMatch(...texts: Array<string | undefined>): boolean {
  const q = bpFilter.value.trim().toLowerCase();
  if (!q) return true;
  return texts.some((t) => t?.toLowerCase().includes(q));
}

function pathUnder(child: string, root: string): boolean {
  const c = child.replace(/\\/g, "/").toLowerCase();
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (!r) return false;
  return c === r || c.startsWith(`${r}/`);
}

function matchedPlugins(d: Blueprint): MatchedPlugin[] {
  const files = d.rulesFiles ?? [];
  const used = new Set(d.skills.map((s) => s.name.toLowerCase()));
  const out: MatchedPlugin[] = [];
  for (const p of plugins.value) {
    const reasons: string[] = [];
    for (const f of files) {
      if (pathUnder(f.path, p.origin.path)) reasons.push(f.name);
    }
    for (const ch of p.children) {
      if (ch.kind === "skill" && used.has(ch.name.toLowerCase())) {
        reasons.push(`used · ${ch.name}`);
      }
      if (ch.path) {
        for (const f of files) {
          if (pathUnder(f.path, ch.path) || pathUnder(ch.path, f.path)) {
            reasons.push(ch.name);
          }
        }
      }
    }
    if (used.has(p.id.toLowerCase()) || used.has(p.name.toLowerCase())) {
      reasons.push(`used · ${p.name}`);
    }
    if (!reasons.length) continue;
    if (
      !bpMatch(
        p.name,
        p.id,
        p.description,
        p.origin.marketplaceId,
        ...reasons,
      )
    ) {
      continue;
    }
    out.push({ ...p, matched: [...new Set(reasons)] });
  }
  return out;
}

async function loadPlugins(): Promise<void> {
  try {
    const res = await fetch("/api/plugins");
    plugins.value = (await res.json()) as PluginPack[];
  } catch {
    plugins.value = [];
  }
}

async function loadBlueprint(): Promise<void> {
  loading.value = true;
  error.value = undefined;
  data.value = undefined;
  selectedId.value = undefined;
  bpFilter.value = "";
  try {
    const [res] = await Promise.all([
      fetch(`/api/sessions/${provider.value}/blueprint/${sessionId.value}`),
      plugins.value.length ? Promise.resolve(null) : loadPlugins(),
    ]);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    data.value = (await res.json()) as Blueprint;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function openPluginsInventory(key: string): void {
  void router.push({
    path: "/",
    query: { view: "agents", browse: "plugins", plugin: key },
  });
}

watch(
  () => [route.params.provider, route.params.id],
  () => {
    urlsOpen.value = false;
    if (route.name === "session-blueprint") void loadBlueprint();
  },
  { immediate: true },
);

watch(
  () => {
    const d = data.value;
    if (!d) return [] as string[];
    const paths = [
      ...d.files.map((f) => f.path),
      ...(d.rulesFiles ?? []).map((r) => r.path),
    ];
    return paths;
  },
  (paths) => {
    if (paths.length) void fileViewers.probeMissing(paths);
  },
  { immediate: true },
);

const FILE_CAP = 30;
const fileLimit = ref(FILE_CAP);
const ROW = 66;

const matchingFiles = computed(() =>
  (typeFilters.files ? [...(data.value?.files ?? [])] : [])
    .filter((f) => bpMatch(f.path, f.op))
    .sort(
      (a, b) =>
        (b.additions ?? 0) + (b.deletions ?? 0) - ((a.additions ?? 0) + (a.deletions ?? 0)),
    ),
);

const sortedFiles = computed(() => matchingFiles.value.slice(0, fileLimit.value));
const hiddenFileCount = computed(
  () => matchingFiles.value.length - sortedFiles.value.length,
);

const nodes = computed<VFNode[]>(() => {
  // Track missing-path set so file nodes re-render when probe/open updates it.
  void fileViewers.missingPaths;
  const d = data.value;
  if (!d) return [];
  const out: VFNode[] = [];
  let midY = 0;

  const push = (id: string, x: number, y: number, nodeData: Record<string, unknown>) =>
    out.push({ id, type: "bp", position: { x, y }, data: nodeData });

  if (
    typeFilters.agent &&
    d.ref?.agent &&
    bpMatch(d.ref.agent, "agent", providerShort(d.ref.provider))
  ) {
    push(`agent:${d.ref.agent}`, 420, midY, {
      kind: "agent",
      glyph: "⟨/⟩",
      title: d.ref.agent,
      sub: `${providerShort(d.ref.provider)} · session agent`,
    });
    midY += ROW;
  }
  const agentArts = (d.rulesFiles ?? []).filter(
    (r) =>
      typeFilters.agent &&
      r.kind === "agent" &&
      !(d.ref?.agent && r.name.toLowerCase() === d.ref.agent.toLowerCase()) &&
      bpMatch(r.name, r.source, "agent"),
  );
  if (agentArts.length && midY) midY += 8;
  for (const r of agentArts) {
    push(`agentfile:${r.path}`, 420, midY, {
      kind: "agentfile",
      glyph: "⟨/⟩",
      title: r.name,
      sub: r.scope === "global" ? "global agent def" : r.source,
      badge: r.scope,
      missing: fileViewers.isMissing(r.path),
    });
    midY += ROW;
  }
  if (d.tools.length && midY) midY += 24;
  for (const t of typeFilters.tools ? d.tools : []) {
    if (!bpMatch(t.name)) continue;
    push(`tool:${t.name}`, 420, midY, {
      kind: "tool",
      glyph: "⚙",
      title: t.name,
      badge: `×${t.count}`,
    });
    midY += ROW;
  }
  if (d.skills.length) midY += 24;
  for (const sk of typeFilters.skills ? d.skills : []) {
    if (!bpMatch(sk.name)) continue;
    push(`skill:${sk.name}`, 420, midY, {
      kind: "skill",
      glyph: "✦",
      title: sk.name,
      badge: `×${sk.count}`,
    });
    midY += ROW;
  }
  const ruleArts = (d.rulesFiles ?? []).filter(
    (r) =>
      typeFilters.rules && r.kind === "rules" && bpMatch(r.name, r.source, "rules"),
  );
  const skillArts = (d.rulesFiles ?? []).filter(
    (r) =>
      typeFilters.skillsets &&
      r.kind === "skill" &&
      bpMatch(r.name, r.source, "skillset"),
  );
  if (ruleArts.length || skillArts.length) midY += 24;
  for (const r of ruleArts) {
    push(`rule:${r.path}`, 420, midY, {
      kind: "rulefile",
      glyph: "§",
      title: r.name,
      sub: r.scope === "global" ? "global rules" : r.source,
      badge: r.scope,
      missing: fileViewers.isMissing(r.path),
    });
    midY += ROW;
  }
  for (const r of skillArts) {
    push(`skillset:${r.path}`, 420, midY, {
      kind: "skillset",
      glyph: "✦",
      title: r.name,
      sub: `skillset · ${r.source}`,
      badge: r.scope,
      missing: fileViewers.isMissing(r.path),
    });
    midY += ROW;
  }
  const pluginHits = typeFilters.plugins ? matchedPlugins(d) : [];
  if (pluginHits.length) midY += 24;
  for (const p of pluginHits) {
    push(`plugin:${p.provider}:${p.id}`, 420, midY, {
      kind: "plugin",
      glyph: "▣",
      title: p.name,
      sub: `${p.provider}${p.version ? ` · ${p.version}` : ""} · ${p.state}`,
      badge: String(p.matched.length),
    });
    midY += ROW;
  }
  const ctxSession =
    typeFilters.contexts &&
    d.ref &&
    ((d.stats?.messages ?? d.ref.messageCount ?? 0) > 0 ||
      !!(
        d.ref.meta &&
        typeof d.ref.meta.transcriptPath === "string" &&
        d.ref.meta.transcriptPath
      )) &&
    bpMatch("session context", "context", "reconstructed");
  const ctxOut = typeFilters.contexts
    ? (d.contexts?.extracted ?? []).filter((c) => bpMatch(c.preview, c.kind, "context"))
    : [];
  const ctxIn = typeFilters.contexts
    ? (d.contexts?.injected ?? []).filter((c) => bpMatch(c.preview, c.kind, "context"))
    : [];
  if (ctxSession || ctxOut.length || ctxIn.length) midY += 24;
  if (ctxSession) {
    const last = d.internals?.lastContext;
    const est = !!d.internals?.contextEstimated;
    push("ctx:session", 420, midY, {
      kind: "context",
      glyph: "❝",
      title: "session context",
      sub: "reconstructed model context",
      badge:
        last != null && last > 0
          ? fmtTokens(last, { estimate: est })
          : undefined,
    });
    midY += ROW;
  }
  for (const cx of ctxOut) {
    push(`ctx:${cx.hash}`, 420, midY, {
      kind: "context",
      glyph: "❝",
      title: cx.preview || cx.kind,
      sub: `extracted · ${cx.kind}`,
      badge: fmtTokens(Math.round(cx.chars / 4)),
    });
    midY += ROW;
  }
  for (const cx of ctxIn) {
    push(`ctxin:${cx.hash}`, 420, midY, {
      kind: "context",
      glyph: "❝",
      title: cx.preview || cx.kind,
      sub: `injected · ${cx.kind}`,
      badge: fmtTokens(Math.round(cx.chars / 4)),
    });
    midY += ROW;
  }
  if (typeFilters.reasoning && d.reasoning?.count && bpMatch("reasoning", "thinking")) {
    midY += 24;
    push("reasoning", 420, midY, {
      kind: "reasoning",
      glyph: "∴",
      title: "reasoning",
      sub: d.reasoning.chars
        ? `${fmtTokens(Math.round(d.reasoning.chars / 4))} tok est`
        : "content redacted",
      badge: `×${d.reasoning.count}`,
    });
    midY += ROW;
  }
  if (d.children.length) midY += 24;
  for (const c of typeFilters.subagents ? d.children : []) {
    if (!bpMatch(c.title, c.agent, c.id)) continue;
    push(`sub:${c.id}`, 420, midY, {
      kind: "subagent",
      glyph: "⎇",
      title: c.title ?? shortId(c.id),
      sub: c.agent ?? "subagent",
    });
    midY += ROW;
  }

  sortedFiles.value.forEach((f, i) => {
    push(`file:${f.path}`, 880, i * ROW, {
      kind: `file-${f.op}`,
      glyph: "▤",
      title: f.path.split("/").pop() ?? f.path,
      sub: bidiPath(f.path),
      badge:
        f.additions || f.deletions ? `+${f.additions ?? 0} −${f.deletions ?? 0}` : f.op,
      missing: fileViewers.isMissing(f.path),
    });
  });
  if (hiddenFileCount.value > 0) {
    push("file:more", 880, sortedFiles.value.length * ROW, {
      kind: "file-more",
      glyph: "▤",
      title: `+${hiddenFileCount.value} more files`,
      sub: "top files by churn shown — click to render all",
    });
  } else if (fileLimit.value > FILE_CAP && matchingFiles.value.length > FILE_CAP) {
    push("file:more", 880, sortedFiles.value.length * ROW, {
      kind: "file-more",
      glyph: "▤",
      title: "collapse file list",
      sub: `click to show only the top ${FILE_CAP} again`,
    });
  }

  const height = Math.max(midY, sortedFiles.value.length * ROW, ROW);
  const est = isTokenEstimate(d.ref?.meta);
  const cacheTotal =
    (d.ref?.tokensIn ?? 0) + (d.ref?.tokensCacheRead ?? 0) + (d.ref?.tokensCacheWrite ?? 0);
  const rootMeta = [
    `out ${fmtTokens(d.ref?.tokensOut, { estimate: est })}`,
    cacheTotal
      ? `cache ${((100 * (d.ref?.tokensCacheRead ?? 0)) / cacheTotal).toFixed(0)}%`
      : undefined,
    d.internals?.durationMs ? fmtDuration(d.internals.durationMs) : undefined,
    d.internals?.toolErrors ? `${d.internals.toolErrors} errors` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  push("root", 0, height / 2 - 40, {
    kind: "root",
    glyph: "❯",
    title: d.ref?.title ?? shortId(sessionId.value),
    sub: `${d.stats.userTurns} prompts · ${d.stats.assistantTurns} replies`,
    sub2: rootMeta,
    badge: d.ref?.model?.split("/").pop(),
  });
  return out;
});

const edges = computed<VFEdge[]>(() =>
  nodes.value
    .filter((n) => n.id !== "root")
    .map((n) => ({
      id: `e-${n.id}`,
      source: "root",
      target: n.id,
      type: "default",
      class: n.id.startsWith("sub:")
        ? "edge-child"
        : n.id.startsWith("ctx:") || n.id.startsWith("ctxin:")
          ? "bp-edge-ctx"
          : n.id.startsWith("file:")
          ? "bp-edge-file"
          : n.id.startsWith("rule:") || n.id.startsWith("skillset:")
            ? "bp-edge-rule"
            : n.id.startsWith("agent:") || n.id.startsWith("agentfile:")
              ? "bp-edge-agent"
              : "bp-edge-tool",
    })),
);

function onNodeClick(e: { event?: MouseEvent | TouchEvent; node: VFNode }): void {
  if (e.event instanceof MouseEvent && e.event.button !== 0) return;
  if (e.node.id === "file:more") {
    fileLimit.value = fileLimit.value > FILE_CAP ? FILE_CAP : Infinity;
    return;
  }
  dismissCtxMenu();
  selectedId.value = selectedId.value === e.node.id ? undefined : e.node.id;
}

interface BpCtxMenu {
  nodeId: string;
  label: string;
  x: number;
  y: number;
  path?: string;
  blueprintOf?: { provider: string; id: string };
  contextOf?: { provider: string; id: string };
  reasoningOf?: { provider: string; id: string };
  invocations?: boolean;
  invocationsKind?: "tool" | "skill" | "reasoning";
  payloadOf?: { hash: string; name: string };
  hasTranscript?: boolean;
}

const ctxMenu = ref<BpCtxMenu>();
const ctxCopyBusy = ref(false);
const ctxRefBusy = ref(false);
const ctxRefNote = ref<string>();

function dismissCtxMenu(): void {
  ctxMenu.value = undefined;
  ctxCopyBusy.value = false;
  dismissFilterMenu();
}

function clampMenuPos(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const pad = 8;
  return {
    x: Math.max(pad, Math.min(x, window.innerWidth - w - pad)),
    y: Math.max(pad, Math.min(y, window.innerHeight - h - pad)),
  };
}

function onNodeCtxMenu(e: { event: MouseEvent | TouchEvent; node: VFNode }): void {
  if (!(e.event instanceof MouseEvent)) return;
  e.event.preventDefault();
  dismissFilterMenu();
  if (e.node.id === "file:more") {
    fileLimit.value = fileLimit.value > FILE_CAP ? FILE_CAP : Infinity;
    return;
  }
  const d = detailFor(e.node.id);
  const title = d?.title ?? String(e.node.data?.title ?? e.node.id);
  const hasInvocations = !!d?.invocationsOf;
  const itemCount =
    (d?.contextOf ? 5 : 0) +
    (d?.hasTranscript ? 1 : 0) +
    (d?.openPath ? 1 : 0) +
    (d?.openPath && isLikelyTextPath(d.openPath) ? 3 : 0) +
    (d?.blueprintOf ? 1 : 0) +
    (d?.reasoningOf && !hasInvocations ? 1 : 0) +
    (hasInvocations ? 2 : 0) +
    (d?.payloadOf ? 2 : 0);
  ctxMenu.value = {
    nodeId: e.node.id,
    label: title,
    path: d?.openPath,
    blueprintOf: d?.blueprintOf,
    contextOf: d?.contextOf,
    reasoningOf: d?.reasoningOf,
    invocations: hasInvocations,
    invocationsKind: d?.invocationsOf?.kind,
    payloadOf: d?.payloadOf,
    hasTranscript: !!d?.hasTranscript,
    ...clampMenuPos(e.event.clientX, e.event.clientY, 220, 36 + Math.max(itemCount, 1) * 28),
  };
}

function ctxOpenViewer(): void {
  const p = ctxMenu.value?.path;
  if (!p) return;
  void fileViewers.open(p);
  dismissCtxMenu();
}

function ctxOpenInCode(): void {
  const p = ctxMenu.value?.path;
  if (!p) return;
  settings.openPath(p);
  dismissCtxMenu();
}

async function ctxCopyPath(): Promise<void> {
  const p = ctxMenu.value?.path;
  if (!p) return;
  await copyToClipboard(p);
  dismissCtxMenu();
}

async function ctxCopyContent(): Promise<void> {
  const p = ctxMenu.value?.path;
  if (!p || ctxCopyBusy.value) return;
  ctxCopyBusy.value = true;
  try {
    const text = await fetchFileText(p);
    await copyToClipboard(text);
    dismissCtxMenu();
  } catch {
    /* keep open */
  } finally {
    ctxCopyBusy.value = false;
  }
}

function ctxOpenBlueprint(): void {
  const ref = ctxMenu.value?.blueprintOf;
  if (!ref) return;
  dismissCtxMenu();
  openChildBlueprint(ref);
}

function ctxOpenContext(): void {
  const ref = ctxMenu.value?.contextOf;
  if (!ref) return;
  dismissCtxMenu();
  void fileViewers.openContext(ref.provider, ref.id);
}

function ctxOpenTranscript(): void {
  const ref = ctxMenu.value?.contextOf;
  if (!ref) return;
  dismissCtxMenu();
  fileViewers.openTranscript(ref.provider, ref.id);
}

async function openContextInCode(ref: { provider: string; id: string }): Promise<void> {
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(ref.provider)}/context/${encodeURIComponent(ref.id)}?materialize=1`,
    );
    const body = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !body.path) throw new Error(body.error ?? `${res.status}`);
    settings.openPath(body.path);
  } catch {
    /* editor open is best-effort */
  }
}

function ctxOpenContextInCode(): void {
  const ref = ctxMenu.value?.contextOf;
  if (!ref) return;
  dismissCtxMenu();
  void openContextInCode(ref);
}

function ctxDownloadContext(): void {
  const ref = ctxMenu.value?.contextOf;
  if (!ref) return;
  dismissCtxMenu();
  void downloadContext(ref);
}

async function referenceToWorkflow(ref: { provider: string; id: string }): Promise<void> {
  if (ctxRefBusy.value) return;
  ctxRefBusy.value = true;
  ctxRefNote.value = undefined;
  try {
    const { graphId } = await referenceContextToWorkflow(ref.provider, ref.id);
    await router.push(`/graph/${graphId}`);
  } catch (err) {
    ctxRefNote.value = err instanceof Error ? err.message : String(err);
  } finally {
    ctxRefBusy.value = false;
  }
}

async function referenceToLibrary(ref: { provider: string; id: string }): Promise<void> {
  if (ctxRefBusy.value) return;
  ctxRefBusy.value = true;
  ctxRefNote.value = undefined;
  try {
    const { hash } = await referenceContextToLibrary(ref.provider, ref.id);
    ctxRefNote.value = `saved · reference · ${hash.slice(0, 10)}… — Library or palette › library`;
  } catch (err) {
    ctxRefNote.value = err instanceof Error ? err.message : String(err);
  } finally {
    ctxRefBusy.value = false;
  }
}

function ctxReferenceToWorkflow(): void {
  const ref = ctxMenu.value?.contextOf;
  if (!ref) return;
  dismissCtxMenu();
  void referenceToWorkflow(ref);
}

function ctxReferenceToLibrary(): void {
  const ref = ctxMenu.value?.contextOf;
  if (!ref) return;
  dismissCtxMenu();
  void referenceToLibrary(ref);
}

function copyPath(p: string): void {
  void copyToClipboard(p);
}

function ctxDownloadReasoning(): void {
  const ref = ctxMenu.value?.reasoningOf;
  if (!ref) return;
  dismissCtxMenu();
  void downloadReasoning(ref);
}

function ctxOpenInvocations(): void {
  const d = detail.value;
  if (!d?.invocationsOf && !d?.calls?.length) return;
  openInvocations(d);
  dismissCtxMenu();
}

function ctxDownloadInvocations(): void {
  const ref = detail.value?.invocationsOf;
  if (!ref) return;
  dismissCtxMenu();
  void downloadInvocations(ref);
}

function ctxOpenPayload(): void {
  const ref = ctxMenu.value?.payloadOf;
  if (!ref) return;
  dismissCtxMenu();
  void openPayload(ref);
}

function ctxDownloadPayload(): void {
  const ref = ctxMenu.value?.payloadOf;
  if (!ref) return;
  dismissCtxMenu();
  void downloadPayload(ref);
}

// ---- detail panel content ----

const internals = computed(() => data.value?.internals);

const METRIC_HINTS: Record<string, string> = {
  "tokens in": "Fresh (non-cached) input tokens billed across the session. Cursor may estimate from transcript chars ÷ 4.",
  "tokens out": "Tokens the model generated, including thinking where applicable. Cursor may estimate from transcript chars ÷ 4.",
  reasoning: "Tokens spent on internal reasoning (opencode / Cursor CLI; Claude folds them into output). Cursor may estimate from thinking blocks as chars ÷ 4.",
  "cache read": "Input tokens served from the provider's prompt cache instead of being re-processed. Cursor: from agent CLI usage when available.",
  "cache write": "Tokens written into the prompt cache for reuse by later requests. Cursor: from agent CLI usage when available.",
  "cache hit": "Share of total input served from cache: reads ÷ (fresh + reads + writes). Higher = cheaper turns.",
  spend: "List-price dollar cost as recorded by the tool (opencode; Claude when computed from transcripts). Cursor has no list-price in public storage.",
  "actual spend": "What you really paid: $0 for subscription-billed Claude/Cursor; list price when using API keys.",
  "token source": "Where token counts came from: cli (agent result), turn_ended, or estimate (chars ÷ 4).",
  permission: "The session's permission mode; bypassPermissions means unrestricted tool use.",
  messages: "Messages in the session's active thread.",
  compactions: "Times the context was compacted — detected as a sudden large drop in context size.",
  thinking: "Internal reasoning blocks in the transcript, with a rough token estimate (chars ÷ 4).",
  "tool errors": "Tool calls that returned an error result.",
  duration: "Wall-clock time between the first and last message.",
  blocks: "Number of internal reasoning (thinking) blocks across the whole session.",
  "est tokens": "Rough reasoning token estimate: characters ÷ 4.",
  "share of replies": "How reasoning-heavy replies are on average.",
  content:
    "Some models (e.g. Claude Fable) strip thinking text from transcripts and keep only a cryptographic signature — the counts stay accurate but the text is unrecoverable.",
  project: "Working directory the session ran in.",
  model: "Model used (the last one, if the session switched).",
  agent: "Agent persona the session ran under.",
  status: "Live process status right now (running / waiting / idle).",
  branch: "Git branch the project was on.",
  updated: "Last activity in this session.",
};

const sparkPoints = computed(() => {
  const tl = internals.value?.timeline;
  if (!tl || tl.length < 2) return "";
  const peak = Math.max(...tl.map((t) => t.context), 1);
  return tl
    .map((t, i) => {
      const x = 2 + (96 * i) / (tl.length - 1);
      const y = 41 - (38 * t.context) / peak;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
});

const compactionTicks = computed(() => {
  const tl = internals.value?.timeline;
  if (!tl || tl.length < 2) return [];
  const ticks: number[] = [];
  for (let i = 1; i < tl.length; i++) {
    const prev = tl[i - 1]!.context;
    if (prev > 20_000 && tl[i]!.context < prev * 0.55) {
      ticks.push(2 + (96 * i) / (tl.length - 1));
    }
  }
  return ticks;
});

async function downloadBundle(): Promise<void> {
  await downloadUrl(
    `/api/sessions/${provider.value}/bundle/${sessionId.value}`,
    `threadle-bundle-${shortId(sessionId.value).replace("…", "")}.json`,
  );
}

const converting = ref(false);

/** Seed an editable workflow from this blueprint: session root + subagent children. */
async function convertToWorkflow(): Promise<void> {
  const d = data.value;
  if (!d?.ref || converting.value) return;
  converting.value = true;
  try {
    const id = await sessionsToWorkflow(
      `${d.ref.title?.slice(0, 40) ?? shortId(d.ref.id)} (from blueprint)`,
      [d.ref],
    );
    await router.push(`/graph/${id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    converting.value = false;
  }
}

async function downloadReasoning(ref: { provider: string; id: string }): Promise<void> {
  const res = await fetch(`/api/sessions/${ref.provider}/reasoning/${ref.id}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `threadle-reasoning-${shortId(ref.id).replace("…", "")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadContext(ref: { provider: string; id: string }): Promise<void> {
  const res = await fetch(`/api/sessions/${ref.provider}/context/${ref.id}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `threadle-context-${shortId(ref.id).replace("…", "")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDuration(ms?: number): string {
  if (!ms) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

function callTime(ts?: number): string {
  return ts ? new Date(ts).toLocaleTimeString(undefined, { hour12: false }) : "";
}

function formatInvocationsMarkdown(d: Detail): string {
  const lines: string[] = [
    `# ${d.kindLabel}: ${d.title}`,
    "",
    `${d.calls?.length ?? 0} invocation(s) shown` +
      (d.callsTruncated ? ` (+${d.callsTruncated} more not shown)` : ""),
    "",
  ];
  for (const [i, call] of (d.calls ?? []).entries()) {
    const when = call.ts
      ? new Date(call.ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
      : "—";
    lines.push(`## ${i + 1}. ${when}`);
    lines.push("");
    lines.push("```");
    lines.push((call.body ?? call.summary).trimEnd());
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

function openInvocations(d: Detail): void {
  const ref = d.invocationsOf;
  if (ref) {
    void fileViewers.openInvocations(ref.provider, ref.id, ref.kind, ref.name);
    return;
  }
  if (!d.calls?.length) return;
  const slug = d.title.replace(/[^\w.-]+/g, "_").slice(0, 48);
  const key = `invocations:${provider.value}:${sessionId.value}:${d.kindLabel}:${slug}`;
  fileViewers.openDocument({
    key,
    name: `invocations · ${d.kindLabel} · ${d.title}.md`,
    content: formatInvocationsMarkdown(d),
    format: "markdown",
  });
}

async function downloadInvocations(ref: {
  provider: string;
  id: string;
  kind: "tool" | "skill" | "reasoning";
  name: string;
}): Promise<void> {
  const qs = new URLSearchParams({ kind: ref.kind });
  if (ref.kind !== "reasoning") qs.set("name", ref.name);
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(ref.provider)}/invocations/${encodeURIComponent(ref.id)}?${qs}`,
  );
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = ref.name.replace(/[^\w.-]+/g, "_").slice(0, 48) || ref.kind;
  a.download = `threadle-invocations-${ref.kind}-${safe}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function openPayload(ref: { hash: string; name: string }): Promise<void> {
  await fileViewers.openPayload(ref);
}

async function downloadPayload(ref: { hash: string; name: string }): Promise<void> {
  const safe = ref.name.replace(/[^\w.-]+/g, "_").slice(0, 48) || "payload";
  await downloadUrl(
    `/api/payloads/${encodeURIComponent(ref.hash)}`,
    `payload-${safe}-${ref.hash.slice(0, 8)}.json`,
  );
}

function sessionRows(ref: SessionRef): Array<[string, string]> {
  const est = isTokenEstimate(ref.meta);
  const cacheTotal =
    (ref.tokensIn ?? 0) + (ref.tokensCacheRead ?? 0) + (ref.tokensCacheWrite ?? 0);
  const rows: Array<[string, string]> = [
    ["provider", ref.provider],
    ["id", shortId(ref.id)],
    ["project", ref.projectDir],
    ["model", ref.model ?? "—"],
    ["agent", ref.agent ?? "—"],
    ["status", ref.status],
    ["messages", String(ref.messageCount ?? "—")],
    ["tokens in", fmtTokens(ref.tokensIn, { estimate: est })],
    ["tokens out", fmtTokens(ref.tokensOut, { estimate: est })],
    ["reasoning", fmtTokens(ref.tokensReasoning, { estimate: est })],
    ["cache read", fmtTokens(ref.tokensCacheRead, { estimate: est })],
    ["cache write", fmtTokens(ref.tokensCacheWrite, { estimate: est })],
    [
      "cache hit",
      cacheTotal ? `${((100 * (ref.tokensCacheRead ?? 0)) / cacheTotal).toFixed(1)}%` : "—",
    ],
    ["spend", ref.cost !== undefined ? `$${ref.cost.toFixed(4)}` : "—"],
    [
      "actual spend",
      ref.actualCost === undefined
        ? "—"
        : ref.actualCost === 0 && (ref.cost ?? 0) > 0
          ? "$0 (subscription)"
          : `$${ref.actualCost.toFixed(4)}`,
    ],
    ["permission", typeof ref.meta?.permissionMode === "string" ? ref.meta.permissionMode : "default"],
    ["branch", typeof ref.meta?.gitBranch === "string" ? ref.meta.gitBranch : "—"],
    ["updated", relativeTime(ref.updatedAt)],
  ];
  const tokenSource = typeof ref.meta?.tokenSource === "string" ? ref.meta.tokenSource : undefined;
  if (tokenSource) {
    const idx = rows.findIndex(([k]) => k === "tokens out");
    rows.splice(idx + 1, 0, [
      "token source",
      tokenSource === "estimate" ? "estimate (chars/4)" : tokenSource,
    ]);
  }
  return rows;
}

interface Detail {
  kindLabel: string;
  contextOf?: { provider: string; id: string };
  reasoningOf?: { provider: string; id: string };
  invocationsOf?: {
    provider: string;
    id: string;
    kind: "tool" | "skill" | "reasoning";
    name: string;
  };
  /** Context payload (❝ extracted / injected) for floating viewer. */
  payloadOf?: { hash: string; name: string };
  /** True when the session has messages to open in the transcript viewer. */
  hasTranscript?: boolean;
  title: string;
  rows: Array<[string, string]>;
  hunks?: string[];
  calls?: Invocation[];
  callsTruncated?: number;
  openPath?: string;
  blueprintOf?: { provider: string; id: string };
  /** Jump to Agents → plugins focused on this pack (`provider:id`). */
  pluginsBrowse?: string;
}

function detailFor(id: string | undefined): Detail | undefined {
  const d = data.value;
  if (!id || !d) return undefined;

  if (id === "root" && d.ref) {
    return {
      kindLabel: "session",
      title: d.ref.title ?? shortId(d.ref.id),
      rows: sessionRows(d.ref),
      openPath: d.ref.projectDir,
      contextOf: { provider: d.ref.provider, id: d.ref.id },
      hasTranscript:
        (d.stats?.messages ?? d.ref.messageCount ?? 0) > 0 ||
        !!(
          d.ref.meta &&
          typeof d.ref.meta.transcriptPath === "string" &&
          d.ref.meta.transcriptPath
        ),
    };
  }
  if (id.startsWith("tool:")) {
    const name = id.slice(5);
    const tool = d.tools.find((t) => t.name === name);
    const total = d.tools.reduce((a, t) => a + t.count, 0);
    if (!tool) return undefined;
    return {
      kindLabel: "tool",
      title: tool.name,
      rows: [
        ["calls", String(tool.count)],
        ["share", total ? `${((100 * tool.count) / total).toFixed(1)}% of all calls` : "—"],
      ],
      calls: tool.calls,
      callsTruncated: Math.max(0, tool.count - tool.calls.length),
      invocationsOf: {
        provider: provider.value,
        id: sessionId.value,
        kind: "tool",
        name: tool.name,
      },
    };
  }
  if (id.startsWith("skill:")) {
    const name = id.slice(6);
    const skill = d.skills.find((s) => s.name === name);
    if (!skill) return undefined;
    return {
      kindLabel: "skill",
      title: skill.name,
      rows: [["invocations", String(skill.count)]],
      calls: skill.calls,
      callsTruncated: Math.max(0, skill.count - skill.calls.length),
      invocationsOf: {
        provider: provider.value,
        id: sessionId.value,
        kind: "skill",
        name: skill.name,
      },
    };
  }
  if (id === "reasoning" && d.reasoning) {
    const redacted = d.reasoning.count > 0 && d.reasoning.samples.length === 0;
    return {
      kindLabel: "reasoning",
      title: "internal reasoning",
      rows: [
        ["blocks", String(d.reasoning.count)],
        [
          "est tokens",
          d.reasoning.chars ? fmtTokens(Math.round(d.reasoning.chars / 4)) : "—",
        ],
        [
          "share of replies",
          d.stats.assistantTurns
            ? `${(d.reasoning.count / d.stats.assistantTurns).toFixed(2)} blocks per reply`
            : "—",
        ],
        [
          "content",
          redacted ? "redacted by the model (signature only)" : "recorded in transcript",
        ],
      ],
      calls: d.reasoning.samples,
      callsTruncated: redacted
        ? 0
        : Math.max(0, d.reasoning.count - d.reasoning.samples.length),
      reasoningOf: redacted
        ? undefined
        : { provider: provider.value, id: sessionId.value },
      invocationsOf: redacted
        ? undefined
        : {
            provider: provider.value,
            id: sessionId.value,
            kind: "reasoning",
            name: "reasoning",
          },
    };
  }
  if (id.startsWith("agent:") && !id.startsWith("agentfile:")) {
    const name = id.slice("agent:".length);
    return {
      kindLabel: "agent",
      title: name,
      rows: [
        ["role", "session agent"],
        ["provider", d.ref?.provider ?? provider.value],
        ["model", d.ref?.model?.split("/").pop() ?? "—"],
      ],
    };
  }
  if (id.startsWith("agentfile:")) {
    const agentPath = id.slice("agentfile:".length);
    const r = d.rulesFiles?.find((x) => x.path === agentPath);
    if (!r) return undefined;
    return {
      kindLabel: "agent definition",
      title: r.name,
      rows: [
        ["scope", r.scope === "global" ? "global (~)" : "this project"],
        ["source", r.source],
        ["path", r.path],
        ["size", `${r.size} B`],
        ["modified", relativeTime(r.mtime)],
        ["applies", "agent persona available in this scope"],
      ],
      openPath: r.path,
    };
  }
  if (id.startsWith("rule:") || id.startsWith("skillset:")) {
    const rulePath = id.slice(id.indexOf(":") + 1);
    const r = d.rulesFiles?.find((x) => x.path === rulePath);
    if (!r) return undefined;
    return {
      kindLabel: r.kind === "skill" ? "skillset (on disk)" : "rules file",
      title: r.name,
      rows: [
        ["scope", r.scope === "global" ? "global (~)" : "this project"],
        ["source", r.source],
        ["path", r.path],
        ["size", `${r.size} B`],
        ["modified", relativeTime(r.mtime)],
        [
          "applies",
          r.kind === "skill"
            ? "available to agents running in this scope"
            : "loaded as instructions for sessions in this scope",
        ],
      ],
      openPath: r.path,
    };
  }
  if (id.startsWith("plugin:")) {
    const key = id.slice("plugin:".length);
    const hit = matchedPlugins(d).find((p) => `${p.provider}:${p.id}` === key);
    if (!hit) return undefined;
    return {
      kindLabel: "plugin pack",
      title: hit.name,
      rows: [
        ["provider", hit.provider],
        ["version", hit.version ?? "—"],
        ["state", hit.state],
        ["origin", hit.origin.kind],
        ...(hit.origin.marketplaceId
          ? [["marketplace", hit.origin.marketplaceId] as [string, string]]
          : []),
        ["path", hit.origin.path],
        ["matched", hit.matched.join(", ")],
        [
          "children",
          hit.children.length
            ? hit.children.map((c) => `${c.kind}:${c.name}`).join(", ")
            : "—",
        ],
      ],
      openPath: hit.origin.path,
      pluginsBrowse: `${hit.provider}:${hit.id}`,
    };
  }
  if (id === "ctx:session" && d.ref) {
    const last = d.internals?.lastContext;
    const peak = d.internals?.peakContext;
    const est = !!d.internals?.contextEstimated;
    return {
      kindLabel: "session context",
      title: "session context",
      rows: [
        [
          "size",
          last != null
            ? fmtTokens(last, { estimate: est })
            : "—",
        ],
        ...(peak != null
          ? [["peak", fmtTokens(peak, { estimate: est })] as [string, string]]
          : []),
        ["source", "reconstructed from transcript"],
        [
          "note",
          "This is the live model context for the session — not a Library payload.",
        ],
      ],
      contextOf: { provider: d.ref.provider, id: d.ref.id },
      hasTranscript: true,
    };
  }
  if (id.startsWith("ctx:") || id.startsWith("ctxin:")) {
    const hash = id.slice(id.indexOf(":") + 1);
    const injected = id.startsWith("ctxin:");
    const cx = (injected ? d.contexts?.injected : d.contexts?.extracted)?.find(
      (c) => c.hash === hash,
    );
    if (!cx) return undefined;
    return {
      kindLabel: injected ? "context (injected into this session)" : "context (extracted from this session)",
      title: cx.preview || cx.kind,
      rows: [
        ["kind", cx.kind],
        ["size", `${cx.chars >= 1000 ? (cx.chars / 1000).toFixed(1) + "k" : cx.chars} chars`],
        ["created", relativeTime(cx.createdAt)],
        ["hash", `${cx.hash.slice(0, 16)}…`],
        [
          "direction",
          injected
            ? "flowed INTO this session from another session"
            : "captured FROM this session for reuse",
        ],
      ],
      payloadOf: {
        hash: cx.hash,
        name: (cx.preview || cx.kind).replace(/[^\w.-]+/g, "_").slice(0, 48) || "payload",
      },
    };
  }
  if (id.startsWith("sub:")) {
    const child = d.children.find((c) => `sub:${c.id}` === id);
    if (!child) return undefined;
    return {
      kindLabel: "subagent run",
      title: child.title ?? shortId(child.id),
      rows: sessionRows(child),
      blueprintOf: { provider: child.provider, id: child.id },
      contextOf: { provider: child.provider, id: child.id },
      // Always offer viewers for a real child session — messageCount /
      // tokensReasoning are missing on some providers even when data exists.
      hasTranscript: true,
      reasoningOf: { provider: child.provider, id: child.id },
      invocationsOf: {
        provider: child.provider,
        id: child.id,
        kind: "reasoning",
        name: "reasoning",
      },
    };
  }
  if (id.startsWith("file:")) {
    const path = id.slice(5);
    const f = d.files.find((x) => x.path === path);
    if (!f) return undefined;
    return {
      kindLabel: "file",
      title: f.path.split("/").pop() ?? f.path,
      rows: [
        ["path", f.path],
        ["operation", f.op],
        ["lines added", f.additions !== undefined ? `+${f.additions}` : "—"],
        ["lines removed", f.deletions !== undefined ? `−${f.deletions}` : "—"],
        ["bytes written", f.bytes !== undefined ? `${f.bytes}` : "—"],
        ["last touched", f.lastSeenAt ? relativeTime(f.lastSeenAt) : "—"],
      ],
      hunks: f.hunks,
      openPath: f.path,
    };
  }
  return undefined;
}

const detail = computed<Detail | undefined>(() => detailFor(selectedId.value));

watch(selectedId, () => {
  detailExpanded.value = false;
});

watch(
  () => {
    const d = detail.value;
    if (!d?.hasTranscript || !d.contextOf) return "";
    return `${d.contextOf.provider}:${d.contextOf.id}`;
  },
  (key) => {
    if (!key) {
      transcriptPreview.value = [];
      transcriptPreviewMore.value = 0;
      transcriptPreviewError.value = undefined;
      transcriptPreviewLoading.value = false;
      return;
    }
    const d = detail.value;
    if (!d?.contextOf) return;
    void loadTranscriptPreview(d.contextOf.provider, d.contextOf.id);
  },
  { immediate: true },
);
</script>

<style scoped>
.bp-page {
  height: 100%;
  min-height: 0;
  display: flex;
}
.bp-ctx {
  position: fixed;
  z-index: 60;
  min-width: 190px;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-strong);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.bp-ctx-title {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  padding: 5px 9px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 3px;
}
.bp-ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 6px 9px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text);
  cursor: pointer;
}
.bp-ctx-item:hover:not(:disabled) {
  background: var(--accent-soft);
}
.bp-ctx-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.bp-ctx-empty {
  padding: 8px 9px;
  font-size: var(--fs-xs);
  color: var(--text-faint);
  font-family: var(--mono);
}
.bp-layout {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bp-chrome {
  flex-shrink: 0;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.bp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px 20px;
  margin-bottom: 24px;
}
.bp-head-copy {
  flex: 1 1 22rem;
  min-width: 0;
}
.bp-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.bp-back {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: var(--fs-2xl);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}
.bp-back:hover {
  color: var(--text);
}
.bp-title {
  margin: 0;
  font-size: var(--fs-title);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.bp-crumb {
  background: none;
  border: none;
  color: var(--text-faint);
  font-size: var(--fs-xs);
  cursor: pointer;
  padding: 0;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}
.bp-crumb:hover {
  color: var(--text);
}
.bp-crumb-sep {
  color: var(--text-faint);
  font-size: var(--fs-xs);
  flex-shrink: 0;
}
.bp-subbadge {
  font-size: var(--fs-2xs);
  color: var(--lane-session);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 6px;
  flex-shrink: 0;
}
.bp-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}
.bp-search {
  width: 240px;
  height: 30px;
  padding: 4px 10px;
  font-size: var(--fs-sm);
}
.bp-toolbar {
  padding-bottom: 16px;
}
.bp-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.bp-canvas {
  flex: 1;
  min-width: 0;
  position: relative;
  background: var(--canvas-bg);
}

.bp-detail {
  position: relative;
  flex-shrink: 0;
  background: var(--panel-bg);
  border-left: 1px solid var(--border);
  padding: 14px 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bp-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bp-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-md);
}
.bp-close:hover {
  color: var(--text);
}
.bp-detail-title {
  font-size: var(--fs-lg);
  font-weight: 600;
  word-break: break-word;
}
.meta-kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 5px 14px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.meta-kv > span:nth-child(odd) {
  color: var(--text-faint);
}
.meta-kv > span:nth-child(even) {
  white-space: normal;
  word-break: break-word;
}
.bp-hunks-label {
  padding-bottom: 6px;
}
.bp-est {
  margin-left: 6px;
  color: var(--text-faint);
  font-weight: 400;
}
.bp-internals {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.bp-spark {
  width: 100%;
  height: 46px;
  display: block;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.bp-spark-line {
  fill: none;
  stroke: var(--lane-session);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
}
.bp-spark-compact {
  stroke: var(--status-waiting);
  stroke-width: 1;
  stroke-dasharray: 2 3;
  vector-effect: non-scaling-stroke;
}
.bp-spark-labels {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.bp-call-list {
  max-height: 340px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
}
.bp-call {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.bp-call-time {
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  flex-shrink: 0;
  min-width: 4.5em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.bp-call-text {
  color: var(--text-dim);
  word-break: break-word;
  min-width: 0;
}
.bp-call-more {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  font-style: italic;
  padding-top: 4px;
}
.bp-hunk-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.bp-detail-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.bp-ref-note {
  color: var(--text-dim);
  line-height: 1.4;
  word-break: break-word;
}

.bp-node {
  position: relative;
  min-width: 190px;
  max-width: 280px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 9px 12px;
  cursor: pointer;
  transition: border-color 0.12s;
}
.bp-node.picked {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.bp-node.missing {
  opacity: 0.48;
  filter: grayscale(0.7);
}
.bp-missing-tag {
  position: absolute;
  right: 8px;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--status-error) 45%, var(--border));
  color: var(--status-error);
  background: color-mix(in srgb, var(--status-error) 10%, var(--panel-bg));
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: var(--fs-2xs);
  line-height: 1.3;
  pointer-events: none;
}
.bp-missing-note {
  width: 100%;
  margin: 0 0 4px;
  color: var(--status-error);
}
.bp-btn-missing {
  opacity: 0.55;
}
.bp-node.root {
  border-color: var(--border-strong);
  min-width: 240px;
}
.bp-node-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.bp-glyph {
  font-family: var(--mono);
  color: var(--text-dim);
  flex-shrink: 0;
}
.bp-node.root .bp-glyph {
  color: var(--claude);
}
.bp-node.agent .bp-glyph,
.bp-node.agentfile .bp-glyph {
  color: var(--wire-agent-def);
}
.bp-node.subagent .bp-glyph {
  color: var(--lane-session);
}
.bp-node.skill .bp-glyph {
  color: var(--accent);
}
.bp-node.reasoning .bp-glyph {
  color: var(--status-waiting);
}
.bp-node.context .bp-glyph {
  color: var(--context);
}
.bp-node.rulefile .bp-glyph {
  color: var(--lane-session);
}
.bp-node.skillset .bp-glyph {
  color: var(--accent);
}
.bp-node[class*="file-"] .bp-glyph {
  color: var(--context);
}
.bp-node.file-more {
  border-style: dashed;
  background: transparent;
}
.bp-node.file-more .bp-name {
  color: var(--text-dim);
}
.bp-name {
  font-size: var(--fs-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bp-badge {
  margin-left: auto;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 6px;
  flex-shrink: 0;
}
.bp-node.file-write .bp-badge,
.bp-node.file-create .bp-badge {
  color: var(--status-running);
}
.bp-node.file-edit .bp-badge,
.bp-node.file-patch .bp-badge {
  color: var(--status-waiting);
}
.bp-node-sub {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.bp-node-sub2 {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  margin-top: 2px;
}
.kv-key[title] {
  cursor: help;
  text-decoration: underline dotted var(--text-faint);
  text-underline-offset: 2px;
}
.bp-handle {
  width: 7px;
  height: 7px;
  background: var(--node-bg);
  border: 2px solid var(--border-strong);
}
</style>

<style>
.bp-edge-tool .vue-flow__edge-path {
  stroke: var(--edge);
  stroke-width: 1.5;
}
.bp-edge-file .vue-flow__edge-path {
  stroke: rgba(207, 169, 60, 0.4);
  stroke-width: 1.5;
}
.bp-edge-rule .vue-flow__edge-path {
  stroke: rgba(95, 159, 232, 0.35);
  stroke-width: 1.5;
  stroke-dasharray: 2 4;
}
.bp-edge-agent .vue-flow__edge-path {
  stroke: color-mix(in srgb, var(--wire-agent-def) 45%, transparent);
  stroke-width: 1.5;
  stroke-dasharray: 3 4;
}
.bp-edge-ctx .vue-flow__edge-path {
  stroke: rgba(207, 169, 60, 0.55);
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
}
</style>
