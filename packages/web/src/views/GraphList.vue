<template>
  <div class="dash">
    <DashNav :items="navItems" :active="view" @select="onNav" />

    <div class="dash-col">
    <main class="dash-main">
      <!-- ============ workflows ============ -->
      <template v-if="view === 'workflows'">
        <div class="wf-chrome">
          <header class="dash-head">
            <div>
              <h1 class="dash-title">Workflows</h1>
            </div>
            <div class="view-controls">
              <button class="threadle-btn" @click="importPicker?.click()">
                <span class="btn-glyph">↑</span> Import
              </button>
              <button
                class="threadle-btn"
                title="Download threadle config backup (graphs, payloads, nodes, settings)"
                :disabled="backupBusy"
                @click="downloadBackup"
              >
                <template v-if="backupBusy">…</template>
                <template v-else><span class="btn-glyph">↓</span> Backup</template>
              </button>
              <button
                class="threadle-btn"
                title="Open blank canvas"
                @click="openCanvas"
              >
                <span class="btn-glyph">⌗</span> Canvas
              </button>
              <button class="threadle-btn primary" @click="createGraph">
                <span class="btn-glyph">+</span> New
              </button>
              <input
                ref="importPicker"
                type="file"
                accept="application/json,.json"
                class="import-input"
                hidden
                @change="onImportFile"
              />
            </div>
          </header>

          <div
            v-if="userSortedGraphs.length || loading || folderIndex.folders.length || settings.showExamples"
            class="wf-toolbar"
          >
            <input
              v-model="wfTextFilter"
              class="threadle-input dash-search"
              placeholder="Filter workflows…"
              spellcheck="false"
            />
            <div class="chip-row">
              <button
                class="filter-chip"
                :class="{ active: wfKindFilter === 'all' }"
                @click="wfKindFilter = 'all'"
              >
                all{{ userSortedGraphs.length ? ` · ${userSortedGraphs.length}` : "" }}
              </button>
              <button
                class="filter-chip"
                :class="{ active: wfKindFilter === 'workflow' }"
                @click="wfKindFilter = 'workflow'"
              >
                workflows{{ workflowGraphs.length ? ` · ${workflowGraphs.length}` : "" }}
              </button>
              <button
                class="filter-chip"
                :class="{ active: wfKindFilter === 'subgraph' }"
                @click="wfKindFilter = 'subgraph'"
              >
                subgraphs{{ subgraphGraphs.length ? ` · ${subgraphGraphs.length}` : "" }}
              </button>
              <button
                v-if="settings.showExamples"
                class="filter-chip"
                :class="{ active: wfKindFilter === 'examples' }"
                @click="wfKindFilter = 'examples'"
              >
                examples{{ examplesTabCount ? ` · ${examplesTabCount}` : "" }}
              </button>
            </div>
            <div v-if="wfKindFilter !== 'examples'" class="wf-toolbar-actions">
              <button class="threadle-btn" title="New folder" @click="createWorkflowFolder()">
                <FolderMark class="btn-folder-mark" /> Folder
              </button>
              <button class="threadle-btn" @click="createSubgraph">+ Subgraph</button>
            </div>
          </div>
        </div>

        <div class="dash-load-host">
          <GraphLoadingOverlay
            :loading="wfHydrating"
            label="Loading workflows"
          />
          <template v-if="!wfHydrating">
        <div
          v-if="
            (wfKindFilter !== 'examples' &&
              (filteredGraphs.length ||
                wfTextHasFolderHits ||
                (!wfTextFilter.trim() && folderIndex.folders.length))) ||
            (wfKindFilter === 'examples' && (filteredGraphs.length || wfTextHasFolderHits))
          "
          class="wf-table"
          v-col-resize="'wf'"
          data-cols="minmax(0,1fr) minmax(6rem, 9rem) 5.5rem 4rem 3.5rem 6.5rem 2rem"
          @dragover.prevent="onWfRootDragOver"
          @dragleave="onWfRootDragLeave"
          @drop.prevent="onWfRootDrop"
          :class="{ 'wf-drop-over': wfDropTarget === 'root' }"
        >
          <div class="wf-cols micro-label">
            <span class="th" @click="sortBy('wf', 'name')">name{{ arrow('wf', 'name') }}</span>
            <span class="th" @click="sortBy('wf', 'id')">id{{ arrow('wf', 'id') }}</span>
            <span class="th">kind</span>
            <span class="th num" @click="sortBy('wf', 'nodes')">nodes{{ arrow('wf', 'nodes') }}</span>
            <span class="th num" title="How many workflows embed this subgraph">used</span>
            <span class="th num" @click="sortBy('wf', 'updated')">updated{{ arrow('wf', 'updated') }}</span>
            <span class="th" />
          </div>

          <template v-for="row in wfTreeRows" :key="row.key">
            <!-- folder row -->
            <div
              v-if="row.kind === 'folder'"
              class="wf-row wf-folder-row"
              :class="{
                pinned:
                  openMenu === folderMenuKey(row.folder.id) ||
                  wfFolderCtx?.id === row.folder.id,
                'wf-drop-over': wfDropTarget === row.folder.id,
              }"
              :style="{ '--wf-depth': row.depth }"
              draggable="true"
              @dragstart="onFolderDragStart($event, row.folder.id)"
              @dragend="onWfDragEnd"
              @dragover.prevent="onFolderDragOver($event, row.folder.id)"
              @dragleave="onFolderDragLeave(row.folder.id)"
              @drop.prevent="onFolderDrop($event, row.folder.id)"
              @contextmenu.capture.prevent.stop="openFolderCtxMenu($event, row.folder)"
              @mousedown.capture="onFolderRowMouseDown($event, row.folder)"
            >
              <button
                type="button"
                class="wf-folder-name"
                @click="createGraphInFolder(row.folder.id)"
              >
                <span
                  class="wf-folder-caret"
                  @click.stop="toggleFolderCollapsed(row.folder.id)"
                >{{ collapsedFolders.has(row.folder.id) ? "▸" : "▾" }}</span>
                <FolderMark :open="!collapsedFolders.has(row.folder.id)" />
                <span class="wf-folder-label">{{ row.folder.name }}</span>
                <span class="wf-folder-count mono">{{ row.graphCount }}</span>
              </button>
              <span class="wf-id mono" />
              <span class="wf-kind mono">folder</span>
              <span class="wf-meta" />
              <span class="wf-meta" />
              <span class="wf-meta" />
              <div
                class="row-actions wf-row-actions"
                :class="{ pinned: openMenu === folderMenuKey(row.folder.id) }"
                @click.stop
                @mousedown.stop
              >
                <div class="row-menu">
                  <button
                    class="row-act menu-btn"
                    :class="{ open: openMenu === folderMenuKey(row.folder.id) }"
                    title="More actions"
                    @click="toggleFolderMenu(row.folder.id)"
                  >
                    ⋯
                  </button>
                  <div v-if="openMenu === folderMenuKey(row.folder.id)" class="menu-pop">
                    <button
                      class="menu-item"
                      @click="menuAction(() => createGraphInFolder(row.folder.id))"
                    >
                      <span class="menu-glyph">+</span> New workflow
                    </button>
                    <button
                      class="menu-item"
                      @click="menuAction(() => createWorkflowFolder(row.folder.id))"
                    >
                      <span class="menu-glyph"><FolderMark /></span> New subfolder
                    </button>
                    <button
                      class="menu-item"
                      @click="menuAction(() => renameWorkflowFolder(row.folder.id, row.folder.name))"
                    >
                      <span class="menu-glyph">✎</span> Rename
                    </button>
                    <button
                      class="menu-item menu-danger"
                      @click="menuAction(() => removeWorkflowFolder(row.folder.id))"
                    >
                      <span class="menu-glyph">⌫</span> Delete folder
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- graph row -->
            <div
              v-else
              class="wf-row"
              :class="{
                pinned:
                  openMenu === graphMenuKey(row.graph.id) ||
                  wfGraphCtx?.id === row.graph.id,
              }"
              :style="{ '--wf-depth': row.depth }"
              draggable="true"
              @dragstart="onGraphDragStart($event, row.graph.id)"
              @dragend="onWfDragEnd"
              @contextmenu.prevent.stop="openGraphCtxMenu($event, row.graph)"
              @mousedown.capture="onGraphRowMouseDown($event, row.graph)"
            >
              <router-link
                :to="`/graph/${row.graph.id}`"
                class="wf-name"
              >
                {{ row.graph.name }}
              </router-link>
              <span class="wf-id mono" :title="row.graph.id">{{ row.graph.id }}</span>
              <span
                class="wf-kind mono"
                :class="row.graph.kind === 'subgraph' ? 'sub' : 'wf'"
              >
                {{ row.graph.kind === "subgraph" ? "subgraph" : "workflow" }}
              </span>
              <span
                v-if="row.graph.unconfirmedImport"
                class="wf-kind mono unconfirmed"
                title="Imported JSON — review what it executes on first ▶"
              >
                ⚠ imported
              </span>
              <span class="wf-meta">{{ row.graph.nodeCount }}</span>
              <span class="wf-meta">{{
                row.graph.kind === "subgraph" ? (row.graph.usedBy ?? 0) : "—"
              }}</span>
              <span class="wf-meta">{{ relativeTime(row.graph.updatedAt) }}</span>
              <div
                class="row-actions wf-row-actions"
                :class="{ pinned: openMenu === graphMenuKey(row.graph.id) }"
                @click.stop
                @mousedown.stop
              >
                <div class="row-menu">
                  <button
                    class="row-act menu-btn"
                    :class="{ open: openMenu === graphMenuKey(row.graph.id) }"
                    title="More actions"
                    @click="toggleGraphMenu(row.graph.id)"
                  >
                    ⋯
                  </button>
                  <div v-if="openMenu === graphMenuKey(row.graph.id)" class="menu-pop">
                    <button
                      class="menu-item"
                      @click="menuAction(() => openGraph(row.graph.id))"
                    >
                      <span class="menu-glyph">↗</span> Open
                    </button>
                    <button
                      class="menu-item"
                      @click="menuAction(() => runGraph(row.graph.id))"
                    >
                      <span class="menu-glyph">▶</span> Run
                    </button>
                    <button
                      class="menu-item"
                      @click="menuAction(() => duplicateGraph(row.graph.id))"
                    >
                      <span class="menu-glyph">⊕</span> Duplicate
                    </button>
                    <button
                      v-if="row.graph.kind !== 'subgraph'"
                      class="menu-item"
                      @click="menuAction(() => setKind(row.graph.id, 'subgraph'))"
                    >
                      <span class="menu-glyph">⌗</span> Mark as subgraph
                    </button>
                    <button
                      v-else
                      class="menu-item"
                      @click="menuAction(() => setKind(row.graph.id, 'workflow'))"
                    >
                      <span class="menu-glyph">#</span> Mark as workflow
                    </button>
                    <button
                      v-if="folderIndex.folders.length && folderIndex.placements[row.graph.id]"
                      class="menu-item"
                      @click="menuAction(() => placeGraphRoot(row.graph.id))"
                    >
                      <span class="menu-glyph">↑</span> Move to root
                    </button>
                    <button
                      class="menu-item"
                      @click="menuAction(() => toggleGraphFavorite(row.graph))"
                    >
                      <span class="menu-glyph">{{
                        isGraphFavorite(row.graph) ? "☆" : "★"
                      }}</span>
                      {{
                        isGraphFavorite(row.graph)
                          ? "Remove from favorites"
                          : "Add to favorites"
                      }}
                    </button>
                    <button
                      class="menu-item menu-danger"
                      @click="menuAction(() => removeGraph(row.graph.id))"
                    >
                      <span class="menu-glyph">⌫</span> Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div
          v-if="
            !loading &&
            !filteredGraphs.length &&
            !wfTextHasFolderHits &&
            (wfKindFilter === 'examples' ||
              !!wfTextFilter.trim() ||
              !folderIndex.folders.length)
          "
          class="empty-state"
        >
          <div class="empty-mark">#</div>
          <p class="empty-title">
            {{
              wfTextFilter.trim()
                ? "No matches"
                : wfKindFilter === "subgraph"
                  ? "No subgraphs yet"
                  : wfKindFilter === "examples"
                    ? "No examples"
                    : wfKindFilter === "workflow"
                      ? "No workflows yet"
                      : "No workflows yet"
            }}
          </p>
          <p class="empty-sub">
            {{
              wfTextFilter.trim()
                ? "Nothing matches this filter."
                : wfKindFilter === "subgraph"
                  ? "Extract a selection on the canvas, or create an empty subgraph."
                  : wfKindFilter === "examples"
                    ? "Enable examples in Settings, or none are available."
                    : "Create a workflow and start wiring agents together."
            }}
          </p>
          <button
            v-if="wfTextFilter.trim()"
            class="threadle-btn"
            @click="wfTextFilter = ''"
          >
            Clear filter
          </button>
          <button
            v-else-if="wfKindFilter === 'subgraph'"
            class="threadle-btn primary"
            @click="createSubgraph"
          >
            Create subgraph
          </button>
          <button
            v-else-if="wfKindFilter !== 'examples'"
            class="threadle-btn primary"
            @click="createGraph"
          >
            Create workflow
          </button>
        </div>

        <Teleport to="body">
          <div
            v-if="wfFolderCtx"
            class="menu-pop wf-folder-ctx"
            :style="{ left: wfFolderCtx.x + 'px', top: wfFolderCtx.y + 'px' }"
            @click.stop
            @contextmenu.prevent
          >
            <button
              class="menu-item"
              @click="menuAction(() => createGraphInFolder(wfFolderCtx!.id))"
            >
              <span class="menu-glyph">+</span> New workflow
            </button>
            <button
              class="menu-item"
              @click="menuAction(() => createWorkflowFolder(wfFolderCtx!.id))"
            >
              <span class="menu-glyph"><FolderMark /></span> New subfolder
            </button>
            <button
              class="menu-item"
              @click="menuAction(() => renameWorkflowFolder(wfFolderCtx!.id, wfFolderCtx!.name))"
            >
              <span class="menu-glyph">✎</span> Rename
            </button>
            <button
              class="menu-item menu-danger"
              @click="menuAction(() => removeWorkflowFolder(wfFolderCtx!.id))"
            >
              <span class="menu-glyph">⌫</span> Delete folder
            </button>
          </div>
        </Teleport>

        <Teleport to="body">
          <div
            v-if="wfGraphCtx"
            class="menu-pop wf-folder-ctx"
            :style="{ left: wfGraphCtx.x + 'px', top: wfGraphCtx.y + 'px' }"
            @click.stop
            @contextmenu.prevent
          >
            <button class="menu-item" @click="menuAction(() => openGraph(wfGraphCtx!.id))">
              <span class="menu-glyph">↗</span> Open
            </button>
            <button class="menu-item" @click="menuAction(() => runGraph(wfGraphCtx!.id))">
              <span class="menu-glyph">▶</span> Run
            </button>
            <button class="menu-item" @click="menuAction(() => duplicateGraph(wfGraphCtx!.id))">
              <span class="menu-glyph">⊕</span> Duplicate
            </button>
            <button
              v-if="wfGraphCtx.kind !== 'subgraph'"
              class="menu-item"
              @click="menuAction(() => setKind(wfGraphCtx!.id, 'subgraph'))"
            >
              <span class="menu-glyph">⌗</span> Mark as subgraph
            </button>
            <button
              v-else
              class="menu-item"
              @click="menuAction(() => setKind(wfGraphCtx!.id, 'workflow'))"
            >
              <span class="menu-glyph">#</span> Mark as workflow
            </button>
            <button
              class="menu-item"
              @click="
                menuAction(() =>
                  toggleGraphFavorite({
                    id: wfGraphCtx!.id,
                    name: wfGraphCtx!.name,
                  }),
                )
              "
            >
              <span class="menu-glyph">{{
                isGraphFavorite({ id: wfGraphCtx!.id }) ? "☆" : "★"
              }}</span>
              {{
                isGraphFavorite({ id: wfGraphCtx!.id })
                  ? "Remove from favorites"
                  : "Add to favorites"
              }}
            </button>
            <button
              class="menu-item menu-danger"
              @click="menuAction(() => removeGraph(wfGraphCtx!.id))"
            >
              <span class="menu-glyph">⌫</span> Delete
            </button>
          </div>
        </Teleport>

        <Teleport to="body">
          <div
            v-if="folderNameDialog"
            class="wf-name-backdrop"
            @click.self="closeFolderNameDialog"
            @keydown.esc="closeFolderNameDialog"
          >
            <div class="wf-name-modal" role="dialog" aria-modal="true" @keydown.stop>
              <header class="wf-name-head">
                <div class="wf-name-title mono">
                  <template v-if="folderNameDialog.mode === 'rename'">✎ rename folder</template>
                  <template v-else><FolderMark class="dlg-folder-mark" /> new folder</template>
                </div>
                <button class="wf-name-close" title="Close" @click="closeFolderNameDialog">✕</button>
              </header>
              <div class="wf-name-body">
                <label class="wf-name-field">
                  <span class="micro-label">name</span>
                  <input
                    ref="folderNameInput"
                    v-model="folderNameDialog.name"
                    class="threadle-input mono"
                    spellcheck="false"
                    maxlength="120"
                    placeholder="folder name"
                    @keydown.enter.prevent="submitFolderNameDialog"
                  />
                </label>
                <p v-if="folderNameError" class="wf-name-error">{{ folderNameError }}</p>
              </div>
              <footer class="wf-name-foot">
                <button class="threadle-btn" @click="closeFolderNameDialog">Cancel</button>
                <button
                  class="threadle-btn primary"
                  :disabled="folderNameBusy"
                  @click="submitFolderNameDialog"
                >
                  {{
                    folderNameBusy
                      ? "…"
                      : folderNameDialog.mode === "rename"
                        ? "Rename"
                        : "Create"
                  }}
                </button>
              </footer>
            </div>
          </div>
        </Teleport>

        <Teleport to="body">
          <div
            v-if="folderDeleteDialog"
            class="wf-name-backdrop"
            @click.self="closeFolderDeleteDialog"
            @keydown.esc="closeFolderDeleteDialog"
          >
            <div class="wf-name-modal" role="dialog" aria-modal="true" @keydown.stop>
              <header class="wf-name-head">
                <div class="wf-name-title mono">⌫ delete folder</div>
                <button class="wf-name-close" title="Close" @click="closeFolderDeleteDialog">✕</button>
              </header>
              <div class="wf-name-body">
                <p class="wf-name-copy">
                  Delete <span class="mono">{{ folderDeleteDialog.name }}</span>?
                  Workflows and subfolders move to the parent (or root). Graphs are not deleted.
                </p>
                <p v-if="folderDeleteError" class="wf-name-error">{{ folderDeleteError }}</p>
              </div>
              <footer class="wf-name-foot">
                <button class="threadle-btn" :disabled="folderDeleteBusy" @click="closeFolderDeleteDialog">
                  Cancel
                </button>
                <button
                  class="threadle-btn danger"
                  :disabled="folderDeleteBusy"
                  @click="confirmFolderDelete"
                >
                  {{ folderDeleteBusy ? "…" : "Delete folder" }}
                </button>
              </footer>
            </div>
          </div>
        </Teleport>

        <template v-if="settings.showExamples && wfKindFilter === 'examples'">
        <section class="wf-examples">
          <div class="wf-examples-head">
            <div class="micro-label">recipes</div>
            <p class="wf-examples-sub">
              Clone a job — fill the contract (model / --dir / session slot), then ▶.
            </p>
          </div>
          <div
            class="ex-table"
            data-cols="minmax(0, 1.2fr) minmax(0, 1.6fr) minmax(7rem, 11rem) minmax(5rem, 8rem) 4rem"
          >
            <div class="ex-cols micro-label">
              <span class="th">name</span>
              <span class="th">outcome</span>
              <span class="th" title="What you must supply before ▶ succeeds">you supply</span>
              <span class="th" title="Catalog / CLI id — threadle run &lt;id&gt;">recipe id</span>
              <span class="th ex-th-act" />
            </div>
            <div v-for="r in workflowRecipes" :key="r.id" class="ex-row">
              <div class="ex-name-cell" :title="r.note ?? r.outcome">
                <span class="ex-name">{{ recipeTitle(r.name) }}</span>
                <span v-if="r.note" class="ex-desc">{{ r.note }}</span>
              </div>
              <span class="ex-desc" :title="r.outcome">{{ r.outcome }}</span>
              <span class="ex-teaches mono" :title="recipeNeedsLabel(r)">{{ recipeNeedsLabel(r) }}</span>
              <span class="ex-id mono" :title="r.id">{{ r.id }}</span>
              <div class="ex-act">
                <button
                  type="button"
                  class="vsc-btn"
                  :disabled="recipeBusy === r.id"
                  @click.stop="useRecipe(r.id)"
                >
                  {{ recipeBusy === r.id ? "…" : "use" }}
                </button>
              </div>
            </div>
            <p v-if="!workflowRecipes.length && !recipesLoading" class="stat-note ex-empty">
              no bundled recipes
            </p>
          </div>
          <p class="ex-footnote mono">
            Recipe ids work with <span class="mono">threadle run &lt;id&gt;</span>. Teaching graphs are below.
          </p>
        </section>

        <section class="wf-examples">
          <div class="wf-examples-head">
            <div class="micro-label">examples</div>
            <p class="wf-examples-sub">
              Clone a canned graph — beginner wiring through expert parallelism / merge / circuit breaker.
            </p>
          </div>
          <div
            class="ex-table"
            data-cols="7.5rem minmax(0, 1.4fr) minmax(8rem, 13rem) minmax(0, 1fr) 4rem"
          >
            <div class="ex-cols micro-label">
              <span class="th ex-th-level">level</span>
              <span class="th">name</span>
              <span class="th" title="Catalog / CLI id — threadle run &lt;id&gt;. Cloning creates a new graph with its own id.">template id</span>
              <span class="th">teaches</span>
              <span class="th ex-th-act" />
            </div>
            <div v-for="t in workflowExamples" :key="t.id" class="ex-row">
              <span class="ex-level mono" :data-level="t.level">{{ t.level }}</span>
              <div class="ex-name-cell" :title="t.description">
                <span class="ex-name">{{ exampleTitle(t.name) }}</span>
                <span class="ex-desc">{{ t.description }}</span>
              </div>
              <span class="ex-id mono" :title="t.id">{{ t.id }}</span>
              <span class="ex-teaches mono" :title="(t.teaches ?? []).join(' · ')">
                {{ (t.teaches ?? []).join(" · ") || "—" }}
              </span>
              <div class="ex-act">
                <button
                  type="button"
                  class="vsc-btn"
                  :disabled="exampleBusy === t.id"
                  @click.stop="useExample(t.id)"
                >
                  {{ exampleBusy === t.id ? "…" : "use" }}
                </button>
              </div>
            </div>
            <p v-if="!workflowExamples.length && !examplesLoading" class="stat-note ex-empty">
              no bundled examples
            </p>
          </div>
          <p class="ex-footnote mono">
            Template ids work with <span class="mono">threadle run &lt;id&gt;</span> (cloning creates a new graph id). Hide in Settings → Examples.
          </p>
        </section>
        </template>
          </template>
        </div>
      </template>

      <!-- ============ runs / executions ============ -->
      <RunsView
        v-else-if="view === 'runs'"
        :graphs="graphs"
        @open-session="onOpenSession"
        @running-count="onRunsRunningCount"
      />


      <!-- ============ sessions + subagent viewer ============ -->
      <SessionsView
        v-else-if="view === 'sessions'"
        v-model:provider-filter="providerFilter"
        v-model:open-request="sessionOpenRequest"
        @nav="onNav"
        @handoff="onHandoff"
      />

      <!-- ============ rules ============ -->
      <RulesView
        v-else-if="view === 'rules'"
        :rule-groups="ruleGroups"
        :focus="rulesFocus"
        @reload="reloadRuleGroups"
      />

      <!-- ============ skills ============ -->
      <SkillsView
        v-else-if="view === 'skills'"
        :rule-groups="ruleGroups"
        :focus="skillFocus"
        @reload="reloadRuleGroups"
      />

      <!-- ============ services ============ -->
      <ServicesView
        v-else-if="view === 'services'"
        :providers="providers"
        @nav="onNav"
        @set-provider-filter="onSetProviderFilter"
      />

      <!-- ============ meta ============ -->
      <MetaView
        v-else-if="view === 'meta'"
        :graphs="graphs"
        :rule-groups="ruleGroups"
        @nav="onNav"
      />

      <!-- ============ security ============ -->
      <SecurityView v-else-if="view === 'security'" />

      <!-- ============ files ============ -->
      <FilesView v-else-if="view === 'files'" />

      <!-- ============ file activity per session ============ -->
      <ActivityView v-else-if="view === 'activity'" />

      <!-- ============ settings ============ -->
      <SettingsView v-else-if="view === 'settings'" />

      <!-- ============ combined run logs ============ -->
      <LogsView v-else-if="view === 'logs'" />


      <!-- ============ usage / statistics ============ -->
      <UsageView v-else-if="view === 'usage'" />

      <!-- ============ full-text search ============ -->
      <SearchView v-else-if="view === 'search'" />

      <!-- ============ payload library ============ -->
      <LibraryView
        v-else-if="view === 'library'"
        @nav="onNav"
        @open-session="onOpenSession"
      />

      <!-- ============ favorites jump list ============ -->
      <FavoritesView
        v-else-if="view === 'favorites'"
        @open-session="onFavoriteSession"
      />


      <!-- ============ agents ============ -->
      <AgentsView
        v-else-if="view === 'agents'"
        :focus="agentFocus"
        :browse="agentBrowseFocus"
        @nav="onNav"
        @open-session="onOpenSession"
      />

      <HandoffModal
        v-if="handoffSource"
        :source="{
          provider: handoffSource.provider,
          sessionId: handoffSource.id,
          title: handoffSource.title,
          projectDir: handoffSource.projectDir,
        }"
        @close="handoffSource = undefined"
        @open-session="openHandoffResult"
      />
    </main>
    <StatusBar />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  Graph,
  GraphEdge,
  GraphNode,
  GraphSummary,
  ProviderInfo,
  SessionRef,
  WorkflowFolder,
  WorkflowFolderIndex,
} from "@threadle/shared";
import {
  emptyWorkflowFolderIndex,
  folderPathNames,
  validatePortableGraphJsonText,
} from "@threadle/shared";
import { writePendingFolders } from "@/lib/pendingFolders";
import { api, subscribeEvents } from "@/api/client";
import { relativeTime } from "@/lib/format";
import { type SessionFilter } from "@/lib/providers";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useFavoritesStore } from "@/stores/favorites";
import { nextWorkflowName } from "@/lib/workflowName";
import { vColResize } from "@/lib/colResize";
import HandoffModal from "@/panels/HandoffModal.vue";
import StatusBar from "@/panels/StatusBar.vue";
import DashNav from "@/panels/DashNav.vue";
import FolderMark from "@/panels/FolderMark.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import { useNavItems } from "@/panels/useNavItems";
import {
  ServicesView,
  SecurityView,
  FilesView,
  LogsView,
  ActivityView,
  MetaView,
  LibraryView,
  SearchView,
  RulesView,
  SkillsView,
  RunsView,
  SettingsView,
  SessionsView,
  UsageView,
  AgentsView,
  FavoritesView,
} from "@/views/dashboard";
import "./dashboard/chrome.css";

const router = useRouter();
const sessions = useSessionsStore();
const settings = useSettingsStore();
const favorites = useFavoritesStore();
void settings.load();
void favorites.ensureLoaded();

function graphFavoriteInput(g: { id: string; name?: string }) {
  return {
    kind: "workflow" as const,
    graphId: g.id,
    label: g.name,
  };
}
function isGraphFavorite(g: { id: string }): boolean {
  return favorites.isFavorite(graphFavoriteInput(g));
}
function toggleGraphFavorite(g: { id: string; name?: string }): void {
  void favorites.toggle(graphFavoriteInput(g));
}

const graphs = ref<GraphSummary[]>([]);
const runsRunningCount = ref<number | "">("");
function onRunsRunningCount(n: number | ""): void {
  runsRunningCount.value = n;
}
async function refreshRunsRunningCount(): Promise<void> {
  try {
    const jobs = (await (await fetch("/api/jobs")).json()) as Array<{ status: string }>;
    const n = jobs.filter((j) => j.status === "running").length;
    runsRunningCount.value = n || "";
  } catch {
    // offline
  }
}

const folderIndex = ref<WorkflowFolderIndex>(emptyWorkflowFolderIndex());
const providers = ref<ProviderInfo[]>([]);
const loading = ref(true);
/** First fetch only — keep table if graphs already in memory. */
const wfHydrating = computed(() => loading.value && !graphs.value.length);

interface WorkflowExample {
  id: string;
  name: string;
  description: string;
  level?: string;
  teaches?: string[];
}
const workflowExamples = ref<WorkflowExample[]>([]);
const examplesLoading = ref(false);
const exampleBusy = ref<string | null>(null);

interface WorkflowRecipe {
  id: string;
  name: string;
  outcome: string;
  needs: { model: boolean; dir: boolean; session: boolean };
  agents: number | string;
  params: string[];
  note?: string;
}
const workflowRecipes = ref<WorkflowRecipe[]>([]);
const recipesLoading = ref(false);
const recipeBusy = ref<string | null>(null);

async function loadExamples(): Promise<void> {
  examplesLoading.value = true;
  try {
    workflowExamples.value = await api.graphTemplates();
  } catch {
    workflowExamples.value = [];
  } finally {
    examplesLoading.value = false;
  }
}

async function loadRecipes(): Promise<void> {
  recipesLoading.value = true;
  try {
    workflowRecipes.value = await api.graphRecipes();
  } catch {
    workflowRecipes.value = [];
  } finally {
    recipesLoading.value = false;
  }
}

async function useExample(id: string): Promise<void> {
  exampleBusy.value = id;
  try {
    const g = await api.fromTemplate(id);
    await refresh();
    await router.push(`/graph/${g.id}`);
  } catch (err) {
    alert(`Could not clone example: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    exampleBusy.value = null;
  }
}

async function useRecipe(id: string): Promise<void> {
  recipeBusy.value = id;
  try {
    const meta = workflowRecipes.value.find((r) => r.id === id);
    const g = await api.fromRecipe(id);
    if (meta) {
      try {
        sessionStorage.setItem(
          `threadle.recipeSetup.${g.id}`,
          JSON.stringify({
            recipeId: meta.id,
            outcome: meta.outcome,
            needs: meta.needs,
            params: meta.params,
            note: meta.note,
          }),
        );
      } catch {
        // private mode
      }
    }
    await refresh();
    await router.push(`/graph/${g.id}`);
  } catch (err) {
    alert(`Could not clone recipe: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    recipeBusy.value = null;
  }
}

function exampleTitle(name: string): string {
  return name.replace(/^Example\s*·\s*/i, "");
}

function recipeTitle(name: string): string {
  return name.replace(/^Recipe\s*·\s*/i, "");
}

function recipeNeedsLabel(r: WorkflowRecipe): string {
  const parts: string[] = [];
  if (r.needs.model) parts.push("model");
  if (r.needs.dir) parts.push("--dir");
  if (r.needs.session) parts.push("session");
  if (r.params.length) parts.push(`param:${r.params.join(",")}`);
  return parts.join(" · ") || "—";
}
type ViewId =
  | "workflows" | "runs" | "logs" | "sessions" | "search" | "agents" | "rules" | "skills" | "services" | "usage"
  | "meta" | "security" | "files" | "activity" | "settings" | "library" | "favorites";

const route = useRoute();
const VIEW_IDS: ViewId[] = [
  "workflows", "runs", "logs", "sessions", "search", "agents", "rules", "skills", "services", "usage",
  "meta", "security", "files", "activity", "settings", "library", "favorites",
];
function viewFromQuery(): ViewId {
  const q = route.query.view;
  return typeof q === "string" && VIEW_IDS.includes(q as ViewId)
    ? (q as ViewId)
    : "workflows";
}
const view = ref<ViewId>(viewFromQuery());

const skillFocus = computed(() => {
  const s = route.query.skill;
  return typeof s === "string" && s ? s : undefined;
});
const rulesFocus = computed(() => {
  const p = route.query.path;
  if (typeof p === "string" && p) return p;
  const n = route.query.name;
  return typeof n === "string" && n ? n : undefined;
});
const agentFocus = computed(() => {
  const name = route.query.agent;
  if (typeof name !== "string" || !name) return undefined;
  const provider = route.query.provider;
  return {
    name,
    provider: typeof provider === "string" && provider ? provider : undefined,
  };
});
const agentBrowseFocus = computed(() => {
  const b = route.query.browse;
  return typeof b === "string" && b ? b : undefined;
});

function onNav(id: string): void {
  if (id === "lineage") {
    void router.push("/lineage");
    return;
  }
  if (id === "timeline") {
    void router.push("/timeline");
    return;
  }
  if (id === "map") {
    void router.push("/map");
    return;
  }
  view.value = id as ViewId;
  void router.replace({ query: { view: id } });
}

const providerFilter = ref<SessionFilter>("all");
const sessionOpenRequest = ref<{ session: SessionRef; fromAgents?: boolean } | null>(null);
const handoffSource = ref<SessionRef>();

function applySessionDeepLink(): void {
  const provider = route.query.provider;
  const session = route.query.session;
  if (typeof provider !== "string" || typeof session !== "string") return;
  if (!provider || !session) return;
  if (viewFromQuery() !== "sessions") return;
  sessionOpenRequest.value = {
    session: {
      provider,
      id: session,
      projectDir: "",
      updatedAt: Date.now(),
      status: "unknown",
      kind: "session",
      meta: {},
    } as SessionRef,
  };
}

function onSetProviderFilter(id: string): void {
  providerFilter.value = id as SessionFilter;
}

function onOpenSession(s: SessionRef, meta?: { fromAgents?: boolean }): void {
  sessionOpenRequest.value = { session: s, fromAgents: meta?.fromAgents };
}

function onFavoriteSession(payload: { provider: string; id: string }): void {
  view.value = "sessions";
  void router.replace({
    query: { view: "sessions", provider: payload.provider, session: payload.id },
  });
  sessionOpenRequest.value = {
    session: {
      provider: payload.provider,
      id: payload.id,
      projectDir: "",
      updatedAt: Date.now(),
      status: "unknown",
      kind: "session",
      meta: {},
    } as SessionRef,
  };
}

function onHandoff(s: SessionRef): void {
  handoffSource.value = s;
}

function openHandoffResult(provider: string, sessionId: string): void {
  handoffSource.value = undefined;
  void sessions.refresh().then(() => {
    sessionOpenRequest.value = {
      session:
        sessions.find(provider, sessionId) ??
        ({
          provider,
          id: sessionId,
          projectDir: "",
          updatedAt: Date.now(),
          status: "unknown",
          kind: "session",
          meta: {},
        } as SessionRef),
    };
  });
}

watch(
  () => route.query.view,
  () => {
    const next = viewFromQuery();
    if (next !== view.value) view.value = next;
  },
);

watch(
  () => [route.query.view, route.query.provider, route.query.session] as const,
  () => applySessionDeepLink(),
  { immediate: true },
);

const NAV_COUNTS: Record<string, () => string | number> = {
  // While graphs/providers are still loading, return "" so shared cached counts stay visible.
  workflows: () =>
    loading.value && !graphs.value.length
      ? ""
      : userSortedGraphs.value.length || "",
  runs: () => runsRunningCount.value,
  rules: () =>
    (ruleGroups.value ?? [])
      .flatMap((g) => g.artifacts)
      .filter((a) => a.kind !== "skill").length || "",
  skills: () =>
    (ruleGroups.value ?? [])
      .flatMap((g) => g.artifacts)
      .filter((a) => a.kind === "skill").length || "",
  services: () =>
    providers.value.length
      ? providers.value.filter((p) => p.available).length || ""
      : "",
};

const navItems = useNavItems({ counts: NAV_COUNTS });

const projectCount = computed(() => {
  const dirs = new Set(sessions.sessions.map((s) => s.projectDir || "(unknown)"));
  return dirs.size;
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [g, folders] = await Promise.all([api.graphs(), api.graphFolders()]);
    graphs.value = g;
    folderIndex.value = folders;
  } finally {
    loading.value = false;
  }
  if (!sessions.sessions.length) void sessions.refresh();
  void api.providers().then((p) => {
    providers.value = p;
  });
}

let unsubSessionEvents: (() => void) | undefined;

onMounted(() => {
  void refresh();
  void loadExamples();
  void loadRecipes();
  void refreshRunsRunningCount();
  unsubSessionEvents = subscribeEvents((ev) => {
    if (ev.type === "live.status") {
      sessions.applyLiveStatuses(ev.statuses);
      return;
    }
    if (ev.type === "sessions.changed") {
      void sessions.refresh();
      return;
    }
    if (ev.type === "job.done" || ev.type === "job.error" || ev.type === "job.progress") {
      void refreshRunsRunningCount();
    }
  });
});

onUnmounted(() => {
  unsubSessionEvents?.();
});

const importPicker = ref<HTMLInputElement>();
const backupBusy = ref(false);

async function downloadBackup(): Promise<void> {
  backupBusy.value = true;
  try {
    const bundle = await api.backupPack();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `threadle-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    backupBusy.value = false;
  }
}

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      alert("Import failed: invalid JSON");
      return;
    }
    // Config backup (threadle/backup@1) vs portable graph
    if (
      raw &&
      typeof raw === "object" &&
      (raw as { $schema?: string }).$schema === "threadle/backup@1"
    ) {
      // Manifest first; code-bearing categories need their own explicit yes —
      // restored node code executes when the node list next loads, and
      // settings include the editor command threadle spawns.
      const bundleFiles = (raw as { files?: Array<{ path?: unknown }> }).files ?? [];
      const counts = new Map<string, number>();
      for (const f of bundleFiles) {
        const top = String(f?.path ?? "").split("/")[0];
        if (top) counts.set(top, (counts.get(top) ?? 0) + 1);
      }
      const manifest = [...counts.entries()]
        .map(([k, n]) => `  ${k} — ${n} file(s)`)
        .join("\n");
      if (
        !confirm(
          `Restore this backup into ~/.config/threadle?\n\n${manifest}\n\nExisting files with the same paths will be overwritten.`,
        )
      ) {
        return;
      }
      const executing = ["nodes", "settings.json"];
      const categories = [...counts.keys()].filter((k) => !executing.includes(k));
      if (counts.has("nodes")) {
        if (
          confirm(
            "Also restore custom NODES?\n\nRestored node code can run as soon as the node list loads. Only accept nodes from a backup you made yourself.",
          )
        ) {
          categories.push("nodes");
        }
      }
      if (counts.has("settings.json")) {
        if (
          confirm(
            "Also restore SETTINGS?\n\nSettings include the editor command threadle runs on your machine.",
          )
        ) {
          categories.push("settings.json");
        }
      }
      const r = await api.backupRestore(raw, categories);
      const skippedNote = r.skipped.length ? ` Skipped: ${r.skipped.join(", ")}.` : "";
      alert(`Restored ${r.written} file(s).${skippedNote} Reload the page to see changes.`);
      return;
    }
    const parsed = validatePortableGraphJsonText(text);
    if (!parsed.ok) {
      alert(`Import failed: ${parsed.error}`);
      return;
    }
    const g = await api.importGraph(parsed.data);
    await router.push(`/graph/${g.id}`);
  } catch (err) {
    alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function createGraph(): Promise<void> {
  const g = await api.createGraph(nextWorkflowName(graphs.value), {
    kind: "workflow",
  });
  await router.push(`/graph/${g.id}`);
}

/** Empty draft in a folder — placement waits until the draft has a node. */
async function createGraphInFolder(folderId: string): Promise<void> {
  const next = new Set(collapsedFolders.value);
  if (next.delete(folderId)) {
    collapsedFolders.value = next;
    persistCollapsedFolders();
  }
  try {
    const path = folderPathNames(folderIndex.value, folderId);
    const g = await api.createGraph(nextWorkflowName(graphs.value), { kind: "workflow" });
    writePendingFolders(g.id, path);
    await router.push(`/graph/${g.id}`);
  } catch (err) {
    alert(`Could not create workflow: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Open the graph editor with no workflow selected (empty canvas). */
async function openCanvas(): Promise<void> {
  await router.push("/graph");
}

async function createSubgraph(): Promise<void> {
  const g = await api.createGraph(`Subgraph ${subgraphGraphs.value.length + 1}`, {
    kind: "subgraph",
  });
  await router.push(`/graph/${g.id}`);
}

async function setKind(id: string, kind: "workflow" | "subgraph"): Promise<void> {
  try {
    await api.setGraphKind(id, kind);
    await refresh();
  } catch (err) {
    alert(`Could not change kind: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function removeGraph(id: string): Promise<void> {
  const g = graphs.value.find((x) => x.id === id);
  const label = g?.kind === "subgraph" ? "subgraph" : "workflow";
  if (!confirm(`Delete this ${label}? Referenced sessions are not touched.`)) return;
  await api.deleteGraph(id);
  await refresh();
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

const WF_SEL: Record<string, (g: GraphSummary) => number | string> = {
  name: (g) => g.name,
  id: (g) => g.id,
  nodes: (g) => g.nodeCount,
  wires: (g) => g.edgeCount,
  updated: (g) => g.updatedAt,
};

const sortedGraphs = computed(() => applySort("wf", graphs.value, WF_SEL, "updated"));

/** Cloned teaching graphs / recipes keep the "Example ·" / "Recipe ·" name prefix. */
function isExampleWorkflow(g: { name: string }): boolean {
  return /^(Example|Recipe)\s*·/i.test(g.name);
}

const userSortedGraphs = computed(() =>
  sortedGraphs.value.filter((g) => !isExampleWorkflow(g)),
);
const exampleSortedGraphs = computed(() =>
  sortedGraphs.value.filter((g) => isExampleWorkflow(g)),
);
const workflowGraphs = computed(() =>
  userSortedGraphs.value.filter((g) => g.kind !== "subgraph"),
);
const subgraphGraphs = computed(() =>
  userSortedGraphs.value.filter((g) => g.kind === "subgraph"),
);
const examplesTabCount = computed(
  () => workflowExamples.value.length + workflowRecipes.value.length,
);

const wfKindFilter = ref<"all" | "workflow" | "subgraph" | "examples">("all");
const wfTextFilter = ref("");

/** Kind-scoped list before the text filter. */
const wfKindGraphs = computed(() => {
  if (wfKindFilter.value === "examples") return exampleSortedGraphs.value;
  if (wfKindFilter.value === "workflow") return workflowGraphs.value;
  if (wfKindFilter.value === "subgraph") return subgraphGraphs.value;
  return userSortedGraphs.value;
});

/** Folder ids whose name matches the text filter (and all their descendants). */
const wfTextMatchingFolderIds = computed(() => {
  const q = wfTextFilter.value.trim().toLowerCase();
  const ids = new Set<string>();
  if (!q) return ids;
  const byParent = new Map<string | null, WorkflowFolder[]>();
  for (const f of folderIndex.value.folders) {
    const p = f.parentId;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(f);
    if (f.name.toLowerCase().includes(q)) ids.add(f.id);
  }
  function addDescendants(id: string): void {
    for (const child of byParent.get(id) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      addDescendants(child.id);
    }
  }
  for (const id of [...ids]) addDescendants(id);
  return ids;
});

function wfGraphMatchesText(g: GraphSummary, q: string): boolean {
  return (
    g.name.toLowerCase().includes(q) ||
    g.id.toLowerCase().includes(q) ||
    g.kind.toLowerCase().includes(q)
  );
}

function wfFolderIdMatchesText(folderId: string | null | undefined): boolean {
  return !!folderId && wfTextMatchingFolderIds.value.has(folderId);
}

const filteredGraphs = computed(() => {
  const list = wfKindGraphs.value;
  const q = wfTextFilter.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (g) =>
      wfGraphMatchesText(g, q) ||
      wfFolderIdMatchesText(folderIndex.value.placements[g.id]),
  );
});

const wfTextHasFolderHits = computed(() => {
  const q = wfTextFilter.value.trim().toLowerCase();
  if (!q) return false;
  return folderIndex.value.folders.some((f) => f.name.toLowerCase().includes(q));
});

watch(
  () => settings.showExamples,
  (on) => {
    if (!on && wfKindFilter.value === "examples") wfKindFilter.value = "all";
  },
);

const WF_COLLAPSE_KEY = "threadle:wf-folders-collapsed";
const collapsedFolders = ref<Set<string>>(loadCollapsedFolders());

function loadCollapsedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(WF_COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    // ignore
  }
  return new Set();
}

function persistCollapsedFolders(): void {
  localStorage.setItem(WF_COLLAPSE_KEY, JSON.stringify([...collapsedFolders.value]));
}

function toggleFolderCollapsed(id: string): void {
  const next = new Set(collapsedFolders.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedFolders.value = next;
  persistCollapsedFolders();
}

type WfTreeRow =
  | { kind: "folder"; key: string; folder: WorkflowFolder; depth: number; graphCount: number }
  | { kind: "graph"; key: string; graph: GraphSummary; depth: number };

const wfTreeRows = computed((): WfTreeRow[] => {
  const graphsByFolder = new Map<string | null, GraphSummary[]>();
  graphsByFolder.set(null, []);
  for (const f of folderIndex.value.folders) graphsByFolder.set(f.id, []);
  for (const g of filteredGraphs.value) {
    const fid = folderIndex.value.placements[g.id] ?? null;
    const bucket = graphsByFolder.get(fid) ?? graphsByFolder.get(null)!;
    bucket.push(g);
  }

  const childrenOf = new Map<string | null, WorkflowFolder[]>();
  childrenOf.set(null, []);
  for (const f of folderIndex.value.folders) {
    const parent = f.parentId;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(f);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  function countGraphsDeep(folderId: string): number {
    let n = graphsByFolder.get(folderId)?.length ?? 0;
    for (const child of childrenOf.get(folderId) ?? []) {
      n += countGraphsDeep(child.id);
    }
    return n;
  }

  const rows: WfTreeRow[] = [];
  const examplesOnly = wfKindFilter.value === "examples";
  const textQ = wfTextFilter.value.trim();

  function folderOrDescendantMatches(folderId: string): boolean {
    if (wfTextMatchingFolderIds.value.has(folderId)) return true;
    for (const child of childrenOf.get(folderId) ?? []) {
      if (folderOrDescendantMatches(child.id)) return true;
    }
    return false;
  }

  function shouldShowFolder(folder: WorkflowFolder, graphCount: number): boolean {
    if (examplesOnly && !textQ && graphCount === 0) return false;
    if (!textQ) return true;
    if (graphCount > 0) return true;
    return folderOrDescendantMatches(folder.id);
  }

  function walk(parentId: string | null, depth: number): void {
    for (const folder of childrenOf.get(parentId) ?? []) {
      const graphCount = countGraphsDeep(folder.id);
      if (!shouldShowFolder(folder, graphCount)) continue;
      rows.push({
        kind: "folder",
        key: `folder:${folder.id}`,
        folder,
        depth,
        graphCount,
      });
      if (!collapsedFolders.value.has(folder.id)) {
        walk(folder.id, depth + 1);
        for (const g of graphsByFolder.get(folder.id) ?? []) {
          rows.push({ kind: "graph", key: `graph:${g.id}`, graph: g, depth: depth + 1 });
        }
      }
    }
    if (parentId === null) {
      for (const g of graphsByFolder.get(null) ?? []) {
        rows.push({ kind: "graph", key: `graph:${g.id}`, graph: g, depth: 0 });
      }
    }
  }
  walk(null, 0);
  return rows;
});

function graphMenuKey(id: string): string {
  return `graph:${id}`;
}

function folderMenuKey(id: string): string {
  return `folder:${id}`;
}

function toggleGraphMenu(id: string): void {
  const k = graphMenuKey(id);
  wfGraphCtx.value = undefined;
  wfFolderCtx.value = undefined;
  openMenu.value = openMenu.value === k ? undefined : k;
}

function toggleFolderMenu(id: string): void {
  const k = folderMenuKey(id);
  wfFolderCtx.value = undefined;
  wfGraphCtx.value = undefined;
  openMenu.value = openMenu.value === k ? undefined : k;
}

const wfFolderCtx = ref<{ id: string; name: string; x: number; y: number }>();
const wfGraphCtx = ref<{
  id: string;
  name: string;
  kind: "workflow" | "subgraph";
  x: number;
  y: number;
}>();
let wfFolderCtxIgnoreClick = false;
let wfGraphCtxIgnoreClick = false;

function openFolderCtxMenu(e: MouseEvent, folder: WorkflowFolder): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  wfGraphCtx.value = undefined;
  const pad = 8;
  const w = 220;
  const h = 160;
  const x = Math.min(e.clientX, window.innerWidth - w - pad);
  const y = Math.min(e.clientY, window.innerHeight - h - pad);
  wfFolderCtxIgnoreClick = true;
  wfFolderCtx.value = { id: folder.id, name: folder.name, x: Math.max(pad, x), y: Math.max(pad, y) };
  window.setTimeout(() => {
    wfFolderCtxIgnoreClick = false;
  }, 400);
}

function onFolderRowMouseDown(e: MouseEvent, folder: WorkflowFolder): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openFolderCtxMenu(e, folder);
}

function openGraphCtxMenu(
  e: MouseEvent,
  graph: { id: string; name: string; kind?: "workflow" | "subgraph" },
): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  wfFolderCtx.value = undefined;
  const pad = 8;
  const w = 220;
  const h = 180;
  const x = Math.min(e.clientX, window.innerWidth - w - pad);
  const y = Math.min(e.clientY, window.innerHeight - h - pad);
  wfGraphCtxIgnoreClick = true;
  wfGraphCtx.value = {
    id: graph.id,
    name: graph.name,
    kind: graph.kind === "subgraph" ? "subgraph" : "workflow",
    x: Math.max(pad, x),
    y: Math.max(pad, y),
  };
  window.setTimeout(() => {
    wfGraphCtxIgnoreClick = false;
  }, 400);
}

function onGraphRowMouseDown(
  e: MouseEvent,
  graph: { id: string; name: string; kind?: "workflow" | "subgraph" },
): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openGraphCtxMenu(e, graph);
}

function openGraph(id: string): void {
  void router.push(`/graph/${id}`);
}

function runGraph(id: string): void {
  void router.push(`/graph/${id}?run=1`);
}

async function duplicateGraph(id: string): Promise<void> {
  try {
    const src = await api.graph(id);
    const kind = src.kind === "subgraph" ? "subgraph" : "workflow";
    const copy = await api.createGraph(`${src.name} copy`.slice(0, 60), { kind });
    copy.kind = kind;
    const idMap = new Map<string, string>();
    const srcNodes = JSON.parse(JSON.stringify(src.nodes)) as GraphNode[];
    for (const n of srcNodes) {
      idMap.set(n.id, crypto.randomUUID().slice(0, 8));
    }
    copy.nodes = srcNodes.map((n) => {
      const nextId = idMap.get(n.id)!;
      const subOf = n.subOf ? idMap.get(n.subOf) : undefined;
      return {
        ...n,
        id: nextId,
        subOf,
        status: "idle" as const,
        lastRunId: undefined,
      };
    });
    copy.edges = (JSON.parse(JSON.stringify(src.edges)) as GraphEdge[]).map((e) => ({
      ...e,
      id: crypto.randomUUID().slice(0, 8),
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    if (src.params?.length) {
      copy.params = JSON.parse(JSON.stringify(src.params)) as Graph["params"];
    }
    if (src.settings) {
      copy.settings = JSON.parse(JSON.stringify(src.settings)) as Graph["settings"];
    }
    if (src.viewport) copy.viewport = { ...src.viewport };
    await api.saveGraph(copy);
    const folderId = folderIndex.value.placements[id];
    if (folderId) {
      await applyFolderIndex(await api.placeGraphInFolder(copy.id, folderId));
    }
    await router.push(`/graph/${copy.id}`);
  } catch (err) {
    alert(`Duplicate failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function applyFolderIndex(idx: WorkflowFolderIndex): Promise<void> {
  folderIndex.value = idx;
}

type FolderNameDialog =
  | { mode: "create"; parentId: string | null; name: string }
  | { mode: "rename"; folderId: string; name: string };

const folderNameDialog = ref<FolderNameDialog>();
const folderNameInput = ref<HTMLInputElement>();
const folderNameBusy = ref(false);
const folderNameError = ref("");
const folderDeleteDialog = ref<{ id: string; name: string }>();
const folderDeleteBusy = ref(false);
const folderDeleteError = ref("");

function closeFolderNameDialog(): void {
  if (folderNameBusy.value) return;
  folderNameDialog.value = undefined;
  folderNameError.value = "";
}

async function createWorkflowFolder(parentId?: string | null): Promise<void> {
  folderNameError.value = "";
  folderNameDialog.value = {
    mode: "create",
    parentId: parentId ?? null,
    name: "",
  };
  if (parentId) {
    const next = new Set(collapsedFolders.value);
    if (next.delete(parentId)) {
      collapsedFolders.value = next;
      persistCollapsedFolders();
    }
  }
  await nextTick();
  folderNameInput.value?.focus();
}

async function renameWorkflowFolder(id: string, current: string): Promise<void> {
  folderNameError.value = "";
  folderNameDialog.value = { mode: "rename", folderId: id, name: current };
  await nextTick();
  folderNameInput.value?.focus();
  folderNameInput.value?.select();
}

async function submitFolderNameDialog(): Promise<void> {
  const dlg = folderNameDialog.value;
  if (!dlg || folderNameBusy.value) return;
  const trimmed = dlg.name.trim() || (dlg.mode === "create" ? "Untitled folder" : "");
  if (!trimmed) {
    folderNameError.value = "name required";
    return;
  }
  folderNameBusy.value = true;
  folderNameError.value = "";
  try {
    if (dlg.mode === "create") {
      await applyFolderIndex(await api.createGraphFolder(trimmed, dlg.parentId));
    } else {
      await applyFolderIndex(await api.renameGraphFolder(dlg.folderId, trimmed));
    }
    folderNameDialog.value = undefined;
  } catch (err) {
    folderNameError.value = err instanceof Error ? err.message : String(err);
  } finally {
    folderNameBusy.value = false;
  }
}

async function removeWorkflowFolder(id: string): Promise<void> {
  const folder = folderIndex.value.folders.find((f) => f.id === id);
  folderDeleteError.value = "";
  folderDeleteDialog.value = { id, name: folder?.name ?? "folder" };
}

function closeFolderDeleteDialog(): void {
  if (folderDeleteBusy.value) return;
  folderDeleteDialog.value = undefined;
  folderDeleteError.value = "";
}

async function confirmFolderDelete(): Promise<void> {
  const dlg = folderDeleteDialog.value;
  if (!dlg || folderDeleteBusy.value) return;
  folderDeleteBusy.value = true;
  folderDeleteError.value = "";
  try {
    await applyFolderIndex(await api.deleteGraphFolder(dlg.id));
    folderDeleteDialog.value = undefined;
  } catch (err) {
    folderDeleteError.value = err instanceof Error ? err.message : String(err);
  } finally {
    folderDeleteBusy.value = false;
  }
}

async function placeGraphRoot(graphId: string): Promise<void> {
  try {
    await applyFolderIndex(await api.placeGraphInFolder(graphId, null));
  } catch (err) {
    alert(`Could not move: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const WF_DRAG_GRAPH = "application/x-threadle-wf-graph";
const WF_DRAG_FOLDER = "application/x-threadle-wf-folder";
const wfDropTarget = ref<string | null>(null);
const wfDragging = ref<"graph" | "folder" | null>(null);

function onGraphDragStart(e: DragEvent, graphId: string): void {
  wfDragging.value = "graph";
  e.dataTransfer?.setData(WF_DRAG_GRAPH, graphId);
  e.dataTransfer!.effectAllowed = "move";
}

function onFolderDragStart(e: DragEvent, folderId: string): void {
  wfDragging.value = "folder";
  e.dataTransfer?.setData(WF_DRAG_FOLDER, folderId);
  e.dataTransfer!.effectAllowed = "move";
}

function onWfDragEnd(): void {
  wfDropTarget.value = null;
  wfDragging.value = null;
}

function onWfRootDragOver(e: DragEvent): void {
  if (!wfDragging.value) return;
  const t = e.target as HTMLElement;
  if (t.closest?.(".wf-folder-row")) return;
  wfDropTarget.value = "root";
  e.dataTransfer!.dropEffect = "move";
}

function onWfRootDragLeave(e: DragEvent): void {
  const related = e.relatedTarget as HTMLElement | null;
  if (related?.closest?.(".wf-table")) return;
  if (wfDropTarget.value === "root") wfDropTarget.value = null;
}

async function onWfRootDrop(e: DragEvent): Promise<void> {
  wfDropTarget.value = null;
  const t = e.target as HTMLElement;
  if (t.closest?.(".wf-folder-row")) return;
  const graphId = e.dataTransfer?.getData(WF_DRAG_GRAPH);
  const folderId = e.dataTransfer?.getData(WF_DRAG_FOLDER);
  wfDragging.value = null;
  try {
    if (graphId) await applyFolderIndex(await api.placeGraphInFolder(graphId, null));
    else if (folderId) await applyFolderIndex(await api.moveGraphFolder(folderId, null));
  } catch (err) {
    alert(`Could not move: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function onFolderDragOver(e: DragEvent, folderId: string): void {
  if (!wfDragging.value) return;
  e.stopPropagation();
  wfDropTarget.value = folderId;
  e.dataTransfer!.dropEffect = "move";
}

function onFolderDragLeave(folderId: string): void {
  if (wfDropTarget.value === folderId) wfDropTarget.value = null;
}

async function onFolderDrop(e: DragEvent, folderId: string): Promise<void> {
  e.stopPropagation();
  wfDropTarget.value = null;
  const graphId = e.dataTransfer?.getData(WF_DRAG_GRAPH);
  const draggedFolder = e.dataTransfer?.getData(WF_DRAG_FOLDER);
  wfDragging.value = null;
  try {
    if (graphId) await applyFolderIndex(await api.placeGraphInFolder(graphId, folderId));
    else if (draggedFolder && draggedFolder !== folderId) {
      await applyFolderIndex(await api.moveGraphFolder(draggedFolder, folderId));
    }
  } catch (err) {
    alert(`Could not move: ${err instanceof Error ? err.message : String(err)}`);
  }
}
// ---- rules & skills (meta view) ----

interface RuleArtifact {
  path: string;
  name: string;
  kind: "rules" | "agent" | "skill";
  source: string;
  size: number;
  mtime: number;
  description?: string;
  autoInvoke?: boolean;
  origin?: "project" | "custom" | "imported" | "global";
  layer?: number;
  shadowedBy?: string;
}
interface RuleGroup {
  scope: string;
  artifacts: RuleArtifact[];
}

const ruleGroups = ref<RuleGroup[] | undefined>();

watch(
  view,
  (v) => {
    if ((v === "meta" || v === "rules" || v === "skills") && ruleGroups.value === undefined) {
      void reloadRuleGroups();
    }
  },
  { immediate: true },
);

async function reloadRuleGroups(): Promise<void> {
  try {
    ruleGroups.value = (await (await fetch("/api/rules")).json()) as RuleGroup[];
  } catch {
    ruleGroups.value = [];
  }
}

// ---- row actions menu (workflows) ----
const openMenu = ref<string>();

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    openMenu.value = undefined;
    wfFolderCtx.value = undefined;
    wfGraphCtx.value = undefined;
  }
}

function onDocClick(e: MouseEvent): void {
  if (wfFolderCtxIgnoreClick || wfGraphCtxIgnoreClick || e.button !== 0) {
    return;
  }
  const t = e.target as HTMLElement;
  if (!t.closest?.(".row-menu") && !t.closest?.(".wf-folder-ctx")) {
    openMenu.value = undefined;
    wfFolderCtx.value = undefined;
    wfGraphCtx.value = undefined;
  }
}
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));
</script>

<style scoped>
.dash {
  height: 100%;
  min-height: 0;
  display: flex;
}
.dash-side {
  width: 220px;
  flex-shrink: 0;
  background: var(--panel-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 18px 10px 14px;
}
.dash-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 18px;
  font-family: var(--mono);
  font-weight: 600;
  font-size: var(--fs-xl);
}
.logo-mark {
  color: var(--text);
}
.dash-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: var(--fs-md);
  font-family: var(--font);
  cursor: pointer;
  text-align: left;
}
.nav-item:hover {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.nav-item.active {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.nav-glyph {
  font-family: var(--mono);
  width: 22px;
  color: var(--text-faint);
}
.nav-item.active .nav-glyph {
  color: var(--text);
}
.nav-label {
  flex: 1;
}
.nav-count {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-faint);
}
.dash-side-foot {
  margin-top: auto;
  padding: 0 10px;
}

.dash-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dash-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: scroll; /* always reserve scrollbar so day-filter can't reflow the page */
  scrollbar-gutter: stable;
  padding: 32px 36px 64px;
}
/* Logs fills the column; keep other views as normal block flow (flex
   would shrink overflow:hidden tables like .wf-table to ~0). */
.dash-main:has(> .logs-page) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 16px;
}
.dash-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 14px 20px;
  margin-bottom: 24px;
}
.dash-head-copy {
  flex: 1 1 22rem;
  min-width: 0;
}
.dash-summary {
  margin: 10px 0 0;
}
.dash-head:has(+ .dash-toolbar) {
  margin-bottom: 14px;
}
.dash-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}
.dash-head > .view-controls,
.dash-head > .dash-search,
.dash-head > .threadle-btn,
.dash-head > .dash-head-actions {
  margin-left: auto;
  flex-shrink: 0;
}
.dash-head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.dash-title {
  font-size: var(--fs-title);
  margin: 0;
  letter-spacing: -0.01em;
  font-weight: 600;
}
.dash-search {
  max-width: 260px;
}
.import-input {
  display: none;
}
.mono {
  font-family: var(--mono);
  font-size: var(--fs-xs);
}

/* workflows table */
.wf-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.wf-chrome .dash-head {
  margin-bottom: 14px;
}
.wf-chrome:not(:has(.wf-toolbar)) .dash-head {
  margin-bottom: 0;
  padding-bottom: 16px;
}
.wf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.wf-toolbar .dash-search {
  flex: 0 1 16rem;
  min-width: 10rem;
  max-width: 22rem;
}
.wf-toolbar .chip-row {
  margin-right: auto;
}
.wf-toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wf-table {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.wf-table.wf-drop-over {
  outline: 1px dashed var(--accent);
  outline-offset: -1px;
}
.wf-cols,
.wf-row {
  display: grid;
  grid-template-columns: var(--cols, minmax(0, 1fr) minmax(6rem, 9rem) 5.5rem 4rem 3.5rem 6.5rem 2rem);
  align-items: center;
  gap: 10px;
  padding: 0 14px;
}
.wf-cols {
  height: 34px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.wf-row {
  position: relative;
  height: 48px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}
.wf-row:last-child {
  border-bottom: none;
}
.wf-row:hover,
.wf-row.pinned {
  background: var(--panel-bg);
}
.wf-row.wf-drop-over {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.wf-folder-row {
  user-select: none;
  -webkit-user-select: none;
  background: var(--panel-bg);
  cursor: grab;
}
.wf-folder-row:active {
  cursor: grabbing;
}
.wf-folder-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0;
  padding-left: calc(var(--wf-depth, 0) * 14px);
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.btn-folder-mark {
  width: 12px;
  height: 12px;
  color: currentColor;
}
.dlg-folder-mark {
  display: inline-block;
  width: 12px;
  height: 12px;
  vertical-align: -1px;
  margin-right: 4px;
  color: var(--text-dim);
}
.menu-glyph :deep(.folder-mark) {
  width: 12px;
  height: 12px;
  color: currentColor;
}
.wf-folder-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-md);
  user-select: none;
  -webkit-user-select: none;
}
.wf-folder-count {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.wf-name {
  padding-left: calc(var(--wf-depth, 0) * 14px);
  font-weight: 500;
  font-size: var(--fs-md);
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.wf-name:hover {
  color: var(--accent);
}
.wf-id {
  min-width: 0;
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wf-kind {
  justify-self: start;
  font-size: var(--fs-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 6px;
  line-height: 1.2;
}
.wf-kind.sub {
  color: var(--lane-session);
  border-color: rgba(95, 159, 232, 0.35);
}
.wf-kind.unconfirmed {
  color: var(--status-waiting);
  border-color: rgba(240, 193, 77, 0.35);
}
.wf-meta {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-dim);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.wf-row-actions {
  justify-self: end;
}

/* workflow examples (bundled templates) */
.wf-examples {
  margin-top: 40px;
  padding-top: 28px;
  border-top: 1px solid var(--border);
}
.wf-examples-head {
  margin-bottom: 14px;
}
.wf-examples-sub {
  margin: 6px 0 0;
  font-size: var(--fs-sm);
  color: var(--text-dim);
  max-width: 52rem;
}
.ex-table {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.ex-cols,
.ex-row {
  display: grid;
  grid-template-columns: 7.5rem minmax(0, 1.4fr) minmax(8rem, 13rem) minmax(0, 1fr) 4rem;
  align-items: center;
  column-gap: 14px;
  padding: 0 14px;
}
.ex-cols {
  height: 34px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.ex-th-level {
  text-align: center;
}
.ex-th-act {
  justify-self: end;
}
.ex-row {
  min-height: 52px;
  padding-top: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}
.ex-row:last-child {
  border-bottom: none;
}
.ex-row:hover {
  background: var(--panel-bg);
}
.ex-level {
  justify-self: stretch;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  font-size: var(--fs-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 3px 6px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
}
.ex-level[data-level="beginner"] {
  color: var(--status-success);
  border-color: rgba(74, 222, 128, 0.35);
}
.ex-level[data-level="intermediate"] {
  color: var(--lane-session);
  border-color: rgba(95, 159, 232, 0.35);
}
.ex-level[data-level="advanced"] {
  color: var(--status-waiting);
  border-color: rgba(232, 185, 62, 0.4);
}
.ex-level[data-level="expert"] {
  color: var(--text);
  border-color: var(--border-strong);
}
.ex-id {
  min-width: 0;
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  align-self: center;
}
.ex-name-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  justify-content: center;
}
.ex-name {
  font-weight: 500;
  font-size: var(--fs-md);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ex-desc {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ex-teaches {
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  align-self: center;
}
.ex-act {
  justify-self: end;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-width: 0;
}
.ex-act .vsc-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ex-empty {
  padding: 16px 14px;
  margin: 0;
}
.ex-footnote {
  margin: 10px 2px 0;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  letter-spacing: 0.02em;
}
.wf-row .row-actions {
  opacity: 0;
}
.wf-row:hover .row-actions,
.wf-row .row-actions.pinned {
  opacity: 1;
}
.menu-item.menu-danger:hover {
  color: var(--status-error);
}

.wf-folder-ctx {
  position: fixed;
  right: auto;
  top: auto;
  z-index: 80;
}
.wf-name-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.6);
}
.wf-name-modal {
  width: min(380px, calc(100vw - 32px));
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
}
.wf-name-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 8px;
}
.wf-name-title {
  font-size: var(--fs-md);
  color: var(--text);
  letter-spacing: 0.02em;
}
.wf-name-close {
  appearance: none;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-lg);
  line-height: 1;
  padding: 2px 4px;
}
.wf-name-close:hover {
  color: var(--text);
}
.wf-name-body {
  padding: 4px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wf-name-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wf-name-error {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--status-error);
}
.wf-name-copy {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-dim);
  line-height: 1.45;
}
.wf-name-copy .mono {
  color: var(--text);
}
.wf-name-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px 16px;
}
.wf-name-foot .threadle-btn.danger {
  border-color: color-mix(in srgb, var(--status-error) 55%, var(--border));
  color: var(--status-error);
}
.wf-name-foot .threadle-btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--status-error) 12%, transparent);
  border-color: var(--status-error);
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
  opacity: 0.35;
  cursor: default;
}
.menu-item:disabled:hover {
  background: none;
  color: var(--text-dim);
}
.menu-glyph {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  width: 22px;
  color: var(--text-faint);
  flex-shrink: 0;
}
.group-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* empty state */
.empty-state {
  text-align: center;
  padding: 90px 0;
}
.empty-mark {
  font-family: var(--mono);
  font-size: 40px;
  color: var(--text-faint);
}
.empty-title {
  font-size: var(--fs-xl);
  font-weight: 600;
  margin: 14px 0 4px;
}
.empty-sub {
  color: var(--text-dim);
  margin: 0 0 20px;
  font-size: var(--fs-md);
}
</style>
