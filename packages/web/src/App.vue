<template>
  <div v-if="banner" class="build-banner" role="alert">
    <span class="build-banner-text">{{ banner }}</span>
    <button class="build-banner-close" @click="dismissed = true">✕</button>
  </div>
  <router-view />
  <FileViewerWindows />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import FileViewerWindows from "@/panels/FileViewerWindows.vue";

/**
 * Build skew guard. The server reports whether its bundle on disk is newer
 * than the running process (serverStale) and the content-based web build id
 * (webBuildId); we compare against our own baked-in id. mtime is intentionally
 * unused — npm pack/extract rewrites filesystem times and would false-positive
 * on every `npx threadle` install.
 */
const staleServer = ref(false);
const staleWeb = ref(false);
const dismissed = ref(false);

const banner = computed(() => {
  if (dismissed.value) return "";
  if (staleServer.value) {
    return "The running server is an older build than the code on disk — restart it (node packages/server/dist/cli.js).";
  }
  if (staleWeb.value) {
    return "A newer UI build is available — hard-refresh this page (⇧⌘R).";
  }
  return "";
});

onMounted(async () => {
  try {
    const h = (await fetch("/api/health").then((r) => r.json())) as {
      serverStale?: boolean;
      webBuildId?: string;
    };
    staleServer.value = h.serverStale === true;
    staleWeb.value =
      typeof h.webBuildId === "string" &&
      h.webBuildId.length > 0 &&
      h.webBuildId !== __APP_BUILD_ID__;
  } catch {
    // health unavailable — server starting up; stay quiet
  }
});
</script>

<style scoped>
.build-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 7px 14px;
  background: var(--status-waiting);
  color: #2a2000;
  font-size: var(--fs-sm);
  font-weight: 500;
}
.build-banner-close {
  background: none;
  border: none;
  color: #2a2000;
  cursor: pointer;
  font-size: var(--fs-sm);
  opacity: 0.7;
}
.build-banner-close:hover {
  opacity: 1;
}
</style>
