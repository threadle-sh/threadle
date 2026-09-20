<template>
  <div class="editor-page" :class="{ 'canvas-focus': canvasFocus }">
    <DashNav
      v-if="!canvasFocus"
      :items="navItems"
      active="workflows"
      @select="(id) => router.push(id === 'lineage' ? '/lineage' : id === 'timeline' ? '/timeline' : id === 'map' ? '/map' : { path: '/', query: { view: id } })"
    />
    <Palette
      v-if="!canvasFocus"
      :current-dir="currentDir"
      @embed-graph="onPaletteEmbedGraph"
    />
    <div class="editor-layout">
      <EditorTopbar
        :canvas-focus="canvasFocus"
        :parent-graph="parentGraph"
        :has-graph="!!store.graph"
        :name-crumbs="nameCrumbs"
        :name-crumbs-pending="nameCrumbsPending"
        :name-draft="nameDraft"
        :graph-kind="store.graph?.kind"
        :save-state="store.saveState"
        :proc-top="procTop"
        :graph-run-error="graphRunError"
        :server-project-dir="serverProjectDir"
        :editor-label="settings.editorLabel"
        :param-count="store.graph?.params?.length ?? 0"
        :can-undo="store.canUndo"
        :can-redo="store.canRedo"
        :export-state="exportState"
        :active-tab-busy="activeTabBusy"
        :can-run-graph="canRunGraph"
        :graph-ready="graphReady"
        :run-button-title="runButtonTitle"
        :history-open="historyOpen"
        :history-busy="historyBusy"
        :history-versions="historyVersions"
        @back="goBackEditor"
        @update:name-draft="nameDraft = $event"
        @name-focus="onNameFocus"
        @name-blur="onNameBlur"
        @name-keydown="onNameKeydown"
        @name-keyup="onNameKeyup"
        @open-project="settings.openPath(serverProjectDir)"
        @open-params="paramsEditorOpen = true"
        @undo="store.undo() && rebuildCanvas()"
        @redo="store.redo() && rebuildCanvas()"
        @toggle-focus="toggleCanvasFocus()"
        @export="exportGraph"
        @toggle-history="toggleHistory"
        @restore-version="restoreVersion"
        @stop="stopRun"
        @run="requestRun()"
      />

    <WorkflowTabsBar
      v-show="!canvasFocus"
      :open-ids="wfTabs.openIds"
      :open-count="wfTabs.openCount"
      :active-graph-id="activeGraphId"
      :tab-drag-id="tabDragId"
      :tab-drop-before="tabDropBefore"
      :tab-drop-after="tabDropAfter"
      :list-open="wfListOpen"
      :tab-label="(tid) => wfTabs.label(tid)"
      :tab-phase="tabRunPhase"
      :tab-pct="tabRunPct"
      :tab-title="tabRunTitle"
      :run-rail="tabBarRun"
      @tab-bar-dragover="onTabBarDragOver"
      @tab-bar-drop="onTabBarDrop"
      @clear-selection="clearTabTextSelection"
      @tab-contextmenu="openTabCtxMenu"
      @tab-click="onTabClick"
      @tab-close="closeWorkflowTab"
      @tab-dragstart="onTabDragStart"
      @tab-dragend="onTabDragEnd"
      @tab-dragover="onTabDragOver"
      @tab-drop="onTabDrop"
      @new-workflow="newWorkflowTab"
      @toggle-list="toggleWorkflowList"
      @close-all="closeAllWorkflowTabs"
    >
      <WorkflowListPopover
        v-if="wfListOpen"
        :filter="wfListFilter"
        :workflow-rows="wfListWorkflowRows"
        :subgraph-rows="wfListSubgraphRows"
        :collapsed="wfListCollapsed"
        :drop-target="wfListDropTarget"
        :active-graph-id="activeGraphId"
        :open-ids="wfTabs.openIds"
        :folder-ctx-id="wfListFolderCtx?.id"
        :graph-ctx-id="wfListGraphCtx?.id"
        :empty="!filteredWorkflowList.length && !wfListFolders.folders.length"
        :loading="wfListLoading"
        @close="wfListOpen = false"
        @update:filter="wfListFilter = $event"
        @create-folder="createWfListFolder()"
        @create-workflow-in-folder="createWorkflowInFolder"
        @toggle-folder="toggleWfListFolder"
        @folder-contextmenu="openWfListFolderCtx"
        @folder-mousedown="onWfListFolderMouseDown"
        @folder-more="openWfListFolderCtxFromEl"
        @folder-dragover="onWfListFolderDragOver"
        @folder-dragleave="onWfListFolderDragLeave"
        @folder-drop="onWfListFolderDrop"
        @root-dragover="onWfListRootDragOver"
        @root-dragleave="onWfListRootDragLeave"
        @root-drop="onWfListRootDrop"
        @graph-dragstart="onWfListGraphDragStart"
        @graph-dragend="onWfListDragEnd"
        @graph-contextmenu="openWfListGraphCtx"
        @graph-mousedown="onWfListGraphMouseDown"
        @graph-more="openWfListGraphCtxFromEl"
        @open-graph="openWorkflowFromList"
        @new-workflow="newWorkflowTab"
      />

      <WfListFolderCtxMenu
        :ctx="wfListFolderCtx"
        @new-workflow="wfListFolderAction(() => createWorkflowInFolder(wfListFolderCtx!.id))"
        @new-subfolder="wfListFolderAction(() => createWfListFolder(wfListFolderCtx!.id))"
        @rename="wfListFolderAction(() => renameWfListFolder(wfListFolderCtx!.id, wfListFolderCtx!.name))"
        @delete="wfListFolderAction(() => deleteWfListFolder(wfListFolderCtx!.id))"
      />

      <WfListGraphCtxMenu
        :ctx="wfListGraphCtx"
        :embed-disabled="!store.graph || store.graph.id === wfListGraphCtx?.id"
        :embed-title="wfListEmbedTitle"
        :can-move-to-root="!!(wfListGraphCtx && wfListFolders.placements[wfListGraphCtx.id])"
        @open="wfListGraphAction(() => openWorkflowFromList(wfListGraphCtx!.id, wfListGraphCtx!.name))"
        @run="wfListGraphAction(() => runWorkflowFromList(wfListGraphCtx!.id))"
        @embed="wfListGraphAction(() => embedGraphFromList(wfListGraphCtx!.id, wfListGraphCtx!.name))"
        @rename="wfListGraphAction(() => renameWfListGraph(wfListGraphCtx!.id, wfListGraphCtx!.name))"
        @duplicate="wfListGraphAction(() => duplicateWfListGraph(wfListGraphCtx!.id))"
        @mark-subgraph="wfListGraphAction(() => setWfListGraphKind(wfListGraphCtx!.id, 'subgraph'))"
        @mark-workflow="wfListGraphAction(() => setWfListGraphKind(wfListGraphCtx!.id, 'workflow'))"
        @move-root="wfListGraphAction(() => placeWfListGraphRoot(wfListGraphCtx!.id))"
        @delete="wfListGraphAction(() => deleteWfListGraph(wfListGraphCtx!.id, wfListGraphCtx!.name))"
      />

      <WfListGraphRenameDialog
        :open="!!wfListGraphDialog"
        :name="wfListGraphDialog?.name ?? ''"
        :error="wfListGraphError"
        :busy="wfListGraphBusy"
        @close="closeWfListGraphDialog"
        @submit="submitWfListGraphDialog"
        @update:name="(n) => { if (wfListGraphDialog) wfListGraphDialog.name = n }"
      />

      <WfListFolderDialog
        :dialog="wfListFolderDialog"
        :error="wfListFolderError"
        :busy="wfListFolderBusy"
        @close="closeWfListFolderDialog"
        @submit="submitWfListFolderDialog"
        @update:name="(n) => { if (wfListFolderDialog) wfListFolderDialog.name = n }"
      />

      <WfListFolderDeleteDialog
        :target="wfListFolderDelete"
        :error="wfListFolderDeleteError"
        :busy="wfListFolderDeleteBusy"
        @close="closeWfListFolderDelete"
        @confirm="confirmWfListFolderDelete"
      />
    </WorkflowTabsBar>

    <TabContextMenu
      v-if="tabCtx"
      :x="tabCtx.x"
      :y="tabCtx.y"
      :name="tabCtx.name"
      :kind="tabCtx.kind"
      :run-disabled="tabRunPhase(tabCtx.id) === 'running' || tabRunPhase(tabCtx.id) === 'waiting'"
      :can-close-others="wfTabs.openCount >= 2"
      :can-close-to-right="canCloseTabsToRight(tabCtx.id)"
      @run="runTabFromCtx(tabCtx.id)"
      @export="exportTabGraph(tabCtx.id)"
      @duplicate="duplicateTabGraph(tabCtx.id)"
      @convert-kind="convertTabKind(tabCtx.id)"
      @close="closeTabFromCtx(tabCtx.id)"
      @close-others="closeOtherTabs(tabCtx.id)"
      @close-to-right="closeTabsToRight(tabCtx.id)"
      @close-all="closeAllWorkflowTabs"
    />

    <div class="editor-main">
    <div
      class="canvas-wrap"
        :class="{ 'file-drag': fileDragOver }"
        @pointerdown.capture="onSlotPickupPointerDown"
        @drop="onDrop"
        @dragover="onDragOver"
        @dragenter="onDragEnter"
        @dragleave="onDragLeave"
        @dblclick="onCanvasDblClick"
      >
        <RecipeSetupBanner
          v-if="recipeSetup"
          :setup="recipeSetup"
          :gaps="setupGaps"
          :server-project-dir="serverProjectDir"
          @dismiss="dismissRecipeSetup"
        />
        <VueFlow
          :nodes="[]"
          :edges="[]"
          :default-edge-options="{ type: 'default', interactionWidth: 28 }"
          :is-valid-connection="checkConnection"
          :connection-radius="48"
          :min-zoom="0.08"
          :max-zoom="2.5"
          :zoom-on-double-click="false"
          :delete-key-code="['Backspace', 'Delete']"
          fit-view-on-init
          @node-drag-start="onNodeDragStart"
          @node-drag-stop="onNodeDragStop"
          @connect="onConnect"
          @nodes-change="onNodesChange"
          @edges-change="onEdgesChange"
          @edge-click="() => undefined"
          @node-double-click="onNodeDoubleClick"
          @node-click="onNodeClick"
          @node-context-menu="onNodeCtxMenu"
          @pane-click="dismissCtxMenu"
          @pane-context-menu="onPaneCtxMenu"
          @move-start="onCanvasMove"
          @move-end="onCanvasMoveEnd"
          @connect-start="onConnectStart"
          @connect-end="onConnectEnd"
        >
          <Background id="grid-minor" variant="lines" :gap="10" :line-width="1" color="var(--grid-line)" />
          <Background id="grid-major" variant="lines" :gap="100" :line-width="1" color="var(--grid-line-major)" />
          <Controls position="bottom-left">
            <button
              type="button"
              class="vue-flow__controls-button canvas-tidy-btn"
              title="⊡ cleanup arrangement — tidy frames and pack nodes"
              @click="cleanupArrangement()"
            >
              ⊡
            </button>
            <button
              type="button"
              class="vue-flow__controls-button canvas-focus-btn"
              :title="canvasFocus ? 'Exit fullscreen (F or Esc)' : 'Fullscreen canvas (F)'"
              @click="toggleCanvasFocus()"
            >
              {{ canvasFocus ? "↙" : "⛶" }}
            </button>
          </Controls>
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            :node-color="minimapColor"
            mask-color="rgba(35, 36, 51, 0.75)"
          />

          <template #node-session="props">
            <SessionNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-subagent-run="props">
            <SubagentNode v-bind="props" />
          </template>
          <template #node-agent-def="props">
            <AgentDefNode
              v-bind="props"
              :status="nodeStatuses[props.id]"
              :models="modelsFor(props.data.ref.provider)"
            />
          </template>
          <template #node-context="props">
            <ContextNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-prompt="props">
            <PromptNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-output="props">
            <OutputNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-prompt-convert="props">
            <PromptConvertNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-delay="props">
            <DelayNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-data="props">
            <DataNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-approval="props">
            <ApprovalNode
              v-bind="props"
              :status="nodeStatuses[props.id]"
              :waiting="pendingApproval?.nodeId === props.id"
            />
          </template>
          <template #node-live-handoff="props">
            <LiveHandoffNode
              v-bind="props"
              :status="nodeStatuses[props.id]"
              :waiting="pendingLiveHandoff?.nodeId === props.id"
            />
          </template>
          <template #node-wait-idle="props">
            <WaitIdleNode
              v-bind="props"
              :status="nodeStatuses[props.id]"
              :waiting="
                waitingIdleNodeId === props.id ||
                pendingApproval?.nodeId === props.id
              "
            />
          </template>
          <template #node-iterator="props">
            <IteratorNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-knot="props">
            <KnotNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-tripwire="props">
            <TripwireNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-judge="props">
            <JudgeNode
              v-bind="props"
              :status="nodeStatuses[props.id]"
              :waiting="pendingApproval?.nodeId === props.id"
            />
          </template>
          <template #node-until="props">
            <UntilNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-group="props">
            <GroupNode v-bind="props" />
          </template>
          <template #node-note="props">
            <NoteNode v-bind="props" />
          </template>
          <template #node-custom="props">
            <CustomNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-mcp-tool="props">
            <McpToolNode
              v-bind="props"
              :status="nodeStatuses[props.id]"
              :project-dir="serverProjectDir"
            />
          </template>
          <template #node-skill="props">
            <SkillNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
          <template #node-rules="props">
            <RulesNode v-bind="props" :status="nodeStatuses[props.id]" />
          </template>
        </VueFlow>
        <GraphLoadingOverlay
          :loading="!graphReady"
          label="Loading workflow"
        />
        <NodeContextMenu
          v-if="ctxMenu"
          :x="ctxMenu.x"
          :y="ctxMenu.y"
          :label="ctxMenu.label"
          :path="ctxMenuPath"
          :path-is-text="!!ctxMenuPath && isLikelyTextPath(ctxMenuPath)"
          :editor-label="settings.editorLabel"
          :copy-busy="ctxCopyBusy"
          :graph-running="graphRunning"
          :is-output="ctxMenuIsOutput"
          :can-clear-output="ctxMenuCanClearOutput"
          :is-data="ctxMenuIsData"
          :can-clear-data="ctxMenuCanClearData"
          :mutable="canMute(ctxMenu.nodeId)"
          :muted="!!store.nodeById(ctxMenu.nodeId)?.muted"
          :bypassed="!!store.nodeById(ctxMenu.nodeId)?.bypassed"
          :retry="store.nodeById(ctxMenu.nodeId)?.retry ?? 0"
          :continue-on-error="!!store.nodeById(ctxMenu.nodeId)?.continueOnError"
          :is-agent="ctxMenuIsAgent"
          :model-open="modelOpen"
          :model-current="ctxMenuModelCurrent"
          :models="ctxMenuModels"
          :exchange-open="exchangeOpen"
          :exchange-agents="ctxExchangeAgents"
          :selected-count="selectedNodeIds.length"
          :is-group="ctxMenuIsGroup"
          :is-linked="ctxMenuIsLinked"
          @open-viewer="ctxOpenViewer"
          @open-in-code="ctxOpenInCode"
          @copy-path="ctxCopyPath"
          @copy-content="ctxCopyContent"
          @run-from="runFromNode(ctxMenu.nodeId)"
          @test-node="testSingleNode(ctxMenu.nodeId)"
          @clear-output="clearOutputNode(ctxMenu.nodeId)"
          @clear-data="clearDataNode(ctxMenu.nodeId)"
          @toggle-mute="toggleMute(ctxMenu.nodeId)"
          @toggle-bypass="toggleBypass(ctxMenu.nodeId)"
          @cycle-retry="cycleRetry(ctxMenu.nodeId)"
          @toggle-continue-on-error="toggleContinueOnError(ctxMenu.nodeId)"
          @open-model-menu="openCtxModelMenu"
          @close-model-menu="modelOpen = false"
          @toggle-model-menu="toggleCtxModelMenu"
          @set-model="setCtxModel"
          @open-exchange-menu="exchangeOpen = true; modelOpen = false"
          @close-exchange-menu="exchangeOpen = false"
          @toggle-exchange-menu="exchangeOpen = !exchangeOpen; modelOpen = false"
          @exchange-agent="exchangeAgent"
          @group-selection="groupSelection"
          @save-selection-as-workflow="saveSelectionAsWorkflow"
          @ungroup="ungroupFrame(ctxMenu.nodeId)"
          @sync-frame="manualSyncFrame(ctxMenu.nodeId)"
          @cleanup-frame="cleanupArrangement(ctxMenu.nodeId)"
          @remove-frame="removeFrameFromCanvas(ctxMenu.nodeId)"
          @delete-linked-subgraph="deleteLinkedSubgraph(ctxMenu.nodeId)"
          @cleanup-arrangement="cleanupArrangement()"
        />
        <WireDropMenu
          v-if="wireMenu"
          :x="wireMenu.x"
          :y="wireMenu.y"
          :title="wireMenuTitle"
          :has-lists="wireHasLists"
          :filter="wireFilter"
          :blocks="wireBlocks"
          :customs="wireCustoms"
          :agents="wireAgents"
          :library="wireLib"
          :sessions="wireSessions"
          @update:filter="wireFilter = $event"
          @pick="onWireMenuPick"
        />
        <div v-if="store.graph && !store.graph.nodes.length" class="canvas-hint">
          <div class="canvas-hint-inner">
            <p class="canvas-hint-title">Empty canvas</p>
            <p class="canvas-hint-sub">Drag from the left · double-click to add · drop .json</p>
          </div>
        </div>
        <ApprovalDock
          v-if="pendingApproval"
          v-model:text="pendingApproval.text"
          @approve="resolveApproval(true)"
          @reject="resolveApproval(false)"
        />
        <LiveHandoffDock
          v-if="pendingLiveHandoff"
          :seed="pendingLiveHandoff.seed"
          :initial-session="pendingLiveHandoff.session"
          :initial-agent="pendingLiveHandoff.agentRef"
          :initial-kind="pendingLiveHandoff.handoffKind"
          :model="pendingLiveHandoff.model"
          :agents="sessions.agents"
          :project-dir="liveHandoffProjectDir"
          :graph-id="store.graph?.id"
          @ready="resolveLiveHandoff"
          @abort="abortLiveHandoff"
          @bind-agent="onLiveHandoffBindAgent"
          @bind-kind="onLiveHandoffBindKind"
        />
        <RunLogDock
          v-show="!canvasFocus"
          ref="runLogDock"
          :entries="logEntries"
          :open="logDockOpen"
          :live="graphRunning || runBusy"
          :loose-ends="looseEnds"
          :workflow-issues="workflowIssues"
          @toggle="logDockOpen = !logDockOpen"
          @clear="logEntries = []"
          @focus-loose="focusLooseEnd"
          @focus-issue="focusWorkflowIssue"
        />
      </div>

      <Inspector
        v-if="inspected"
        :session-ref="inspectedSessionRef"
        :agent-def="inspectedAgentDef"
        :context-data="inspectedContextData"
        :context-title="inspectedContextData?.label"
        :artifact-data="inspectedArtifactData"
        :agent-node-data="inspectedAgentNodeData"
        :output-data="inspectedOutputData"
        :prompt-data="inspectedPromptData"
        :knot-data="inspectedKnotData"
        :judge-data="inspectedJudgeData"
        :delay-data="inspectedDelayData"
        :data-node-data="inspectedDataNodeData"
        :custom-data="inspectedCustomData"
        :mcp-tool-data="inspectedMcpToolData"
        :can-inject="!!injectSource"
        @close="inspected = undefined"
        @extract-selection="onExtractSelection"
        @add-child="onAddChild"
        @inject="injectModalOpen = true"
      >
        <template #agent>
          <AgentPanel
            v-if="inspectedAgentNodeData && inspectedNode"
            :data="inspectedAgentNodeData"
            :agent-def="inspectedAgentDef"
            :models="modelsFor(inspectedAgentNodeData.ref.provider)"
            :prompt-text="wiredPromptText"
            :busy="runBusy"
            :error="runErrors[inspectedNode.id]"
            :progress="runProgress[inspectedNode.id]"
            @run="runAgent"
          />
        </template>
        <template #context>
          <ContextPanel
            v-if="inspectedContextData && inspectedNode"
            :data="inspectedContextData"
            :source-ref="contextSourceRef"
            :source-title="contextSourceTitle"
            :payload="payloadCache[inspectedContextData.payloadHash ?? '']"
            :busy="pendingJobs.has(inspectedNode.id)"
            :error="jobErrors[inspectedNode.id]"
            :progress="jobProgress[inspectedNode.id]"
            @materialize="materialize(inspectedNode.id)"
          />
        </template>
        <template #artifact>
          <ArtifactPanel
            v-if="inspectedArtifactData"
            :path="inspectedArtifactData.path ?? ''"
            :name="inspectedArtifactData.name"
            :kind="inspectedArtifactData.type"
            :source="inspectedArtifactData.source"
            :description="
              inspectedArtifactData.type === 'skill'
                ? inspectedArtifactData.description
                : undefined
            "
            :auto-invoke="
              inspectedArtifactData.type === 'skill'
                ? inspectedArtifactData.autoInvoke
                : undefined
            "
            @updated="onInspectedArtifactUpdated"
          />
        </template>
        <template #output>
          <OutputPanel v-if="inspectedOutputData" :data="inspectedOutputData" />
        </template>
        <template #prompt>
          <PromptPanel v-if="inspectedPromptData" :data="inspectedPromptData" />
        </template>
        <template #knot>
          <KnotPanel
            v-if="inspectedKnotData"
            :data="inspectedKnotData"
            :models="inspectedKnotData.provider ? modelsFor(inspectedKnotData.provider) : []"
          />
        </template>
        <template #judge>
          <JudgePanel v-if="inspectedJudgeData" :data="inspectedJudgeData" />
        </template>
        <template #delay>
          <DelayPanel v-if="inspectedDelayData" :data="inspectedDelayData" />
        </template>
        <template #data>
          <DataPanel v-if="inspectedDataNodeData" :data="inspectedDataNodeData" />
        </template>
        <template #custom>
          <CustomPanel v-if="inspectedCustomData" :data="inspectedCustomData" />
        </template>
        <template #mcp-tool>
          <McpToolPanel
            v-if="inspectedMcpToolData"
            :data="inspectedMcpToolData"
            :project-dir="serverProjectDir"
          />
        </template>
      </Inspector>

      <InjectModal
        v-if="injectModalOpen && inspectedSessionRef && injectSource"
        :provider="inspectedSessionRef.provider as ProviderId"
        :session-id="inspectedSessionRef.sessionId"
        :target-title="inspectedSessionRef.title"
        :busy="injectBusy"
        :error="injectError"
        :progress="injectProgress"
        :models="modelsFor(inspectedSessionRef.provider)"
        @close="closeInjectModal"
        @run="runInject"
      />
      </div>
      <WorkflowParamsModal
        :open="paramsEditorOpen"
        :params="store.graph?.params ?? []"
        :ply="store.graph?.settings?.ply ?? DEFAULT_PLY"
        :spend-tripwire-usd="store.graph?.settings?.spendTripwireUsd ?? ''"
        @close="paramsEditorOpen = false"
        @add-param="addWorkflowParam"
        @remove-param="removeWorkflowParam"
        @update:ply="setGraphPly"
        @update:spend-tripwire-usd="setGraphSpendTripwire"
      />
      <ParamRunModal
        :open="paramRunOpen"
        :params="store.graph?.params ?? []"
        :draft="paramDraft"
        :errors="paramErrors"
        @close="paramRunOpen = false"
        @submit="submitParamRun"
      />
      <ValidationModal
        :open="validationOpen"
        :issues="validationIssues"
        @close="validationOpen = false"
        @focus-issue="focusValidationIssue"
      />
      <DetachedGateModal
        :open="detachedGateOpen"
        :blockers="detachedBlockers"
        :approvals="detachedApprovals"
        @close="detachedGateOpen = false"
        @focus-issue="focusDetachedIssue"
        @run-interactive="runInteractivelyFromDetachedGate"
        @confirm="confirmDetachedGate"
      />
      <ImportRunModal
        :open="importConfirmOpen"
        :manifest="importManifest"
        @close="cancelImportConfirm"
        @confirm="confirmImportAndProceed"
      />

      <StatusBar
        v-show="!canvasFocus"
        :status="statusBarText"
        :active-running="activeRunningLabels"
        :active-queued="activeQueuedLabels"
      />
      <div v-if="canvasFocus" class="focus-hint mono micro-label" aria-hidden="true">
        fullscreen · F or Esc to exit
      </div>
      <ConfirmModal
        v-model="confirmDlg"
        @confirm="onConfirmDlgYes"
        @cancel="onConfirmDlgNo"
      />
    </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  VueFlow,
  useVueFlow,
  Position,
  type Connection,
  type Edge as VFEdge,
  type EdgeChange,
  type NodeChange,
  type Node as VFNode,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import {
  isValidConnection as isValidPair,
  edgesDisplacedByConnection,
  assessDetachedReadiness,
  filterDetachedIssuesForScope,
  assessWorkflowReadiness,
  assessLooseEnds,
  clearWiredSinkNodes,
  expandFrameEdges,
  substituteParams,
  toPortableGraph,
  validatePortableGraphImport,
  validateDragPayloadJsonText,
  valueTypeCompatible,
  valueTypeError,
  coerceValue,
  joinAgentPromptTexts,
  DEFAULT_PLY,
  mapPool,
  mergeKnotTexts,
  evaluateJudge,
  evaluateTripwire,
  agentErrWired,
  agentErrorPorts,
  agentSuccessPorts,
  defaultJudgeMatchers,
  judgePortsOutput,
  clampUntilMaxIterations,
  untilLoopBody,
  untilPortsOutput,
  advanceUntil,
  structuralEdges,
  clampWaitIdleTimeoutMs,
  isSessionBusy,
  WAIT_IDLE_POLL_MS,
  decideWaitIdle,
  splitIteratorItems,
  iteratorIsParallel,
  plyReady,
  predecessorMap,
  packLayeredFlow,
  isAbsolutePath,
  classifyRunScope,
  skillInvokeProvider,
  enrichUsageExhaustionError,
  classifyUsageExhaustion,
  claudeExhaustedForModel,
  formatUsageExhaustionMessage,
  type DetachedIssue,
  type ExtractConfig,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type LooseEnd,
  type NodeType,
  type ValueType,
  type WorkflowIssue,
} from "@threadle/shared";
import { useGraphClipboard } from "@/lib/graph/useGraphClipboard";
import { useGraphKeyboard } from "@/lib/graph/useGraphKeyboard";
import { useTabRuns } from "@/lib/graph/useTabRuns";
import { useContextPayloads } from "@/lib/graph/useContextPayloads";
import { useDesktopNotifications } from "@/lib/graph/useDesktopNotifications";
import { useConnectionRules } from "@/lib/graph/useConnectionRules";
import Palette from "@/panels/Palette.vue";
import DashNav from "@/panels/DashNav.vue";
import ConfirmModal, { type ConfirmModel } from "@/panels/ConfirmModal.vue";
import { useNavItems } from "@/panels/useNavItems";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import Inspector from "@/panels/Inspector.vue";
import ArtifactPanel from "@/panels/ArtifactPanel.vue";
import ContextPanel from "@/panels/ContextPanel.vue";
import OutputPanel from "@/panels/OutputPanel.vue";
import PromptPanel from "@/panels/PromptPanel.vue";
import DelayPanel from "@/panels/DelayPanel.vue";
import DataPanel from "@/panels/DataPanel.vue";
import CustomPanel from "@/panels/CustomPanel.vue";
import McpToolPanel from "@/panels/McpToolPanel.vue";
import KnotPanel from "@/panels/KnotPanel.vue";
import JudgePanel from "@/panels/JudgePanel.vue";
import InjectModal from "@/panels/InjectModal.vue";
import { api, subscribeEvents } from "@/api/client";
import type {
  ContextPayload,
  InjectMode,
  ManifestItem,
  ModelInfo,
  ProviderId,
  ServerEvent,
} from "@threadle/shared";
import { summarizeGraphExecution } from "@threadle/shared";
import {
  definitionExecutesOnRun,
  MUTABLE_NODE_TYPES,
  SKIP_EXEC_TYPES,
  wireMenuBlocks,
} from "@threadle/shared";
import SessionNode from "@/canvas/nodes/SessionNode.vue";
import SubagentNode from "@/canvas/nodes/SubagentNode.vue";
import AgentDefNode from "@/canvas/nodes/AgentDefNode.vue";
import ContextNode from "@/canvas/nodes/ContextNode.vue";
import PromptNode from "@/canvas/nodes/PromptNode.vue";
import OutputNode from "@/canvas/nodes/OutputNode.vue";
import PromptConvertNode from "@/canvas/nodes/PromptConvertNode.vue";
import DelayNode from "@/canvas/nodes/DelayNode.vue";
import DataNode from "@/canvas/nodes/DataNode.vue";
import ApprovalNode from "@/canvas/nodes/ApprovalNode.vue";
import KnotNode from "@/canvas/nodes/KnotNode.vue";
import TripwireNode from "@/canvas/nodes/TripwireNode.vue";
import JudgeNode from "@/canvas/nodes/JudgeNode.vue";
import UntilNode from "@/canvas/nodes/UntilNode.vue";
import LiveHandoffNode from "@/canvas/nodes/LiveHandoffNode.vue";
import WaitIdleNode from "@/canvas/nodes/WaitIdleNode.vue";
import LiveHandoffDock from "@/panels/LiveHandoffDock.vue";
import ApprovalDock from "@/panels/ApprovalDock.vue";
import IteratorNode from "@/canvas/nodes/IteratorNode.vue";
import GroupNode from "@/canvas/nodes/GroupNode.vue";
import NoteNode from "@/canvas/nodes/NoteNode.vue";
import CustomNode from "@/canvas/nodes/CustomNode.vue";
import McpToolNode from "@/canvas/nodes/McpToolNode.vue";
import SkillNode from "@/canvas/nodes/SkillNode.vue";
import RulesNode from "@/canvas/nodes/RulesNode.vue";
import { useCustomNodes } from "@/stores/custom-nodes";
import StatusBar from "@/panels/StatusBar.vue";
import AgentPanel from "@/panels/AgentPanel.vue";
import RunLogDock, { type LogEntry } from "@/panels/RunLogDock.vue";
import {
  WorkflowParamsModal,
  ParamRunModal,
  ValidationModal,
  DetachedGateModal,
  ImportRunModal,
  RecipeSetupBanner,
  NodeContextMenu,
  WireDropMenu,
  EditorTopbar,
  WorkflowTabsBar,
  WorkflowListPopover,
  TabContextMenu,
  WfListFolderCtxMenu,
  WfListGraphCtxMenu,
  WfListGraphRenameDialog,
  WfListFolderDialog,
  WfListFolderDeleteDialog,
  type RecipeSetupState,
  type WfListFolderDialogModel,
} from "./graph-editor";
import { useGraphStore } from "@/stores/graph";
import { useWorkflowTabsStore } from "@/stores/workflowTabs";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";
import { copyToClipboard, fetchFileText } from "@/lib/pathActions";
import { nextWorkflowName } from "@/lib/workflowName";
import { useSubscription } from "@/lib/useSubscription";
import {
  clearPendingFoldersStorage,
  readPendingFolders,
  writePendingFolders,
} from "@/lib/pendingFolders";
import { defaultConfigFor, emptyWorkflowFolderIndex, folderIdForPath, folderNamesForGraph, folderPathNames, parseWorkflowPath, type GraphSummary, type WorkflowFolder, type WorkflowFolderIndex } from "@threadle/shared";

const route = useRoute();
const router = useRouter();
const store = useGraphStore();
const wfTabs = useWorkflowTabsStore();
const sessions = useSessionsStore();
const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const navItems = useNavItems();
const { ensureNotifyPermission, notifyRunFinished, notifyNeedsYou } =
  useDesktopNotifications();
const { snap: subSnap, refresh: refreshSub } = useSubscription();
void settings.load();
void refreshSub();
const customNodes = useCustomNodes();
void customNodes.load();

const activeGraphId = computed(() => {
  const id = route.params.id;
  return typeof id === "string" ? id : "";
});
const wfListOpen = ref(false);
const wfListFilter = ref("");
const wfListLoading = ref(false);
const wfListAll = ref<GraphSummary[]>([]);
const wfListFolders = ref<WorkflowFolderIndex>(emptyWorkflowFolderIndex());

const CANVAS_FOCUS_KEY = "threadle.graph.canvasFocus";
const canvasFocus = ref(localStorage.getItem(CANVAS_FOCUS_KEY) === "1");

const confirmDlg = ref<ConfirmModel>();
let confirmDlgResolve: ((ok: boolean) => void) | undefined;

function onConfirmDlgYes(): void {
  confirmDlgResolve?.(true);
  confirmDlgResolve = undefined;
}
function onConfirmDlgNo(): void {
  confirmDlgResolve?.(false);
  confirmDlgResolve = undefined;
}

function askConfirm(model: ConfirmModel): Promise<boolean> {
  return new Promise((resolve) => {
    confirmDlgResolve?.(false);
    confirmDlgResolve = resolve;
    confirmDlg.value = model;
  });
}

async function toggleCanvasFocus(force?: boolean): Promise<void> {
  canvasFocus.value = force ?? !canvasFocus.value;
  localStorage.setItem(CANVAS_FOCUS_KEY, canvasFocus.value ? "1" : "0");
  wfListOpen.value = false;
  await nextTick();
  // Vue Flow measures the pane on resize — sidebars changing width need a kick.
  window.dispatchEvent(new Event("resize"));
}

/** Topbar name field — leaf name; folder crumbs render beside it. */
const nameDraft = ref("");
const nameEditing = ref(false);
let nameCommitBusy = false;
let wfFoldersLoaded = false;
/**
 * Per-graph folder path intent that is not yet written to disk.
 * Empty drafts must not create folders until the workflow has a node.
 * `[]` means explicit root (after backspacing folders away).
 */
const pendingFoldersByGraph = ref<Record<string, string[]>>({});

function currentFolderDraft(graphId: string): string[] {
  const pending = pendingFoldersByGraph.value[graphId];
  if (pending !== undefined) return [...pending];
  return folderNamesForGraph(wfListFolders.value, graphId);
}

const nameCrumbs = computed(() => {
  if (!store.graph) return [] as string[];
  return currentFolderDraft(store.graph.id);
});

const nameCrumbsPending = computed(() => {
  if (!store.graph) return false;
  return pendingFoldersByGraph.value[store.graph.id] !== undefined;
});

const WF_COLLAPSE_KEY = "threadle:wf-folders-collapsed";
const wfListCollapsed = ref<Set<string>>(loadWfListCollapsed());

function loadWfListCollapsed(): Set<string> {
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

function syncNameDraft(): void {
  if (nameEditing.value || nameCommitBusy || !store.graph) return;
  nameDraft.value = store.graph.name;
}

function onNameFocus(): void {
  nameEditing.value = true;
}

function onNameBlur(): void {
  clearPathKeyHold();
  void commitGraphName();
}

/** Short Backspace/Delete peels a folder into the input; long-press drops the crumb. */
let pathKeyHold: { key: string; timer: number; fired: boolean } | null = null;
const PATH_KEY_LONG_MS = 450;

function clearPathKeyHold(): void {
  if (!pathKeyHold) return;
  window.clearTimeout(pathKeyHold.timer);
  pathKeyHold = null;
}

function dropLastFolderCrumb(): void {
  if (!store.graph) return;
  const cur = currentFolderDraft(store.graph.id);
  if (!cur.length) return;
  setPendingFolders(store.graph.id, cur.slice(0, -1));
}

function peelLastFolderIntoInput(el?: HTMLInputElement | null): void {
  if (!store.graph || nameDraft.value.length > 0) return;
  const cur = currentFolderDraft(store.graph.id);
  if (!cur.length) return;
  const popped = cur[cur.length - 1]!;
  setPendingFolders(store.graph.id, cur.slice(0, -1));
  nameDraft.value = popped;
  void nextTick(() => {
    const input = el ?? (document.activeElement as HTMLInputElement | null);
    if (input && typeof input.setSelectionRange === "function") {
      input.setSelectionRange(popped.length, popped.length);
    }
  });
}

async function ensureFoldersLoaded(): Promise<void> {
  if (wfFoldersLoaded) return;
  await refreshFolderIndex();
}

async function refreshFolderIndex(): Promise<void> {
  try {
    wfListFolders.value = await api.graphFolders();
    wfFoldersLoaded = true;
  } catch {
    /* ignore */
  }
}

/** Handoff from palette / list: pending folder path for a newly created draft. */
function consumePendingFoldersHandoff(graphId: string): void {
  const parsed = readPendingFolders(graphId);
  if (!parsed) return;
  // Keep storage until first node / discard so palette can resolve the path too.
  setPendingFolders(graphId, parsed);
}

function handoffPendingFolders(graphId: string, folders: string[]): void {
  writePendingFolders(graphId, folders);
  setPendingFolders(graphId, folders);
}

function forgetPendingFolders(graphId: string): void {
  clearPendingFolders(graphId);
  clearPendingFoldersStorage(graphId);
}

/** Flush saved work when leaving a loaded graph. Empty drafts stay alive until the tab is closed. */
async function leaveCurrentGraph(): Promise<void> {
  const g = store.graph;
  if (!g) return;
  if (g.nodes.length === 0) {
    // Keep ephemeral draft + tab; only refresh in-memory copy.
    await store.flush();
    return;
  }
  await store.flush();
}

/** Drop an empty draft from memory, tabs, pending folders, and any placement. */
async function discardEmptyDraft(
  id: string,
  opts?: { clearStore?: boolean; closeTab?: boolean },
): Promise<void> {
  forgetPendingFolders(id);
  if (opts?.closeTab !== false) wfTabs.close(id);
  await api.deleteGraph(id).catch(() => undefined);
  if (opts?.clearStore && store.graph?.id === id) store.clear();
  void refreshFolderIndex();
}

/** If `id` is an empty (or missing) draft, discard it. Returns true when discarded. */
async function discardIfEmptyDraft(id: string): Promise<boolean> {
  try {
    const g =
      store.graph?.id === id
        ? store.graph
        : await api.graph(id).catch(() => undefined);
    if (g && g.nodes.length > 0) return false;
    await discardEmptyDraft(id, {
      clearStore: store.graph?.id === id,
      closeTab: false,
    });
    return true;
  } catch {
    return false;
  }
}

function setPendingFolders(graphId: string, folders: string[]): void {
  pendingFoldersByGraph.value = { ...pendingFoldersByGraph.value, [graphId]: folders };
}

function clearPendingFolders(graphId: string): void {
  if (pendingFoldersByGraph.value[graphId] === undefined) return;
  const next = { ...pendingFoldersByGraph.value };
  delete next[graphId];
  pendingFoldersByGraph.value = next;
}

function expandFolderAncestors(folderId: string): void {
  const next = new Set(wfListCollapsed.value);
  let cur: string | null = folderId;
  const byId = new Map(wfListFolders.value.folders.map((f) => [f.id, f]));
  while (cur) {
    next.delete(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  wfListCollapsed.value = next;
  localStorage.setItem(WF_COLLAPSE_KEY, JSON.stringify([...next]));
}

/** Write folder path + placement. Empty folders → root. */
async function persistFolderPath(graphId: string, folders: string[]): Promise<void> {
  const { index, folderId } = await api.ensureGraphFolderPath(folders);
  wfListFolders.value = index;
  wfFoldersLoaded = true;
  wfListFolders.value = await api.placeGraphInFolder(graphId, folderId);
  if (folderId) expandFolderAncestors(folderId);
  forgetPendingFolders(graphId);
}

function onNameKeydown(e: KeyboardEvent): void {
  if (!store.graph) return;
  if (e.key === "Enter") {
    e.preventDefault();
    clearPathKeyHold();
    (e.target as HTMLInputElement).blur();
    return;
  }
  // abc + / → peel "abc" into a folder crumb, keep typing the leaf name
  if (e.key === "/") {
    e.preventDefault();
    clearPathKeyHold();
    const seg = nameDraft.value.trim();
    if (!seg) return;
    const parts = seg
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setPendingFolders(store.graph.id, [...currentFolderDraft(store.graph.id), ...parts]);
    nameDraft.value = "";
    return;
  }

  if (e.key !== "Backspace" && e.key !== "Delete") return;
  // Still editing the leaf / pulled segment — native char-by-char delete.
  if (nameDraft.value.length > 0) return;
  const cur = currentFolderDraft(store.graph.id);
  if (!cur.length) return;
  e.preventDefault();
  if (e.repeat || pathKeyHold) return;
  pathKeyHold = {
    key: e.key,
    fired: false,
    timer: window.setTimeout(() => {
      if (!pathKeyHold || pathKeyHold.key !== e.key) return;
      pathKeyHold.fired = true;
      dropLastFolderCrumb();
      nameDraft.value = "";
    }, PATH_KEY_LONG_MS),
  };
}

function onNameKeyup(e: KeyboardEvent): void {
  if (e.key !== "Backspace" && e.key !== "Delete") return;
  if (!pathKeyHold || pathKeyHold.key !== e.key) return;
  const wasLong = pathKeyHold.fired;
  clearPathKeyHold();
  if (wasLong) return;
  // Short press: pull last folder into the input so further backspaces eat chars.
  peelLastFolderIntoInput(e.target as HTMLInputElement);
}

async function commitGraphName(): Promise<void> {
  nameEditing.value = false;
  if (!store.graph || nameCommitBusy) return;
  const graphId = store.graph.id;
  const parsed = parseWorkflowPath(nameDraft.value);
  // Allow wiping the name while editing; blur with empty → Untitled.
  const leaf = parsed.name.trim() || "Untitled";
  nameCommitBusy = true;
  try {
    if (parsed.hasPath) setPendingFolders(graphId, parsed.folders);

    if (store.graph.name !== leaf) {
      store.graph.name = leaf;
      wfTabs.setName(graphId, leaf);
      await store.flush();
    }

    const pending = pendingFoldersByGraph.value[graphId];
    if (pending !== undefined && store.graph.nodes.length > 0) {
      await persistFolderPath(graphId, pending);
    }
  } catch (err) {
    alert(`Could not update name: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    nameCommitBusy = false;
    syncNameDraft();
  }
}

watch(
  () => [store.graph?.id, store.graph?.name, wfListFolders.value] as const,
  () => syncNameDraft(),
  { deep: true },
);

/** First node on a draft → persist any pending folder path. */
watch(
  () => store.graph?.nodes.length ?? 0,
  async (len, prev) => {
    if (!store.graph || len <= 0 || (prev ?? 0) > 0) return;
    const id = store.graph.id;
    const pending = pendingFoldersByGraph.value[id];
    if (pending === undefined) return;
    try {
      await persistFolderPath(id, pending);
    } catch (err) {
      console.warn("folder path persist failed", err);
    }
  },
);

function toggleWfListFolder(id: string): void {
  const next = new Set(wfListCollapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  wfListCollapsed.value = next;
  localStorage.setItem(WF_COLLAPSE_KEY, JSON.stringify([...next]));
}

const filteredWorkflowList = computed(() => {
  const q = wfListFilter.value.trim().toLowerCase();
  const list = wfListAll.value;
  if (!q) return list;
  return list.filter(
    (g) => g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q),
  );
});

type WfListRow =
  | { kind: "folder"; key: string; folder: WorkflowFolder; depth: number; graphCount: number }
  | { kind: "graph"; key: string; graph: GraphSummary; depth: number };

function buildWfListRows(
  graphs: GraphSummary[],
  opts?: { showEmptyFolders?: boolean; countFrom?: GraphSummary[] },
): WfListRow[] {
  const index = folderIndexWithPending(wfListFolders.value);
  const graphsByFolder = new Map<string | null, GraphSummary[]>();
  graphsByFolder.set(null, []);
  for (const f of index.folders) graphsByFolder.set(f.id, []);
  for (const g of graphs) {
    const fid = index.placements[g.id] ?? null;
    const bucket = graphsByFolder.get(fid) ?? graphsByFolder.get(null)!;
    bucket.push(g);
  }

  const countSource = opts?.countFrom ?? graphs;
  const countByFolder = new Map<string | null, number>();
  for (const f of index.folders) countByFolder.set(f.id, 0);
  countByFolder.set(null, 0);
  for (const g of countSource) {
    const fid = index.placements[g.id] ?? null;
    countByFolder.set(fid, (countByFolder.get(fid) ?? 0) + 1);
  }

  const childrenOf = new Map<string | null, WorkflowFolder[]>();
  childrenOf.set(null, []);
  for (const f of index.folders) {
    const parent = f.parentId;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(f);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  function countGraphsDeep(folderId: string): number {
    let n = countByFolder.get(folderId) ?? 0;
    for (const child of childrenOf.get(folderId) ?? []) n += countGraphsDeep(child.id);
    return n;
  }

  const rows: WfListRow[] = [];
  const showEmpty = opts?.showEmptyFolders ?? true;

  function walk(parentId: string | null, depth: number): void {
    // Folders first at every level, then graphs.
    for (const folder of childrenOf.get(parentId) ?? []) {
      const count = countGraphsDeep(folder.id);
      if (count === 0 && !showEmpty) continue;
      rows.push({
        kind: "folder",
        key: `folder:${folder.id}`,
        folder,
        depth,
        graphCount: count,
      });
      if (!wfListCollapsed.value.has(folder.id)) {
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
}

/** Empty open drafts aren't returned by GET /graphs — splice them into the tree. */
function openDraftSummaries(): GraphSummary[] {
  const known = new Set(wfListAll.value.map((g) => g.id));
  const out: GraphSummary[] = [];
  const seen = new Set<string>();
  const index = wfListFolders.value;

  const consider = (
    id: string,
    name: string,
    kind: "workflow" | "subgraph",
    nodeCount: number,
    edgeCount: number,
  ): void => {
    if (known.has(id) || seen.has(id)) return;
    const pending = pendingFoldersByGraph.value[id];
    const placed = index.placements[id];
    if (pending === undefined && !placed) return;
    seen.add(id);
    out.push({
      id,
      name,
      kind,
      nodeCount,
      edgeCount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usedBy: 0,
    });
  };

  if (store.graph) {
    consider(
      store.graph.id,
      store.graph.name,
      store.graph.kind === "subgraph" ? "subgraph" : "workflow",
      store.graph.nodes.length,
      store.graph.edges.length,
    );
  }
  for (const id of wfTabs.openIds) {
    consider(id, wfTabs.label(id) || id, "workflow", 0, 0);
  }
  return out;
}

/** Overlay pending folder paths onto placements for tree bucketing. */
function folderIndexWithPending(base: WorkflowFolderIndex): WorkflowFolderIndex {
  const placements = { ...base.placements };
  for (const [graphId, path] of Object.entries(pendingFoldersByGraph.value)) {
    if (path.length === 0) {
      delete placements[graphId];
      continue;
    }
    const fid = folderIdForPath(base, path);
    if (fid) placements[graphId] = fid;
  }
  return { ...base, placements };
}

const wfListWorkflowRows = computed(() => {
  const drafts = openDraftSummaries().filter((g) => g.kind !== "subgraph");
  const workflows = [
    ...drafts,
    ...filteredWorkflowList.value.filter((g) => g.kind !== "subgraph"),
  ];
  const allWorkflows = [
    ...drafts,
    ...wfListAll.value.filter((g) => g.kind !== "subgraph"),
  ];
  return buildWfListRows(workflows, {
    showEmptyFolders: !wfListFilter.value.trim(),
    countFrom: allWorkflows,
  });
});
const wfListSubgraphRows = computed(() => {
  const drafts = openDraftSummaries().filter((g) => g.kind === "subgraph");
  const subgraphs = [
    ...drafts,
    ...filteredWorkflowList.value.filter((g) => g.kind === "subgraph"),
  ];
  const allSubgraphs = [
    ...drafts,
    ...wfListAll.value.filter((g) => g.kind === "subgraph"),
  ];
  return buildWfListRows(subgraphs, {
    showEmptyFolders: false,
    countFrom: allSubgraphs,
  });
});

async function refreshWorkflowList(): Promise<void> {
  wfListLoading.value = true;
  try {
    const [graphs, folders] = await Promise.all([api.graphs(), api.graphFolders()]);
    wfListAll.value = graphs;
    wfListFolders.value = folders;
    wfFoldersLoaded = true;
    for (const g of wfListAll.value) wfTabs.setName(g.id, g.name);
  } finally {
    wfListLoading.value = false;
  }
}

const wfListFolderCtx = ref<{ id: string; name: string; x: number; y: number }>();
const wfListGraphCtx = ref<{
  id: string;
  name: string;
  kind?: "workflow" | "subgraph";
  x: number;
  y: number;
}>();
/** Ignore document dismiss for a beat after opening (browsers fire click/auxclick after contextmenu). */
let wfListFolderCtxIgnoreUntil = 0;

function placeWfListFolderCtx(clientX: number, clientY: number, folder: WorkflowFolder): void {
  window.getSelection()?.removeAllRanges();
  const pad = 8;
  const w = 220;
  const h = 180;
  const x = Math.min(clientX, window.innerWidth - w - pad);
  const y = Math.min(clientY, window.innerHeight - h - pad);
  wfListFolderCtxIgnoreUntil = Date.now() + 400;
  wfListGraphCtx.value = undefined;
  wfListFolderCtx.value = {
    id: folder.id,
    name: folder.name,
    x: Math.max(pad, x),
    y: Math.max(pad, y),
  };
}

function placeWfListGraphCtx(
  clientX: number,
  clientY: number,
  graph: { id: string; name: string; kind?: "workflow" | "subgraph" | null },
): void {
  window.getSelection()?.removeAllRanges();
  const pad = 8;
  const w = 240;
  const h = 320;
  const x = Math.min(clientX, window.innerWidth - w - pad);
  const y = Math.min(clientY, window.innerHeight - h - pad);
  wfListFolderCtxIgnoreUntil = Date.now() + 400;
  wfListFolderCtx.value = undefined;
  wfListGraphCtx.value = {
    id: graph.id,
    name: graph.name,
    kind: graph.kind === "subgraph" ? "subgraph" : "workflow",
    x: Math.max(pad, x),
    y: Math.max(pad, y),
  };
}

function openWfListFolderCtx(e: MouseEvent, folder: WorkflowFolder): void {
  e.preventDefault();
  e.stopPropagation();
  placeWfListFolderCtx(e.clientX, e.clientY, folder);
}

/** Right-mouse down — some hosts skip contextmenu on buttons. */
function onWfListFolderMouseDown(e: MouseEvent, folder: WorkflowFolder): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  placeWfListFolderCtx(e.clientX, e.clientY, folder);
}

function openWfListFolderCtxFromEl(e: MouseEvent, folder: WorkflowFolder): void {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  placeWfListFolderCtx(r.right - 4, r.bottom + 2, folder);
}

function openWfListGraphCtx(
  e: MouseEvent,
  graph: { id: string; name: string; kind?: "workflow" | "subgraph" | null },
): void {
  e.preventDefault();
  e.stopPropagation();
  placeWfListGraphCtx(e.clientX, e.clientY, graph);
}

function onWfListGraphMouseDown(
  e: MouseEvent,
  graph: { id: string; name: string; kind?: "workflow" | "subgraph" | null },
): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  placeWfListGraphCtx(e.clientX, e.clientY, graph);
}

function openWfListGraphCtxFromEl(
  e: MouseEvent,
  graph: { id: string; name: string; kind?: "workflow" | "subgraph" | null },
): void {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  placeWfListGraphCtx(r.right - 4, r.bottom + 2, graph);
}

function wfListFolderAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    wfListFolderCtx.value = undefined;
  }
}

function wfListGraphAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    wfListGraphCtx.value = undefined;
  }
}

function onWfListDocPointerDown(e: PointerEvent): void {
  if (Date.now() < wfListFolderCtxIgnoreUntil) return;
  if (e.button !== 0 && e.button !== 2) return;
  const t = e.target as HTMLElement;
  if (
    t.closest?.(".wf-folder-ctx") ||
    t.closest?.(".wf-graph-ctx") ||
    t.closest?.(".wf-list-folder-more")
  ) {
    return;
  }
  if (t.closest?.(".wf-list-folder") && e.button === 2) return;
  if (t.closest?.(".wf-list-graph") && e.button === 2) return;
  wfListFolderCtx.value = undefined;
  wfListGraphCtx.value = undefined;
}

onMounted(() => document.addEventListener("pointerdown", onWfListDocPointerDown, true));
onUnmounted(() => document.removeEventListener("pointerdown", onWfListDocPointerDown, true));

const wfListFolderDialog = ref<WfListFolderDialogModel>();
const wfListFolderBusy = ref(false);
const wfListFolderError = ref("");
const wfListFolderDelete = ref<{ id: string; name: string }>();
const wfListFolderDeleteBusy = ref(false);
const wfListFolderDeleteError = ref("");

const wfListGraphDialog = ref<{ id: string; name: string }>();
const wfListGraphBusy = ref(false);
const wfListGraphError = ref("");

const wfListEmbedTitle = computed(() => {
  if (!store.graph) return "Open a workflow first";
  if (wfListGraphCtx.value && store.graph.id === wfListGraphCtx.value.id) {
    return "Already the active canvas";
  }
  return "Embed as a linked frame on the current canvas";
});

function closeWfListGraphDialog(): void {
  if (wfListGraphBusy.value) return;
  wfListGraphDialog.value = undefined;
  wfListGraphError.value = "";
}

async function renameWfListGraph(id: string, current: string): Promise<void> {
  wfListGraphError.value = "";
  wfListGraphDialog.value = { id, name: current };
}

async function submitWfListGraphDialog(): Promise<void> {
  const dlg = wfListGraphDialog.value;
  if (!dlg || wfListGraphBusy.value) return;
  const trimmed = dlg.name.trim();
  if (!trimmed) {
    wfListGraphError.value = "name required";
    return;
  }
  wfListGraphBusy.value = true;
  wfListGraphError.value = "";
  try {
    const g = await api.graph(dlg.id);
    g.name = trimmed.slice(0, 120);
    await api.saveGraph(g);
    const row = wfListAll.value.find((x) => x.id === dlg.id);
    if (row) row.name = g.name;
    wfTabs.setName(dlg.id, g.name);
    if (store.graph?.id === dlg.id) {
      store.graph.name = g.name;
      nameDraft.value = g.name;
    }
    wfListGraphDialog.value = undefined;
  } catch (err) {
    wfListGraphError.value = err instanceof Error ? err.message : String(err);
  } finally {
    wfListGraphBusy.value = false;
  }
}

async function duplicateWfListGraph(id: string): Promise<void> {
  await duplicateTabGraph(id);
  await refreshWorkflowList();
}

async function setWfListGraphKind(id: string, kind: "workflow" | "subgraph"): Promise<void> {
  try {
    if (store.graph?.id === id) await store.flush();
    const saved = await api.setGraphKind(id, kind);
    if (store.graph?.id === id) store.graph.kind = saved.kind ?? kind;
    const row = wfListAll.value.find((g) => g.id === id);
    if (row) row.kind = saved.kind ?? kind;
    await refreshWorkflowList();
  } catch (err) {
    alert(`Could not change kind: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function placeWfListGraphRoot(graphId: string): Promise<void> {
  try {
    wfListFolders.value = await api.placeGraphInFolder(graphId, null);
  } catch (err) {
    alert(`Could not move: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function deleteWfListGraph(id: string, name: string): Promise<void> {
  const row = wfListAll.value.find((g) => g.id === id);
  const label = row?.kind === "subgraph" ? "subgraph" : "workflow";
  const ok = await askConfirm({
    title: `delete ${label}`,
    emphasis: `"${name}"`,
    body: ` ${label} will be deleted.`,
    detail: "Referenced sessions are not touched.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    if (wfTabs.openIds.includes(id)) await closeWorkflowTab(id);
    await api.deleteGraph(id);
    await refreshWorkflowList();
  } catch (err) {
    alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runWorkflowFromList(id: string): Promise<void> {
  const name =
    wfListAll.value.find((g) => g.id === id)?.name ?? wfTabs.label(id);
  wfListOpen.value = false;
  await openWorkflowFromList(id, name);
  await nextTick();
  requestRun();
}

async function embedGraphFromList(id: string, name: string): Promise<void> {
  if (!store.graph || store.graph.id === id) return;
  wfListOpen.value = false;
  const wrap = document.querySelector(".canvas-wrap") as HTMLElement | null;
  const rect = wrap?.getBoundingClientRect();
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const at = screenToFlowCoordinate({ x: cx, y: cy });
  await importSubgraph(id, name, { x: at.x - 80, y: at.y - 40 });
  await refreshWorkflowList();
}

function onPaletteEmbedGraph(id: string, name: string): void {
  void embedGraphFromList(id, name);
}
function closeWfListFolderDialog(): void {
  if (wfListFolderBusy.value) return;
  wfListFolderDialog.value = undefined;
  wfListFolderError.value = "";
}

async function createWfListFolder(parentId?: string | null): Promise<void> {
  wfListFolderError.value = "";
  wfListFolderDialog.value = {
    mode: "create",
    parentId: parentId ?? null,
    name: "",
  };
  if (parentId) {
    const next = new Set(wfListCollapsed.value);
    if (next.delete(parentId)) {
      wfListCollapsed.value = next;
      localStorage.setItem(WF_COLLAPSE_KEY, JSON.stringify([...next]));
    }
  }
}

async function renameWfListFolder(id: string, current: string): Promise<void> {
  wfListFolderError.value = "";
  wfListFolderDialog.value = { mode: "rename", folderId: id, name: current };
}

async function submitWfListFolderDialog(): Promise<void> {
  const dlg = wfListFolderDialog.value;
  if (!dlg || wfListFolderBusy.value) return;
  const trimmed = dlg.name.trim() || (dlg.mode === "create" ? "Untitled folder" : "");
  if (!trimmed) {
    wfListFolderError.value = "name required";
    return;
  }
  wfListFolderBusy.value = true;
  wfListFolderError.value = "";
  try {
    if (dlg.mode === "create") {
      wfListFolders.value = await api.createGraphFolder(trimmed, dlg.parentId);
    } else {
      wfListFolders.value = await api.renameGraphFolder(dlg.folderId, trimmed);
    }
    wfListFolderDialog.value = undefined;
  } catch (err) {
    wfListFolderError.value = err instanceof Error ? err.message : String(err);
  } finally {
    wfListFolderBusy.value = false;
  }
}

async function deleteWfListFolder(id: string): Promise<void> {
  const folder = wfListFolders.value.folders.find((f) => f.id === id);
  wfListFolderDeleteError.value = "";
  wfListFolderDelete.value = { id, name: folder?.name ?? "folder" };
}

function closeWfListFolderDelete(): void {
  if (wfListFolderDeleteBusy.value) return;
  wfListFolderDelete.value = undefined;
  wfListFolderDeleteError.value = "";
}

async function confirmWfListFolderDelete(): Promise<void> {
  const dlg = wfListFolderDelete.value;
  if (!dlg || wfListFolderDeleteBusy.value) return;
  wfListFolderDeleteBusy.value = true;
  wfListFolderDeleteError.value = "";
  try {
    wfListFolders.value = await api.deleteGraphFolder(dlg.id);
    wfListFolderDelete.value = undefined;
  } catch (err) {
    wfListFolderDeleteError.value = err instanceof Error ? err.message : String(err);
  } finally {
    wfListFolderDeleteBusy.value = false;
  }
}

/** Draft workflow in a folder — folder placement waits until it has a node. */
async function createWorkflowInFolder(folderId: string): Promise<void> {
  const next = new Set(wfListCollapsed.value);
  if (next.delete(folderId)) {
    wfListCollapsed.value = next;
    localStorage.setItem(WF_COLLAPSE_KEY, JSON.stringify([...next]));
  }
  try {
    await leaveCurrentGraph();
    const list = await api.graphs().catch(() => [] as GraphSummary[]);
    const name = nextWorkflowName([
      ...list,
      ...wfTabs.openIds.map((id) => ({ name: wfTabs.label(id) })),
    ]);
    const path = folderPathNames(wfListFolders.value, folderId);
    const g = await api.createGraph(name, { kind: "workflow" });
    handoffPendingFolders(g.id, path);
    expandFolderAncestors(folderId);
    wfTabs.ensureOpen(g.id, g.name);
    wfListOpen.value = false;
    await router.push(`/graph/${g.id}`);
  } catch (err) {
    alert(`Could not create workflow: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function toggleWorkflowList(): Promise<void> {
  wfListOpen.value = !wfListOpen.value;
  if (wfListOpen.value) {
    wfListFilter.value = "";
    await refreshWorkflowList();
  }
}

async function switchWorkflow(id: string): Promise<void> {
  if (id === activeGraphId.value) return;
  wfListOpen.value = false;
  await leaveCurrentGraph();
  await router.push(`/graph/${id}`);
}

async function openWorkflowFromList(id: string, name: string): Promise<void> {
  if (wfListDragSuppress) return;
  wfTabs.ensureOpen(id, name);
  await switchWorkflow(id);
}

const WF_LIST_DRAG_GRAPH = "application/x-threadle-wf-graph";
const wfListDropTarget = ref<string | null>(null);
const wfListDragging = ref(false);
/** Skip the click that follows a completed drag. */
let wfListDragSuppress = false;

function onWfListGraphDragStart(e: DragEvent, graphId: string): void {
  wfListDragging.value = true;
  wfListDragSuppress = true;
  e.dataTransfer?.setData(WF_LIST_DRAG_GRAPH, graphId);
  e.dataTransfer!.effectAllowed = "move";
}

function onWfListDragEnd(): void {
  wfListDropTarget.value = null;
  wfListDragging.value = false;
  setTimeout(() => {
    wfListDragSuppress = false;
  }, 0);
}

function onWfListRootDragOver(e: DragEvent): void {
  if (!wfListDragging.value) return;
  const t = e.target as HTMLElement;
  if (t.closest?.(".wf-list-folder")) return;
  wfListDropTarget.value = "root";
  e.dataTransfer!.dropEffect = "move";
}

function onWfListRootDragLeave(e: DragEvent): void {
  const related = e.relatedTarget as HTMLElement | null;
  if (related?.closest?.(".wf-list-scroll")) return;
  if (wfListDropTarget.value === "root") wfListDropTarget.value = null;
}

async function onWfListRootDrop(e: DragEvent): Promise<void> {
  wfListDropTarget.value = null;
  const t = e.target as HTMLElement;
  if (t.closest?.(".wf-list-folder")) return;
  const graphId = e.dataTransfer?.getData(WF_LIST_DRAG_GRAPH);
  wfListDragging.value = false;
  if (!graphId) return;
  try {
    wfListFolders.value = await api.placeGraphInFolder(graphId, null);
  } catch (err) {
    alert(`Could not move: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function onWfListFolderDragOver(e: DragEvent, folderId: string): void {
  if (!wfListDragging.value) return;
  e.stopPropagation();
  wfListDropTarget.value = folderId;
  e.dataTransfer!.dropEffect = "move";
}

function onWfListFolderDragLeave(folderId: string): void {
  if (wfListDropTarget.value === folderId) wfListDropTarget.value = null;
}

async function onWfListFolderDrop(e: DragEvent, folderId: string): Promise<void> {
  e.stopPropagation();
  wfListDropTarget.value = null;
  const graphId = e.dataTransfer?.getData(WF_LIST_DRAG_GRAPH);
  wfListDragging.value = false;
  if (!graphId) return;
  try {
    const next = new Set(wfListCollapsed.value);
    if (next.delete(folderId)) {
      wfListCollapsed.value = next;
      localStorage.setItem(WF_COLLAPSE_KEY, JSON.stringify([...next]));
    }
    wfListFolders.value = await api.placeGraphInFolder(graphId, folderId);
  } catch (err) {
    alert(`Could not move: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function newWorkflowTab(): Promise<void> {
  wfListOpen.value = false;
  await leaveCurrentGraph();
  const list = await api.graphs().catch(() => [] as GraphSummary[]);
  const name = nextWorkflowName([
    ...list,
    ...wfTabs.openIds.map((id) => ({ name: wfTabs.label(id) })),
  ]);
  const g = await api.createGraph(name, { kind: "workflow" });
  wfTabs.ensureOpen(g.id, g.name);
  await router.push(`/graph/${g.id}`);
}

async function closeWorkflowTab(id: string): Promise<void> {
  const wasActive = id === activeGraphId.value;
  const idx = wfTabs.openIds.indexOf(id);
  const remaining = wfTabs.openIds.filter((x) => x !== id);
  const neighbor = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)];

  if (wasActive && store.graph?.id === id) {
    if (store.graph.nodes.length === 0) {
      await discardEmptyDraft(id, { clearStore: true, closeTab: false });
    } else {
      await store.flush();
    }
  } else {
    await discardIfEmptyDraft(id);
  }
  dropTabRun(id);
  wfTabs.close(id);
  if (!wasActive) return;
  if (neighbor) await router.push(`/graph/${neighbor}`);
  else await router.push("/graph");
}

async function closeAllWorkflowTabs(): Promise<void> {
  tabCtx.value = undefined;
  wfListOpen.value = false;
  if (graphRunning.value) stopRun();
  const ids = [...wfTabs.openIds];
  if (store.graph) {
    if (store.graph.nodes.length === 0) {
      await discardEmptyDraft(store.graph.id, { clearStore: true, closeTab: false });
    } else {
      await store.flush();
    }
  }
  for (const id of ids) {
    if (id === store.graph?.id) continue;
    await discardIfEmptyDraft(id);
  }
  disposeTabRuns();
  wfTabs.closeAll();
  await router.push("/graph");
}

const tabCtx = ref<{
  id: string;
  name: string;
  kind: "workflow" | "subgraph";
  x: number;
  y: number;
}>();

async function openTabCtxMenu(e: MouseEvent, tid: string): Promise<void> {
  clearTabTextSelection();
  wfListOpen.value = false;
  ctxMenu.value = undefined;
  wireMenu.value = undefined;
  let kind: "workflow" | "subgraph" = "workflow";
  if (store.graph?.id === tid) {
    kind = store.graph.kind === "subgraph" ? "subgraph" : "workflow";
  } else {
    const fromList = wfListAll.value.find((g) => g.id === tid);
    if (fromList?.kind === "subgraph" || fromList?.kind === "workflow") {
      kind = fromList.kind;
    } else {
      try {
        const g = await api.graph(tid);
        kind = g.kind === "subgraph" ? "subgraph" : "workflow";
      } catch {
        // default workflow
      }
    }
  }
  tabCtx.value = {
    id: tid,
    name: wfTabs.label(tid),
    kind,
    x: e.clientX,
    y: e.clientY,
  };
}

/** Run a tab's workflow on the server without switching to it. */
async function runTabFromCtx(id: string): Promise<void> {
  tabCtx.value = undefined;
  if (tabRunPhase(id) === "running" || tabRunPhase(id) === "waiting") return;
  ensureNotifyPermission();
  if (id === store.graph?.id) {
    requestRun();
    return;
  }
  try {
    const g = await api.graph(id);
    if (needsImportConfirm(g)) {
      openImportConfirm(id, summarizeGraphExecution(g), () => void runTabFromCtx(id));
      return;
    }
    const issues = assessDetachedReadiness(g);
    const blockers = issues.filter((i) => i.blocking);
    if (blockers.length) {
      graphRunError.value = `can't run "${g.name}" — ${blockers.length} blocker(s); open the tab to fix`;
      return;
    }
    const params: Record<string, string> = {};
    for (const p of g.params ?? []) params[p.name] = p.default ?? "";
    const approveAll = issues.some((i) => !i.blocking);
    const total = g.nodes.filter(nodeExecutesOnRun).length;
    beginTabRun(id, undefined, total);
    const r = await fetch("/api/run/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphId: id,
        params,
        approveAll,
        projectDir: serverProjectDir.value,
      }),
    });
    const body = (await r.json()) as { jobId?: string; error?: string };
    if (!r.ok || !body.jobId) throw new Error(body.error ?? `run refused (${r.status})`);
    if (tabRuns[id]) tabRuns[id]!.jobId = body.jobId;
    trackDetachedJob(body.jobId, id, g.name);
    pushLog(
      body.jobId,
      "raw",
      `≫ background run · ${g.name} (job ${body.jobId})`,
    );
  } catch (err) {
    finishTabRun(id, false);
    graphRunError.value = err instanceof Error ? err.message : String(err);
  }
}

function canCloseTabsToRight(id: string): boolean {
  const idx = wfTabs.openIds.indexOf(id);
  return idx >= 0 && idx < wfTabs.openIds.length - 1;
}

async function loadTabGraph(id: string): Promise<Graph> {
  if (store.graph?.id === id) {
    await store.flush();
    return store.graph;
  }
  return api.graph(id);
}

async function exportTabGraph(id: string): Promise<void> {
  tabCtx.value = undefined;
  try {
    const g = await loadTabGraph(id);
    const json = JSON.stringify(toPortableGraph(g), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      exportState.value = "copied";
    } catch {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${g.name.replace(/[^\w-]+/g, "-") || "threadle-graph"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      exportState.value = "downloaded";
    }
    setTimeout(() => (exportState.value = ""), 1600);
  } catch (err) {
    alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function duplicateTabGraph(id: string): Promise<void> {
  tabCtx.value = undefined;
  try {
    const src = await loadTabGraph(id);
    const kind = src.kind === "subgraph" ? "subgraph" : "workflow";
    const copy = await api.createGraph(`${src.name} copy`.slice(0, 60), { kind });
    copy.kind = kind;
    // Fresh node/edge ids so the copy is independent (shared ids confuse jobs/debug).
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
      copy.params = JSON.parse(JSON.stringify(src.params)) as typeof src.params;
    }
    if (src.settings) {
      copy.settings = JSON.parse(JSON.stringify(src.settings)) as typeof src.settings;
    }
    if (src.viewport) copy.viewport = { ...src.viewport };
    await api.saveGraph(copy);
    wfTabs.ensureOpen(copy.id, copy.name);
    if (store.graph && store.graph.id !== copy.id) await leaveCurrentGraph();
    await router.push(`/graph/${copy.id}`);
  } catch (err) {
    alert(`Duplicate failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function convertTabKind(id: string): Promise<void> {
  const menu = tabCtx.value;
  tabCtx.value = undefined;
  const next = menu?.kind === "subgraph" ? "workflow" : "subgraph";
  try {
    if (store.graph?.id === id) await store.flush();
    const saved = await api.setGraphKind(id, next);
    if (store.graph?.id === id) store.graph.kind = saved.kind ?? next;
    const row = wfListAll.value.find((g) => g.id === id);
    if (row) row.kind = saved.kind ?? next;
  } catch (err) {
    alert(`Could not change kind: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function closeTabFromCtx(id: string): Promise<void> {
  tabCtx.value = undefined;
  await closeWorkflowTab(id);
}

async function closeOtherTabs(id: string): Promise<void> {
  tabCtx.value = undefined;
  const others = wfTabs.openIds.filter((x) => x !== id);
  if (!others.length) return;
  if (activeGraphId.value !== id) {
    await leaveCurrentGraph();
  }
  if (graphRunning.value && activeGraphId.value !== id) stopRun();
  for (const tid of others) {
    await discardIfEmptyDraft(tid);
    wfTabs.close(tid);
  }
  if (activeGraphId.value !== id) await router.push(`/graph/${id}`);
}

async function closeTabsToRight(id: string): Promise<void> {
  tabCtx.value = undefined;
  const idx = wfTabs.openIds.indexOf(id);
  if (idx < 0) return;
  const toClose = wfTabs.openIds.slice(idx + 1);
  if (!toClose.length) return;
  const closingActive = toClose.includes(activeGraphId.value);
  if (closingActive) {
    if (store.graph && store.graph.nodes.length === 0) {
      await discardEmptyDraft(store.graph.id, { clearStore: true, closeTab: false });
    } else if (store.graph) {
      await store.flush();
    }
    if (graphRunning.value) stopRun();
  }
  for (const tid of toClose) {
    await discardIfEmptyDraft(tid);
    wfTabs.close(tid);
  }
  if (closingActive && activeGraphId.value !== id) {
    await router.push(`/graph/${id}`);
  }
}

const TAB_DRAG_MIME = "application/x-threadle-tab";
const tabDragId = ref<string>();
const tabDropBefore = ref<string>();
const tabDropAfter = ref<string>();
let tabDragMoved = false;

function clearTabTextSelection(): void {
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) sel.removeAllRanges();
}

function clearTabDropHint(): void {
  tabDropBefore.value = undefined;
  tabDropAfter.value = undefined;
}

function onTabClick(tid: string): void {
  if (tabDragMoved) {
    tabDragMoved = false;
    return;
  }
  void switchWorkflow(tid);
}

function onTabDragStart(e: DragEvent, tid: string): void {
  clearTabTextSelection();
  tabDragId.value = tid;
  tabDragMoved = false;
  e.dataTransfer?.setData(TAB_DRAG_MIME, tid);
  e.dataTransfer?.setData("text/plain", tid);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onTabDragEnd(): void {
  tabDragId.value = undefined;
  clearTabDropHint();
  // click fires after dragend — keep suppress for one tick
  setTimeout(() => {
    tabDragMoved = false;
  }, 0);
}

function isTabDrag(e: DragEvent): boolean {
  return Boolean(tabDragId.value) ||
    Array.from(e.dataTransfer?.types ?? []).includes(TAB_DRAG_MIME);
}

function onTabDragOver(e: DragEvent, tid: string): void {
  if (!isTabDrag(e) || !tabDragId.value || tabDragId.value === tid) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  tabDragMoved = true;
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const before = e.clientX < rect.left + rect.width / 2;
  tabDropBefore.value = before ? tid : undefined;
  tabDropAfter.value = before ? undefined : tid;
}

function onTabDrop(e: DragEvent, tid: string): void {
  if (!isTabDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const from = tabDragId.value || e.dataTransfer?.getData(TAB_DRAG_MIME);
  if (!from || from === tid) {
    clearTabDropHint();
    return;
  }
  const ids = wfTabs.openIds;
  const targetIdx = ids.indexOf(tid);
  if (targetIdx < 0) return;
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const before = e.clientX < rect.left + rect.width / 2;
  const toIndex = before ? targetIdx : targetIdx + 1;
  wfTabs.move(from, toIndex);
  tabDragId.value = undefined;
  clearTabDropHint();
  tabDragMoved = true;
}

function onTabBarDragOver(e: DragEvent): void {
  if (!isTabDrag(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onTabBarDrop(e: DragEvent): void {
  if (!isTabDrag(e)) return;
  // Dropped on empty scroll area (not a tab) → append to end.
  if ((e.target as HTMLElement).closest?.(".wf-tab")) return;
  e.preventDefault();
  const from = tabDragId.value || e.dataTransfer?.getData(TAB_DRAG_MIME);
  if (!from) return;
  wfTabs.move(from, wfTabs.openIds.length);
  tabDragId.value = undefined;
  clearTabDropHint();
  tabDragMoved = true;
}

function onDocClickCloseWfList(): void {
  wfListOpen.value = false;
}

// live process load in the topbar: agent-less runs execute on this machine
const procTop = ref<{ cpuPct: number; activeCustomRuns: number; runningJobs: number }>();
let procTopTimer: ReturnType<typeof setInterval> | undefined;

async function pollProcTop(): Promise<void> {
  try {
    procTop.value = (await (
      await fetch("/api/internals/process")
    ).json()) as typeof procTop.value;
  } catch {
    // server unreachable — keep last value
  }
}
const { setNodes, setEdges, addNodes, removeNodes, screenToFlowCoordinate, findNode, getNodes, getSelectedNodes, fitView, getViewport, setViewport, setCenter, startConnection, updateConnection, endConnection, vueFlowRef } =
  useVueFlow();

/** Per-node error text from in-tab runs / materialize jobs — paints red shell. */
const runErrors = reactive<Record<string, string>>({});
const jobErrors = reactive<Record<string, string>>({});
/** Node ids from live workflow Issues (readiness) — also paint red. */
const issueErrorIds = ref(new Set<string>());

// opened from a linked frame: remember the parent for the breadcrumb + back
const parentGraph = ref<{ id: string; name: string }>();

watch(
  () => route.query.parent,
  async (pid) => {
    parentGraph.value = undefined;
    if (typeof pid !== "string" || !pid) return;
    try {
      const g = (await (await fetch(`/api/graphs/${pid}`)).json()) as { id: string; name: string };
      if (g?.id) parentGraph.value = { id: g.id, name: g.name };
    } catch {
      // parent gone — plain back
    }
  },
  { immediate: true },
);

function goBackEditor(): void {
  if (parentGraph.value) void router.push(`/graph/${parentGraph.value.id}`);
  else void router.push("/");
}

const currentDir = computed(
  () => sessions.sessions.find((s) => s.status === "running")?.projectDir,
);

const statusBarText = computed(() => {
  const save =
    ({ saved: "saved", saving: "saving…", dirty: "unsaved changes", error: "SAVE FAILED" } as const)[
      store.saveState
    ] ?? "";
  if (!store.graph) return "workflow · —";
  const empty = store.graph.nodes.length === 0;
  const parts = [
    empty ? "workflow · draft (not saved until a node is added)" : `workflow · ${save}`,
  ];
  if (pendingApproval.value) parts.push("waiting · approval (splice)");
  else if (pendingLiveHandoff.value) parts.push("waiting · live handoff");
  else if (waitingIdleNodeId.value) parts.push("waiting · idle");
  else if (graphRunning.value || activeTabBusy.value) parts.push("running");
  return parts.join(" · ");
});

const activeTabBusy = computed(() => {
  const id = store.graph?.id;
  if (graphRunning.value) return true;
  if (!id) return detachedBusy.value;
  const phase = tabRuns[id]?.phase;
  return phase === "running" || phase === "waiting";
});

const runButtonTitle = computed(() => {
  if (!canRunGraph.value) {
    return "Add something that executes — an agent, knot, output, converter, or similar";
  }
  return "Run on the threadle server (survives closing this tab)";
});

const RECIPE_SETUP_KEY = (id: string) => `threadle.recipeSetup.${id}`;
const recipeSetup = ref<RecipeSetupState | null>(null);

const serverProjectDir = ref<string>("");

const setupGaps = computed(() => {
  const g = store.graph;
  const setup = recipeSetup.value;
  if (!g || !setup) return { model: false, dir: false, session: false, any: false };
  const issues = assessWorkflowReadiness(g, {
    edges: effectiveEdges(),
    customInputs: (name) => customNodes.defs.find((d) => d.name === name)?.inputs,
  });
  const model = setup.needs.model && issues.some((i) => i.kind === "model");
  const session =
    setup.needs.session &&
    issues.some((i) => i.kind === "context" || i.message?.toLowerCase().includes("session"));
  const dir = setup.needs.dir && !serverProjectDir.value;
  return { model, dir, session, any: model || dir || session };
});

function loadRecipeSetup(graphId: string): void {
  try {
    const raw = sessionStorage.getItem(RECIPE_SETUP_KEY(graphId));
    if (!raw) {
      recipeSetup.value = null;
      return;
    }
    recipeSetup.value = JSON.parse(raw) as RecipeSetupState;
  } catch {
    recipeSetup.value = null;
  }
}

function dismissRecipeSetup(): void {
  const id = store.graph?.id;
  if (id) sessionStorage.removeItem(RECIPE_SETUP_KEY(id));
  recipeSetup.value = null;
}

const VP_KEY = (id: string) => `threadle.viewport.${id}`;

function saveViewportFor(graphId: string): void {
  try {
    const vp = getViewport();
    sessionStorage.setItem(VP_KEY(graphId), JSON.stringify(vp));
  } catch {
    // private mode
  }
}

function restoreViewportFor(graphId: string): boolean {
  try {
    const raw = sessionStorage.getItem(VP_KEY(graphId));
    if (!raw) return false;
    const vp = JSON.parse(raw) as { x: number; y: number; zoom: number };
    if (
      typeof vp.x !== "number" ||
      typeof vp.y !== "number" ||
      typeof vp.zoom !== "number"
    ) {
      return false;
    }
    void setViewport(vp);
    return true;
  } catch {
    return false;
  }
}

const activeRunningLabels = computed(() =>
  (store.graph?.nodes ?? [])
    .filter((n) => n.status === "running")
    .map((n) => nodeLabelOf(n)),
);

const activeQueuedLabels = computed(() =>
  (store.graph?.nodes ?? [])
    .filter((n) => n.status === "queued")
    .map((n) => nodeLabelOf(n)),
);

function frameCollapsed(frameId?: string): boolean {
  if (!frameId) return false;
  const f = store.nodeById(frameId);
  return f?.data.type === "group" && !!f.data.collapsed;
}

/** Vue Flow shell classes — mute/bypass + border on active / errored nodes. */
function nodeShellClass(n: GraphNode): string {
  const parts: string[] = [];
  if (n.muted) parts.push("node-muted");
  else if (n.bypassed) parts.push("node-bypassed");
  if (n.status === "running") parts.push("node-run-running");
  else if (
    n.status === "error" ||
    !!runErrors[n.id] ||
    !!jobErrors[n.id] ||
    issueErrorIds.value.has(n.id)
  ) {
    parts.push("node-run-error");
  }
  return parts.join(" ");
}

function toVfNode(n: GraphNode): VFNode {
  // output nodes, group frames and notes are resizable; restore persisted dimensions
  const collapsed = n.data.type === "group" && n.data.collapsed;
  const size = collapsed
    ? { width: 300, height: 46 }
    : n.data.type === "output" || n.data.type === "group" || n.data.type === "note"
      ? n.data.size
      : undefined;
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
    class: nodeShellClass(n),
    style: size ? { width: `${size.width}px`, height: `${size.height}px` } : undefined,
    // frames live behind the nodes they contain (collapsed bars act like nodes)
    // notes always float above frames — they are never frame members
    zIndex:
      n.data.type === "note"
        ? 5
        : n.data.type === "group"
          ? collapsed
            ? 0
            : -10
          : undefined,
    // members of a minimized frame are hidden, not gone (notes never hide with frames)
    hidden: !!(n.data.type !== "note" && n.subOf && frameCollapsed(n.subOf)),
  };
}

/**
 * Edges are derived from the store: each wire is color-coded by the
 * source node type, and animates while its target runs.
 * Re-derived on every relevant status change, so the canvas can't drift.
 */
const edgesLive = ref(false);

function edgeEndpointHidden(id: string): boolean {
  const n = store.nodeById(id);
  return !!(n?.subOf && frameCollapsed(n.subOf));
}

function toVfEdge(e: GraphEdge): VFEdge {
  const src = store.nodeById(e.source);
  const s = src?.data.type;
  const isChild = e.data?.role === "child";
  const active = store.nodeById(e.target)?.status === "running";
  const classes: string[] = [];
  if (isChild) {
    classes.push("edge-child");
  } else {
    classes.push(s ? `src-${s}` : "src-unknown");
    if (src?.data.type === "agent-def") {
      classes.push(`prov-${src.data.ref.provider}`);
    }
    if (e.sourceHandle === "out:err" || e.sourceHandle === "err") {
      classes.push("edge-err");
    }
    if (active) classes.push("edge-active");
  }
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    type: isChild ? "straight" : "default",
    interactionWidth: 28,
    hidden: edgeEndpointHidden(e.source) || edgeEndpointHidden(e.target),
    class: classes,
  };
}

function refreshEdges(): void {
  const g = store.graph;
  if (!g || !edgesLive.value) return;
  setEdges(g.edges.map(toVfEdge));
}

watch(
  () =>
    [
      store.graph?.nodes.map((n) => `${n.id}:${n.status}`).join("|"),
      Object.entries(runErrors)
        .map(([k, v]) => `${k}=${v}`)
        .join("|"),
      Object.entries(jobErrors)
        .map(([k, v]) => `${k}=${v}`)
        .join("|"),
      [...issueErrorIds.value].join("|"),
    ].join("~"),
  () => {
    refreshEdges();
    syncAllNodeShellClasses();
  },
);

async function loadGraph(): Promise<void> {
  const prevId = store.graph?.id;
  if (prevId && graphReady.value) saveViewportFor(prevId);
  const rawId = route.params.id;
  const loadId = typeof rawId === "string" && rawId.length > 0 ? rawId : "";

  // Persist non-empty work when switching; empty drafts stay alive in their tabs.
  if (prevId && prevId !== loadId && store.graph && store.graph.nodes.length > 0) {
    await store.flush();
  }

  // Switching tabs must not leave a run mutating the previous graph.
  if (graphRunning.value) stopRun();
  stopDetachedPoll();
  clearPayloadCache(); // transcripts from the previous graph — don't retain
  graphReady.value = false;
  recipeSetup.value = null;
  const gen = ++graphLoadGen;
  edgesLive.value = false;
  setNodes([]);
  setEdges([]);

  if (loadId) {
    consumePendingFoldersHandoff(loadId);
    void refreshFolderIndex();
  }

  // No workflow in the URL — seed an empty "Workflow N" (ephemeral until it has nodes).
  if (!loadId) {
    try {
      const list = await api.graphs();
      const name = nextWorkflowName([
        ...list,
        ...wfTabs.openIds.map((id) => ({ name: wfTabs.label(id) })),
      ]);
      const g = await api.createGraph(name, { kind: "workflow" });
      if (gen !== graphLoadGen) return;
      wfTabs.ensureOpen(g.id, g.name);
      await router.replace(`/graph/${g.id}`);
    } catch (err) {
      store.clear();
      setNodes([]);
      setEdges([]);
      edgesLive.value = true;
      graphReady.value = true;
      graphRunError.value = err instanceof Error ? err.message : String(err);
    }
    return;
  }

  await store.load(loadId);
  if (gen !== graphLoadGen) return;
  if (String(route.params.id ?? "") !== loadId) return;
  const g = store.graph;
  if (!g || g.id !== loadId) return;
  wfTabs.ensureOpen(g.id, g.name);
  loadRecipeSetup(loadId);
  // ?run=1 (from "⟳ re-run" in Runs): start the chain as soon as the graph is up
  if (route.query.run === "1") {
    void router.replace({ query: { ...route.query, run: undefined } });
    setTimeout(() => {
      if (
        graphReady.value &&
        store.graph?.id === loadId &&
        canRunGraph.value &&
        !graphRunning.value &&
        !graphHasDetachedJob(loadId)
      ) {
        void autoRunWithDefaults();
      }
    }, 600);
  }
  const resumed = await resumeServerJobsForGraph(loadId);
  if (gen !== graphLoadGen || String(route.params.id ?? "") !== loadId) return;
  // Wipe mid-run paint only when nothing is actually running on the server.
  // Detached jobs persist statuses on disk — keep them so reopen shows progress.
  if (!resumed) {
    for (const n of g.nodes) {
      if (n.status === "running" || n.status === "queued") n.status = "idle";
    }
  }
  await syncLinkedFrames();
  if (gen !== graphLoadGen || String(route.params.id ?? "") !== loadId) return;
  detachNotesFromFrames();
  setNodes(g.nodes.map(toVfNode));
  setEdges(g.edges.map(toVfEdge));
  edgesLive.value = true;
  graphReady.value = true;
  // Restore this tab's camera when known; otherwise fit the graph.
  setTimeout(() => {
    if (store.graph?.id !== loadId) return;
    if (!restoreViewportFor(loadId)) void fitView({ padding: 0.15 });
  }, 80);
}

onMounted(async () => {
  if (!sessions.sessions.length) void sessions.refresh();
  void hydrateTabNames();
  void ensureFoldersLoaded().then(() => syncNameDraft());
  await loadGraph();
  void resumeOpenTabJobs();
});

/** Fill titles for every open tab (names are not always present after a reload). */
async function hydrateTabNames(): Promise<void> {
  if (!wfTabs.openIds.length) return;
  try {
    const list = await api.graphs();
    const listed = new Set(list.map((g) => g.id));
    for (const g of list) {
      if (wfTabs.openIds.includes(g.id) && g.name) wfTabs.setName(g.id, g.name);
    }
    // Drop tabs that no longer exist (abandoned empty drafts after restart).
    for (const id of [...wfTabs.openIds]) {
      if (listed.has(id)) continue;
      const g = await api.graph(id).catch(() => undefined);
      if (!g || g.nodes.length === 0) {
        forgetPendingFolders(id);
        wfTabs.close(id);
      }
    }
  } catch {
    /* ignore — tabs fall back to id until a graph loads */
  }
}

watch(() => route.params.id, loadGraph);

watch(
  () => store.graph?.name,
  (name) => {
    if (store.graph && name) wfTabs.setName(store.graph.id, name);
  },
);

function nodeType(id: string): NodeType | undefined {
  return store.nodeById(id)?.type;
}

const {
  emittedType,
  expectedType,
  customPortsFor,
  checkConnection,
  checkConnectionTypes,
} = useConnectionRules({
  nodeById: (id) => store.nodeById(id),
  findCustomDef: (name) => customNodes.defs.find((d) => d.name === name),
});

// ---- export (shareable JSON) ----

const exportState = ref<"" | "copied" | "downloaded">("");
const historyOpen = ref(false);
const historyBusy = ref(false);
const historyVersions = ref<
  Array<{ ts: string; updatedAt?: number; name?: string; nodeCount?: number }>
>([]);

async function toggleHistory(): Promise<void> {
  if (historyOpen.value) {
    historyOpen.value = false;
    return;
  }
  const id = store.graph?.id;
  if (!id) return;
  historyBusy.value = true;
  try {
    historyVersions.value = await api.graphVersions(id);
    historyOpen.value = true;
  } catch {
    historyVersions.value = [];
    historyOpen.value = true;
  } finally {
    historyBusy.value = false;
  }
}

async function restoreVersion(ts: string): Promise<void> {
  const id = store.graph?.id;
  if (!id) return;
  if (!confirm(`Restore version ${ts}? Current graph will be snapshotted first.`)) return;
  historyBusy.value = true;
  try {
    const g = await api.restoreGraphVersion(id, ts);
    await store.load(g.id);
    rebuildCanvas();
    historyOpen.value = false;
  } catch (err) {
    alert(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    historyBusy.value = false;
  }
}
const exportLabel = computed(
  () =>
    ({ "": "⤒ Export", copied: "✓ Copied", downloaded: "✓ Downloaded" })[
      exportState.value
    ],
);

async function exportGraph(): Promise<void> {
  const g = store.graph;
  if (!g) return;
  await store.flush(); // persist pending edits so the export is current
  const json = JSON.stringify(toPortableGraph(g), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    exportState.value = "copied";
  } catch {
    // clipboard unavailable — fall back to a file download
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${g.name.replace(/[^\w-]+/g, "-") || "threadle-graph"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    exportState.value = "downloaded";
  }
  setTimeout(() => (exportState.value = ""), 1600);
}

/** id → run status, handed to node components (Vue Flow only forwards fixed props). */
const nodeStatuses = computed(() =>
  Object.fromEntries(
    (store.graph?.nodes ?? []).map((n) => [n.id, n.status] as const),
  ),
);

/** Full single-capacity ports drop the old wire(s) for the new one. */
function displaceForConnection(conn: Connection, ignoreEdgeId?: string): void {
  const ids = edgesDisplacedByConnection(
    store.graph?.edges ?? [],
    conn,
    (id) => nodeType(id),
    { customPorts: customPortsFor, ignoreEdgeId },
  );
  for (const id of ids) store.removeEdge(id);
}

function edgeRole(source: NodeType, target: NodeType): GraphEdge["data"] {
  if (source === "session" && target === "subagent-run") return { role: "child" };
  if (target === "context") return { role: "extract" };
  if (source === "context") return { role: "inject" };
  return { role: "instantiate" };
}

function onConnect(conn: Connection): void {
  wireDidConnect = true;
  if (!checkConnection(conn)) return;
  const s = nodeType(conn.source)!;
  const t = nodeType(conn.target)!;
  displaceForConnection(conn);
  const edge: GraphEdge = {
    id: crypto.randomUUID().slice(0, 8),
    source: conn.source,
    target: conn.target,
    sourceHandle: conn.sourceHandle ?? undefined,
    targetHandle: conn.targetHandle ?? undefined,
    data: edgeRole(s, t),
  };
  store.addEdge(edge);
  refreshEdges();
}

/** Topmost non-decorative node under a flow-space point (drop-on-node). */
function nodeUnderPointer(
  pos: { x: number; y: number },
  excludeId?: string,
): VFNode | undefined {
  const nodes = getNodes.value;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (n.id === excludeId || n.hidden) continue;
    const gn = store.nodeById(n.id);
    if (!gn || gn.data.type === "group" || gn.data.type === "note") continue;
    const origin = nodeFlowOrigin(n);
    const w = n.dimensions?.width ?? 180;
    const h = n.dimensions?.height ?? 80;
    if (
      pos.x >= origin.x &&
      pos.x <= origin.x + w &&
      pos.y >= origin.y &&
      pos.y <= origin.y + h
    ) {
      return n;
    }
  }
  return undefined;
}

/** Closest handle of the sought type on a node; falls back to first named port. */
function pickHandleNear(
  nodeId: string,
  seek: "source" | "target",
  near: { x: number; y: number },
): string | null {
  const vf = findNode(nodeId);
  const bounds = seek === "source" ? vf?.handleBounds?.source : vf?.handleBounds?.target;
  if (bounds?.length && vf) {
    const origin = nodeFlowOrigin(vf);
    let best = bounds[0]!;
    let bestD = Number.POSITIVE_INFINITY;
    for (const h of bounds) {
      const hx = origin.x + h.x + h.width / 2;
      const hy = origin.y + h.y + h.height / 2;
      const d = (hx - near.x) ** 2 + (hy - near.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return normalizeHandleId(best.id);
  }
  return firstPortHandle(nodeId, seek === "source" ? "out" : "in") ?? null;
}

function connectionFromMagnet(
  from: { nodeId: string; handleType: "source" | "target"; handleId?: string | null },
  toNodeId: string,
  near: { x: number; y: number },
): Connection | undefined {
  if (from.nodeId === toNodeId) return undefined;
  const seek = from.handleType === "source" ? "target" : "source";
  const handleId = pickHandleNear(toNodeId, seek, near);
  const conn: Connection =
    from.handleType === "source"
      ? {
          source: from.nodeId,
          sourceHandle: from.handleId ?? null,
          target: toNodeId,
          targetHandle: handleId,
        }
      : {
          source: toNodeId,
          sourceHandle: handleId,
          target: from.nodeId,
          targetHandle: from.handleId ?? null,
        };
  return checkConnection(conn) ? conn : undefined;
}

/** Drop a new wire (or reconnect) onto a node body → snap to its connector. */
function tryMagnetToNode(
  from: { nodeId: string; handleType: "source" | "target"; handleId?: string | null },
  e: MouseEvent,
): Connection | undefined {
  const near = screenToFlowCoordinate({ x: e.clientX, y: e.clientY });
  const hit = nodeUnderPointer(near, from.nodeId);
  if (!hit) return undefined;
  return connectionFromMagnet(from, hit.id, near);
}

function applyEdgeReconnect(
  edgeId: string,
  connection: Connection,
  data?: GraphEdge["data"],
): boolean {
  if (!checkConnectionTypes(connection)) return false;
  const s = nodeType(connection.source);
  const t = nodeType(connection.target);
  if (!s || !t) return false;
  if (connection.source === connection.target) return false;
  displaceForConnection(connection, edgeId);
  store.removeEdge(edgeId);
  store.addEdge({
    id: edgeId,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
    data: data ?? edgeRole(s, t),
  });
  refreshEdges();
  return true;
}

/**
 * Drag an occupied input (or single-wire output) slot to pick up that wire.
 * Grab happens on the connector itself. Alt-drag forces a brand-new connection instead.
 * Detach only after the pointer moves — a click keeps the link; drop on another
 * compatible connector reconnects; empty canvas unlinks.
 */
let slotPickup:
  | {
      id: string;
      source: string;
      sourceHandle?: string;
      target: string;
      targetHandle?: string;
      data?: GraphEdge["data"];
      mode: "input" | "output";
      originX: number;
      originY: number;
      moved: boolean;
      detached: boolean;
    }
  | undefined;

function normalizeHandleId(id: string | null | undefined): string | null {
  if (id == null || id === "" || id === "null" || id === "undefined") return null;
  return id;
}

function findIncomingEdge(nodeId: string, handleId?: string | null): GraphEdge | undefined {
  const want = normalizeHandleId(handleId);
  return (store.graph?.edges ?? []).find((e) => {
    if (e.target !== nodeId || e.data?.role === "child") return false;
    const eh = normalizeHandleId(e.targetHandle);
    if (!want) return !eh;
    return eh === want;
  });
}

function findOutgoingSoloEdge(nodeId: string, handleId?: string | null): GraphEdge | undefined {
  const want = normalizeHandleId(handleId);
  const edges = (store.graph?.edges ?? []).filter((e) => {
    if (e.source !== nodeId || e.data?.role === "child") return false;
    const eh = normalizeHandleId(e.sourceHandle);
    if (!want) return !eh;
    return eh === want;
  });
  return edges.length === 1 ? edges[0] : undefined;
}

/** Vue Flow connection line expects pointer coords relative to the flow pane, not flow-space. */
function connectionPointerPos(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const bounds = vueFlowRef.value?.getBoundingClientRect();
  return {
    x: e.clientX - (bounds?.left ?? 0),
    y: e.clientY - (bounds?.top ?? 0),
  };
}

function nodeFlowOrigin(n: {
  position: { x: number; y: number };
  computedPosition?: { x: number; y: number };
}): { x: number; y: number } {
  const c = n.computedPosition;
  if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return { x: c.x, y: c.y };
  return { x: n.position.x, y: n.position.y };
}

/** Radius (flow units) for snapping a dragged wire onto a connector. */
const SLOT_DROP_RADIUS = 56;

/**
 * Closest compatible handle under the cursor (connection-radius style).
 * Prefer this over elementFromPoint — handles are small and easy to miss.
 */
function closestSlotDropConnection(
  state: {
    mode: "input" | "output";
    source: string;
    sourceHandle?: string;
    target: string;
    targetHandle?: string;
  },
  near: { x: number; y: number },
): Connection | undefined {
  const seek: "source" | "target" = state.mode === "input" ? "target" : "source";
  let best: { conn: Connection; d: number } | undefined;

  for (const n of getNodes.value) {
    if (n.hidden) continue;
    const gn = store.nodeById(n.id);
    if (!gn || gn.data.type === "group" || gn.data.type === "note") continue;
    const bounds = seek === "target" ? n.handleBounds?.target : n.handleBounds?.source;
    if (!bounds?.length) continue;
    const origin = nodeFlowOrigin(n);
    for (const h of bounds) {
      const hx = origin.x + h.x + h.width / 2;
      const hy = origin.y + h.y + h.height / 2;
      const d = Math.hypot(hx - near.x, hy - near.y);
      if (d > SLOT_DROP_RADIUS) continue;
      const handleId = normalizeHandleId(h.id);
      const conn: Connection =
        state.mode === "input"
          ? {
              source: state.source,
              sourceHandle: normalizeHandleId(state.sourceHandle),
              target: n.id,
              targetHandle: handleId,
            }
          : {
              source: n.id,
              sourceHandle: handleId,
              target: state.target,
              targetHandle: normalizeHandleId(state.targetHandle),
            };
      if (conn.source === conn.target) continue;
      if (!checkConnectionTypes(conn)) continue;
      if (!best || d < best.d) best = { conn, d };
    }
  }
  return best?.conn;
}

function handleUnderClientPoint(clientX: number, clientY: number): Element | null {
  const stack =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)];
  for (const el of stack) {
    if (!(el instanceof Element)) continue;
    const handle = el.closest(".vue-flow__handle");
    if (handle) return handle;
  }
  return null;
}

function beginSlotConnectionLine(
  state: {
    mode: "input" | "output";
    source: string;
    sourceHandle?: string;
    target: string;
    targetHandle?: string;
  },
  e: { clientX: number; clientY: number },
): void {
  const fixedNodeId = state.mode === "input" ? state.source : state.target;
  const fixedType = state.mode === "input" ? ("source" as const) : ("target" as const);
  const fixedHandleId =
    normalizeHandleId(state.mode === "input" ? state.sourceHandle : state.targetHandle);
  const vf = findNode(fixedNodeId);
  const bounds = fixedType === "source" ? vf?.handleBounds?.source : vf?.handleBounds?.target;
  const hb =
    (fixedHandleId ? bounds?.find((h) => normalizeHandleId(h.id) === fixedHandleId) : undefined) ??
    bounds?.[0];
  const origin = vf ? nodeFlowOrigin(vf) : { x: 0, y: 0 };
  const fx = vf && hb ? origin.x + hb.x + hb.width / 2 : 0;
  const fy = vf && hb ? origin.y + hb.y + hb.height / 2 : 0;
  startConnection(
    {
      nodeId: fixedNodeId,
      type: fixedType,
      id: fixedHandleId,
      position: hb?.position ?? (fixedType === "source" ? Position.Right : Position.Left),
      x: fx,
      y: fy,
    },
    connectionPointerPos(e),
  );
}

function beginSlotPickupGesture(
  edge: GraphEdge,
  mode: "input" | "output",
  e: PointerEvent,
): void {
  // Steal the gesture so Vue Flow does not select / pan / start a fresh wire
  e.preventDefault();
  e.stopImmediatePropagation();

  slotPickup = {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    data: edge.data,
    mode,
    originX: e.clientX,
    originY: e.clientY,
    moved: false,
    detached: false,
  };

  const onMove = (ev: PointerEvent): void => {
    if (!slotPickup) return;
    if (
      !slotPickup.moved &&
      (Math.abs(ev.clientX - slotPickup.originX) > 4 ||
        Math.abs(ev.clientY - slotPickup.originY) > 4)
    ) {
      slotPickup.moved = true;
    }
    // Detach only once the drag starts — keeps a click from briefly unlinking
    if (slotPickup.moved && !slotPickup.detached) {
      store.removeEdge(slotPickup.id);
      refreshEdges();
      slotPickup.detached = true;
      beginSlotConnectionLine(slotPickup, ev);
    }
    if (slotPickup.detached) updateConnection(connectionPointerPos(ev));
  };

  const onUp = (ev: PointerEvent): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    finishSlotPickup(ev);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function onSlotPickupPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || e.altKey || slotPickup) return;
  const el = e.target;
  if (!(el instanceof Element)) return;

  // Prefer an occupied connector — same Comfy grab as before
  const handle = el.closest(".vue-flow__handle");
  if (handle) {
    const nodeId = handle.getAttribute("data-nodeid");
    if (!nodeId) return;
    const handleId = normalizeHandleId(handle.getAttribute("data-handleid"));
    const isTarget = handle.classList.contains("target");
    const isSource = handle.classList.contains("source");

    // Shift+click a connector → list nodes that can wire to/from it
    if (e.shiftKey && (isSource || isTarget)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openWireMenuFromHandle({
        nodeId,
        handleType: isSource ? "source" : "target",
        handleId: handleId ?? undefined,
        clientX: e.clientX,
        clientY: e.clientY,
      });
      return;
    }

    let edge: GraphEdge | undefined;
    let mode: "input" | "output" | undefined;
    if (isTarget) {
      edge = findIncomingEdge(nodeId, handleId);
      mode = "input";
    } else if (isSource) {
      edge = findOutgoingSoloEdge(nodeId, handleId);
      mode = "output";
    }
    if (!edge || !mode) return;
    beginSlotPickupGesture(edge, mode, e);
    return;
  }

  // Drag the wire body → detach from the *input* (target) end; source stays fixed
  const edgeEl = el.closest(".vue-flow__edge");
  if (!edgeEl) return;
  const edgeId = edgeEl.getAttribute("data-id");
  if (!edgeId) return;
  const edge = store.graph?.edges.find((x) => x.id === edgeId);
  if (!edge || edge.data?.role === "child") return;
  beginSlotPickupGesture(edge, "input", e);
}

function finishSlotPickup(e: PointerEvent): void {
  const state = slotPickup;
  slotPickup = undefined;
  endConnection(e);
  if (!state) return;

  // Click / no real drag — edge never left the store
  if (!state.moved || !state.detached) {
    refreshEdges();
    return;
  }

  const near = screenToFlowCoordinate({ x: e.clientX, y: e.clientY });

  // 1) Closest compatible connector within snap radius
  const snapped = closestSlotDropConnection(state, near);
  if (snapped && applyEdgeReconnect(state.id, snapped, state.data)) return;

  // 2) Exact DOM hit (handles stacked under overlays)
  const handle = handleUnderClientPoint(e.clientX, e.clientY);
  if (handle) {
    const nodeId = handle.getAttribute("data-nodeid");
    const handleId = normalizeHandleId(handle.getAttribute("data-handleid"));
    if (nodeId) {
      const conn: Connection | undefined =
        state.mode === "input" && handle.classList.contains("target")
          ? {
              source: state.source,
              sourceHandle: normalizeHandleId(state.sourceHandle),
              target: nodeId,
              targetHandle: handleId,
            }
          : state.mode === "output" && handle.classList.contains("source")
            ? {
                source: nodeId,
                sourceHandle: handleId,
                target: state.target,
                targetHandle: normalizeHandleId(state.targetHandle),
              }
            : undefined;
      if (conn && applyEdgeReconnect(state.id, conn, state.data)) return;
    }
  }

  // 3) Magnet onto a node body → nearest port of the right side
  if (state.mode === "input") {
    const hit = nodeUnderPointer(near, state.source);
    if (hit) {
      const conn = connectionFromMagnet(
        { nodeId: state.source, handleType: "source", handleId: state.sourceHandle },
        hit.id,
        near,
      );
      if (conn && applyEdgeReconnect(state.id, conn, state.data)) return;
    }
  } else {
    const hit = nodeUnderPointer(near, state.target);
    if (hit) {
      const conn = connectionFromMagnet(
        { nodeId: state.target, handleType: "target", handleId: state.targetHandle },
        hit.id,
        near,
      );
      if (conn && applyEdgeReconnect(state.id, conn, state.data)) return;
    }
  }

  // Empty / invalid drop — leave detached (Comfy-style unlink)
  refreshEdges();
}

// Dragging a group frame carries its members — notes never ride along.
let groupDrag:
  | { id: string; start: { x: number; y: number }; members: string[] }
  | undefined;

/** Notes are canvas annotations — never frame members, never sticky to subgraphs. */
function isAnnotative(n: GraphNode | undefined): boolean {
  return n?.data.type === "note";
}

/** Nodes that may belong to a frame (excludes groups + notes). */
function canBelongToFrame(n: GraphNode): boolean {
  return n.data.type !== "group" && n.data.type !== "note";
}

/** Clear stray note membership (legacy graphs / bad syncs). */
function detachNotesFromFrames(): void {
  const g = store.graph;
  if (!g) return;
  for (const n of g.nodes) {
    if (n.data.type === "note" && (n.subOf || n.originId)) {
      n.subOf = undefined;
      n.originId = undefined;
    }
  }
}

function onNodeDragStart(e: { node: VFNode }): void {
  groupDrag = undefined;
  const n = store.nodeById(e.node.id);
  if (!n || n.data.type !== "group" || !store.graph) return;
  const linked = !!n.data.graphId;
  const rect = {
    x: n.position.x,
    y: n.position.y,
    w: n.data.size.width,
    h: n.data.size.height,
  };
  const members = store.graph.nodes
    .filter((m) => {
      if (m.id === n.id || !canBelongToFrame(m)) return false;
      if (m.subOf === n.id) return true; // tagged members always travel with the frame
      // Linked sub-workflows move only their tagged members — spatial hitchhikers
      // (notes, loose nodes overlapping the frame) stay put.
      if (linked) return false;
      const dims = findNode(m.id)?.dimensions;
      const cx = m.position.x + (dims?.width ?? 200) / 2;
      const cy = m.position.y + (dims?.height ?? 70) / 2;
      return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    })
    .map((m) => m.id);
  groupDrag = { id: n.id, start: { ...n.position }, members };
}

function onNodeDragStop(e: { node: VFNode }): void {
  const n = store.nodeById(e.node.id);
  if (!n) return;
  const prev = { ...n.position };
  n.position = { x: e.node.position.x, y: e.node.position.y };
  if (groupDrag && groupDrag.id === n.id) {
    const dx = n.position.x - groupDrag.start.x;
    const dy = n.position.y - groupDrag.start.y;
    void prev;
    for (const id of groupDrag.members) {
      const m = store.nodeById(id);
      const vf = findNode(id);
      if (!m) continue;
      m.position = { x: m.position.x + dx, y: m.position.y + dy };
      if (vf) vf.position = { ...m.position };
    }
    groupDrag = undefined;
  } else if (canBelongToFrame(n)) {
    // adopt / leave frames by spatial containment (membership drives collapse + run I/O)
    reconcileMembership(n.id);
  } else if (isAnnotative(n)) {
    // notes never join frames
    n.subOf = undefined;
    n.originId = undefined;
  }
}

/** Tag a node with subOf for the innermost frame that contains its center. */
function reconcileMembership(nodeId: string): void {
  const g = store.graph;
  const n = store.nodeById(nodeId);
  if (!g || !n || !canBelongToFrame(n)) {
    if (n && isAnnotative(n)) {
      n.subOf = undefined;
      n.originId = undefined;
    }
    return;
  }
  // linked members stay tagged to their frame — don't steal them by drag
  if (n.subOf) {
    const frame = store.nodeById(n.subOf);
    if (frame?.data.type === "group" && frame.data.graphId) return;
  }
  const dims = findNode(nodeId)?.dimensions;
  const cx = n.position.x + (dims?.width ?? 200) / 2;
  const cy = n.position.y + (dims?.height ?? 70) / 2;
  let best: GraphNode | undefined;
  let bestArea = Infinity;
  for (const f of g.nodes) {
    if (f.data.type !== "group" || f.data.collapsed) continue;
    // plain groups accept spatial membership; linked frames only keep explicit tags
    if (f.data.graphId) continue;
    const w = f.data.size.width;
    const h = f.data.size.height;
    if (
      cx >= f.position.x &&
      cx <= f.position.x + w &&
      cy >= f.position.y &&
      cy <= f.position.y + h
    ) {
      const area = w * h;
      if (area < bestArea) {
        best = f;
        bestArea = area;
      }
    }
  }
  const next = best?.id;
  if (n.subOf !== next) {
    n.subOf = next;
    if (!next) n.originId = undefined;
  }
}

/**
 * Vue Flow removes a node's edges before the node itself, so when the
 * session's remove-change arrives its child edges are already gone from the
 * store. Stash child-edge targets at edge-removal time; the freshness window
 * keeps a manually deleted wire from causing a false cascade much later.
 */
const pendingChildTargets = new Map<string, { targets: string[]; at: number }>();

function onNodesChange(changes: NodeChange[]): void {
  for (const ch of changes) {
    if (ch.type !== "remove") continue;
    // deleting a session takes its attached subagent-run nodes with it —
    // they exist because of the session and are meaningless without it
    const node = store.nodeById(ch.id);
    const cascade = new Set<string>();
    if (node?.data.type === "session") {
      const stashed = pendingChildTargets.get(ch.id);
      pendingChildTargets.delete(ch.id);
      if (stashed && Date.now() - stashed.at < 500) {
        for (const t of stashed.targets) cascade.add(t);
      }
      for (const e of store.graph?.edges ?? []) {
        if (e.source === ch.id && e.data?.role === "child") cascade.add(e.target);
      }
    }
    store.removeNode(ch.id);
    const victims = [...cascade].filter(
      (id) => store.nodeById(id)?.data.type === "subagent-run",
    );
    for (const id of victims) store.removeNode(id);
    if (victims.length) removeNodes(victims);
  }
}

function onEdgesChange(changes: EdgeChange[]): void {
  for (const ch of changes) {
    if (ch.type !== "remove") continue;
    const edge = store.graph?.edges.find((e) => e.id === ch.id);
    if (edge?.data?.role === "child") {
      // sweep entries past the 500ms freshness window — the check below only
      // gated USE; stale stashes (child edge deleted, session kept) piled up
      const now = Date.now();
      for (const [key, e] of pendingChildTargets) {
        if (now - e.at > 500) pendingChildTargets.delete(key);
      }
      const entry = pendingChildTargets.get(edge.source) ?? { targets: [], at: now };
      entry.targets.push(edge.target);
      entry.at = now;
      pendingChildTargets.set(edge.source, entry);
    }
    store.removeEdge(ch.id);
  }
}

interface DragPayload {
  kind:
    | "session"
    | "agent-def"
    | "context"
    | "prompt"
    | "output"
    | "prompt-convert"
    | "delay"
    | "data"
    | "approval"
    | "live-handoff"
    | "wait-idle"
    | "iterator"
    | "knot"
    | "tripwire"
    | "judge"
    | "until"
    | "group"
    | "note"
    | "custom"
    | "mcp-tool"
    | "skill"
    | "rules"
    | "subgraph";
  graphId?: string;
  provider?: ProviderId;
  sessionId?: string;
  nodeType?: "session" | "subagent-run";
  snapshot?: { title?: string; agent?: string; projectDir?: string };
  name?: string;
  source?: string;
  server?: string;
  tool?: string;
  contextKind?: "distilled-summary" | "transcript-excerpt" | "files";
  /** a library payload to pre-materialize the context node with */
  payloadHash?: string;
  label?: string;
  path?: string;
  description?: string;
  origin?: "project" | "custom" | "imported" | "global";
  autoInvoke?: boolean;
  shadowedBy?: string;
}

function onDragOver(e: DragEvent): void {
  e.preventDefault();
  if (e.dataTransfer && isFileDrag(e)) e.dataTransfer.dropEffect = "copy";
}

function onDragEnter(e: DragEvent): void {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  fileDragDepth += 1;
  fileDragOver.value = true;
}

function onDragLeave(e: DragEvent): void {
  if (!isFileDrag(e)) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) fileDragOver.value = false;
}

function isFileDrag(e: DragEvent): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes("Files");
}

const fileDragOver = ref(false);
let fileDragDepth = 0;

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  fileDragDepth = 0;
  fileDragOver.value = false;

  const file = e.dataTransfer?.files?.[0];
  if (file) {
    await importWorkflowFile(file);
    return;
  }

  const raw = e.dataTransfer?.getData("application/threadle");
  if (!raw || !store.graph) return;
  const payload = validateDragPayloadJsonText(raw);
  if (!payload.ok) {
    pushLog("run", "raw", `· drop ignored — ${payload.error}`);
    return;
  }
  const position = screenToFlowCoordinate({ x: e.clientX, y: e.clientY });
  if (payload.data.kind === "subgraph" && payload.data.graphId) {
    void importSubgraph(payload.data.graphId, payload.data.name ?? "subgraph", position);
    return;
  }
  const node = buildNode(payload.data as DragPayload, position);
  if (node) {
    store.addNode(node);
    addNodes([toVfNode(node)]);
    if (node.type === "session") void attachSubagents(node);
  }
}

/** Load a portable `threadle/graph@1` JSON into the current empty canvas. */
async function importWorkflowFile(file: File): Promise<void> {
  const g = store.graph;
  if (!g) return;
  if (g.nodes.length > 0) {
    alert("Drop a workflow JSON onto an empty canvas (clear nodes first, or open a new workflow).");
    return;
  }
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
    alert("Drop a .json workflow export (threadle/graph@1).");
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    alert("Could not parse JSON.");
    return;
  }
  const parsed = validatePortableGraphImport(raw);
  if (!parsed.ok) {
    alert(parsed.error);
    return;
  }
  const transplant = async (): Promise<void> => {
    try {
      // Import via API so skill/rules paths resolve, then transplant into this graph id.
      const imported = await api.importGraph(parsed.data);
      g.name = imported.name;
      g.nodes = imported.nodes;
      g.edges = imported.edges;
      g.params = imported.params?.map((p) => ({ ...p }));
      g.viewport = imported.viewport;
      await api.deleteGraph(imported.id).catch(() => undefined);
      edgesLive.value = true;
      setNodes(g.nodes.map(toVfNode));
      setEdges(g.edges.map(toVfEdge));
      for (const n of g.nodes) {
        if (n.type === "session") void attachSubagents(n);
      }
      void syncLinkedFrames();
      setTimeout(() => void fitView({ padding: 0.15 }), 80);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // The transplant lands the nodes in THIS (already-trusted) graph id, so
  // the server's imported-graph gate never sees them — confirm the manifest
  // client-side before merging. (confirm-import on a non-imported graph is
  // an idempotent no-op server-side.)
  const manifest = summarizeGraphExecution({ nodes: parsed.data.nodes } as never);
  openImportConfirm(g.id, manifest, () => void transplant());
}

/**
 * Linked frames are REFERENCES: on load, re-sync their member nodes and
 * internal wires from the source workflow. Structure and params follow the
 * source; local layout of surviving members is preserved; boundary wires to
 * the rest of this graph survive as long as their member node still exists.
 */
async function syncLinkedFrames(): Promise<void> {
  const g = store.graph;
  if (!g) return;
  const frames = g.nodes.filter(
    (n): n is GraphNode & { data: Extract<GraphNode["data"], { type: "group" }> } =>
      n.data.type === "group" && !!n.data.graphId && n.data.graphId !== g.id,
  );
  for (const frame of frames) {
    let src: { name?: string; nodes: GraphNode[]; edges: GraphEdge[] };
    try {
      const res = await fetch(`/api/graphs/${frame.data.graphId}`);
      if (!res.ok) throw new Error(String(res.status));
      src = (await res.json()) as typeof src;
    } catch {
      continue; // source gone/offline — leave the copy as-is
    }
    const srcInner = src.nodes.filter((n) => canBelongToFrame(n));
    const srcIds = new Set(srcInner.map((n) => n.id));
    // Notes / annotations never stay as frame members. Synced clones are removed;
    // free-floating notes that were wrongly tagged are only detached.
    for (const m of [...g.nodes]) {
      if (m.subOf !== frame.id || canBelongToFrame(m)) continue;
      if (m.originId) {
        g.nodes = g.nodes.filter((n) => n.id !== m.id);
        g.edges = g.edges.filter((e) => e.source !== m.id && e.target !== m.id);
      } else {
        m.subOf = undefined;
        m.originId = undefined;
      }
    }
    if (!srcInner.length) {
      fitFrameToMembers(frame, true);
      continue;
    }
    const members = g.nodes.filter((n) => n.subOf === frame.id && canBelongToFrame(n));
    const byOrigin = new Map(members.map((m) => [m.originId, m]));
    const minX = Math.min(...srcInner.map((n) => n.position.x), 0);
    const minY = Math.min(...srcInner.map((n) => n.position.y), 0);

    let changed = 0;
    // update / add
    for (const sn of srcInner) {
      const existing = byOrigin.get(sn.id);
      const freshData = JSON.parse(JSON.stringify(sn.data)) as GraphNode["data"];
      // extraction originals keep the source ids — adopt them instead of cloning,
      // which also heals graphs whose membership tags were lost pre-save
      const adoptable = !existing
        ? g.nodes.find(
            (n) => n.id === sn.id && !n.subOf && canBelongToFrame(n),
          )
        : undefined;
      if (adoptable) {
        adoptable.subOf = frame.id;
        adoptable.originId = sn.id;
        byOrigin.set(sn.id, adoptable);
        changed++;
      }
      const member = existing ?? adoptable;
      if (member) {
        if (JSON.stringify(member.data) !== JSON.stringify(freshData)) {
          member.data = freshData;
          changed++;
        }
        if (member.type !== sn.type) {
          member.type = sn.type;
          changed++;
        }
      } else {
        g.nodes.push({
          id: crypto.randomUUID().slice(0, 8),
          type: sn.type,
          position: {
            x: frame.position.x + 36 + (sn.position.x - minX),
            y: frame.position.y + 52 + (sn.position.y - minY),
          },
          status: "idle",
          data: freshData,
          subOf: frame.id,
          originId: sn.id,
        });
        changed++;
      }
    }
    // remove members whose origin disappeared
    for (const m of [...members]) {
      if (m.originId && !srcIds.has(m.originId)) {
        g.nodes = g.nodes.filter((n) => n.id !== m.id);
        g.edges = g.edges.filter((e) => e.source !== m.id && e.target !== m.id);
        changed++;
      }
    }
    // internal wiring follows the source exactly
    const memberNow = new Map(
      g.nodes
        .filter((n) => n.subOf === frame.id && canBelongToFrame(n))
        .map((m) => [m.originId, m.id]),
    );
    const memberIds = new Set(memberNow.values());
    const beforeEdges = g.edges.length;
    g.edges = g.edges.filter(
      (e) => !(memberIds.has(e.source) && memberIds.has(e.target)),
    );
    for (const se of src.edges) {
      const source = memberNow.get(se.source);
      const target = memberNow.get(se.target);
      if (!source || !target) continue;
      g.edges.push({
        id: crypto.randomUUID().slice(0, 8),
        source,
        target,
        sourceHandle: se.sourceHandle ?? undefined,
        targetHandle: se.targetHandle ?? undefined,
        data: se.data ? { ...se.data } : undefined,
      });
    }
    if (src.name) {
      const clean = src.name.replace(/^Sub(?:graph)?\s*·\s*/i, "").trim();
      if (clean && frame.data.label !== clean) frame.data.label = clean;
    }

    // Source positions (notes excluded) → non-overlapping member layout
    arrangeFrameMembers(frame.id, srcInner, memberNow);
    fitFrameToMembers(frame, true);

    if (changed || beforeEdges !== g.edges.length) {
      pushLog("run", "raw", `⌗ synced frame "${frame.data.label}" from its sub-workflow`);
    }
  }
  // After all frames sync, pack so frames themselves don't overlap
  if (frames.length) packTopLevelNodes();
}

/**
 * Embed a saved graph as a linked frame. Subgraphs link in place; workflows
 * are cloned into a new subgraph first so the original stays top-level.
 */
async function importSubgraph(
  graphId: string,
  name: string,
  at: { x: number; y: number },
): Promise<void> {
  const g = store.graph;
  if (!g) return;
  let src: {
    id: string;
    name: string;
    kind?: "workflow" | "subgraph";
    nodes: GraphNode[];
    edges: GraphEdge[];
    params?: Graph["params"];
  };
  try {
    src = (await (await fetch(`/api/graphs/${graphId}`)).json()) as typeof src;
  } catch {
    pushLog("run", "raw", `✗ could not load subgraph ${graphId}`);
    return;
  }

  let linkId = graphId;
  let linkName = name;
  if (src.kind !== "subgraph") {
    const ok = await askConfirm({
      title: "embed as subgraph",
      emphasis: `"${src.name}"`,
      body: " is a workflow. Embed a linked subgraph copy?",
      detail: "The original stays a workflow. A new subgraph is created and framed on this canvas.",
      confirmLabel: "Embed copy",
    });
    if (!ok) return;
    try {
      const clone = await api.createGraph(`${src.name} · embed`.slice(0, 60), {
        kind: "subgraph",
      });
      clone.kind = "subgraph";
      clone.nodes = src.nodes.map((n) => ({
        ...JSON.parse(JSON.stringify(n)) as GraphNode,
        status: "idle" as const,
        lastRunId: undefined,
        subOf: undefined,
        originId: undefined,
      }));
      clone.edges = src.edges.map((e) => ({ ...e }));
      if (src.params?.length) {
        clone.params = JSON.parse(JSON.stringify(src.params)) as typeof src.params;
      }
      await api.saveGraph(clone);
      linkId = clone.id;
      linkName = clone.name;
      src = {
        id: clone.id,
        name: clone.name,
        kind: "subgraph",
        nodes: clone.nodes,
        edges: clone.edges,
        params: clone.params,
      };
    } catch (err) {
      pushLog(
        "run",
        "raw",
        `✗ could not clone workflow: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }

  const inner = src.nodes.filter((n) => canBelongToFrame(n));
  if (!inner.length) {
    pushLog("run", "raw", "✗ subgraph has no runnable nodes (notes alone don't embed)");
    return;
  }
  const minX = Math.min(...inner.map((n) => n.position.x));
  const minY = Math.min(...inner.map((n) => n.position.y));
  const idMap = new Map<string, string>();
  const frameId = crypto.randomUUID().slice(0, 8);
  const clones: GraphNode[] = inner.map((n) => {
    const id = crypto.randomUUID().slice(0, 8);
    idMap.set(n.id, id);
    const data = JSON.parse(JSON.stringify(n.data)) as GraphNode["data"];
    return {
      id,
      type: n.type,
      position: { x: at.x + (n.position.x - minX), y: at.y + (n.position.y - minY) },
      status: "idle",
      data,
      subOf: frameId,
      originId: n.id,
    };
  });
  const maxX = Math.max(...clones.map((n) => n.position.x)) + 240;
  const maxY = Math.max(...clones.map((n) => n.position.y)) + 100;
  const PAD = 36;
  const frame: GraphNode = {
    id: frameId,
    type: "group",
    position: { x: at.x - PAD, y: at.y - PAD - 16 },
    status: "idle",
    data: {
      type: "group",
      label: linkName,
      color: "blue",
      size: { width: maxX - at.x + PAD * 2, height: maxY - at.y + PAD * 2 + 16 },
      graphId: linkId,
    },
  };
  store.addNode(frame);
  addNodes([toVfNode(frame)]);
  for (const n of clones) {
    store.addNode(n);
    addNodes([toVfNode(n)]);
  }
  for (const e of src.edges) {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target) continue;
    store.addEdge({
      id: crypto.randomUUID().slice(0, 8),
      source,
      target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      data: e.data ? { ...e.data } : undefined,
    });
  }
  const originMap = new Map(
    clones.map((c) => [c.originId!, c.id] as [string, string]),
  );
  arrangeFrameMembers(frameId, inner, originMap);
  const framed = store.nodeById(frameId);
  if (framed?.data.type === "group") {
    fitFrameToMembers(
      framed as GraphNode & { data: Extract<GraphNode["data"], { type: "group" }> },
      true,
    );
  }
  rebuildCanvas();
  await store.flush(); // membership must persist before any navigation
  pushLog("run", "raw", `⌗ imported subgraph "${linkName}" — ${clones.length} node(s), framed & linked`);
}

/** Build a GraphNode from a palette/wire-menu payload (shared by drag-drop and wire-drop). */
function buildNode(
  payload: DragPayload,
  position: { x: number; y: number },
): GraphNode | undefined {
  let node: GraphNode | undefined;
  const id = crypto.randomUUID().slice(0, 8);

  if (payload.kind === "session" && payload.provider && payload.sessionId) {
    node = {
      id,
      type: payload.nodeType ?? "session",
      position,
      status: "idle",
      data: {
        type: payload.nodeType ?? "session",
        ref: { provider: payload.provider, sessionId: payload.sessionId },
        snapshot: payload.snapshot,
        resolved: true,
      },
    };
  } else if (payload.kind === "agent-def" && payload.provider && payload.name) {
    node = {
      id,
      type: "agent-def",
      position,
      status: "idle",
      data: {
        type: "agent-def",
        ref: {
          provider: payload.provider,
          name: payload.name,
          source: payload.source ?? "",
        },
      },
    };
  } else if (payload.kind === "prompt") {
    node = {
      id,
      type: "prompt",
      position,
      status: "idle",
      data: { type: "prompt", text: "" },
    };
  } else if (payload.kind === "output") {
    node = {
      id,
      type: "output",
      position,
      status: "idle",
      data: { type: "output" },
    };
  } else if (payload.kind === "prompt-convert") {
    node = {
      id,
      type: "prompt-convert",
      position,
      status: "idle",
      data: { type: "prompt-convert", template: "{{input}}" },
    };
  } else if (payload.kind === "delay") {
    node = {
      id,
      type: "delay",
      position,
      status: "idle",
      data: { type: "delay", ms: 5_000 },
    };
  } else if (payload.kind === "data") {
    node = {
      id,
      type: "data",
      position,
      status: "idle",
      data: { type: "data" },
    };
  } else if (payload.kind === "approval") {
    node = {
      id,
      type: "approval",
      position,
      status: "idle",
      data: { type: "approval" },
    };
  } else if (payload.kind === "live-handoff") {
    node = {
      id,
      type: "live-handoff",
      position,
      status: "idle",
      data: {
        type: "live-handoff",
        handoffKind: "distilled-summary",
        ...(payload.provider && payload.name
          ? {
              ref: {
                provider: payload.provider,
                name: payload.name,
                source: payload.source ?? "",
              },
            }
          : {}),
      },
    };
  } else if (payload.kind === "wait-idle") {
    node = {
      id,
      type: "wait-idle",
      position,
      status: "idle",
      data: { type: "wait-idle", timeoutMs: 60_000, onTimeout: "park" },
    };
  } else if (payload.kind === "iterator") {
    node = {
      id,
      type: "iterator",
      position,
      status: "idle",
      data: { type: "iterator", splitMode: "lines", mode: "serial" },
    };
  } else if (payload.kind === "knot") {
    node = {
      id,
      type: "knot",
      position,
      status: "idle",
      data: { type: "knot", strategy: "concat" },
    };
  } else if (payload.kind === "tripwire") {
    node = {
      id,
      type: "tripwire",
      position,
      status: "idle",
      data: {
        type: "tripwire",
        mode: "spend",
        action: "abort",
        thresholdUsd: 1,
      },
    };
  } else if (payload.kind === "judge") {
    node = {
      id,
      type: "judge",
      position,
      status: "idle",
      data: {
        type: "judge",
        matchers: defaultJudgeMatchers(),
        unmatched: "unsure",
      },
    };
  } else if (payload.kind === "until") {
    node = {
      id,
      type: "until",
      position,
      status: "idle",
      data: {
        type: "until",
        maxIterations: 3,
      },
    };
  } else if (payload.kind === "group") {
    node = {
      id,
      type: "group",
      position,
      status: "idle",
      data: { type: "group", label: "Group", size: { width: 420, height: 300 } },
    };
  } else if (payload.kind === "note") {
    node = {
      id,
      type: "note",
      position,
      status: "idle",
      data: { type: "note", text: "", size: { width: 220, height: 120 } },
    };
  } else if (payload.kind === "custom" && payload.name) {
    const def = customNodes.defs.find((d) => d.name === payload.name);
    node = {
      id,
      type: "custom",
      position,
      status: "idle",
      data: {
        type: "custom",
        ref: { name: payload.name },
        snapshot: def
          ? {
              label: def.label,
              glyph: def.glyph,
              description: def.description,
              input: def.input !== "text" ? def.input : undefined,
              output: def.output !== "text" ? def.output : undefined,
              inputs: def.inputs,
              outputs: def.outputs,
            }
          : undefined,
      },
    };
  } else if (payload.kind === "mcp-tool") {
    node = {
      id,
      type: "mcp-tool",
      position,
      status: "idle",
      data: {
        type: "mcp-tool",
        ref: { server: payload.server ?? "" },
        tool: payload.tool ?? "",
        snapshot: payload.server ? { serverLabel: payload.server } : undefined,
      },
    };
  } else if (payload.kind === "skill" && payload.path && payload.name) {
    node = {
      id,
      type: "skill",
      position,
      status: "idle",
      data: {
        type: "skill",
        path: payload.path,
        name: payload.name,
        source: payload.source,
        description: payload.description,
        origin: payload.origin,
        autoInvoke: payload.autoInvoke,
        shadowedBy: payload.shadowedBy,
      },
    };
  } else if (payload.kind === "rules" && payload.path && payload.name) {
    node = {
      id,
      type: "rules",
      position,
      status: "idle",
      data: {
        type: "rules",
        path: payload.path,
        name: payload.name,
        source: payload.source,
        label: payload.label,
      },
    };
  } else if (payload.kind === "context" && payload.contextKind) {
    node = {
      id,
      type: "context",
      position,
      status: "idle",
      data: {
        type: "context",
        kind: payload.contextKind,
        config: defaultConfigFor(payload.contextKind),
        payloadHash: payload.payloadHash,
        label: payload.label,
      },
    };
  }
  return node;
}

/** Fetch a session's subagent runs and hang them beneath it as round nodes. */
async function attachSubagents(parent: GraphNode): Promise<void> {
  if (parent.data.type !== "session") return;
  const { provider, sessionId } = parent.data.ref;
  let children: Awaited<ReturnType<typeof api.children>>;
  try {
    children = await api.children(provider, sessionId);
  } catch {
    return;
  }
  if (!children.length || !store.graph) return;

  const existing = new Set(
    store.graph.nodes
      .filter((n) => n.data.type === "subagent-run")
      .map((n) => (n.data.type === "subagent-run" ? n.data.ref.sessionId : "")),
  );
  const fresh = children.filter((c) => !existing.has(c.id));

  fresh.forEach((c, i) => {
    const childId = crypto.randomUUID().slice(0, 8);
    const node: GraphNode = {
      id: childId,
      type: "subagent-run",
      position: {
        x: parent.position.x + 45 + (i - (fresh.length - 1) / 2) * 135,
        y: parent.position.y + 150,
      },
      status: "idle",
      data: {
        type: "subagent-run",
        ref: { provider: c.provider, sessionId: c.id },
        snapshot: { title: c.title, agent: c.agent, projectDir: c.projectDir },
        resolved: true,
      },
    };
    store.addNode(node);
    addNodes([toVfNode(node)]);
    const edge: GraphEdge = {
      id: crypto.randomUUID().slice(0, 8),
      source: parent.id,
      target: childId,
      sourceHandle: "sub",
      data: { role: "child" },
    };
    store.addEdge(edge);
    setEdges(store.graph!.edges.map(toVfEdge));
  });
}

function minimapColor(): string {
  return "#3b3d4f";
}

// ---- inspector ----

const inspected = ref<string>();

const inspectedNode = computed(() =>
  inspected.value ? store.nodeById(inspected.value) : undefined,
);

const inspectedSessionRef = computed(() => {
  const n = inspectedNode.value;
  if (!n || (n.data.type !== "session" && n.data.type !== "subagent-run")) {
    return undefined;
  }
  return {
    provider: n.data.ref.provider,
    sessionId: n.data.ref.sessionId,
    title: n.data.snapshot?.title,
  };
});

const inspectedAgentDef = computed(() => {
  const n = inspectedNode.value;
  if (!n || n.data.type !== "agent-def") return undefined;
  const ref_ = n.data.ref;
  return sessions.agents.find(
    (a) => a.provider === ref_.provider && a.name === ref_.name,
  );
});

const inspectedContextData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "context" ? n.data : undefined;
});

const inspectedArtifactData = computed(() => {
  const n = inspectedNode.value;
  if (!n) return undefined;
  if (n.data.type === "skill" || n.data.type === "rules") return n.data;
  return undefined;
});

const inspectedOutputData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "output" ? n.data : undefined;
});

const inspectedPromptData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "prompt" ? n.data : undefined;
});

const inspectedKnotData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "knot" ? n.data : undefined;
});

const inspectedJudgeData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "judge" ? n.data : undefined;
});

const inspectedDelayData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "delay" ? n.data : undefined;
});

const inspectedDataNodeData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "data" ? n.data : undefined;
});

const inspectedCustomData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "custom" ? n.data : undefined;
});

const inspectedMcpToolData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "mcp-tool" ? n.data : undefined;
});

function onInspectedArtifactUpdated(patch: {
  path: string;
  autoInvoke?: boolean;
  description?: string;
  shadowedBy?: string;
}): void {
  const n = inspectedNode.value;
  if (!n || n.data.type !== "skill" || n.data.path !== patch.path) return;
  if (patch.autoInvoke !== undefined) n.data.autoInvoke = patch.autoInvoke;
  if (patch.description !== undefined) n.data.description = patch.description;
  if (patch.shadowedBy !== undefined) n.data.shadowedBy = patch.shadowedBy;
}

/** Single-click opens the inspector for skill/rules (reading is the primary action). */
function onNodeClick(e: { node: VFNode }): void {
  const n = store.nodeById(e.node.id);
  if (n?.data.type === "skill" || n?.data.type === "rules") {
    inspected.value = e.node.id;
  }
}

function onNodeDoubleClick(e: { node: VFNode }): void {
  const n = store.nodeById(e.node.id);
  // linked frame: open the sub-workflow (matches GroupNodeData contract)
  if (n?.data.type === "group" && n.data.graphId) {
    void router.push(`/graph/${n.data.graphId}?parent=${route.params.id}`);
    return;
  }
  inspected.value = e.node.id;
}

/** Selection in the transcript → a wired excerpt context node. */
function onExtractSelection(range: [number, number]): void {
  const source = inspectedNode.value;
  if (!source || !store.graph) return;
  const id = crypto.randomUUID().slice(0, 8);
  const node: GraphNode = {
    id,
    type: "context",
    position: {
      x: source.position.x + 280,
      y: source.position.y,
    },
    status: "idle",
    data: {
      type: "context",
      kind: "transcript-excerpt",
      config: {
        ...(defaultConfigFor("transcript-excerpt") as ExtractConfig),
        range,
      },
      label: `Excerpt ${range[0] + 1}–${range[1] + 1}`,
    },
  };
  store.addNode(node);
  addNodes([toVfNode(node)]);
  const edge: GraphEdge = {
    id: crypto.randomUUID().slice(0, 8),
    source: source.id,
    target: id,
    data: { role: "extract" },
  };
  store.addEdge(edge);
  refreshEdges();
}

// ---- context materialization ----

// Bounded LRU of materialized context payloads (see useContextPayloads).
const { payloadCache, cachePayload, clearPayloadCache, ensurePayload } =
  useContextPayloads();
const pendingJobs = reactive(new Map<string, string>()); // nodeId → jobId
const jobProgress = reactive<Record<string, string>>({});

/** The session node wired into a context node (via an extract edge). */
const contextSourceNode = computed(() => {
  const n = inspectedNode.value;
  if (!n || !store.graph) return undefined;
  const edge = store.graph.edges.find((e) => e.target === n.id);
  if (!edge) return undefined;
  const src = store.nodeById(edge.source);
  return src && (src.data.type === "session" || src.data.type === "subagent-run")
    ? src
    : undefined;
});

const contextSourceRef = computed(() => {
  const src = contextSourceNode.value;
  if (
    !src ||
    (src.data.type !== "session" && src.data.type !== "subagent-run")
  ) {
    return undefined;
  }
  return {
    provider: src.data.ref.provider,
    sessionId: src.data.ref.sessionId,
  };
});

const contextSourceTitle = computed(() => {
  const src = contextSourceNode.value;
  return src && (src.data.type === "session" || src.data.type === "subagent-run")
    ? src.data.snapshot?.title
    : undefined;
});

watch(
  () => inspectedContextData.value?.payloadHash,
  (hash) => void ensurePayload(hash),
  { immediate: true },
);

async function materialize(nodeId: string): Promise<void> {
  const node = store.nodeById(nodeId);
  const source = contextSourceRef.value;
  if (!node || node.data.type !== "context" || !source) return;
  const data = node.data;
  delete jobErrors[nodeId];
  node.status = "running";

  try {
    if (data.kind === "distilled-summary") {
      const { jobId } = await api.distillContext({
        source: { provider: source.provider as never, sessionId: source.sessionId },
        config: data.config,
      });
      pendingJobs.set(nodeId, jobId);
      return; // completion arrives via SSE
    }
    const call = data.kind === "files" ? api.filesContext : api.extractContext;
    const payload = await call({
      source: { provider: source.provider as never, sessionId: source.sessionId },
      config: data.config,
    });
    cachePayload(payload.hash, payload);
    data.payloadHash = payload.hash;
    node.status = "success";
  } catch (err) {
    jobErrors[nodeId] = err instanceof Error ? err.message : String(err);
    node.status = "error";
  }
}

function onServerEvent(event: ServerEvent): void {
  if (event.type === "sessions.changed" || event.type === "live.status") {
    if (event.type === "live.status") sessions.applyLiveStatuses(event.statuses);
    void sessions.refresh();
    return;
  }
  if (event.type === "job.log") {
    pushLog(event.jobId, event.lane, event.line);
    return;
  }
  // Detached mid-run paint: active node border + status without waiting for job.done.
  if (event.type === "job.node") {
    noteTabNode(event.graphId, event.nodeId, event.status);
    if (store.graph?.id !== event.graphId) return;
    const n = store.nodeById(event.nodeId);
    if (n && n.status !== event.status) {
      n.status = event.status;
    }
    return;
  }
  // Runs-view cancel (or other remote abort) of this editor's client-started job.
  if (
    event.type === "job.error" &&
    wfJobId &&
    event.jobId === wfJobId &&
    graphRunning.value &&
    !runAborted
  ) {
    pushLog(event.jobId, "raw", `✗ ${event.error}`);
    stopRun();
    return;
  }
  if (event.type === "job.error") {
    pushLog(event.jobId, "raw", `✗ ${event.error}`);
  }
  // detached ≫ runs: merge persisted statuses/outputs when the job settles
  if (
    (event.type === "job.done" || event.type === "job.error") &&
    detachedJobs.has(event.jobId)
  ) {
    void settleDetachedJob(event.jobId, event.type === "job.done");
    return;
  }
  if ("jobId" in event && jobWaiters.has(event.jobId)) {
    if (event.type === "job.done" || event.type === "job.error") {
      const resolve = jobWaiters.get(event.jobId)!;
      jobWaiters.delete(event.jobId);
      resolve(event);
    }
    return;
  }
  if (onRunEvent(event)) return;
  if (onInjectEvent(event)) return;
  const entry = [...pendingJobs.entries()].find(([, jobId]) => jobId === event.jobId);
  if (!entry) return;
  const [nodeId] = entry;
  const node = store.nodeById(nodeId);
  if (event.type === "job.progress") {
    jobProgress[nodeId] = event.message;
  } else if (event.type === "job.done") {
    pendingJobs.delete(nodeId);
    delete jobProgress[nodeId];
    if (event.payload && node?.data.type === "context") {
      cachePayload(event.payload.hash, event.payload);
      node.data.payloadHash = event.payload.hash;
      node.status = "success";
    }
  } else if (event.type === "job.error") {
    pendingJobs.delete(nodeId);
    delete jobProgress[nodeId];
    jobErrors[nodeId] = event.error;
    if (node) node.status = "error";
  }
}

let unsubscribe: (() => void) | undefined;
function dismissCtxMenu(): void {
  ctxMenu.value = undefined;
  tabCtx.value = undefined;
  // ignore the synthetic click fired right after the wire-drop mouseup
  if (wireMenu.value && Date.now() - wireMenu.value.openedAt > 250) {
    wireMenu.value = undefined;
  }
}
function onCtxMenuKey(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  if (confirmDlg.value) {
    onConfirmDlgNo();
    confirmDlg.value = undefined;
    return;
  }
  if (ctxMenu.value || wireMenu.value || tabCtx.value) {
    ctxMenu.value = undefined;
    wireMenu.value = undefined;
    tabCtx.value = undefined;
    return;
  }
  if (canvasFocus.value) {
    e.preventDefault();
    void toggleCanvasFocus(false);
  }
}

/**
 * Lay out frame members so they never overlap.
 * Near→far layered pack: side inputs stay beside their consumers.
 */
function arrangeFrameMembers(
  frameId: string,
  srcNodes?: GraphNode[],
  originToLocal?: Map<string | undefined, string>,
): void {
  const g = store.graph;
  const frame = store.nodeById(frameId);
  if (!g || frame?.data.type !== "group") return;
  const members = g.nodes.filter((n) => n.subOf === frameId && canBelongToFrame(n));
  if (!members.length) return;

  const GAP_X = 72;
  const GAP_Y = 56;
  const PAD_X = 44;
  const PAD_Y = 56;

  const memberIds = new Set(members.map((m) => m.id));
  const internal = g.edges
    .filter((e) => memberIds.has(e.source) && memberIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  // Optional: bias first-column Y from the selection that created the frame
  let originY = frame.position.y + PAD_Y;
  if (srcNodes?.length && originToLocal) {
    const ys = srcNodes
      .map((sn) => originToLocal.get(sn.id))
      .filter((id): id is string => !!id)
      .map((id) => store.nodeById(id))
      .filter((n): n is GraphNode => !!n)
      .map(nodeCenterY);
    if (ys.length) originY = ys.reduce((a, b) => a + b, 0) / ys.length;
  }

  const pos = packLayeredFlow(
    members.map((m) => {
      const b = nodeBox(m);
      return { id: m.id, w: b.w, h: b.h };
    }),
    internal,
    {
      gapX: GAP_X,
      gapY: GAP_Y,
      originX: frame.position.x + PAD_X,
      originY,
    },
  );
  for (const m of members) {
    const p = pos.get(m.id);
    if (p) moveNode(m, p.x, p.y);
  }
}

function nodeCenterY(n: GraphNode): number {
  const b = nodeBox(n);
  return b.y + b.h / 2;
}

function nodeBox(n: GraphNode): { x: number; y: number; w: number; h: number } {
  if (n.data.type === "group") {
    return {
      x: n.position.x,
      y: n.position.y,
      w: n.data.collapsed ? 300 : n.data.size.width,
      h: n.data.collapsed ? 46 : n.data.size.height,
    };
  }
  if (n.data.type === "note" || n.data.type === "output") {
    const fallback = n.data.type === "output" ? { w: 280, h: 160 } : { w: 220, h: 120 };
    return {
      x: n.position.x,
      y: n.position.y,
      w: Math.max(n.data.size?.width ?? 0, fallback.w),
      h: Math.max(n.data.size?.height ?? 0, fallback.h),
    };
  }
  const dims = findNode(n.id)?.dimensions;
  const fb = nodeSizeFallback(n.data.type);
  // Floor at type-aware defaults so stale/tiny VF measures don't pack nodes on top of each other.
  return {
    x: n.position.x,
    y: n.position.y,
    w: Math.max(dims?.width && dims.width > 1 ? dims.width : 0, fb.w),
    h: Math.max(dims?.height && dims.height > 1 ? dims.height : 0, fb.h),
  };
}

/** Conservative outer size when VF hasn't measured the node yet. */
function nodeSizeFallback(type: GraphNode["data"]["type"]): { w: number; h: number } {
  switch (type) {
    case "data":
      return { w: 220, h: 130 };
    case "delay":
      return { w: 220, h: 110 };
    case "prompt":
    case "prompt-convert":
      return { w: 240, h: 140 };
    case "custom":
      return { w: 240, h: 100 };
    case "mcp-tool":
      return { w: 240, h: 100 };
    case "agent-def":
    case "session":
    case "subagent-run":
      return { w: 240, h: 90 };
    case "knot":
    case "tripwire":
    case "judge":
    case "until":
      return { w: 240, h: 120 };
    case "approval":
    case "live-handoff":
    case "wait-idle":
      return { w: 220, h: 80 };
    case "iterator":
      return { w: 220, h: 120 };
    default:
      return { w: 240, h: 100 };
  }
}

function moveNode(n: GraphNode, x: number, y: number): void {
  n.position = { x, y };
  const vf = findNode(n.id);
  if (vf) vf.position = { x, y };
}

/** Move a frame and every tagged member by the same delta. */
function moveFrameTo(frame: GraphNode, x: number, y: number): void {
  const g = store.graph;
  if (!g || frame.data.type !== "group") return;
  const dx = x - frame.position.x;
  const dy = y - frame.position.y;
  if (!dx && !dy) return;
  frame.position = { x, y };
  const vf = findNode(frame.id);
  if (vf) vf.position = { x, y };
  for (const m of g.nodes) {
    if (m.subOf !== frame.id) continue;
    m.position = { x: m.position.x + dx, y: m.position.y + dy };
    const mv = findNode(m.id);
    if (mv) mv.position = { ...m.position };
  }
}

type BoxHandle = {
  id: string;
  get: () => { x: number; y: number; w: number; h: number };
  set: (x: number, y: number) => void;
};

/** Push overlapping boxes apart until clear (or passes exhausted). */
function resolveBoxesOverlaps(boxes: BoxHandle[], gapX: number, gapY: number): void {
  for (let pass = 0; pass < 32; pass++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const ha = boxes[i]!;
        const hb = boxes[j]!;
        const A = ha.get();
        const B = hb.get();
        // Positive = how much to separate to clear the required gap
        const needX = Math.min(A.x + A.w + gapX - B.x, B.x + B.w + gapX - A.x);
        const needY = Math.min(A.y + A.h + gapY - B.y, B.y + B.h + gapY - A.y);
        if (needX <= 0 || needY <= 0) continue;
        if (needX <= needY) {
          const push = needX / 2;
          if (A.x <= B.x) {
            ha.set(A.x - push, A.y);
            hb.set(B.x + push, B.y);
          } else {
            ha.set(A.x + push, A.y);
            hb.set(B.x - push, B.y);
          }
        } else {
          const push = needY / 2;
          if (A.y <= B.y) {
            ha.set(A.x, A.y - push);
            hb.set(B.x, B.y + push);
          } else {
            ha.set(A.x, A.y + push);
            hb.set(B.x, B.y - push);
          }
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Fit a frame to its member nodes. Grow-only by default (respects manual
 * resizes); `exact` recomputes position+size outright — used on expand / sync.
 */
function fitFrameToMembers(
  frame: GraphNode & { data: Extract<GraphNode["data"], { type: "group" }> },
  exact = false,
): void {
  const g = store.graph;
  if (!g) return;
  const members = g.nodes.filter((n) => n.subOf === frame.id && canBelongToFrame(n));
  if (!members.length) return;
  const PADF = 44;
  const HEAD = 20;
  const sizeOf = (m: GraphNode): { w: number; h: number } => {
    const b = nodeBox(m);
    return { w: b.w, h: b.h };
  };
  const minMX = Math.min(...members.map((m) => m.position.x)) - PADF;
  const minMY = Math.min(...members.map((m) => m.position.y)) - PADF - HEAD;
  const maxMX = Math.max(...members.map((m) => m.position.x + sizeOf(m).w));
  const maxMY = Math.max(...members.map((m) => m.position.y + sizeOf(m).h));
  if (exact) {
    // Keep members fixed; grow/move the frame shell around them.
    frame.position.x = minMX;
    frame.position.y = minMY;
    frame.data.size.width = Math.max(220, maxMX - minMX + PADF);
    frame.data.size.height = Math.max(140, maxMY - minMY + PADF);
    const vf = findNode(frame.id);
    if (vf) {
      vf.position = { ...frame.position };
      vf.style = {
        width: `${frame.data.size.width}px`,
        height: `${frame.data.size.height}px`,
      };
    }
    return;
  }
  if (minMX < frame.position.x) frame.position.x = minMX;
  if (minMY < frame.position.y) frame.position.y = minMY;
  const needW = maxMX - frame.position.x + PADF;
  const needH = maxMY - frame.position.y + PADF;
  if (needW > frame.data.size.width) frame.data.size.width = needW;
  if (needH > frame.data.size.height) frame.data.size.height = needH;
}

/** Owner id for layout: frame id if member, else the node itself. */
function topLevelOwner(nodeId: string): string {
  const n = store.nodeById(nodeId);
  return n?.subOf ?? nodeId;
}

/**
 * Cleanup arrangement — tidy frame internals, then pack top-level frames/nodes
 * near→far so side inputs stay beside their consumers. Pass a frame id to only
 * tidy that frame (+ re-pack graph).
 */
function cleanupArrangement(frameId?: string): void {
  ctxMenu.value = undefined;
  const g = store.graph;
  if (!g) return;
  detachNotesFromFrames();

  const frames = g.nodes.filter(
    (n): n is GraphNode & { data: Extract<GraphNode["data"], { type: "group" }> } =>
      n.data.type === "group" && !n.data.collapsed && (!frameId || n.id === frameId),
  );
  for (const f of frames) {
    arrangeFrameMembers(f.id);
    fitFrameToMembers(f, true);
  }
  // If only one frame requested, still pack the whole top-level so neighbors clear.
  packTopLevelNodes();
  rebuildCanvas();
  void store.flush();
  pushLog(
    "run",
    "raw",
    frameId ? `⊡ cleaned up frame arrangement` : `⊡ cleaned up graph arrangement`,
  );
}

/**
 * Place top-level nodes/frames with near→far layered pack so boxes never
 * overlap and side inputs stay beside their consumers. Moving a frame also
 * moves its members.
 */
function packTopLevelNodes(): void {
  const g = store.graph;
  if (!g) return;

  const tops = g.nodes.filter((n) => !n.subOf);
  if (!tops.length) return;

  const flow = tops.filter((n) => n.data.type !== "note");
  const notes = tops.filter((n) => n.data.type === "note");

  const flowIds = new Set(flow.map((n) => n.id));
  const edges: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();
  for (const e of g.edges) {
    if (e.data?.role === "child") continue;
    const s = topLevelOwner(e.source);
    const t = topLevelOwner(e.target);
    if (s === t || !flowIds.has(s) || !flowIds.has(t)) continue;
    const key = `${s}->${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: s, target: t });
  }

  const GAP_X = 120;
  const GAP_Y = 72;
  const ORIGIN_X = 80;
  const ORIGIN_Y = 220;

  const pos = packLayeredFlow(
    flow.map((n) => {
      const b = nodeBox(n);
      return { id: n.id, w: b.w, h: b.h };
    }),
    edges,
    { gapX: GAP_X, gapY: GAP_Y, originX: ORIGIN_X, originY: ORIGIN_Y },
  );

  for (const n of flow) {
    const p = pos.get(n.id);
    if (!p) continue;
    if (n.data.type === "group") moveFrameTo(n, p.x, p.y);
    else moveNode(n, p.x, p.y);
  }

  // Notes: park above the flow, left-aligned
  let noteY = 40;
  const noteX = ORIGIN_X;
  for (const n of notes) {
    moveNode(n, noteX, noteY);
    noteY += nodeBox(n).h + 24;
  }

  // Only separate notes from the flow pack — don't undo column centering.
  if (notes.length) {
    const handles: BoxHandle[] = tops.map((n) => ({
      id: n.id,
      get: () => nodeBox(n),
      set: (nx, ny) => {
        if (n.data.type === "group") moveFrameTo(n, nx, ny);
        else moveNode(n, nx, ny);
      },
    }));
    resolveBoxesOverlaps(handles, GAP_X, GAP_Y);
  }
}

function rebuildCanvas(): void {
  const g = store.graph;
  if (!g) return;
  detachNotesFromFrames();
  // an expanded frame must wrap everything inside it again — exactly
  for (const n of g.nodes) {
    if (n.data.type === "group" && !n.data.collapsed) {
      const f = n as GraphNode & { data: Extract<GraphNode["data"], { type: "group" }> };
      fitFrameToMembers(f, true);
    }
  }
  setNodes(g.nodes.map(toVfNode));
  setEdges(g.edges.map(toVfEdge));
  // push frame geometry into the live VF nodes — setNodes alone does not
  // re-apply style to nodes VueFlow already measured
  for (const n of g.nodes) {
    if (n.data.type !== "group") continue;
    const vf = findNode(n.id);
    if (!vf) continue;
    vf.position = { ...n.position };
    vf.style = n.data.collapsed
      ? { width: "300px", height: "46px" }
      : { width: `${n.data.size.width}px`, height: `${n.data.size.height}px` };
    vf.dimensions = {
      width: n.data.collapsed ? 300 : n.data.size.width,
      height: n.data.collapsed ? 46 : n.data.size.height,
    };
  }
}

onMounted(() => {
  unsubscribe = subscribeEvents(onServerEvent);
  window.addEventListener("click", dismissCtxMenu);
  window.addEventListener("keydown", onCtxMenuKey);
  window.addEventListener("keydown", onEditorKeydown);
  window.addEventListener("threadle:frames-changed", rebuildCanvas);
  window.addEventListener("threadle:sync-frame", onSyncFrameEvent);
  void pollProcTop();
  procTopTimer = setInterval(() => void pollProcTop(), 5000);
  void api.models().then((m) => {
    models.value = m;
  });
  void fetch("/api/health")
    .then((r) => r.json() as Promise<{ projectDir?: string }>)
    .then((h) => {
      serverProjectDir.value = h.projectDir ?? "";
    });
  document.addEventListener("click", onDocClickCloseWfList);
});
onUnmounted(() => {
  const id = store.graph?.id;
  if (id && graphReady.value) saveViewportFor(id);
  unsubscribe?.();
  stopDetachedPoll();
  window.removeEventListener("click", dismissCtxMenu);
  window.removeEventListener("keydown", onCtxMenuKey);
  window.removeEventListener("keydown", onEditorKeydown);
  window.removeEventListener("threadle:frames-changed", rebuildCanvas);
  window.removeEventListener("threadle:sync-frame", onSyncFrameEvent);
  document.removeEventListener("click", onDocClickCloseWfList);
  clearInterval(procTopTimer);
  for (const t of jobWaitTimers) {
    clearInterval(t as ReturnType<typeof setInterval>);
    clearTimeout(t as ReturnType<typeof setTimeout>);
  }
  jobWaitTimers.clear();
  jobWaiters.clear();
  stopJobHeartbeat();
  disposeTabRuns();
});

// ---- run log dock ----

const logEntries = ref<LogEntry[]>([]);
const logDockOpen = ref(false);
const jobLabels = new Map<string, string>();

/** Bounded setter — jobLabels was write-only across a whole editing session
 *  (11 set-sites, zero deletes). Insert-order eviction past 500. */
function setJobLabel(jobId: string, label: string): void {
  jobLabels.delete(jobId);
  jobLabels.set(jobId, label);
  if (jobLabels.size > 500) {
    const oldest = jobLabels.keys().next();
    if (!oldest.done) jobLabels.delete(oldest.value);
  }
}
const LOG_CAP = 1000;

/** the server-side job registered for the current client-driven workflow run */
let wfJobId: string | undefined;
/** 60s heartbeat so the server's abandoned-job reaper knows this tab is
 *  alive even through a long, silent agent node (no logs, no outputs). */
let wfJobHeartbeat: ReturnType<typeof setInterval> | undefined;

function startJobHeartbeat(): void {
  stopJobHeartbeat();
  wfJobHeartbeat = setInterval(() => {
    if (!wfJobId) return;
    void fetch(`/api/jobs/${wfJobId}/touch`, { method: "POST" }).catch(() => undefined);
  }, 60_000);
}

function stopJobHeartbeat(): void {
  if (wfJobHeartbeat !== undefined) {
    clearInterval(wfJobHeartbeat);
    wfJobHeartbeat = undefined;
  }
}

function pushLog(jobId: string, lane: LogEntry["lane"], line: string): void {
  // the runner's own narration ("run") is mirrored into the workflow job so
  // it lands in the combined Logs view alongside agent/session/node output
  if (jobId === "run" && wfJobId) {
    void fetch(`/api/jobs/${wfJobId}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lane, line }),
    }).catch(() => undefined);
  }
  logEntries.value.push({
    jobId,
    label: jobLabels.get(jobId),
    lane,
    line,
    ts: Date.now(),
  });
  if (logEntries.value.length > LOG_CAP) {
    logEntries.value.splice(0, logEntries.value.length - LOG_CAP);
  }
}

// ---- models & agent runs ----

const models = ref<ModelInfo[]>([]);
const runBusy = ref(false);
const runProgress = reactive<Record<string, string>>({});
const pendingRuns = reactive(new Map<string, { agentNodeId: string }>());

function modelsFor(provider: string): string[] {
  return models.value.filter((m) => m.provider === provider).map((m) => m.id);
}

const inspectedAgentNodeData = computed(() => {
  const n = inspectedNode.value;
  return n?.data.type === "agent-def" ? n.data : undefined;
});

/** Assembled prompt for the inspected agent-def (Prompt wires first). */
const wiredPromptText = computed(() => {
  const n = inspectedNode.value;
  if (!n || n.data.type !== "agent-def" || !store.graph) return undefined;
  const parts: Array<{ sourceType: string; text?: string }> = [];
  for (const edge of store.graph.edges) {
    if (edge.target !== n.id) continue;
    const src = store.nodeById(edge.source);
    if (!src) continue;
    if (src.data.type === "prompt") parts.push({ sourceType: "prompt", text: src.data.text });
    else if (src.data.type === "prompt-convert") {
      parts.push({ sourceType: "prompt-convert", text: src.data.template });
    } else if (src.data.type === "data") {
      parts.push({ sourceType: "data", text: src.data.value });
    }
  }
  const joined = joinAgentPromptTexts(parts);
  return joined || undefined;
});

async function runAgent(): Promise<void> {
  const node = inspectedNode.value;
  const data = inspectedAgentNodeData.value;
  let prompt = wiredPromptText.value;
  if (!node || !data || !prompt?.trim() || !store.graph) return;
  // prepend any materialized context payloads wired into this agent
  for (const edge of store.graph.edges) {
    if (edge.target !== node.id) continue;
    const src = store.nodeById(edge.source);
    if (src?.data.type === "context" && src.data.payloadHash) {
      const payload =
        payloadCache[src.data.payloadHash] ??
        (await api.payload(src.data.payloadHash).catch(() => undefined));
      if (payload) {
        prompt = `# Handed-off context\n\n${payload.content}\n\n---\n\n${prompt}`;
      }
    }
  }
  runBusy.value = true;
  delete runErrors[node.id];
  node.status = "running";
  // continue the linked session if one is wired out of this agent
  const linked = linkedSessionOf(node.id);
  const linkedData = linked?.data.type === "session" ? linked.data : undefined;
  const linkedLive = linkedData
    ? sessions.find(linkedData.ref.provider, linkedData.ref.sessionId)
    : undefined;
  if (linked) linked.status = "running";
  try {
    const { jobId } = await api.runAgent({
      provider: data.ref.provider,
      agent: data.ref.name,
      model: data.model,
      prompt,
      sessionId: linkedData?.ref.sessionId,
      permissionMode: data.permissionMode,
      sandbox: data.sandbox,
      askForApproval: data.askForApproval,
      projectDir:
        linkedLive?.projectDir ??
        linkedData?.snapshot?.projectDir ??
        serverProjectDir.value,
    });
    setJobLabel(jobId, data.ref.name);
    pendingRuns.set(jobId, { agentNodeId: node.id });
  } catch (err) {
    runBusy.value = false;
    runErrors[node.id] = err instanceof Error ? err.message : String(err);
    node.status = "error";
    if (linked) linked.status = "error";
  }
}

function onRunEvent(event: ServerEvent): boolean {
  if (!("jobId" in event) || !pendingRuns.has(event.jobId)) return false;
  const { agentNodeId } = pendingRuns.get(event.jobId)!;
  const agentNode = store.nodeById(agentNodeId);

  if (event.type === "job.progress") {
    runProgress[agentNodeId] = event.message;
    return true;
  }
  pendingRuns.delete(event.jobId);
  runBusy.value = false;
  delete runProgress[agentNodeId];

  if (event.type === "job.error") {
    runErrors[agentNodeId] = event.error;
    if (agentNode) agentNode.status = "error";
    const linked = linkedSessionOf(agentNodeId);
    if (linked) linked.status = "error";
    return true;
  }
  if (event.type === "job.done" && event.inject && agentNode) {
    agentNode.status = "success";
    const result = event.inject;
    upsertResultSessionNode(
      agentNode,
      result,
      `${agentNode.data.type === "agent-def" ? agentNode.data.ref.name : "agent"} run`,
    );
    void sessions.refresh();
  }
  return true;
}

// ---- graph runner (stepping) ----

const graphRunning = ref(false);
/** False while a tab is loading — Run must not fire against a stale store.graph. */
const graphReady = ref(false);
let graphLoadGen = 0;
/** Graph id the interactive run is bound to (ignore after tab switch). */
let activeRunGraphId: string | undefined;

/** True when the editor store matches the open tab. */
function isActiveTabGraph(g?: { id: string } | null): g is { id: string } {
  return Boolean(g && g.id === String(route.params.id));
}
const graphRunError = ref<string>();
const jobWaiters = new Map<string, (e: ServerEvent) => void>();

const JOB_TIMEOUT_MS = 15 * 60_000;

/**
 * Resolve when the job reaches a terminal state. Primary signal is SSE;
 * a poll of /api/jobs/:id covers dropped events, plus a hard timeout.
 */
/** awaitJob timers still ticking — cleared in onUnmounted so a mid-run
 *  navigation away doesn't leave 5s pollers (and the whole editor scope
 *  they close over) alive for up to 15 minutes per job. */
const jobWaitTimers = new Set<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>();

function awaitJob(jobId: string): Promise<ServerEvent> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (evt: ServerEvent): void => {
      if (settled) return;
      settled = true;
      jobWaiters.delete(jobId);
      clearInterval(poller);
      clearTimeout(timer);
      jobWaitTimers.delete(poller);
      jobWaitTimers.delete(timer);
      resolve(evt);
    };
    jobWaiters.set(jobId, settle);
    const poller = setInterval(() => {
      void api
        .job(jobId)
        .then((job) => {
          if (job.status === "done" && job.result) {
            settle(job.result as ServerEvent);
          } else if (job.status === "error" || job.status === "cancelled") {
            settle({ type: "job.error", jobId, error: job.error ?? job.status });
          }
        })
        .catch(() => undefined);
    }, 5_000);
    const timer = setTimeout(
      () => settle({ type: "job.error", jobId, error: "timed out after 15 minutes" }),
      JOB_TIMEOUT_MS,
    );
    jobWaitTimers.add(poller);
    jobWaitTimers.add(timer);
  });
}

// ---- workflow parameters ----

let runParamValues: Record<string, string> = {};
const paramRunOpen = ref(false);
const paramDraft = ref<Record<string, string>>({});
const paramErrors = ref<Record<string, string>>({});
let pendingRunScope: Set<string> | undefined;
/** Partial-run node ids for the next server ▶ (undefined = full graph). */
let pendingDetachedScope: Set<string> | undefined;
const paramsEditorOpen = ref(false);

function defaultParamValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of store.graph?.params ?? []) out[p.name] = runParamValues[p.name] ?? p.default ?? "";
  return out;
}

let pendingDetached = false;
/** After gate confirm, whether the upcoming detached run may auto-approve gates. */
let detachedApproveAll = false;
const detachedGateOpen = ref(false);
const detachedIssues = ref<DetachedIssue[]>([]);

/* ---- imported-workflow first-run confirmation ---- */
const importConfirmOpen = ref(false);
const importManifest = ref<ManifestItem[]>([]);
/** graph awaiting confirmation (usually the active tab; runTabFromCtx may target another) */
let pendingImportGraphId: string | undefined;
let pendingAfterImportConfirm: (() => void) | undefined;

function needsImportConfirm(g: { origin?: string; confirmedAt?: number } | null | undefined): boolean {
  return !!g && g.origin === "imported" && !g.confirmedAt;
}

function openImportConfirm(graphId: string, manifest: ManifestItem[], after: () => void): void {
  pendingImportGraphId = graphId;
  importManifest.value = manifest;
  pendingAfterImportConfirm = after;
  importConfirmOpen.value = true;
}

function cancelImportConfirm(): void {
  importConfirmOpen.value = false;
  pendingImportGraphId = undefined;
  pendingAfterImportConfirm = undefined;
}

async function confirmImportAndProceed(): Promise<void> {
  const id = pendingImportGraphId;
  importConfirmOpen.value = false;
  if (!id) return;
  try {
    const saved = await api.confirmImport(id);
    // reflect on the open graph so the gate doesn't re-trigger
    if (store.graph?.id === id) {
      store.graph.origin = saved.origin;
      store.graph.confirmedAt = saved.confirmedAt;
    }
  } catch (err) {
    pushLog("run", "raw", `✗ could not confirm imported workflow: ${err instanceof Error ? err.message : String(err)}`);
    pendingImportGraphId = undefined;
    pendingAfterImportConfirm = undefined;
    return;
  }
  const cont = pendingAfterImportConfirm;
  pendingImportGraphId = undefined;
  pendingAfterImportConfirm = undefined;
  cont?.();
}
const detachedBlockers = computed(() => detachedIssues.value.filter((i) => i.blocking));
const detachedApprovals = computed(() => detachedIssues.value.filter((i) => !i.blocking));
/** Job ids started via server ▶ — refresh canvas when they finish. jobId → graphId */
const detachedJobs = new Map<string, string>();
const detachedBusy = ref(false);
let detachedPollTimer: ReturnType<typeof setInterval> | undefined;

const {
  tabRuns,
  tabRunPhase,
  tabRunPct,
  tabRunTitle,
  beginTabRun,
  noteTabNode,
  finishTabRun,
  dropTabRun,
  disposeTabRuns,
  tabBarRun,
} = useTabRuns({
  labelFor: (id) => wfTabs.label(id),
  activeGraphId: () => store.graph?.id,
});

function stopDetachedPoll(): void {
  if (detachedPollTimer !== undefined) {
    clearInterval(detachedPollTimer);
    detachedPollTimer = undefined;
  }
}

function startDetachedPoll(): void {
  if (detachedPollTimer !== undefined) return;
  detachedPollTimer = setInterval(() => {
    void tickDetachedJobs();
  }, 2000);
}

function syncDetachedBusy(): void {
  detachedBusy.value = detachedJobs.size > 0;
}

/** True when this graph already has a tracked server ▶ job. */
function graphHasDetachedJob(graphId: string): boolean {
  for (const gid of detachedJobs.values()) {
    if (gid === graphId) return true;
  }
  return false;
}

/** Re-attach to in-flight server jobs for this graph after open/refresh. */
async function resumeServerJobsForGraph(graphId: string): Promise<boolean> {
  for (const [jobId, gid] of [...detachedJobs]) {
    if (gid === graphId) {
      detachedJobs.delete(jobId);
      jobLabels.delete(jobId);
    }
  }
  syncDetachedBusy();
  try {
    const all = await api.jobs();
    const mine = all.filter((j) => j.kind === "workflow" && j.graphId === graphId);
    const running = mine.filter((j) => j.status === "running");
    for (const j of running) {
      detachedJobs.set(j.id, graphId);
      setJobLabel(j.id, j.label ?? `${store.graph?.name ?? "workflow"}`);
      if (tabRuns[graphId]?.phase !== "running") {
        beginTabRun(
          graphId,
          j.id,
          Math.max(1, store.graph?.nodes.filter(nodeExecutesOnRun).length ?? 1),
        );
      }
    }
    syncDetachedBusy();
    if (running.length) {
      pushLog(
        "run",
        "raw",
        `≫ ${running.length} server job(s) still running for this workflow — safe to leave; statuses sync from the server`,
      );
      startDetachedPoll();
      return true;
    }
    const recentDone = mine.filter(
      (j) =>
        (j.status === "done" || j.status === "error" || j.status === "cancelled") &&
        (j.finishedAt ?? j.createdAt) > Date.now() - 5 * 60_000,
    );
    if (recentDone[0]) {
      const j = recentDone[0]!;
      pushLog(
        j.id,
        "raw",
        j.status === "done"
          ? `≫ last server run finished while you were away — outputs are on the canvas`
          : `≫ last server run ${j.status}${j.error ? `: ${j.error}` : ""}`,
      );
      if (j.status === "error") finishTabRun(graphId, false);
      else if (j.status === "done") finishTabRun(graphId, true);
    }
  } catch {
    // server unreachable — editor still works offline for editing
  }
  return false;
}

/** Seed tab status for open workflows that still have a running server job. */
async function resumeOpenTabJobs(): Promise<void> {
  try {
    const all = await api.jobs();
    const open = new Set(wfTabs.openIds);
    for (const j of all) {
      if (j.kind !== "workflow" || j.status !== "running" || !j.graphId) continue;
      if (!open.has(j.graphId)) continue;
      detachedJobs.set(j.id, j.graphId);
      setJobLabel(j.id, j.label ?? wfTabs.label(j.graphId));
      if (tabRuns[j.graphId]?.phase !== "running") {
        beginTabRun(j.graphId, j.id, 1);
      }
    }
    syncDetachedBusy();
    if (detachedJobs.size) startDetachedPoll();
  } catch {
    // ignore
  }
}

async function mergeRuntimeFromServer(graphId: string): Promise<void> {
  if (!store.graph || store.graph.id !== graphId) return;
  try {
    const remote = await api.graph(graphId);
    if (!store.graph || store.graph.id !== graphId) return;
    // Mutate store in place — never rebuildCanvas mid-run (that remeasures + jumps wires).
    applyRuntimeNodeFields(remote.nodes);
  } catch {
    // ignore transient fetch errors while polling
  }
}

/** Apply status / output / data fields from a remote snapshot without touching positions. */
function applyRuntimeNodeFields(remoteNodes: GraphNode[]): boolean {
  let changed = false;
  for (const rn of remoteNodes) {
    const ln = store.nodeById(rn.id);
    if (!ln) continue;
    if (ln.status !== rn.status) {
      ln.status = rn.status;
      changed = true;
    }
    if (ln.lastDurationMs !== rn.lastDurationMs) {
      if (rn.lastDurationMs == null) delete ln.lastDurationMs;
      else ln.lastDurationMs = rn.lastDurationMs;
      changed = true;
    }
    if (ln.data.type === "output" && rn.data.type === "output") {
      if (ln.data.content !== rn.data.content || ln.data.preview !== rn.data.preview) {
        ln.data.content = rn.data.content;
        ln.data.preview = rn.data.preview;
        changed = true;
      }
    }
    if (ln.data.type === "data" && rn.data.type === "data") {
      if (ln.data.value !== rn.data.value) {
        ln.data.value = rn.data.value;
        changed = true;
      }
    }
  }
  if (changed) {
    syncAllNodeShellClasses();
    refreshEdges();
  }
  return changed;
}

async function tickDetachedJobs(): Promise<void> {
  if (!detachedJobs.size) {
    stopDetachedPoll();
    syncDetachedBusy();
    return;
  }
  const activeId = store.graph?.id;
  if (activeId && [...detachedJobs.values()].includes(activeId)) {
    await mergeRuntimeFromServer(activeId);
  }
  for (const [jobId, graphId] of [...detachedJobs]) {
    try {
      const job = await api.job(jobId);
      if (job.status !== "running") {
        await settleDetachedJob(jobId, job.status === "done");
      }
    } catch {
      await settleDetachedJob(jobId, true);
    }
  }
  if (!detachedJobs.size) stopDetachedPoll();
}

function trackDetachedJob(jobId: string, graphId: string, label: string): void {
  detachedJobs.set(jobId, graphId);
  syncDetachedBusy();
  setJobLabel(jobId, label);
  startDetachedPoll();
}

function confirmDetachedGate(): void {
  if (detachedBlockers.value.length) return;
  detachedApproveAll = detachedApprovals.value.length > 0;
  detachedGateOpen.value = false;
  proceedDetachedAfterGate();
}

function focusDetachedIssue(i: DetachedIssue): void {
  detachedGateOpen.value = false;
  selectOnlyNode(i.nodeId);
  const vf = findNode(i.nodeId);
  if (vf) vf.class = "node-invalid";
  softFocusNode(i.nodeId);
}

/** Leave the gate modal and run in-tab so splice / live handoff can pause. */
function runInteractivelyFromDetachedGate(): void {
  detachedGateOpen.value = false;
  detachedApproveAll = false;
  pendingRunScope = pendingDetachedScope;
  if (store.graph?.params?.length) {
    paramDraft.value = defaultParamValues();
    paramErrors.value = {};
    paramRunOpen.value = true;
    return;
  }
  runParamValues = {};
  const scope = pendingDetachedScope;
  pendingDetachedScope = undefined;
  void runGraph(scope);
}

function proceedDetachedAfterGate(): void {
  if (store.graph?.params?.length) {
    paramDraft.value = defaultParamValues();
    paramErrors.value = {};
    pendingDetached = true;
    paramRunOpen.value = true;
    return;
  }
  void startDetachedRun({});
}

async function startDetachedRun(values: Record<string, string>): Promise<void> {
  const g = store.graph;
  if (!g || !isActiveTabGraph(g)) return;
  // Drop stale wired Data/Output before the server loads the graph.
  clearWiredSinkNodes(g);
  await store.flush();
  if (!isActiveTabGraph(store.graph)) return;
  const total = g.nodes.filter(nodeExecutesOnRun).length;
  beginTabRun(g.id, undefined, total);
  try {
    const r = await fetch("/api/run/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphId: g.id,
        params: values,
        approveAll: detachedApproveAll,
        projectDir: serverProjectDir.value,
        scope: pendingDetachedScope ? [...pendingDetachedScope] : undefined,
      }),
    });
    const body = (await r.json()) as {
      jobId?: string;
      error?: string;
      code?: string;
      manifest?: ManifestItem[];
    };
    if (r.status === 428 && body.code === "confirmation-required") {
      // race/autorun path — server refused an unconfirmed import; show the
      // manifest it sent and retry after the explicit confirm
      finishTabRun(g.id, false);
      syncDetachedBusy();
      openImportConfirm(g.id, body.manifest ?? [], () => void startDetachedRun(values));
      return;
    }
    if (!r.ok || !body.jobId) throw new Error(body.error ?? `detached run refused (${r.status})`);
    if (tabRuns[g.id]) tabRuns[g.id]!.jobId = body.jobId;
    trackDetachedJob(body.jobId, g.id, g.name);
    const scoped = pendingDetachedScope;
    pendingDetachedScope = undefined;
    pushLog(
      body.jobId,
      "raw",
      scoped
        ? `≫ server run started (job ${body.jobId}, ${scoped.size} node(s)) — close this tab anytime`
        : `≫ server run started (job ${body.jobId}) — close this tab anytime; reopen to watch progress`,
    );
  } catch (err) {
    finishTabRun(g.id, false);
    syncDetachedBusy();
    pushLog("run", "raw", `✗ server run failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Settle a server workflow job: update tab strip + merge canvas if that graph is open. */
async function settleDetachedJob(jobId: string, ok: boolean): Promise<void> {
  const graphId = detachedJobs.get(jobId) ?? store.graph?.id;
  detachedJobs.delete(jobId);
  jobLabels.delete(jobId);
  syncDetachedBusy();
  if (!detachedJobs.size) stopDetachedPoll();
  if (graphId) finishTabRun(graphId, ok);
  if (!graphId || store.graph?.id !== graphId) {
    if (graphId) {
      pushLog(
        jobId,
        "raw",
        ok
          ? `≫ server run finished for ${wfTabs.label(graphId)}`
          : `≫ server run failed for ${wfTabs.label(graphId)}`,
      );
      notifyRunFinished(ok, wfTabs.label(graphId));
    }
    void sessions.refresh();
    return;
  }
  try {
    const remote = await api.graph(graphId);
    if (!store.graph || store.graph.id !== graphId) return;
    applyRuntimeNodeFields(remote.nodes);
    pushLog(
      jobId,
      "raw",
      ok
        ? `≫ server run finished — canvas statuses/outputs updated`
        : `≫ server run failed — canvas shows last persisted statuses`,
    );
    notifyRunFinished(ok, store.graph?.name ?? "workflow");
    void sessions.refresh();
  } catch (err) {
    pushLog(
      jobId,
      "raw",
      `≫ could not refresh graph after server run: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function requestRun(scope?: Set<string>): void {
  if (!graphReady.value || !isActiveTabGraph(store.graph)) return;
  if (!passWorkflowValidation(scope)) return;
  ensureNotifyPermission();
  pendingDetachedScope = scope;
  // Imported JSON: nothing runs (detached OR the in-tab splice fallback)
  // until the user has confirmed the execution manifest once.
  const g = store.graph;
  if (g && needsImportConfirm(g)) {
    openImportConfirm(g.id, summarizeGraphExecution(g), () => requestDetachedRun());
    return;
  }
  // Full-graph and partial ▶ both run on the server. In-tab runGraph is
  // only the splice fallback when the detached-gate modal says so.
  requestDetachedRun();
}

const validationOpen = ref(false);
const validationIssues = ref<WorkflowIssue[]>([]);

function highlightIssueNodes(issues: WorkflowIssue[]): void {
  const ids = [...new Set(issues.map((i) => i.nodeId).filter((id) => id !== "frame"))];
  for (const id of ids) {
    const vf = findNode(id);
    if (vf) vf.class = "node-invalid";
  }
  setTimeout(() => {
    for (const id of ids) {
      const vf = findNode(id);
      if (vf && vf.class === "node-invalid") {
        const n = store.nodeById(id);
        if (n) vf.class = nodeShellClass(n);
        else vf.class = "";
      }
    }
  }, 5000);
}

function passWorkflowValidation(scope?: Set<string>): boolean {
  const g = store.graph;
  if (!g) return false;
  const issues = assessWorkflowReadiness(g, {
    edges: effectiveEdges(),
    scope,
    customInputs: (name) => customNodes.defs.find((d) => d.name === name)?.inputs,
  });
  if (!issues.length) return true;
  validationIssues.value = issues;
  validationOpen.value = true;
  highlightIssueNodes(issues);
  graphRunError.value = `${issues.length} issue(s) — fix before running`;
  pushLog(
    "run",
    "raw",
    `✗ not started — ${issues.map((i) => `${i.label}: ${i.message}`).join("; ")}`,
  );
  logDockOpen.value = true;
  runLogDock.value?.showIssues();
  return false;
}

/** Pan to a node without slamming the zoom in. */
function softFocusNode(nodeId: string): void {
  const n = findNode(nodeId);
  if (!n) return;
  const w = n.dimensions?.width ?? 180;
  const h = n.dimensions?.height ?? 80;
  const zoom = Math.min(getViewport().zoom, 1);
  void setCenter(n.position.x + w / 2, n.position.y + h / 2, {
    zoom,
    duration: 200,
  });
}

function selectOnlyNode(nodeId: string): void {
  for (const n of getNodes.value) {
    if (n.id !== nodeId && n.selected) n.selected = false;
  }
  const vf = findNode(nodeId);
  if (vf) vf.selected = true;
}

function focusValidationIssue(i: WorkflowIssue): void {
  validationOpen.value = false;
  if (i.nodeId === "frame") return;
  inspected.value = i.nodeId;
  selectOnlyNode(i.nodeId);
  const vf = findNode(i.nodeId);
  if (vf) vf.class = "node-invalid";
  softFocusNode(i.nodeId);
}

function requestDetachedRun(): void {
  const g = store.graph;
  if (!g || !graphReady.value || !isActiveTabGraph(g)) return;
  // Only block if *this* graph is already running — other tabs may have jobs.
  if (graphHasDetachedJob(g.id) || tabRunPhase(g.id) === "running" || tabRunPhase(g.id) === "waiting") {
    pushLog("run", "raw", `· already running — wait for it to finish (or cancel)`);
    return;
  }
  if (!passWorkflowValidation(pendingDetachedScope)) return;
  ensureNotifyPermission();
  const issues = filterDetachedIssuesForScope(
    assessDetachedReadiness(g),
    pendingDetachedScope,
  );
  if (issues.length) {
    detachedIssues.value = issues;
    detachedGateOpen.value = true;
    return;
  }
  detachedApproveAll = false;
  proceedDetachedAfterGate();
}

function submitParamRun(): void {
  const errs: Record<string, string> = {};
  for (const p of store.graph?.params ?? []) {
    const bad = valueTypeError(paramDraft.value[p.name] ?? "", p.type);
    if (bad) errs[p.name] = bad;
  }
  paramErrors.value = errs;
  if (Object.keys(errs).length) return;
  runParamValues = { ...paramDraft.value };
  paramRunOpen.value = false;
  if (pendingDetached) {
    pendingDetached = false;
    void startDetachedRun(runParamValues);
    return;
  }
  void runGraph(pendingRunScope);
  pendingRunScope = undefined;
}

/** ?run=1 autorun: no modal — defaults must validate or the run is refused */
async function autoRunWithDefaults(): Promise<void> {
  if (!passWorkflowValidation()) return;
  runParamValues = defaultParamValues();
  for (const p of store.graph?.params ?? []) {
    const bad = valueTypeError(runParamValues[p.name] ?? "", p.type);
    if (bad) {
      pushLog("run", "raw", `✗ autorun refused — param "${p.name}" ${bad}`);
      logDockOpen.value = true;
      return;
    }
  }
  const g = store.graph;
  if (!g) return;
  const issues = assessDetachedReadiness(g);
  const blockers = issues.filter((i) => i.blocking);
  const gates = issues.filter((i) => !i.blocking);
  if (!blockers.length && !gates.length) {
    detachedApproveAll = false;
    await startDetachedRun(runParamValues);
    return;
  }
  await runGraph();
}

function addWorkflowParam(): void {
  if (!store.graph) return;
  store.graph.params = store.graph.params ?? [];
  store.graph.params.push({ name: `param${store.graph.params.length + 1}`, type: "text", default: "" });
}

function removeWorkflowParam(i: number): void {
  store.graph?.params?.splice(i, 1);
}

/** Nodes that do work on ▶ Run (agents plus local merges / sinks). */
function nodeExecutesOnRun(n: GraphNode): boolean {
  const flag = definitionExecutesOnRun(n.data.type);
  if (flag === "session-if-wired") return sessionRunsInGraph(n);
  return flag === true;
}

const canRunGraph = computed(() => Boolean(store.graph?.nodes.some(nodeExecutesOnRun)));

interface NodeOutput {
  text?: string;
  session?: { provider: ProviderId; sessionId: string };
  /** set by iterator nodes: the downstream agent runs once per item */
  items?: string[];
  /** named-output custom nodes: port → lane value (text carries the primary port) */
  ports?: Record<string, string>;
}

/** the value an edge actually carries: a named source port when wired, else the primary text */
function edgeValue(out: NodeOutput, e: GraphEdge): NodeOutput {
  const port = e.sourceHandle?.startsWith("out:") ? e.sourceHandle.slice(4) : undefined;
  if (port && out.ports) {
    if (port in out.ports) return { ...out, text: out.ports[port] };
    return { ...out, text: undefined };
  }
  return out;
}

// ---- approval gates: the run parks here until the user decides ----

const pendingApproval = ref<{
  nodeId: string;
  text: string;
  resolve: (result: false | string) => void;
}>();

function resolveApproval(approved: boolean): void {
  const p = pendingApproval.value;
  if (!p) return;
  p.resolve(approved ? p.text : false);
  pendingApproval.value = undefined;
}

function setGraphPly(raw: string): void {
  if (!store.graph) return;
  const n = Math.max(1, Math.min(32, Math.floor(Number(raw) || DEFAULT_PLY)));
  store.graph.settings = { ...store.graph.settings, ply: n };
}

function setGraphSpendTripwire(raw: string): void {
  if (!store.graph) return;
  const v = Number(raw);
  if (!raw.trim() || !Number.isFinite(v) || v <= 0) {
    if (store.graph.settings) {
      const { spendTripwireUsd: _t, ...rest } = store.graph.settings;
      store.graph.settings = Object.keys(rest).length ? rest : undefined;
    }
    return;
  }
  store.graph.settings = { ...store.graph.settings, spendTripwireUsd: v };
}

const looseEnds = computed((): LooseEnd[] => {
  const g = store.graph;
  if (!g) return [];
  return assessLooseEnds(g, {
    customInputs: (name) => customNodes.defs.find((d) => d.name === name)?.inputs,
  });
});

const workflowIssues = computed((): WorkflowIssue[] => {
  const g = store.graph;
  if (!g) return [];
  return assessWorkflowReadiness(g, {
    edges: effectiveEdges(),
    customInputs: (name) => customNodes.defs.find((d) => d.name === name)?.inputs,
  });
});

watch(
  workflowIssues,
  (issues) => {
    issueErrorIds.value = new Set(
      issues.map((i) => i.nodeId).filter((id) => id && id !== "frame"),
    );
    // Topbar toast / validation modal stay sticky after a blocked ▶ unless we
    // clear them when the graph is healthy again (or refresh the count).
    if (!issues.length) {
      validationIssues.value = [];
      validationOpen.value = false;
      if (isReadinessToast(graphRunError.value)) {
        graphRunError.value = undefined;
      }
    } else if (isReadinessToast(graphRunError.value)) {
      graphRunError.value = `${issues.length} issue(s) — fix before running`;
      validationIssues.value = issues;
    }
  },
  { immediate: true },
);

function isReadinessToast(msg: string | undefined): boolean {
  if (!msg) return false;
  return (
    /\d+ issue\(s\) — fix before running/.test(msg) ||
    /blocker\(s\); open the tab to fix/.test(msg)
  );
}

function focusLooseEnd(le: LooseEnd): void {
  if (!le.nodeId) return;
  inspected.value = le.nodeId;
  selectOnlyNode(le.nodeId);
  softFocusNode(le.nodeId);
}

function focusWorkflowIssue(issue: WorkflowIssue): void {
  if (!issue.nodeId || issue.nodeId === "frame") return;
  inspected.value = issue.nodeId;
  selectOnlyNode(issue.nodeId);
  softFocusNode(issue.nodeId);
}

const runLogDock = ref<{ showIssues: () => void } | null>(null);

// ---- live handoff: chat until Ready, then distill and continue ----

const pendingLiveHandoff = ref<{
  nodeId: string;
  seed: string;
  session?: { provider: ProviderId; sessionId: string };
  agentRef?: { provider: ProviderId; name: string; source: string };
  model?: string;
  handoffKind: "distilled-summary" | "transcript-excerpt";
  resolve: (result: {
    ready: boolean;
    text?: string;
    session?: { provider: ProviderId; sessionId: string };
  }) => void;
}>();

/** Set while a wait-idle node is polling live session status. */
const waitingIdleNodeId = ref<string>();

const liveHandoffProjectDir = computed(
  () =>
    serverProjectDir.value ||
    sessions.sessions.find((s) => s.status === "running")?.projectDir ||
    "",
);

function resolveLiveHandoff(payload: {
  text: string;
  session: { provider: ProviderId; sessionId: string };
}): void {
  pendingLiveHandoff.value?.resolve({
    ready: true,
    text: payload.text,
    session: payload.session,
  });
  pendingLiveHandoff.value = undefined;
}

function abortLiveHandoff(): void {
  pendingLiveHandoff.value?.resolve({ ready: false });
  pendingLiveHandoff.value = undefined;
}

watch(
  () => pendingApproval.value?.nodeId,
  (id) => {
    if (id) notifyNeedsYou("approval");
  },
);
watch(
  () => pendingLiveHandoff.value?.nodeId,
  (id) => {
    if (id) notifyNeedsYou("handoff");
  },
);

/** Keep the active tab's strip/progress in sync during in-tab runs. */
watch(
  () => {
    if (!graphRunning.value || !store.graph) return "";
    return (
      store.graph.nodes.map((n) => `${n.id}:${n.status}`).join("|") +
      `|ap:${pendingApproval.value ? 1 : 0}|lh:${pendingLiveHandoff.value ? 1 : 0}|wi:${waitingIdleNodeId.value ? 1 : 0}`
    );
  },
  () => {
    const g = store.graph;
    if (!g || !graphRunning.value) return;
    const tr = tabRuns[g.id];
    if (!tr) return;
    tr.phase =
      pendingApproval.value || pendingLiveHandoff.value || waitingIdleNodeId.value
        ? "waiting"
        : "running";
    for (const n of g.nodes) {
      if (n.status !== "idle") noteTabNode(g.id, n.id, n.status);
    }
  },
);

function onLiveHandoffBindAgent(ref_: {
  provider: ProviderId;
  name: string;
  source: string;
}): void {
  const id = pendingLiveHandoff.value?.nodeId;
  const n = id ? store.nodeById(id) : undefined;
  if (n?.data.type === "live-handoff") {
    n.data.ref = ref_;
    if (pendingLiveHandoff.value) pendingLiveHandoff.value.agentRef = ref_;
  }
}

function onLiveHandoffBindKind(
  k: "distilled-summary" | "transcript-excerpt",
): void {
  const id = pendingLiveHandoff.value?.nodeId;
  const n = id ? store.nodeById(id) : undefined;
  if (n?.data.type === "live-handoff") {
    n.data.handoffKind = k;
    if (pendingLiveHandoff.value) pendingLiveHandoff.value.handoffKind = k;
  }
}

/**
 * The runner's view of the wiring: edges attached to a linked frame are
 * expanded to its entry/exit member nodes ("the frame IS its subgraph").
 */
function effectiveEdges(): GraphEdge[] {
  const g = store.graph!;
  return expandFrameEdges(g.nodes, g.edges);
}

/** Topological order, roots first, ties broken top-left first. */
function topoOrder(edges?: GraphEdge[]): GraphNode[] {
  const g = store.graph!;
  const es = structuralEdges(edges ?? g.edges);
  const incoming = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  for (const e of es) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }
  const byPos = (a: GraphNode, b: GraphNode) =>
    a.position.y - b.position.y || a.position.x - b.position.x;
  const queue = g.nodes.filter((n) => !incoming.get(n.id)).sort(byPos);
  const order: GraphNode[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    order.push(n);
    for (const e of es) {
      if (e.source !== n.id) continue;
      const remaining = (incoming.get(e.target) ?? 0) - 1;
      incoming.set(e.target, remaining);
      if (remaining <= 0) {
        const t = store.nodeById(e.target);
        if (t && !seen.has(t.id)) {
          queue.push(t);
          queue.sort(byPos);
        }
      }
    }
  }
  return order;
}

/**
 * The session node wired out of an agent is the session the agent works in:
 * each run continues it in place — the node never moves, the conversation
 * accumulates. Only spawn a node when the agent has none yet.
 */
function linkedSessionOf(agentId: string): GraphNode | undefined {
  const g = store.graph;
  if (!g) return undefined;
  for (const e of g.edges) {
    if (e.source !== agentId) continue;
    const t = store.nodeById(e.target);
    if (t?.data.type === "session") return t;
  }
  return undefined;
}

/** Session nodes that do work during a run: an agent continues them, or a text lane feeds them a message. */
function sessionRunsInGraph(n: GraphNode, edges?: GraphEdge[]): boolean {
  if (n.data.type !== "session") return false;
  return !!(edges ?? store.graph?.edges)?.some((e) => {
    if (e.target !== n.id) return false;
    const s = store.nodeById(e.source)?.data.type;
    return (
      s === "agent-def" || s === "prompt" || s === "prompt-convert" || s === "output"
    );
  });
}

function upsertResultSessionNode(
  agentNode: GraphNode,
  result: { provider: ProviderId; newSessionId: string },
  title: string,
): void {
  const existing = linkedSessionOf(agentNode.id);
  if (existing && existing.data.type === "session") {
    if (
      existing.data.ref.sessionId !== result.newSessionId ||
      existing.data.ref.provider !== result.provider
    ) {
      // provider moved the conversation — safety net; normally unchanged
      existing.data.ref = {
        provider: result.provider,
        sessionId: result.newSessionId,
      };
    }
    existing.data.snapshot = { title, ...existing.data.snapshot };
    existing.data.resolved = true;
    existing.status = "success";
    return;
  }
  const id = crypto.randomUUID().slice(0, 8);
  const node: GraphNode = {
    id,
    type: "session",
    position: { x: agentNode.position.x + 280, y: agentNode.position.y },
    status: "success",
    data: {
      type: "session",
      ref: { provider: result.provider, sessionId: result.newSessionId },
      snapshot: { title },
      resolved: true,
    },
  };
  store.addNode(node);
  addNodes([toVfNode(node)]);
  store.addEdge({
    id: crypto.randomUUID().slice(0, 8),
    source: agentNode.id,
    target: id,
    data: { role: "instantiate" },
  });
  refreshEdges();
}

async function materializePayloadFor(
  data: Extract<GraphNode["data"], { type: "context" }>,
  source: { provider: ProviderId; sessionId: string },
): Promise<ContextPayload> {
  const req = { source, config: data.config };
  if (data.kind === "distilled-summary") {
    const { jobId } = await api.distillContext(req);
    setJobLabel(jobId, "distill");
    const evt = await awaitJob(jobId);
    if (evt.type === "job.error") throw new Error(evt.error);
    if (evt.type === "job.done" && evt.payload) return evt.payload;
    throw new Error("distill returned no payload");
  }
  const call = data.kind === "files" ? api.filesContext : api.extractContext;
  return call(req);
}

/**
 * Extract the final assistant text of a session (used to pipe agent output onward).
 * Retries briefly — a just-finished session may take a beat to be readable.
 */
async function sessionResultText(
  provider: string,
  sessionId: string,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = await api
      .transcript(provider, sessionId, 0, 500)
      .catch(() => undefined);
    const last = t?.messages.filter((m) => m.role === "assistant").at(-1);
    const text = last?.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    if (text) return text;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 700));
  }
  return undefined;
}

let runAborted = false;
const activeRunJob = ref<string>();

function stopRun(): void {
  runAborted = true;
  const activeId = store.graph?.id;
  activeRunGraphId = undefined;
  // a run parked at an approval / live-handoff gate must unblock to stop
  pendingApproval.value?.resolve(false);
  pendingApproval.value = undefined;
  pendingLiveHandoff.value?.resolve({ ready: false });
  pendingLiveHandoff.value = undefined;
  waitingIdleNodeId.value = undefined;
  if (activeRunJob.value) void api.cancelJob(activeRunJob.value).catch(() => undefined);
  for (const [jobId, graphId] of [...detachedJobs]) {
    if (activeId && graphId !== activeId) continue;
    void api.cancelJob(jobId).catch(() => undefined);
  }
  if (activeId && tabRuns[activeId]?.phase === "running") {
    finishTabRun(activeId, false);
  }
}

// ---- partial execution (canvas context menu) ----

const ctxMenu = ref<{ nodeId: string; label: string; x: number; y: number }>();
const exchangeOpen = ref(false);
const modelOpen = ref(false);
const ctxCopyBusy = ref(false);
const ctxMenuIsGroup = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  return n?.data.type === "group";
});
const ctxMenuIsLinked = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  return n?.data.type === "group" && !!n.data.graphId;
});
const ctxMenuIsAgent = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  return n?.data.type === "agent-def";
});
const ctxMenuModels = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  if (!n || n.data.type !== "agent-def") return [];
  return modelsFor(n.data.ref.provider);
});
const ctxMenuModelCurrent = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  if (!n || n.data.type !== "agent-def") return undefined;
  return n.data.model;
});
const ctxMenuIsOutput = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  return n?.data.type === "output";
});
const ctxMenuCanClearOutput = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  if (!n || n.data.type !== "output") return false;
  return !!(n.data.content || n.data.preview);
});
const ctxMenuIsData = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  return n?.data.type === "data";
});
const ctxMenuCanClearData = computed(() => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  if (!n || n.data.type !== "data") return false;
  return !!(n.data.value ?? "").length;
});
/** Absolute path for file-backed nodes (skill / rules / agent source). */
const ctxMenuPath = computed((): string | undefined => {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  if (!n) return undefined;
  if (n.data.type === "skill" || n.data.type === "rules") {
    const p = n.data.path?.trim();
    return p && isAbsolutePath(p) ? p : undefined;
  }
  if (n.data.type === "agent-def") {
    const s = n.data.ref.source?.trim();
    return s && isAbsolutePath(s) ? s : undefined;
  }
  return undefined;
});

function ctxOpenViewer(): void {
  const p = ctxMenuPath.value;
  if (!p) return;
  void fileViewers.open(p);
  ctxMenu.value = undefined;
}

function ctxOpenInCode(): void {
  const p = ctxMenuPath.value;
  if (!p) return;
  settings.openPath(p);
  ctxMenu.value = undefined;
}

async function ctxCopyPath(): Promise<void> {
  const p = ctxMenuPath.value;
  if (!p) return;
  await copyToClipboard(p);
  ctxMenu.value = undefined;
}

async function ctxCopyContent(): Promise<void> {
  const p = ctxMenuPath.value;
  if (!p || ctxCopyBusy.value) return;
  ctxCopyBusy.value = true;
  try {
    const text = await fetchFileText(p);
    await copyToClipboard(text);
    ctxMenu.value = undefined;
  } catch {
    /* leave menu open so the user can retry / open in editor */
  } finally {
    ctxCopyBusy.value = false;
  }
}
const exchangeAgentChoices = computed(() => {
  if (!ctxMenuIsAgent.value) return [];
  return [...sessions.agents].sort((a, b) =>
    a.provider === b.provider
      ? a.name.localeCompare(b.name)
      : a.provider.localeCompare(b.provider),
  );
});

const ctxExchangeAgents = computed(() =>
  exchangeAgentChoices.value.map((a) => ({
    ...a,
    current: isCurrentAgent(a),
  })),
);

function isCurrentAgent(a: { provider: string; name: string; source: string }): boolean {
  const n = ctxMenu.value ? store.nodeById(ctxMenu.value.nodeId) : undefined;
  if (!n || n.data.type !== "agent-def") return false;
  return (
    n.data.ref.provider === a.provider &&
    n.data.ref.name === a.name &&
    n.data.ref.source === a.source
  );
}

function exchangeAgent(a: {
  provider: string;
  name: string;
  source: string;
  model?: string;
}): void {
  const id = ctxMenu.value?.nodeId;
  if (!id) return;
  const n = store.nodeById(id);
  if (!n || n.data.type !== "agent-def") return;
  n.data.ref = {
    provider: a.provider as ProviderId,
    name: a.name,
    source: a.source,
  };
  if (a.model) n.data.model = a.model;
  exchangeOpen.value = false;
  modelOpen.value = false;
  ctxMenu.value = undefined;
}

function openCtxModelMenu(): void {
  modelOpen.value = true;
  exchangeOpen.value = false;
}

function toggleCtxModelMenu(): void {
  modelOpen.value = !modelOpen.value;
  if (modelOpen.value) exchangeOpen.value = false;
}

function setCtxModel(m: string | undefined): void {
  const id = ctxMenu.value?.nodeId;
  if (!id) return;
  const n = store.nodeById(id);
  if (!n || n.data.type !== "agent-def") return;
  n.data.model = m || undefined;
  modelOpen.value = false;
  ctxMenu.value = undefined;
}

function nodeLabelOf(n: GraphNode): string {
  switch (n.data.type) {
    case "prompt":
      return n.data.label || "prompt";
    case "prompt-convert":
      return n.data.label || "text → prompt";
    case "delay": {
      if (n.data.label) return n.data.label;
      const s = Math.round((n.data.ms ?? 0) / 1000);
      if (s < 60) return `delay (${s}s)`;
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return rem ? `delay (${m}m ${rem}s)` : `delay (${m}m)`;
    }
    case "data":
      return n.data.label || `data (${n.data.valueType ?? "text"})`;
    case "output":
      return n.data.label || "output";
    case "agent-def":
      return n.data.label || n.data.ref.name;
    case "session":
    case "subagent-run":
      return n.data.label || n.data.snapshot?.title || n.data.ref.sessionId.slice(0, 8);
    case "context":
      return n.data.label ?? n.data.kind;
    case "skill":
      return n.data.label || n.data.name;
    case "rules":
      return n.data.label || n.data.name;
    case "group":
      return n.data.label;
    case "custom":
      return n.data.label || n.data.snapshot?.label || n.data.ref.name;
    case "mcp-tool":
      return n.data.label || n.data.tool || n.data.ref.server || "MCP tool";
    case "approval":
      return n.data.label || "approval";
    case "live-handoff":
      return n.data.label || n.data.ref?.name || "live handoff";
    case "wait-idle":
      return n.data.label || "wait for idle";
    case "knot":
      return n.data.label || `merge (${n.data.strategy})`;
    case "tripwire":
      return n.data.label || `circuit breaker (${n.data.mode})`;
    case "judge":
      return n.data.label || "judge";
    case "until":
      return n.data.label || `until (×${clampUntilMaxIterations(n.data.maxIterations)})`;
    case "iterator":
      return (
        n.data.label ||
        `iterator (${n.data.mode === "parallel" ? "parallel" : "serial"})`
      );
    case "note":
      return "note";
  }
  return "node";
}

/** Clamp a popup position so an (estimated) w×h menu stays fully inside the viewport. */
function clampMenuPos(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
  };
}

/** menus are viewport-fixed — panning/zooming the canvas under them feels broken, so close them */
function onCanvasMove(): void {
  ctxMenu.value = undefined;
  exchangeOpen.value = false;
  modelOpen.value = false;
  wireMenu.value = undefined;
}

function onCanvasMoveEnd(): void {
  const id = store.graph?.id;
  if (id && graphReady.value) saveViewportFor(id);
}

function onNodeCtxMenu(e: { event: MouseEvent | TouchEvent; node: { id: string } }): void {
  const n = store.nodeById(e.node.id);
  if (!n || !(e.event instanceof MouseEvent)) return;
  e.event.preventDefault();
  exchangeOpen.value = false;
  modelOpen.value = false;
  ctxCopyBusy.value = false;
  if (n.data.type === "agent-def" && !sessions.agents.length) void sessions.refresh();
  const hasPath =
    ((n.data.type === "skill" || n.data.type === "rules") && !!n.data.path && isAbsolutePath(n.data.path)) ||
    (n.data.type === "agent-def" && !!n.data.ref.source && isAbsolutePath(n.data.ref.source));
  let menuH = 140;
  if (n.data.type === "agent-def") menuH = 310;
  if (hasPath) menuH += 130;
  ctxMenu.value = {
    nodeId: n.id,
    label: nodeLabelOf(n),
    ...clampMenuPos(e.event.clientX, e.event.clientY, 250, menuH),
  };
}

// ---- wire-drop menu: drag a wire onto empty canvas → pick a suitable node ----

const wireMenu = ref<{
  /** absent = opened via right-click on empty canvas: show everything, wire nothing */
  sourceId?: string;
  handleType?: "source" | "target";
  /** the specific handle the wire was dragged from (named custom-node ports) */
  sourceHandle?: string;
  x: number;
  y: number;
  flowPos: { x: number; y: number };
  openedAt: number;
}>();
const wireFilter = ref("");
let wireDragFrom:
  | { nodeId: string; handleType: "source" | "target"; handleId?: string }
  | undefined;
let wireDidConnect = false;

function onPaneCtxMenu(e: MouseEvent): void {
  e.preventDefault();
  if (!store.graph) return;
  ctxMenu.value = undefined;
  wireFilter.value = "";
  void loadWireLibrary();
  wireMenu.value = {
    ...clampMenuPos(e.clientX, e.clientY, 310, 480),
    flowPos: screenToFlowCoordinate({ x: e.clientX, y: e.clientY }),
    openedAt: Date.now(),
  };
}

/** Shift+click a connector → menu of nodes that can wire to that handle. */
function openWireMenuFromHandle(opts: {
  nodeId: string;
  handleType: "source" | "target";
  handleId?: string;
  clientX: number;
  clientY: number;
}): void {
  if (!store.graph) return;
  ctxMenu.value = undefined;
  wireFilter.value = "";
  void loadWireLibrary();
  if (!sessions.agents.length) void sessions.refresh();

  const vf = findNode(opts.nodeId);
  const w = vf?.dimensions?.width ?? 200;
  const pos = vf?.position ?? screenToFlowCoordinate({ x: opts.clientX, y: opts.clientY });
  const flowPos =
    opts.handleType === "source"
      ? { x: pos.x + w + 56, y: pos.y }
      : { x: pos.x - 260, y: pos.y };

  wireMenu.value = {
    sourceId: opts.nodeId,
    handleType: opts.handleType,
    sourceHandle: opts.handleId,
    ...clampMenuPos(opts.clientX, opts.clientY, 310, 430),
    flowPos,
    openedAt: Date.now(),
  };
}

/** Quick-add: double-click empty canvas opens the add-node menu */
function onCanvasDblClick(e: MouseEvent): void {
  if (!(e.target instanceof Element)) return;
  if (!e.target.classList.contains("vue-flow__pane")) return;
  onPaneCtxMenu(e);
}

// ---- mute / bypass ----

const MUTABLE = MUTABLE_NODE_TYPES;
function canMute(id: string): boolean {
  const n = store.nodeById(id);
  return !!n && MUTABLE.has(n.data.type as NodeType);
}

function clearOutputNode(id: string): void {
  const n = store.nodeById(id);
  if (!n || n.data.type !== "output") return;
  n.data.content = undefined;
  n.data.preview = undefined;
  ctxMenu.value = undefined;
}

function clearDataNode(id: string): void {
  const n = store.nodeById(id);
  if (!n || n.data.type !== "data") return;
  n.data.value = undefined;
  ctxMenu.value = undefined;
}

function toggleMute(id: string): void {
  const n = store.nodeById(id);
  if (!n || !canMute(id)) return;
  n.muted = !n.muted;
  if (n.muted) n.bypassed = false;
  ctxMenu.value = undefined;
  syncNodeFlags(n);
}

function toggleBypass(id: string): void {
  const n = store.nodeById(id);
  if (!n || !canMute(id)) return;
  n.bypassed = !n.bypassed;
  if (n.bypassed) n.muted = false;
  ctxMenu.value = undefined;
  syncNodeFlags(n);
}

function cycleRetry(id: string): void {
  const n = store.nodeById(id);
  if (!n) return;
  const next = ({ 0: 1, 1: 3, 3: 0 } as Record<number, number>)[n.retry ?? 0] ?? 0;
  if (next) n.retry = next;
  else delete n.retry;
}

function toggleContinueOnError(id: string): void {
  const n = store.nodeById(id);
  if (!n) return;
  if (n.continueOnError) delete n.continueOnError;
  else n.continueOnError = true;
}

/** push mute/bypass/run presentation onto the live canvas node */
function syncNodeFlags(n: GraphNode): void {
  const vf = findNode(n.id);
  if (!vf) return;
  if (vf.class === "node-invalid") return; // leave validation flash alone
  vf.class = nodeShellClass(n);
}

function syncAllNodeShellClasses(): void {
  const g = store.graph;
  if (!g) return;
  for (const n of g.nodes) {
    const vf = findNode(n.id);
    if (!vf || vf.class === "node-invalid") continue;
    const next = nodeShellClass(n);
    if (vf.class !== next) vf.class = next;
  }
}

// ---- clipboard: copy / paste / duplicate with wiring ----

const {
  hasClipboard,
  copySelection,
  pasteClipboard,
  duplicateSelection,
} = useGraphClipboard({
  getSelectedNodeIds: () => getSelectedNodes.value.map((n) => n.id),
  hasGraph: () => !!store.graph,
  getNodes: () => store.graph?.nodes ?? [],
  getEdges: () => store.graph?.edges ?? [],
  addNode: (n) => store.addNode(n),
  addEdge: (e) => store.addEdge(e),
  rebuildCanvas,
});

// ---- editor keyboard shortcuts ----

const { onEditorKeydown } = useGraphKeyboard({
  toggleCanvasFocus,
  undo: () => store.undo(),
  redo: () => store.redo(),
  rebuildCanvas,
  copySelection,
  pasteClipboard,
  duplicateSelection,
  hasClipboard,
  getSelectedNodes: () => getSelectedNodes.value,
  toggleMute,
  toggleBypass,
});

function onConnectStart(p: {
  nodeId?: string | null;
  handleType?: string | null;
  handleId?: string | null;
}): void {
  wireDidConnect = false;
  wireDragFrom =
    p.nodeId && (p.handleType === "source" || p.handleType === "target")
      ? { nodeId: p.nodeId, handleType: p.handleType, handleId: p.handleId ?? undefined }
      : undefined;
}

function onConnectEnd(e?: MouseEvent | TouchEvent): void {
  const from = wireDragFrom;
  wireDragFrom = undefined;
  if (!from || wireDidConnect || !(e instanceof MouseEvent)) return;
  // Magnet: release over a node body → snap to its connector
  const magnet = tryMagnetToNode(from, e);
  if (magnet) {
    onConnect(magnet);
    return;
  }
  // only when the wire was dropped on empty canvas
  if (!(e.target instanceof Element) || !e.target.classList.contains("vue-flow__pane")) return;
  wireFilter.value = "";
  void loadWireLibrary();
  wireMenu.value = {
    sourceId: from.nodeId,
    handleType: from.handleType,
    sourceHandle: from.handleId,
    // the menu can grow tall (filter + agent/session lists) — keep it fully visible
    ...clampMenuPos(e.clientX, e.clientY, 310, 430),
    flowPos: screenToFlowCoordinate({ x: e.clientX, y: e.clientY }),
    openedAt: Date.now(),
  };
}

interface WireBlock {
  type: NodeType;
  label: string;
  glyph: string;
  payload: DragPayload;
}
const WIRE_BLOCKS: WireBlock[] = wireMenuBlocks().map((b) => ({
  type: b.type,
  label: b.label,
  glyph: b.glyph,
  payload: b.contextKind
    ? { kind: "context", contextKind: b.contextKind }
    : { kind: b.type as DragPayload["kind"] },
}));
/** Is `t` a valid partner for the dragged handle? source-drag → new node is target, and vice versa. */
function wireTypeOk(t: NodeType): boolean {
  const m = wireMenu.value;
  if (!m) return false;
  if (!m.sourceId) return true; // canvas right-click: unrestricted add-node menu
  const s = nodeType(m.sourceId);
  if (!s) return false;
  if (!(m.handleType === "source" ? isValidPair(s, t) : isValidPair(t, s))) return false;
  return wireValueOk(t);
}

/** Value-type compatibility for the open wire menu (builtins ≈ text lane). */
function wireValueOk(t: NodeType, customName?: string): boolean {
  const m = wireMenu.value;
  if (!m?.sourceId || !m.handleType) return true;
  if (m.handleType === "source") {
    const from = emittedType(m.sourceId, m.sourceHandle);
    if (t === "data") return true;
    if (t === "custom") {
      if (!customName) return true;
      const def = customNodes.defs.find((d) => d.name === customName);
      if (!def) return valueTypeCompatible(from, "text");
      const ins = def.inputs;
      if (ins?.length) return ins.some((p) => valueTypeCompatible(from, p.type));
      return valueTypeCompatible(from, def.input ?? "text");
    }
    return valueTypeCompatible(from, "text");
  }
  const to = expectedType(m.sourceId, m.sourceHandle);
  if (t === "data") return true;
  if (t === "custom") {
    if (!customName) return true;
    const def = customNodes.defs.find((d) => d.name === customName);
    if (!def) return valueTypeCompatible("text", to);
    const outs = def.outputs;
    if (outs?.length) return outs.some((p) => valueTypeCompatible(p.type, to));
    return valueTypeCompatible(def.output ?? "text", to);
  }
  return valueTypeCompatible("text", to);
}

const wireBlocks = computed(() => WIRE_BLOCKS.filter((b) => wireTypeOk(b.type)));
const wireCustoms = computed(() => {
  if (!wireMenu.value || !wireTypeOk("custom")) return [];
  const q = wireFilter.value.toLowerCase();
  return customNodes.defs
    .filter((d) => wireValueOk("custom", d.name))
    .filter((d) => !q || d.label.toLowerCase().includes(q) || d.name.includes(q))
    .slice(0, 8);
});
const wireAgents = computed(() => {
  if (!wireMenu.value || !wireTypeOk("agent-def")) return [];
  const q = wireFilter.value.toLowerCase();
  return sessions.agents.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.provider.includes(q),
  );
});
const wireSessions = computed(() => {
  if (!wireMenu.value || !wireTypeOk("session")) return [];
  const q = wireFilter.value.toLowerCase();
  return sessions.sessions
    .filter((s) => s.kind !== "subagent-run")
    .filter((s) => !q || (s.title ?? s.id).toLowerCase().includes(q))
    .slice(0, 8);
});
interface WireLibItem {
  hash: string;
  kind: "distilled-summary" | "transcript-excerpt" | "files";
  preview: string;
  tags: string[];
}
const wireLibrary = ref<WireLibItem[]>([]);
let wireLibraryLoaded = false;

async function loadWireLibrary(): Promise<void> {
  if (wireLibraryLoaded) return;
  wireLibraryLoaded = true;
  try {
    wireLibrary.value = (await (await fetch("/api/payloads")).json()) as WireLibItem[];
  } catch {
    wireLibrary.value = [];
  }
}

const wireLib = computed(() => {
  if (!wireMenu.value || !wireTypeOk("context")) return [];
  const q = wireFilter.value.toLowerCase();
  return wireLibrary.value
    .filter(
      (p) =>
        !q ||
        p.preview.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    )
    .slice(0, 6);
});

const wireHasLists = computed(
  () => wireTypeOk("agent-def") || wireTypeOk("session") || wireTypeOk("context"),
);

const wireMenuTitle = computed(() => {
  const m = wireMenu.value;
  if (!m?.sourceId) return "add node";
  return m.handleType === "source" ? "compatible next nodes" : "compatible input nodes";
});

function onWireMenuPick(payload: object): void {
  pickWire(payload as unknown as DragPayload);
}

function pickWire(payload: DragPayload): void {
  const m = wireMenu.value;
  if (!m || !store.graph) return;
  wireMenu.value = undefined;
  const node = buildNode(payload, { x: m.flowPos.x, y: m.flowPos.y - 20 });
  if (!node) return;
  store.addNode(node);
  addNodes([toVfNode(node)]);
  if (node.type === "session") void attachSubagents(node);
  if (!m.sourceId) return; // canvas add: no wire to draw
  const srcType = nodeType(m.sourceId);
  const newType = node.type as NodeType;
  const [sT, tT] =
    m.handleType === "source" ? [srcType, newType] : [newType, srcType];
  if (sT && tT && isValidPair(sT, tT)) {
    const source = m.handleType === "source" ? m.sourceId : node.id;
    const target = m.handleType === "source" ? node.id : m.sourceId;
    const fromType =
      m.handleType === "source"
        ? emittedType(m.sourceId, m.sourceHandle)
        : undefined;
    store.addEdge({
      id: crypto.randomUUID().slice(0, 8),
      source,
      target,
      // the dragged handle keeps its id; a named-port custom node on the
      // other end gets its first compatible port
      sourceHandle:
        (m.handleType === "source" ? m.sourceHandle : undefined) ??
        firstPortHandle(source, "out"),
      targetHandle:
        (m.handleType === "target" ? m.sourceHandle : undefined) ??
        (fromType
          ? bestInHandle(target, fromType)
          : firstPortHandle(target, "in")),
      data: edgeRole(sT, tT),
    });
    refreshEdges();
  }
}

/** first named-port handle of a custom node, if it declares any — else undefined */
function firstPortHandle(nodeId: string, side: "in" | "out"): string | undefined {
  const n = store.nodeById(nodeId);
  if (n?.data.type !== "custom") return undefined;
  const data = n.data;
  const def = customNodes.defs.find((d) => d.name === data.ref.name);
  const ports = side === "in"
    ? (def?.inputs ?? data.snapshot?.inputs)
    : (def?.outputs ?? data.snapshot?.outputs);
  return ports?.length ? `${side}:${ports[0]!.name}` : undefined;
}

/** Prefer an input port whose type accepts `from`. */
function bestInHandle(nodeId: string, from: ValueType): string | undefined {
  const n = store.nodeById(nodeId);
  if (n?.data.type !== "custom") return undefined;
  const data = n.data;
  const def = customNodes.defs.find((d) => d.name === data.ref.name);
  const ports = def?.inputs ?? data.snapshot?.inputs;
  if (!ports?.length) return undefined;
  const hit = ports.find((p) => valueTypeCompatible(from, p.type)) ?? ports[0];
  return hit ? `in:${hit.name}` : undefined;
}

const selectedNodeIds = computed(() => getSelectedNodes.value.map((n) => n.id));

/** Wrap the current selection in a group frame */
function groupSelection(): void {
  ctxMenu.value = undefined;
  const sel = getSelectedNodes.value.filter((n) => {
    const gn = store.nodeById(n.id);
    return gn && canBelongToFrame(gn);
  });
  if (sel.length < 1 || !store.graph) return;
  const PAD = 36;
  const minX = Math.min(...sel.map((n) => n.position.x)) - PAD;
  const minY = Math.min(...sel.map((n) => n.position.y)) - PAD - 16; // room for the title bar
  const maxX = Math.max(...sel.map((n) => n.position.x + (n.dimensions?.width ?? 220)));
  const maxY = Math.max(...sel.map((n) => n.position.y + (n.dimensions?.height ?? 80)));
  const node: GraphNode = {
    id: crypto.randomUUID().slice(0, 8),
    type: "group",
    position: { x: minX, y: minY },
    status: "idle",
    data: {
      type: "group",
      label: "Group",
      size: { width: maxX - minX + PAD, height: maxY - minY + PAD },
    },
  };
  store.addNode(node);
  addNodes([toVfNode(node)]);
  // membership tags drive collapse / fit / drag — not just spatial bounds
  for (const s of sel) {
    const m = store.nodeById(s.id);
    if (m) m.subOf = node.id;
  }
  rebuildCanvas();
}

/** Dissolve a frame; members stay in place and lose their subOf tag. */
function ungroupFrame(frameId: string): void {
  ctxMenu.value = undefined;
  const g = store.graph;
  const frame = store.nodeById(frameId);
  if (!g || frame?.data.type !== "group") return;
  for (const n of g.nodes) {
    if (n.subOf === frameId) {
      n.subOf = undefined;
      n.originId = undefined;
    }
  }
  // drop wires that only touched the frame shell
  g.edges = g.edges.filter((e) => e.source !== frameId && e.target !== frameId);
  store.removeNode(frameId);
  rebuildCanvas();
}

/** Remove the frame and its members from this canvas; linked subgraph file stays. */
async function removeFrameFromCanvas(frameId: string): Promise<void> {
  ctxMenu.value = undefined;
  const g = store.graph;
  const frame = store.nodeById(frameId);
  if (!g || frame?.data.type !== "group") return;
  const label = frame.data.label || "frame";
  const ok = await askConfirm({
    title: "remove frame",
    emphasis: `"${label}"`,
    body: " and its nodes will be removed from this canvas.",
    detail: frame.data.graphId
      ? "The linked subgraph file is kept — only this embed is removed."
      : "This only affects the current workflow.",
    confirmLabel: "Remove frame",
    danger: true,
  });
  if (!ok) return;
  const memberIds = new Set(
    g.nodes.filter((n) => n.subOf === frameId).map((n) => n.id),
  );
  memberIds.add(frameId);
  g.edges = g.edges.filter((e) => !memberIds.has(e.source) && !memberIds.has(e.target));
  for (const id of memberIds) store.removeNode(id);
  rebuildCanvas();
  pushLog("run", "raw", `⌫ removed frame "${label}" from canvas`);
}

/** Delete the linked subgraph document and remove this frame from the canvas. */
async function deleteLinkedSubgraph(frameId: string): Promise<void> {
  ctxMenu.value = undefined;
  const g = store.graph;
  const frame = store.nodeById(frameId);
  if (!g || frame?.data.type !== "group" || !frame.data.graphId) return;
  const graphId = frame.data.graphId;
  const label = frame.data.label || "subgraph";
  const ok = await askConfirm({
    title: "delete linked subgraph",
    emphasis: `"${label}"`,
    body: " will be deleted permanently.",
    detail: "Removes the subgraph file and this frame from the canvas. Other embeds of the same subgraph are not updated.",
    confirmLabel: "Delete subgraph",
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteGraph(graphId);
  } catch (err) {
    alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const memberIds = new Set(
    g.nodes.filter((n) => n.subOf === frameId).map((n) => n.id),
  );
  memberIds.add(frameId);
  g.edges = g.edges.filter((e) => !memberIds.has(e.source) && !memberIds.has(e.target));
  for (const id of memberIds) store.removeNode(id);
  rebuildCanvas();
  void refreshWorkflowList().catch(() => undefined);
  pushLog("run", "raw", `⌫ deleted subgraph "${label}"`);
}

async function manualSyncFrame(frameId: string): Promise<void> {
  ctxMenu.value = undefined;
  const frame = store.nodeById(frameId);
  if (frame?.data.type !== "group" || !frame.data.graphId) return;
  await syncLinkedFrames();
  rebuildCanvas();
  pushLog("run", "raw", `↻ synced "${frame.data.label}" from its sub-workflow`);
}

function onSyncFrameEvent(e: Event): void {
  const frameId = (e as CustomEvent<{ frameId?: string }>).detail?.frameId;
  if (frameId) void manualSyncFrame(frameId);
}

/** extract the selection (nodes + internal wires) into a new saved workflow */
async function saveSelectionAsWorkflow(): Promise<void> {
  ctxMenu.value = undefined;
  const g = store.graph;
  const sel = new Set(selectedNodeIds.value);
  if (!g || sel.size < 2) return;
  const sub = await api.createGraph(`${g.name} · sub`.slice(0, 60), { kind: "subgraph" });
  sub.kind = "subgraph";
  sub.nodes = g.nodes
    .filter((n) => sel.has(n.id))
    .map((n) => ({
      ...JSON.parse(JSON.stringify(n)) as GraphNode,
      status: "idle" as const,
      lastRunId: undefined,
      subOf: undefined,
      originId: undefined,
    }));
  sub.edges = g.edges
    .filter((e) => sel.has(e.source) && sel.has(e.target))
    .map((e) => ({ ...e }));
  // carry workflow params so {{param:…}} placeholders still resolve in the sub
  if (g.params?.length) {
    sub.params = JSON.parse(JSON.stringify(g.params)) as typeof g.params;
  }
  const dropped = g.edges.filter(
    (e) => sel.has(e.source) !== sel.has(e.target),
  ).length;
  await api.saveGraph(sub);

  // the sub-workflow stays visible where it came from: wrap the selection in a
  // linked frame — the nodes keep running in place, the frame opens the copy
  const selNodes = getSelectedNodes.value;
  const PAD = 36;
  const minX = Math.min(...selNodes.map((n) => n.position.x)) - PAD;
  const minY = Math.min(...selNodes.map((n) => n.position.y)) - PAD - 16;
  const maxX = Math.max(...selNodes.map((n) => n.position.x + (n.dimensions?.width ?? 220)));
  const maxY = Math.max(...selNodes.map((n) => n.position.y + (n.dimensions?.height ?? 80)));
  const frame: GraphNode = {
    id: crypto.randomUUID().slice(0, 8),
    type: "group",
    position: { x: minX, y: minY },
    status: "idle",
    data: {
      type: "group",
      label: sub.name,
      color: "blue",
      size: { width: maxX - minX + PAD, height: maxY - minY + PAD },
      graphId: sub.id,
    },
  };
  store.addNode(frame);
  addNodes([toVfNode(frame)]);
  // the originals become live members: edits to the sub-workflow sync back here
  // notes stay on the parent canvas — they are never frame members
  for (const n of g.nodes) {
    if (!sel.has(n.id) || !canBelongToFrame(n)) continue;
    n.subOf = frame.id;
    n.originId = n.id; // the extracted copy kept the same ids
  }
  // keep notes that were in the selection as free-floating annotations
  for (const n of g.nodes) {
    if (sel.has(n.id) && isAnnotative(n)) {
      n.subOf = undefined;
      n.originId = undefined;
    }
  }
  await store.flush(); // tags must persist before any ⌗ open navigation
  pushLog(
    "run",
    "raw",
    `⌗ extracted ${sub.nodes.length} node(s) into sub-workflow "${sub.name}" — framed & linked; edits to the sub-workflow sync back on reload${dropped ? ` (${dropped} boundary wire(s) stay only in this graph)` : ""}`,
  );
}

/** The node plus everything reachable downstream of it. */
function descendantsOf(nodeId: string): Set<string> {
  const g = store.graph;
  const scope = new Set<string>([nodeId]);
  if (!g) return scope;
  const edges = effectiveEdges();
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.source === cur && !scope.has(e.target)) {
        scope.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return scope;
}

async function runFromNode(nodeId: string): Promise<void> {
  ctxMenu.value = undefined;
  if (!graphReady.value || !isActiveTabGraph(store.graph)) return;
  const g = store.graph!;
  const scope = descendantsOf(nodeId);
  const classified = classifyRunScope(g.nodes, scope);
  const n = store.nodeById(nodeId);
  const label = n ? nodeLabelOf(n) : nodeId;
  const ok = await askConfirm({
    title: "partial run",
    body: ` from "${label}"`,
    emphasis: "❯ run",
    detail: `re-run ${classified.counts.reRun} · reuse ${classified.counts.reuse} · missing ${classified.counts.missing}`,
    confirmLabel: "Run",
  });
  if (!ok) return;
  pushLog(
    "run",
    "raw",
    `❯ partial run: re-run ${classified.counts.reRun}, reuse ${classified.counts.reuse}, missing ${classified.counts.missing} from "${label}"`,
  );
  requestRun(scope);
}

function testSingleNode(nodeId: string): void {
  ctxMenu.value = undefined;
  if (!graphReady.value || !isActiveTabGraph(store.graph)) return;
  const n = store.nodeById(nodeId);
  pushLog("run", "raw", `⊙ test node "${n ? nodeLabelOf(n) : nodeId}"`);
  requestRun(new Set([nodeId]));
}

/**
 * Seed a node OUTSIDE the run scope with its last known result — read-only,
 * no jobs, no messages posted. This is what lets a partial run start
 * mid-chain: upstream nodes contribute state instead of re-executing.
 * Prefers a prior job's outputs.json when available (`priorJobOutputs`).
 */
async function seedOutput(
  node: GraphNode,
  inboundEdges: Array<{ src: GraphNode; out: NodeOutput }>,
  outputs: Map<string, NodeOutput>,
  priorJobOutputs?: Record<string, NodeOutput>,
): Promise<void> {
  const cached = priorJobOutputs?.[node.id];
  if (cached && (cached.text !== undefined || cached.session || cached.ports || cached.items)) {
    outputs.set(node.id, { ...cached });
    return;
  }
  switch (node.data.type) {
    case "prompt":
      outputs.set(node.id, { text: node.data.text });
      break;
    case "skill":
    case "rules":
      if (node.data.path) {
        try {
          const res = await fetch(
            `/api/rules/content?path=${encodeURIComponent(node.data.path)}`,
          );
          if (res.ok) {
            const body = (await res.json()) as { content: string };
            const heading = node.data.type === "skill" ? "Skill" : "Rules";
            const src = node.data.source ? ` (${node.data.source})` : "";
            outputs.set(node.id, {
              text: `# ${heading}: ${node.data.name}${src}\n\n${body.content.trim()}\n`,
            });
          }
        } catch {
          // seed soft-fails — scoped run will error if this node is required
        }
      }
      break;
    case "session":
    case "subagent-run":
      outputs.set(node.id, {
        session: {
          provider: node.data.ref.provider,
          sessionId: node.data.ref.sessionId,
        },
      });
      break;
    case "agent-def": {
      // the agent's last answer = the tail of its linked session
      const linked = linkedSessionOf(node.id);
      if (linked?.data.type === "session") {
        const ref = linked.data.ref;
        const text = await sessionResultText(ref.provider, ref.sessionId);
        outputs.set(node.id, {
          text,
          session: { provider: ref.provider, sessionId: ref.sessionId },
        });
      }
      break;
    }
    case "context":
      if (node.data.payloadHash) {
        await ensurePayload(node.data.payloadHash);
        const p = payloadCache[node.data.payloadHash];
        if (p) outputs.set(node.id, { text: p.content });
      }
      break;
    case "output": {
      const session = inboundEdges.map((i) => i.out.session).find(Boolean);
      // stored result first (content, or the legacy preview field); if the
      // node never ran, pull the session tail read-only — that IS its job
      let text: string | undefined = node.data.content ?? node.data.preview;
      if (!text && session) {
        text = await sessionResultText(session.provider, session.sessionId);
      }
      if (text) outputs.set(node.id, { text, session });
      break;
    }
    case "prompt-convert": {
      // pure transform — recompute from upstream seeds at zero cost
      const texts = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean) as string[];
      if (!texts.length) break;
      const input = texts.join("\n\n");
      const tpl = node.data.template ?? "";
      outputs.set(node.id, {
        text: tpl.includes("{{input}}")
          ? tpl.replaceAll("{{input}}", input)
          : tpl.trim()
            ? `${tpl}\n\n${input}`
            : input,
      });
      break;
    }
    case "delay": {
      // don't sleep when seeding — pass upstream text through
      const text = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean)
        .join("\n\n");
      if (text) outputs.set(node.id, { text });
      break;
    }
    case "data": {
      const inbound = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean)
        .join("\n\n");
      const text = inbound || (node.data.value ?? "");
      if (!text) break;
      const coerced = coerceValue(text, node.data.valueType ?? "text");
      if ("error" in coerced) break;
      // persist so the card shows what this node holds / received
      node.data.value = coerced.value;
      outputs.set(node.id, { text: coerced.value });
      break;
    }
    case "approval": {
      // out of scope: no gate — pass upstream text straight through
      const text = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (text) {
        outputs.set(node.id, {
          text,
          session: inboundEdges.map((i) => i.out.session).find(Boolean),
        });
      }
      break;
    }
    case "knot": {
      const texts = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean) as string[];
      if (!texts.length) break;
      outputs.set(node.id, {
        text: mergeKnotTexts(texts, node.data.strategy, {
          separator: node.data.separator,
        }),
        session: inboundEdges.map((i) => i.out.session).find(Boolean),
      });
      break;
    }
    case "tripwire": {
      // out of scope: no gate — pass upstream text straight through
      const text = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (text) {
        outputs.set(node.id, {
          text,
          session: inboundEdges.map((i) => i.out.session).find(Boolean),
        });
      }
      break;
    }
    case "judge": {
      const text = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (!text) break;
      const verdict = evaluateJudge(node.data, text);
      const port = verdict.park ? "unsure" : verdict.port;
      const ports = judgePortsOutput(port, text);
      outputs.set(node.id, {
        text: ports[port],
        session: inboundEdges.map((i) => i.out.session).find(Boolean),
        ports,
      });
      break;
    }
    case "until": {
      const text = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (!text) break;
      // Out of scope: no re-entry — pass through on exhausted.
      const ports = untilPortsOutput("exhausted", text);
      outputs.set(node.id, {
        text,
        session: inboundEdges.map((i) => i.out.session).find(Boolean),
        ports,
      });
      break;
    }
    case "live-handoff": {
      // out of scope: forward text / session without chatting
      const text = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (text) {
        outputs.set(node.id, {
          text,
          session: inboundEdges.map((i) => i.out.session).find(Boolean),
        });
      }
      break;
    }
    case "wait-idle": {
      // out of scope: no poll — forward text / session
      const text = inboundEdges
        .map((i) => i.out.text)
        .filter(Boolean)
        .join("\n\n---\n\n");
      const session = inboundEdges.map((i) => i.out.session).find(Boolean);
      if (text || session) {
        outputs.set(node.id, { text: text || undefined, session });
      }
      break;
    }
    case "iterator":
      // out of scope: forward text unsplit — only an executed iterator fans out
      {
        const text = inboundEdges
          .map((i) => i.out.text)
          .filter(Boolean)
          .join("\n\n");
        if (text) outputs.set(node.id, { text });
      }
      break;
  }
}

async function runGraph(scope?: Set<string>): Promise<void> {
  const g = store.graph;
  if (!g || graphRunning.value || !graphReady.value || !isActiveTabGraph(g)) return;

  const boundId = g.id;
  activeRunGraphId = boundId;

  const eEdges = effectiveEdges();
  // Defense in depth — requestRun already validates; catch direct callers.
  const issues = assessWorkflowReadiness(g, {
    edges: eEdges,
    scope,
    customInputs: (name) => customNodes.defs.find((d) => d.name === name)?.inputs,
  });
  if (issues.length) {
    validationIssues.value = issues;
    validationOpen.value = true;
    highlightIssueNodes(issues);
    graphRunError.value = `${issues.length} issue(s) — fix before running`;
    pushLog(
      "run",
      "raw",
      `✗ not started — ${issues.map((i) => `${i.label}: ${i.message}`).join("; ")}`,
    );
    logDockOpen.value = true;
    runLogDock.value?.showIssues();
    activeRunGraphId = undefined;
    return;
  }

  graphRunning.value = true;
  graphRunError.value = undefined;
  runAborted = false;
  // Clear prior-run captures on Data/Output nodes fed by a wire.
  clearWiredSinkNodes(g, scope);
  beginTabRun(boundId, undefined, g.nodes.filter(nodeExecutesOnRun).length);

  wfJobId = undefined;
  try {
    const r = await fetch("/api/jobs/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "workflow",
        label: g.name + (scope ? " (partial)" : ""),
        graphId: boundId,
      }),
    });
    if (r.ok) {
      wfJobId = ((await r.json()) as { jobId: string }).jobId;
      startJobHeartbeat();
    }
  } catch {
    // logging is best-effort; the run proceeds regardless
  }

  const order = topoOrder(eEdges);
  if (order.length < g.nodes.length) {
    const stuck = g.nodes
      .filter((n) => !order.some((o) => o.id === n.id))
      .map((n) => (n.data.type === "prompt" ? "prompt" : n.id));
    graphRunError.value = `cycle detected — ${stuck.length} node(s) can never run`;
    pushLog("run", "raw", `✗ cycle detected; unreachable nodes: ${stuck.join(", ")}`);
  }
  const inScope = (id: string): boolean => !scope || scope.has(id);
  const outputs = new Map<string, NodeOutput>();
  const skipped = new Set<string>();
  const untilIter = new Map<string, number>();
  const injectText = new Map<string, string>();
  let pendingReenter:
    | { untilId: string; text: string; targets: string[]; body: string[] }
    | undefined;

  let priorJobOutputs: Record<string, NodeOutput> | undefined;
  if (scope) {
    try {
      const r = await fetch(`/api/jobs/outputs/latest?graphId=${encodeURIComponent(boundId)}`);
      if (r.ok) {
        const body = (await r.json()) as {
          jobId?: string | null;
          outputs?: Record<string, NodeOutput>;
        };
        if (body.outputs && Object.keys(body.outputs).length) {
          priorJobOutputs = body.outputs;
          pushLog(
            "run",
            "raw",
            `↻ seeding from prior job ${body.jobId ?? "—"}`,
          );
        }
      }
    } catch {
      // prior cache is best-effort
    }
  }

  const persistCanvasOutput = (nodeId: string, out: NodeOutput): void => {
    if (!wfJobId) return;
    void fetch(`/api/jobs/${wfJobId}/outputs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, output: out }),
    }).catch(() => undefined);
  };
  for (const n of order) {
    if (!inScope(n.id)) continue;
    if (n.muted) continue;
    if (
      n.data.type === "agent-def" ||
      n.data.type === "context" ||
      n.data.type === "output" ||
      n.data.type === "prompt-convert" ||
      n.data.type === "delay" ||
      n.data.type === "data" ||
      n.data.type === "approval" ||
      n.data.type === "live-handoff" ||
      n.data.type === "iterator" ||
      n.data.type === "knot" ||
      n.data.type === "tripwire" ||
      n.data.type === "judge" ||
      n.data.type === "until" ||
      (n.data.type === "session" && sessionRunsInGraph(n, eEdges))
    ) {
      n.status = "queued";
      delete n.lastDurationMs;
      delete runErrors[n.id];
      delete jobErrors[n.id];
    }
  }

  const stillBound = (): boolean =>
    !runAborted && store.graph?.id === boundId && activeRunGraphId === boundId;

  const plyLimit = Math.max(1, g.settings?.ply ?? DEFAULT_PLY);
  const spendTripwireUsd = g.settings?.spendTripwireUsd;
  let runSpend = 0;
  let runFailures = 0;
  const runStartedAt = Date.now();
  if (plyLimit > 1) pushLog("run", "raw", `ǁ parallelism ${plyLimit}`);
  if (spendTripwireUsd != null) {
    pushLog("run", "raw", `$ spend ceiling $${spendTripwireUsd}`);
  }
  const checkSpendTripwire = (): void => {
    if (spendTripwireUsd != null && runSpend >= spendTripwireUsd) {
      throw new Error(
        `$ spend ceiling: $${runSpend.toFixed(2)} ≥ $${spendTripwireUsd} — run stopped`,
      );
    }
  };

  try {
    const processOneNode = async (node: GraphNode): Promise<void> => {
      if (!stillBound()) {
        runAborted = true;
        throw new Error("run stopped — switched workflow tab");
      }
      const inboundEdges = eEdges
        .filter((e) => e.target === node.id)
        .map((e) => ({
          edge: e,
          src: store.nodeById(e.source),
          out: outputs.get(e.source) && edgeValue(outputs.get(e.source)!, e),
        }))
        .filter((i) => i.src && i.out) as Array<{ edge: GraphEdge; src: GraphNode; out: NodeOutput }>;
      const inbound = inboundEdges.map((i) => i.out);
      const injected = injectText.get(node.id);
      if (injected !== undefined) {
        inbound.push({ text: injected });
        injectText.delete(node.id);
      }

      if (!inScope(node.id)) {
        // outside the partial-run scope: contribute last known state, run nothing
        await seedOutput(node, inboundEdges, outputs, priorJobOutputs);
        return;
      }

      if (SKIP_EXEC_TYPES.has(node.data.type)) return;

      if (node.muted) {
        skipped.add(node.id);
        node.status = "idle";
        delete node.lastDurationMs;
        pushLog("run", "raw", `⊘ ${nodeLabelOf(node)} muted — skipped`);
        return;
      }

      // starvation: every wired input vanished because upstream was muted/skipped
      if (
        !inbound.length &&
        eEdges.some((e) => e.target === node.id && skipped.has(e.source)) &&
        eEdges.filter((e) => e.target === node.id).every(
          (e) => skipped.has(e.source) || !outputs.has(e.source),
        )
      ) {
        skipped.add(node.id);
        node.status = "idle";
        delete node.lastDurationMs;
        pushLog("run", "raw", `∅ ${nodeLabelOf(node)} starved (upstream muted) — skipped`);
        return;
      }

      if (node.bypassed) {
        const pass = inbound.find((i) => i.text !== undefined) ?? inbound[0];
        if (pass) outputs.set(node.id, pass);
        node.status = "success";
        node.lastDurationMs = 0;
        pushLog("run", "raw", `⤳ ${nodeLabelOf(node)} bypassed — input passed straight through`);
        return;
      }

      // per-node error policy: retry with backoff, then optionally continue
      const execNode = async (): Promise<void> => {
      switch (node.data.type) {
        case "prompt": {
          const text = substituteParams(node.data.text, runParamValues);
          const vt = node.data.valueType ?? "text";
          const bad = valueTypeError(text, vt);
          if (bad) {
            node.status = "error";
            runErrors[node.id] = `prompt is typed ${vt} but ${bad}`;
            throw new Error(runErrors[node.id]);
          }
          outputs.set(node.id, { text });
          break;
        }

        case "skill": {
          if (!node.data.path && !node.data.name) {
            node.status = "error";
            runErrors[node.id] = "skill node has no artifact selected";
            throw new Error(runErrors[node.id]);
          }
          if (node.data.mode === "invoke") {
            const name = node.data.name.trim();
            if (!name) {
              node.status = "error";
              runErrors[node.id] = "skill invoke needs a skill name";
              throw new Error(runErrors[node.id]);
            }
            const extra = (inbound.map((i) => i.text).filter(Boolean) as string[])
              .join("\n\n")
              .trim();
            const provider = skillInvokeProvider(node.data);
            const prompt = extra ? `/${name}\n\n${extra}` : `/${name}`;
            node.status = "running";
            pushLog("run", "raw", `✦ invoke /${name} via ${provider}`);
            try {
              const { jobId } = await api.runAgent({
                provider,
                agent: "",
                model: node.data.model,
                prompt,
                graphId: g.id,
                projectDir: serverProjectDir.value,
              });
              setJobLabel(jobId, `skill:${name}`);
              node.lastRunId = jobId;
              activeRunJob.value = jobId;
              const evt = await awaitJob(jobId);
              activeRunJob.value = undefined;
              if (evt.type === "job.error") {
                throw new Error(evt.error);
              }
              const result = evt.type === "job.done" ? evt.inject : undefined;
              const text =
                result?.resultText?.trim() ||
                (result
                  ? await sessionResultText(result.provider, result.newSessionId)
                  : "") ||
                "(no result text)";
              outputs.set(node.id, { text });
              node.status = "success";
            } catch (err) {
              node.status = "error";
              const msg = err instanceof Error ? err.message : String(err);
              runErrors[node.id] = msg;
              throw err instanceof Error ? err : new Error(msg);
            }
            break;
          }
          node.status = "running";
          const qs = node.data.path
            ? `path=${encodeURIComponent(node.data.path)}`
            : [
                `name=${encodeURIComponent(node.data.name)}`,
                `kind=skill`,
                node.data.source ? `source=${encodeURIComponent(node.data.source)}` : "",
                node.data.origin ? `origin=${encodeURIComponent(node.data.origin)}` : "",
              ]
                .filter(Boolean)
                .join("&");
          const res = await fetch(`/api/rules/content?${qs}`);
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            node.status = "error";
            runErrors[node.id] = body.error ?? "could not read skill";
            throw new Error(runErrors[node.id]);
          }
          const body = (await res.json()) as { content: string; path?: string };
          if (body.path && !node.data.path) node.data.path = body.path;
          const src = node.data.source ? ` (${node.data.source})` : "";
          const text = `# Skill: ${node.data.name}${src}\n\n${body.content.trim()}\n`;
          pushLog("run", "raw", `✦ skill ${node.data.name}: ${body.content.length} chars`);
          outputs.set(node.id, { text });
          node.status = "success";
          break;
        }
        case "rules": {
          if (!node.data.path && !node.data.name) {
            node.status = "error";
            runErrors[node.id] = "rules node has no artifact selected";
            throw new Error(runErrors[node.id]);
          }
          node.status = "running";
          const qs = node.data.path
            ? `path=${encodeURIComponent(node.data.path)}`
            : [
                `name=${encodeURIComponent(node.data.name)}`,
                `kind=rules`,
                node.data.source ? `source=${encodeURIComponent(node.data.source)}` : "",
              ]
                .filter(Boolean)
                .join("&");
          const res = await fetch(`/api/rules/content?${qs}`);
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            node.status = "error";
            runErrors[node.id] = body.error ?? "could not read rules";
            throw new Error(runErrors[node.id]);
          }
          const body = (await res.json()) as { content: string; path?: string };
          if (body.path && !node.data.path) node.data.path = body.path;
          const src = node.data.source ? ` (${node.data.source})` : "";
          const text = `# Rules: ${node.data.name}${src}\n\n${body.content.trim()}\n`;
          pushLog("run", "raw", `✦ rules ${node.data.name}: ${body.content.length} chars`);
          outputs.set(node.id, { text });
          node.status = "success";
          break;
        }

        case "session":
        case "subagent-run":
          if (node.data.type === "session") {
            // a materialized context wired into this session: push it in
            const ctxEdge = g.edges.find((e) => {
              if (e.target !== node.id) return false;
              const src = store.nodeById(e.source);
              return src?.data.type === "context" && src.data.payloadHash;
            });
            const ctxSrc = ctxEdge ? store.nodeById(ctxEdge.source) : undefined;
            if (ctxSrc?.data.type === "context" && ctxSrc.data.payloadHash) {
              if (node.data.ref.provider === "opencode") {
                node.status = "running";
                try {
                  const { jobId } = await api.inject({
                    payloadHash: ctxSrc.data.payloadHash,
                    target: {
                      provider: "opencode",
                      mode: "synthetic",
                      sessionId: node.data.ref.sessionId,
                      projectDir: node.data.snapshot?.projectDir ?? "",
                    },
                  });
                  setJobLabel(jobId, "inject");
                  node.lastRunId = jobId;
                  const evt = await awaitJob(jobId);
                  if (evt.type === "job.error") throw new Error(evt.error);
                  node.status = "success";
                  pushLog(jobId, "raw", `context inserted into ${node.data.snapshot?.title ?? node.data.ref.sessionId} (synthetic, no reply)`);
                } catch (err) {
                  node.status = "error";
                  throw err;
                }
              } else {
                pushLog("run", "raw",
                  `context → ${node.data.ref.provider} session edges are manual: forking/spawning implicitly would create sessions every run — use the Inject button on the node`);
              }
            }
          } {
          // Only prompt / converter / output wires carry a MESSAGE to post into
          // the session. An agent→session edge is the continuation link — its
          // text is the agent's reply and must never be sent back in.
          const texts = inboundEdges
            .filter((i) =>
              ["prompt", "prompt-convert", "delay", "data", "output", "approval", "live-handoff", "wait-idle", "iterator", "knot", "tripwire", "judge", "until", "skill", "rules", "custom", "mcp-tool"].includes(
                i.src.data.type,
              ),
            )
            .map((i) => i.out.text)
            .filter(Boolean) as string[];
          if (texts.length && node.data.type === "session") {
            // a text lane (prompt / converter / another agent's output) wired
            // straight into the session: send it as the next message, in place
            node.status = "running";
            const ref = node.data.ref;
            const live = sessions.find(ref.provider, ref.sessionId);
            const { jobId } = await api.runSession({
              provider: ref.provider,
              sessionId: ref.sessionId,
              prompt: texts.join("\n\n---\n\n"),
              graphId: g.id,
              agent: live?.agent ?? node.data.snapshot?.agent,
              projectDir:
                live?.projectDir ??
                node.data.snapshot?.projectDir ??
                serverProjectDir.value,
            });
            setJobLabel(
              jobId,
              node.data.snapshot?.title?.slice(0, 24) ?? "session",
            );
            const evt = await awaitJob(jobId);
            if (evt.type === "job.error") {
              node.status = "error";
              runErrors[node.id] = evt.error;
              throw new Error(
                `${node.data.snapshot?.title ?? "session"}: ${evt.error}`,
              );
            }
            const result = evt.type === "job.done" ? evt.inject : undefined;
            if (!result) throw new Error("session run returned nothing");
            const text =
              result.resultText ??
              (await sessionResultText(ref.provider, ref.sessionId));
            outputs.set(node.id, {
              text,
              session: { provider: ref.provider, sessionId: ref.sessionId },
            });
            node.status = "success";
            void sessions.refresh();
            break;
          }
          // no text inbound: if an agent is wired in, it already continued the
          // session above (topo order guarantees it) — just forward the ref
          outputs.set(node.id, {
            session: {
              provider: node.data.ref.provider,
              sessionId: node.data.ref.sessionId,
            },
          });
          break;
        }

        case "agent-def": {
          // an iterator upstream turns one run into one run PER item
          const agentData = node.data;
          const items = inbound.flatMap((i) => i.items ?? []);
          const joined = joinAgentPromptTexts(
            inboundEdges.map(({ src, out }) => ({
              sourceType: src.data.type,
              text: out.text,
            })),
          );
          const prompts = items.length ? items : joined ? [joined] : [];
          if (!prompts.length) {
            node.status = "idle"; // nothing wired in — skip, not an error
            break;
          }
          const parallelMap =
            items.length > 0 &&
            inboundEdges.some(
              ({ src }) =>
                src.data.type === "iterator" && src.data.mode === "parallel",
            );
          node.status = "running";
          if (agentData.ref.provider === "claude-code") {
            await refreshSub(true);
            const blocked = claudeExhaustedForModel(agentData.model, subSnap.value?.usage);
            if (blocked.length) {
              const labels = blocked.map((b) => `${b.label} ${b.utilization}%`).join(", ");
              const msg = formatUsageExhaustionMessage(
                blocked.some((b) => b.id === "sevenDayOpus")
                  ? "claude-opus-7d"
                  : blocked.some((b) => b.id === "sevenDay")
                    ? "claude-7d"
                    : "claude-5h",
                labels,
              );
              pushLog("run", "raw", `! ${msg}`);
              throw new Error(msg);
            }
          }
          // serial: a linked session is reused. parallel: fresh session per item.
          const linked = parallelMap ? undefined : linkedSessionOf(node.id);
          const linkedData =
            linked?.data.type === "session" ? linked.data : undefined;
          const linkedLive = linkedData
            ? sessions.find(linkedData.ref.provider, linkedData.ref.sessionId)
            : undefined;
          if (linked) linked.status = "running";
          const projectDir =
            linkedLive?.projectDir ??
            linkedData?.snapshot?.projectDir ??
            serverProjectDir.value;
          const collected: string[] = new Array(prompts.length);
          let lastResult: { provider: ProviderId; newSessionId: string } | undefined;

          const runOne = async (pi: number, sessionId: string | undefined): Promise<{
            provider: ProviderId;
            newSessionId: string;
          }> => {
            if (runAborted) throw new Error("run stopped");
            if (prompts.length > 1) {
              pushLog(
                "run",
                "raw",
                `${parallelMap ? "∀∥" : "∀"} ${agentData.ref.name}: item ${pi + 1}/${prompts.length}`,
              );
            }
            const { jobId } = await api.runAgent({
              provider: agentData.ref.provider,
              agent: agentData.ref.name,
              model: agentData.model,
              prompt: prompts[pi]!,
              sessionId,
              graphId: g.id,
              projectDir,
              permissionMode: agentData.permissionMode,
              sandbox: agentData.sandbox,
              askForApproval: agentData.askForApproval,
            });
            setJobLabel(jobId, agentData.ref.name);
            node.lastRunId = jobId;
            activeRunJob.value = jobId;
            const evt = await awaitJob(jobId);
            activeRunJob.value = undefined;
            if (evt.type === "job.error") {
              throw new Error(`${agentData.ref.name}: ${evt.error}`);
            }
            const result = evt.type === "job.done" ? evt.inject : undefined;
            if (!result) throw new Error("agent run returned no session");
            const text =
              result.resultText ??
              (await sessionResultText(result.provider, result.newSessionId));
            if (text) collected[pi] = text;
            return result;
          };

          try {
            if (parallelMap) {
              pushLog(
                "run",
                "raw",
                `∀∥ ${agentData.ref.name}: ${prompts.length} fresh session(s), ply ${plyLimit}`,
              );
              await mapPool(
                prompts.map((_, pi) => pi),
                plyLimit,
                async (pi) => {
                  const result = await runOne(pi, undefined);
                  lastResult = result;
                  const live = sessions.find(result.provider, result.newSessionId);
                  const c = live?.cost ?? live?.actualCost;
                  if (c != null && c > 0) {
                    runSpend += c;
                    pushLog(
                      "run",
                      "raw",
                      `$ spend +$${c.toFixed(4)} (run $${runSpend.toFixed(4)})`,
                    );
                    checkSpendTripwire();
                  }
                },
              );
            } else {
              let sessionId = linkedData?.ref.sessionId;
              for (let pi = 0; pi < prompts.length; pi++) {
                const result = await runOne(pi, sessionId);
                sessionId = result.newSessionId;
                lastResult = result;
                const live = sessions.find(result.provider, result.newSessionId);
                const c = live?.cost ?? live?.actualCost;
                if (c != null && c > 0) {
                  runSpend += c;
                  pushLog(
                    "run",
                    "raw",
                    `$ spend +$${c.toFixed(4)} (run $${runSpend.toFixed(4)})`,
                  );
                  checkSpendTripwire();
                }
              }
            }
          } catch (err) {
            node.status = "error";
            if (linked) linked.status = "error";
            const msg = err instanceof Error ? err.message : String(err);
            runErrors[node.id] = msg;
            throw err instanceof Error ? err : new Error(msg);
          }

          const textsOut = collected.filter((t): t is string => Boolean(t));
          outputs.set(node.id, {
            text: textsOut.join("\n\n---\n\n"),
            items: items.length ? textsOut : undefined,
            session: lastResult && {
              provider: lastResult.provider,
              sessionId: lastResult.newSessionId,
            },
            ports: agentSuccessPorts(),
          });
          node.status = "success";
          if (lastResult) {
            upsertResultSessionNode(node, lastResult, `${agentData.ref.name} run`);
            for (const i of inboundEdges) {
              if (i.src.data.type === "context" && i.src.data.payloadHash) {
                void fetch("/api/lineage/record", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    payloadHash: i.src.data.payloadHash,
                    mode: "workflow",
                    result: {
                      provider: lastResult.provider,
                      sessionId: lastResult.newSessionId,
                    },
                  }),
                }).catch(() => undefined);
              }
            }
            await sessions.refresh();
          } else {
            void sessions.refresh();
          }
          break;
        }

        case "approval": {
          const text = inbound
            .map((i) => i.text)
            .filter(Boolean)
            .join("\n\n---\n\n");
          if (!text) {
            node.status = "idle";
            break;
          }
          node.status = "running";
          pushLog("run", "raw", "✓ approval gate: waiting for review (splice enabled)…");
          const result = await new Promise<false | string>((resolve) => {
            pendingApproval.value = { nodeId: node.id, text, resolve };
          });
          if (result === false) {
            node.status = "error";
            runErrors[node.id] = "rejected at approval gate";
            throw new Error("rejected at approval gate");
          }
          pushLog("run", "raw", result !== text ? "✓ spliced & approved — continuing" : "✓ approved — continuing");
          outputs.set(node.id, {
            text: result,
            session: inbound.map((i) => i.session).find(Boolean),
          });
          node.status = "success";
          break;
        }

        case "knot": {
          const texts = inbound.map((i) => i.text).filter(Boolean) as string[];
          if (!texts.length) {
            node.status = "idle";
            break;
          }
          const strategy = node.data.strategy;
          let text = mergeKnotTexts(texts, strategy, { separator: node.data.separator });
          if (strategy === "synthesize" && node.data.model && node.data.provider) {
            node.status = "running";
            pushLog("run", "raw", `⋈ merge synthesize via ${node.data.provider}`);
            const { jobId } = await api.runAgent({
              provider: node.data.provider,
              agent: node.data.agent || (node.data.provider === "cursor" || node.data.provider === "antigravity" ? "agent" : node.data.provider === "codex" ? "codex" : node.data.provider === "copilot" ? "copilot" : node.data.provider === "grok" ? "grok" : "build"),
              model: node.data.model,
              prompt: text,
              graphId: g.id,
              projectDir: serverProjectDir.value,
            });
            setJobLabel(jobId, "knot");
            const evt = await awaitJob(jobId);
            if (evt.type === "job.error") throw new Error(evt.error);
            const inj = evt.type === "job.done" ? evt.inject : undefined;
            text =
              inj?.resultText ??
              (inj
                ? (await sessionResultText(inj.provider, inj.newSessionId)) ?? text
                : text);
          } else if (strategy === "synthesize") {
            pushLog("run", "raw", "⋈ merge synthesize — no model; passing labeled candidates");
          } else {
            pushLog("run", "raw", `⋈ merge ${strategy}: ${texts.length} inbound`);
          }
          outputs.set(node.id, {
            text,
            session: inbound.map((i) => i.session).find(Boolean),
          });
          node.status = "success";
          break;
        }

        case "tripwire": {
          const text = inbound
            .map((i) => i.text)
            .filter(Boolean)
            .join("\n\n---\n\n");
          const session = inbound.map((i) => i.session).find(Boolean);
          let tokens: number | undefined;
          if (session) {
            const live = sessions.find(session.provider, session.sessionId);
            if (live) {
              const sum =
                (live.tokensIn ?? 0) +
                (live.tokensOut ?? 0) +
                (live.tokensReasoning ?? 0);
              if (sum > 0) tokens = sum;
            }
          }
          const verdict = evaluateTripwire(node.data, {
            text,
            runSpend,
            runStartedAt,
            runFailures,
            tokens,
          });
          if (!verdict.tripped) {
            pushLog("run", "raw", `‡ circuit breaker ok — ${verdict.reason}`);
            if (!text) {
              node.status = "idle";
              break;
            }
            outputs.set(node.id, { text, session });
            node.status = "success";
            break;
          }
          pushLog("run", "raw", `‡ circuit breaker — ${verdict.reason} → ${node.data.action}`);
          if (node.data.action === "skip") {
            node.status = "error";
            runErrors[node.id] = verdict.reason;
            skipped.add(node.id);
            break;
          }
          if (node.data.action === "park") {
            node.status = "running";
            pushLog(
              "run",
              "raw",
              `‡ circuit breaker park: review before continuing (${verdict.reason})…`,
            );
            const result = await new Promise<false | string>((resolve) => {
              pendingApproval.value = {
                nodeId: node.id,
                text: text || `(circuit breaker: ${verdict.reason})`,
                resolve,
              };
            });
            if (result === false) {
              node.status = "error";
              runErrors[node.id] = "rejected at circuit breaker park";
              throw new Error(`‡ circuit breaker park rejected — ${verdict.reason}`);
            }
            outputs.set(node.id, {
              text: result,
              session,
            });
            node.status = "success";
            break;
          }
          node.status = "error";
          runErrors[node.id] = verdict.reason;
          throw new Error(`‡ circuit breaker: ${verdict.reason} — run stopped`);
        }

        case "judge": {
          const text = inbound
            .map((i) => i.text)
            .filter(Boolean)
            .join("\n\n---\n\n");
          const session = inbound.map((i) => i.session).find(Boolean);
          if (!text) {
            node.status = "idle";
            break;
          }
          const verdict = evaluateJudge(node.data, text);
          if (verdict.park) {
            node.status = "running";
            pushLog(
              "run",
              "raw",
              `? judge park: review before continuing (${verdict.reason})…`,
            );
            const result = await new Promise<false | string>((resolve) => {
              pendingApproval.value = {
                nodeId: node.id,
                text,
                resolve,
              };
            });
            if (result === false) {
              node.status = "error";
              runErrors[node.id] = "rejected at judge park";
              throw new Error(`? judge park rejected — ${verdict.reason}`);
            }
            const ports = judgePortsOutput("unsure", result);
            outputs.set(node.id, { text: result, session, ports });
            node.status = "success";
            break;
          }
          pushLog("run", "raw", `? judge → ${verdict.port} — ${verdict.reason}`);
          const ports = judgePortsOutput(verdict.port, text);
          outputs.set(node.id, {
            text: ports[verdict.port],
            session,
            ports,
          });
          node.status = "success";
          break;
        }

        case "until": {
          const text = inbound
            .map((i) => i.text)
            .filter(Boolean)
            .join("\n\n---\n\n");
          if (!text) {
            node.status = "idle";
            break;
          }
          const max = clampUntilMaxIterations(node.data.maxIterations);
          const iter = untilIter.get(node.id) ?? 0;
          const { targets, body } = untilLoopBody(eEdges, node.id);
          const step = advanceUntil({
            maxIterations: max,
            iterCount: iter,
            hasReenterTargets: targets.length > 0,
          });
          if (step.kind === "reenter") {
            untilIter.set(node.id, step.nextIter);
            pushLog("run", "raw", `↻ until iteration ${step.nextIter}/${max}`);
            const ports = untilPortsOutput("reenter", text);
            outputs.set(node.id, { text: ports.reenter, ports });
            pendingReenter = { untilId: node.id, text, targets, body };
            node.status = "success";
            break;
          }
          if (step.kind === "exhausted-no-wire") {
            pushLog("run", "raw", "↻ until — no reenter wire; emitting exhausted");
          } else {
            pushLog("run", "raw", `↻ until exhausted after ${max} iteration(s)`);
          }
          const ports = untilPortsOutput("exhausted", text);
          outputs.set(node.id, { text, ports });
          node.status = "success";
          break;
        }

        case "wait-idle": {
          const session = inbound.map((i) => i.session).find(Boolean);
          const text = inbound
            .map((i) => i.text)
            .filter(Boolean)
            .join("\n\n---\n\n");
          if (!session) {
            node.status = "error";
            runErrors[node.id] = "wait for idle needs an inbound session";
            throw new Error("wait for idle needs an inbound session");
          }
          const timeoutMs = clampWaitIdleTimeoutMs(node.data.timeoutMs);
          const onTimeout = node.data.onTimeout ?? "park";
          node.status = "running";
          waitingIdleNodeId.value = node.id;
          pushLog(
            "run",
            "raw",
            `◌ wait for idle: ${session.provider}:${session.sessionId.slice(0, 8)}… (${Math.round(timeoutMs / 1000)}s, on miss ${onTimeout})`,
          );
          try {
            const deadline = Date.now() + timeoutMs;
            let gotIdle = false;
            while (Date.now() < deadline) {
              if (runAborted) throw new Error("run stopped");
              const st = sessions.find(session.provider, session.sessionId)?.status;
              if (!isSessionBusy(st)) {
                gotIdle = true;
                break;
              }
              await new Promise((r) => setTimeout(r, WAIT_IDLE_POLL_MS));
            }
            if (gotIdle) {
              pushLog("run", "raw", "◌ session idle — continuing");
              outputs.set(node.id, {
                text: text || undefined,
                session,
              });
              node.status = "success";
              break;
            }
            pushLog(
              "run",
              "raw",
              `◌ still busy after ${Math.round(timeoutMs / 1000)}s → ${onTimeout}`,
            );
            const decision = decideWaitIdle({ gotIdle: false, onTimeout });
            if (decision.kind === "skip") {
              node.status = "idle";
              break;
            }
            if (decision.kind === "abort") {
              node.status = "error";
              runErrors[node.id] = "wait for idle timed out";
              throw new Error("wait for idle timed out");
            }
            const parkText =
              text ||
              `(session ${session.provider}:${session.sessionId} still busy after timeout)`;
            const result = await new Promise<false | string>((resolve) => {
              pendingApproval.value = {
                nodeId: node.id,
                text: parkText,
                resolve,
              };
            });
            if (result === false) {
              node.status = "error";
              runErrors[node.id] = "rejected at wait-for-idle park";
              throw new Error("rejected at wait-for-idle park");
            }
            pushLog(
              "run",
              "raw",
              result !== parkText
                ? "◌ spliced & approved after timeout — continuing"
                : "◌ approved after timeout — continuing",
            );
            outputs.set(node.id, { text: result, session });
            node.status = "success";
          } finally {
            waitingIdleNodeId.value = undefined;
          }
          break;
        }

        case "live-handoff": {
          const seed = inbound
            .map((i) => i.text)
            .filter(Boolean)
            .join("\n\n---\n\n");
          const inboundSession = inbound.map((i) => i.session).find(Boolean);
          const data = node.data;
          if (!inboundSession && !data.ref) {
            node.status = "error";
            runErrors[node.id] = "live handoff needs an agent or an inbound session";
            throw new Error("live handoff needs an agent or an inbound session");
          }
          node.status = "running";
          pushLog("run", "raw", "⇄ live handoff: chat until Ready…");
          const result = await new Promise<{
            ready: boolean;
            text?: string;
            session?: { provider: ProviderId; sessionId: string };
          }>((resolve) => {
            pendingLiveHandoff.value = {
              nodeId: node.id,
              seed,
              session: inboundSession,
              agentRef: data.ref,
              model: data.model,
              handoffKind: data.handoffKind ?? "distilled-summary",
              resolve,
            };
          });
          if (!result.ready || !result.text || !result.session) {
            node.status = "error";
            runErrors[node.id] = "live handoff aborted";
            throw new Error("live handoff aborted");
          }
          pushLog(
            "run",
            "raw",
            `⇄ live handoff ready — ${result.text.length} chars → downstream`,
          );
          outputs.set(node.id, {
            text: result.text,
            session: result.session,
          });
          node.status = "success";
          void sessions.refresh();
          break;
        }

        case "iterator": {
          const text = inbound
            .map((i) => i.text)
            .filter(Boolean)
            .join("\n\n");
          if (!text) {
            node.status = "idle";
            break;
          }
          const split = splitIteratorItems(text, {
            splitMode: node.data.splitMode,
            maxItems: node.data.maxItems,
          });
          if (!split.ok) {
            node.status = "error";
            runErrors[node.id] = split.error;
            throw new Error(`iterator: ${split.error}`);
          }
          const items = split.items;
          pushLog(
            "run",
            "raw",
            `∀ iterator: ${items.length} item(s) (${node.data.splitMode}${iteratorIsParallel(node.data.mode) ? ", parallel" : ""})`,
          );
          outputs.set(node.id, { text, items });
          node.status = "success";
          break;
        }

        case "context": {
          const source = inbound.map((i) => i.session).find(Boolean);
          if (!source) {
            node.status = "idle";
            break;
          }
          node.status = "running";
          try {
            const payload = await materializePayloadFor(node.data, source);
            cachePayload(payload.hash, payload);
            node.data.payloadHash = payload.hash;
            outputs.set(node.id, { text: payload.content });
            node.status = "success";
          } catch (err) {
            node.status = "error";
            jobErrors[node.id] =
              err instanceof Error ? err.message : String(err);
            throw err;
          }
          break;
        }

        case "output": {
          const source = inbound.map((i) => i.session).find(Boolean);
          // an upstream agent already carries its answer as text — reuse it
          const upstreamText = inbound.map((i) => i.text).find(Boolean);
          if (!source && !upstreamText) {
            node.status = "idle";
            break;
          }
          node.status = "running";
          const text =
            upstreamText ??
            (source
              ? await sessionResultText(source.provider, source.sessionId)
              : undefined);
          if (!text) {
            node.status = "error";
            runErrors[node.id] = "no assistant message found in the session";
            throw new Error("Output: no assistant message found");
          }
          node.data.content = text.length > 200_000 ? text.slice(0, 200_000) : text;
          node.data.preview = undefined; // legacy field, superseded by content
          outputs.set(node.id, { text, session: source });
          node.status = "success";
          break;
        }

        case "prompt-convert": {
          const texts = inbound.map((i) => i.text).filter(Boolean) as string[];
          if (!texts.length) {
            node.status = "idle";
            break;
          }
          const input = texts.join("\n\n");
          const tpl = substituteParams(node.data.template ?? "", runParamValues);
          const text = tpl.includes("{{input}}")
            ? tpl.replaceAll("{{input}}", input)
            : tpl.trim()
              ? `${tpl}\n\n${input}`
              : input;
          outputs.set(node.id, { text });
          node.status = "success";
          break;
        }

        case "delay": {
          const texts = inbound.map((i) => i.text).filter(Boolean) as string[];
          if (!texts.length) {
            node.status = "idle";
            break;
          }
          const ms = Math.min(Math.max(Math.floor(node.data.ms ?? 0), 0), 300_000);
          node.status = "running";
          pushLog("run", "raw", `◷ delay ${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`);
          const started = Date.now();
          while (Date.now() - started < ms) {
            if (runAborted || !stillBound()) throw new Error("run cancelled");
            await new Promise((r) => setTimeout(r, Math.min(200, ms - (Date.now() - started))));
          }
          outputs.set(node.id, { text: texts.join("\n\n") });
          node.status = "success";
          break;
        }

        case "data": {
          const texts = inbound.map((i) => i.text).filter(Boolean) as string[];
          const raw = texts.length ? texts.join("\n\n") : (node.data.value ?? "");
          if (!raw) {
            node.status = "idle";
            break;
          }
          const vt = node.data.valueType ?? "text";
          const coerced = coerceValue(raw, vt);
          if ("error" in coerced) throw new Error(coerced.error);
          node.data.value = coerced.value;
          outputs.set(node.id, { text: coerced.value });
          node.status = "success";
          break;
        }

        case "custom": {
          const name = node.data.ref.name;
          const def = customNodes.defs.find((d) => d.name === name);
          // wires land on their named port (in:<name> handles); untagged wires
          // and legacy nodes collect under the first / implicit port
          const portIn: Record<string, string[]> = {};
          for (const { edge, out } of inboundEdges) {
            if (out.text === undefined) continue;
            const port = edge.targetHandle?.startsWith("in:")
              ? edge.targetHandle.slice(3)
              : (def?.inputs?.[0]?.name ?? "input");
            (portIn[port] ??= []).push(out.text);
          }
          if (!Object.values(portIn).some((v) => v.length)) {
            node.status = "idle";
            break;
          }
          node.status = "running";
          try {
            // type/required checks live server-side (buildStdin/parseRunOutput)
            const r = await fetch("/api/custom-nodes/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, inputs: portIn, params: node.data.params }),
            });
            const body = (await r.json()) as {
              output?: string;
              ports?: Record<string, string>;
              stderr?: string;
              ms?: number;
              error?: string;
            };
            if (!r.ok || body.error) throw new Error(body.error ?? `custom node failed (${r.status})`);
            outputs.set(node.id, { text: body.output ?? "", ports: body.ports });
            node.status = "success";
            pushLog("run", "raw", `⌁ ${name} finished in ${body.ms}ms (${(body.output ?? "").length} chars)`);
            if (body.stderr) pushLog("run", "raw", `⌁ ${name} stderr: ${body.stderr}`);
          } catch (err) {
            node.status = "error";
            runErrors[node.id] = err instanceof Error ? err.message : String(err);
            throw err;
          }
          break;
        }
        case "mcp-tool": {
          const data = node.data;
          if (!data.ref.server || !data.tool) {
            throw new Error("MCP tool node needs a server and tool");
          }
          const inboundText = inbound
            .map((i) => i.text)
            .filter((t): t is string => t !== undefined)
            .join("\n\n");
          const args: Record<string, unknown> = { ...(data.params ?? {}) };
          if (data.argPort && inboundText) args[data.argPort] = inboundText;
          else if (inboundText && !Object.keys(args).length) args.input = inboundText;
          node.status = "running";
          try {
            const r = await fetch("/api/mcp/call", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                server: data.ref.server,
                tool: data.tool,
                args,
                projectDir: serverProjectDir.value,
              }),
            });
            const body = (await r.json()) as { output?: string; error?: string; stderr?: string };
            if (!r.ok || body.error) throw new Error(body.error ?? `MCP call failed (${r.status})`);
            outputs.set(node.id, { text: body.output ?? "" });
            node.status = "success";
            if (body.stderr?.trim()) {
              for (const line of body.stderr.split("\n")) {
                if (line.trim()) pushLog("run", "raw", `◈ ${data.ref.server}: ${line}`);
              }
            }
            pushLog("run", "raw", `◈ ${data.ref.server}/${data.tool}: ${(body.output ?? "").length} chars`);
          } catch (err) {
            node.status = "error";
            runErrors[node.id] = err instanceof Error ? err.message : String(err);
            throw err;
          }
          break;
        }
      }
      };

      const maxAttempts = 1 + Math.min(node.retry ?? 0, 10);
      const t0 = Date.now();
      for (let attempt = 1; ; attempt++) {
        try {
          await execNode();
          break;
        } catch (err) {
          const enriched = enrichUsageExhaustionError(err);
          const msg = enriched.message;
          const usageHit = classifyUsageExhaustion(msg);
          if (usageHit) {
            pushLog("run", "raw", `! ${usageHit.message}`);
          }
          if (!runAborted && attempt < maxAttempts) {
            pushLog("run", "raw", `⟳ ${nodeLabelOf(node)} failed (attempt ${attempt}/${maxAttempts}) — retrying: ${msg}`);
            node.status = "queued";
            await new Promise((r) => setTimeout(r, 800 * attempt));
            continue;
          }
          if (
            node.data.type === "agent-def" &&
            agentErrWired(eEdges, node.id) &&
            !runAborted
          ) {
            node.status = "error";
            runErrors[node.id] = msg;
            runFailures++;
            outputs.set(node.id, { ports: agentErrorPorts(msg) });
            pushLog(
              "run",
              "raw",
              `⤵ ${nodeLabelOf(node)} failed after ${attempt} attempt(s) — err port: ${msg}`,
            );
            break;
          }
          if (node.continueOnError && !runAborted) {
            node.status = "error";
            runErrors[node.id] = msg;
            skipped.add(node.id);
            runFailures++;
            pushLog("run", "raw", `⤼ ${nodeLabelOf(node)} failed after ${attempt} attempt(s) — continuing without it: ${msg}`);
            break;
          }
          throw enriched;
        }
      }
      if (node.status === "success" || node.status === "error") {
        node.lastDurationMs = Math.max(0, Date.now() - t0);
        if (node.status === "success") {
          const out = outputs.get(node.id);
          if (out) persistCanvasOutput(node.id, out);
        }
      }
    };

    const pending = new Set(order.map((n) => n.id));
    const completed = new Set<string>();
    const preds = predecessorMap(
      order.map((n) => n.id),
      structuralEdges(eEdges),
    );
    while (pending.size && stillBound()) {
      const readyIds = plyReady(pending, preds, new Set([...completed, ...skipped]));
      const ready = order.filter((n) => readyIds.includes(n.id));
      if (!ready.length) break;
      for (const n of ready) pending.delete(n.id);
      await mapPool(ready, plyLimit, async (node) => {
        await processOneNode(node);
        completed.add(node.id);
      });
      if (pendingReenter) {
        const req = pendingReenter;
        pendingReenter = undefined;
        for (const id of req.body) {
          outputs.delete(id);
          completed.delete(id);
          skipped.delete(id);
          pending.add(id);
          const n = store.nodeById(id);
          if (n) {
            n.status = "queued";
            delete n.lastDurationMs;
          }
        }
        for (const t of req.targets) {
          injectText.set(t, req.text);
        }
      }
      checkSpendTripwire();
    }
  } catch (err) {
    graphRunError.value = err instanceof Error ? err.message : String(err);
  } finally {
    // anything still queued never ran (downstream of the failure); anything
    // still "running" was interrupted — never leave it glowing forever
    for (const n of g.nodes) {
      if (n.status === "queued" || n.status === "running") n.status = "idle";
    }
    pendingApproval.value = undefined;
    pendingLiveHandoff.value = undefined;
    waitingIdleNodeId.value = undefined;
    graphRunning.value = false;
    if (activeRunGraphId === boundId) activeRunGraphId = undefined;
    if (!runAborted) {
      finishTabRun(boundId, !graphRunError.value);
    } else if (tabRuns[boundId]?.phase === "running" || tabRuns[boundId]?.phase === "waiting") {
      finishTabRun(boundId, false);
    }
    // Persist final statuses / output contents without mid-run dirty flicker
    void store.flush();
    if (wfJobId) {
      const ok = !graphRunError.value && !runAborted;
      void fetch(`/api/jobs/${wfJobId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok,
          error: graphRunError.value ?? (runAborted ? "stopped by user" : undefined),
        }),
      }).catch(() => undefined);
      wfJobId = undefined;
    }
    stopJobHeartbeat();
    if (!runAborted) {
      notifyRunFinished(!graphRunError.value, store.graph?.name ?? "workflow");
    }
  }
}

// ---- inject ----

const injectModalOpen = ref(false);
const injectBusy = ref(false);
const injectError = ref<string>();
const injectProgress = ref<string>();
// jobId → source context node id + target session node id
const pendingInjects = reactive(
  new Map<string, { contextNodeId: string; targetNodeId: string }>(),
);

/** Context node wired INTO the inspected session node, with a materialized payload. */
const injectSource = computed(() => {
  const n = inspectedNode.value;
  if (!n || (n.data.type !== "session" && n.data.type !== "subagent-run")) {
    return undefined;
  }
  if (!store.graph) return undefined;
  for (const edge of store.graph.edges) {
    if (edge.target !== n.id) continue;
    const src = store.nodeById(edge.source);
    if (src?.data.type === "context" && src.data.payloadHash) {
      return { node: src, payloadHash: src.data.payloadHash };
    }
  }
  return undefined;
});

function closeInjectModal(): void {
  injectModalOpen.value = false;
  injectError.value = undefined;
  injectProgress.value = undefined;
}

async function runInject(
  mode: InjectMode,
  kickoff: string,
  model?: string,
): Promise<void> {
  const target = inspectedNode.value;
  const source = injectSource.value;
  const sref = inspectedSessionRef.value;
  if (!target || !source || !sref) return;
  injectBusy.value = true;
  injectError.value = undefined;
  target.status = "running";
  try {
    const { jobId } = await api.inject({
      payloadHash: source.payloadHash,
      target: {
        provider: sref.provider as ProviderId,
        mode,
        model,
        sessionId: sref.sessionId,
        projectDir:
          ((target.data.type === "session" ||
            target.data.type === "subagent-run") &&
            target.data.snapshot?.projectDir) ||
          "",
      },
      kickoffPrompt: kickoff,
    });
    setJobLabel(jobId, "inject");
    pendingInjects.set(jobId, {
      contextNodeId: source.node.id,
      targetNodeId: target.id,
    });
  } catch (err) {
    injectBusy.value = false;
    injectError.value = err instanceof Error ? err.message : String(err);
    target.status = "error";
  }
}

function onInjectEvent(event: ServerEvent): boolean {
  if (!("jobId" in event) || !pendingInjects.has(event.jobId)) return false;
  const { contextNodeId, targetNodeId } = pendingInjects.get(event.jobId)!;
  const targetNode = store.nodeById(targetNodeId);

  if (event.type === "job.progress") {
    injectProgress.value = event.message;
    return true;
  }
  pendingInjects.delete(event.jobId);
  injectBusy.value = false;
  injectProgress.value = undefined;

  if (event.type === "job.error") {
    injectError.value = event.error;
    if (targetNode) targetNode.status = "error";
    return true;
  }

  if (event.type === "job.done" && event.inject) {
    if (targetNode) targetNode.status = "success";
    closeInjectModal();
    const result = event.inject;
    const isNewSession =
      (targetNode?.data.type === "session" ||
        targetNode?.data.type === "subagent-run") &&
      result.newSessionId !== targetNode.data.ref.sessionId;
    if (isNewSession && targetNode) {
      // materialize the result as a new session node wired from the context node
      const id = crypto.randomUUID().slice(0, 8);
      const node: GraphNode = {
        id,
        type: "session",
        position: {
          x: targetNode.position.x,
          y: targetNode.position.y + 110,
        },
        status: "success",
        data: {
          type: "session",
          ref: { provider: result.provider, sessionId: result.newSessionId },
          snapshot: { title: "injected session" },
          resolved: true,
        },
      };
      store.addNode(node);
      addNodes([toVfNode(node)]);
      const edge: GraphEdge = {
        id: crypto.randomUUID().slice(0, 8),
        source: contextNodeId,
        target: id,
        data: { role: "inject" },
      };
      store.addEdge(edge);
      refreshEdges();
    }
    void sessions.refresh();
    return true;
  }
  return true;
}

/** Add a subagent run from the inspector as a canvas node near its parent. */
function onAddChild(child: {
  provider: ProviderId;
  id: string;
  title?: string;
  agent?: string;
  projectDir: string;
}): void {
  const parent = inspectedNode.value;
  if (!store.graph) return;
  const id = crypto.randomUUID().slice(0, 8);
  const node: GraphNode = {
    id,
    type: "subagent-run",
    position: {
      x: (parent?.position.x ?? 100) + 60,
      y: (parent?.position.y ?? 100) + 110,
    },
    status: "idle",
    data: {
      type: "subagent-run",
      ref: { provider: child.provider, sessionId: child.id },
      snapshot: {
        title: child.title,
        agent: child.agent,
        projectDir: child.projectDir,
      },
      resolved: true,
    },
  };
  store.addNode(node);
  addNodes([toVfNode(node)]);
}
</script>

<style scoped>
.editor-page {
  height: 100%;
  display: flex;
}
/* Belt-and-suspenders: palette :style width can clobber v-show display. */
.editor-page.canvas-focus :deep(.dash-side),
.editor-page.canvas-focus :deep(.palette) {
  display: none !important;
}
.focus-hint {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  pointer-events: none;
  color: var(--text-faint);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.7;
}
.canvas-focus-btn {
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1;
}
.editor-layout {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}
.undo-btn {
  height: 30px;
  font-size: var(--fs-xl);
  line-height: 1;
  padding: 0 10px;
}
.canvas-tidy-btn {
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1;
}
.editor-main {
  flex: 1;
  display: flex;
  min-height: 0;
}
.canvas-wrap {
  flex: 1;
  position: relative;
  background: var(--canvas-bg);
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.canvas-wrap.file-drag::after {
  content: "drop workflow ·json to import";
  position: absolute;
  inset: 12px;
  z-index: 40;
  display: grid;
  place-items: center;
  pointer-events: none;
  font-family: var(--mono);
  font-size: var(--fs-sm);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text);
  background: rgba(10, 10, 12, 0.72);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
}
.canvas-wrap > .vue-flow {
  flex: 1;
  min-height: 0;
}
.canvas-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 2;
}
.canvas-hint-inner {
  max-width: 26rem;
  text-align: center;
  padding: 0 16px;
}
.canvas-hint-title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 500;
  color: var(--text-dim);
  letter-spacing: -0.01em;
}
.canvas-hint-sub {
  margin: 6px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--text-faint);
}
</style>

<style>
/* vue-flow overrides (unscoped) */
.vue-flow__edge-path {
  stroke: var(--edge);
  stroke-width: 2;
}
/* selected wires lift above the lane colors */
.vue-flow__edge.selected path.vue-flow__edge-path {
  stroke: var(--text);
  stroke-width: 2.5px;
}
/* grab anywhere on the stroke — detach from the input end on drag */
.vue-flow__edge {
  cursor: grab;
}
.vue-flow__edge:active {
  cursor: grabbing;
}
/* canvas controls styling lives in theme.css (shared with blueprint) */
</style>
