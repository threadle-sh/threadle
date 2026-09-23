/** Rail groups: workflows (composites) vs components (droppable parts). */
export const PAL_RAIL_GROUPS = [
  {
    id: "workflows",
    label: "workflows",
    tabs: [{ id: "graphs", glyph: "⌗", label: "workflows" }] as const,
  },
  {
    id: "components",
    label: "components",
    tabs: [
      { id: "agents", glyph: "⟨/⟩", label: "agents" },
      { id: "sessions", glyph: "❯", label: "sessions" },
      { id: "nodes", glyph: "▦", label: "nodes" },
      { id: "skills", glyph: "✦", label: "skills" },
      { id: "plugins", glyph: "▣", label: "plugins" },
      { id: "rules", glyph: "§", label: "rules" },
      { id: "library", glyph: "", label: "library" },
    ] as const,
  },
] as const;

export const PAL_TABS = PAL_RAIL_GROUPS.flatMap((g) => [...g.tabs]);

export type PalTab = (typeof PAL_TABS)[number]["id"];

export const VALID_TABS = new Set<string>(PAL_TABS.map((t) => t.id));

/** Label for the active rail tab (group · tab when they differ). */
export function activePalTabLabel(tabId: PalTab): string {
  const tab = PAL_TABS.find((t) => t.id === tabId);
  const group = PAL_RAIL_GROUPS.find((g) =>
    (g.tabs as readonly { id: string }[]).some((t) => t.id === tabId),
  );
  if (!tab) return "";
  if (!group || group.label === tab.label) return tab.label;
  return `${group.label} · ${tab.label}`;
}
