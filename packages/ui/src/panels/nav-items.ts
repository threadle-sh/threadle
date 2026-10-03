export interface NavItem {
  id: string;
  glyph: string;
  label: string;
  /** Small suffix (e.g. addon) — rendered quieter than the label. */
  badge?: string;
  /** Opens the other app (its own port / tab) instead of selecting a view. */
  app?: "viewer" | "workflows";
  count?: string | number;
}

export interface NavSection {
  id: string;
  /** Group id for section order; chrome is divider-only (no label in UI). */
  label: string;
  items: NavItem[];
}

/**
 * Canonical dashboard sections — single source for DashNav.
 * Order matches the product tour (Build → Review → Resources → System).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "review",
    label: "Review",
    items: [
      { id: "sessions", glyph: "❯", label: "Sessions" },
      { id: "map", glyph: "◈", label: "Map" },
      { id: "search", glyph: "⌕", label: "Search" },
      { id: "lineage", glyph: "⇄", label: "Lineage" },
      { id: "timeline", glyph: "≋", label: "Timeline" },
      { id: "usage", glyph: "◍", label: "Statistics" },
      { id: "activity", glyph: "⊙", label: "Activity" },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    items: [
      { id: "favorites", glyph: "★", label: "Favorites" },
      { id: "library", glyph: "⧉", label: "Library" },
      { id: "agents", glyph: "⟨/⟩", label: "Agents" },
      { id: "rules", glyph: "§", label: "Rules" },
      { id: "skills", glyph: "✦\uFE0E", label: "Skills" },
      { id: "services", glyph: "⏻\uFE0E", label: "Services" },
      { id: "files", glyph: "▤", label: "Files" },
      { id: "meta", glyph: "☰", label: "Meta" },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { id: "settings", glyph: "⚙\uFE0E", label: "Settings" },
      { id: "security", glyph: "⛨\uFE0E", label: "Security" },
    ],
  },
  {
    id: "addons",
    label: "Addons",
    items: [{ id: "workflows-app", glyph: "⌗", label: "Workflows", badge: "addon", app: "workflows" }],
  },
];

/** Flat list derived from {@link NAV_SECTIONS} — used by pages that only need ids/order. */
export const DEFAULT_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
