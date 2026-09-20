import { defineStore } from "pinia";
import { ref } from "vue";

import type { CustomParamDef, CustomPortDef, ValueType } from "@threadle/shared";

export interface CustomNodeDef {
  name: string;
  dir: string;
  kind: "class" | "command";
  label: string;
  glyph: string;
  description?: string;
  command?: string[];
  file?: string;
  timeoutMs: number;
  input: ValueType;
  output: ValueType;
  /** named ports — when present they supersede the scalar input/output */
  inputs?: CustomPortDef[];
  outputs?: CustomPortDef[];
  /** inspector-editable params rendered as widgets on the node card */
  params?: CustomParamDef[];
}

/** user-authored nodes from ~/.config/threadle/nodes — shared by palette, editor and menus */
export const useCustomNodes = defineStore("custom-nodes", () => {
  const defs = ref<CustomNodeDef[]>([]);
  let loaded = false;

  async function load(force = false): Promise<void> {
    if (loaded && !force) return;
    loaded = true;
    try {
      defs.value = (await (
        await fetch("/api/custom-nodes")
      ).json()) as CustomNodeDef[];
    } catch {
      defs.value = [];
    }
  }

  return { defs, load };
});
