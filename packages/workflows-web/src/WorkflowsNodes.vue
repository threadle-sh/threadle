<template>
  <div class="dash">
    <WorkflowsNav active="nodes" />
    <div class="dash-col">
      <main class="dash-main">
        <header class="dash-head">
          <div>
            <h1 class="dash-title">Custom nodes</h1>
          </div>
          <button class="threadle-btn" @click="router.push('/addon/workflows')">← Workflows</button>
        </header>
        <SettingsCustomNodes />
      </main>
      <StatusBar />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import StatusBar from "@ui/panels/StatusBar.vue";
import WorkflowsNav from "./WorkflowsNav.vue";
import SettingsCustomNodes from "./settings/SettingsCustomNodes.vue";
import "@ui/theme/chrome.css";

const router = useRouter();
</script>

<style scoped>
.dash {
  height: 100%;
  min-height: 0;
  display: flex;
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
  overflow-y: scroll;
  scrollbar-gutter: stable;
  padding: 32px 36px 64px;
}
.dash-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
</style>
