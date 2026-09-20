import type { ContextKind } from "../context.js";
import type { NodeType } from "../graph.js";

/** Unlimited fan-in/fan-out for a handle. */
export const PORT_UNLIMITED = Number.POSITIVE_INFINITY;

export interface NodePortLimits {
  in: number;
  out: number;
}

/** One row in the palette Nodes tab or wire/add menu. */
export interface NodeMenuEntry {
  label: string;
  glyph: string;
  /** Short subtitle under the title (palette). */
  hint: string;
  /** CSS background for the glyph tile. */
  iconBg: string;
  /** CSS color for the glyph (defaults to readable contrast). */
  iconFg?: string;
  /** Sort key; lower first. */
  order?: number;
  /**
   * Context payload kind when this entry creates a `context` node.
   * Omitted for ordinary types.
   */
  contextKind?: ContextKind;
}

/**
 * Declarative description of one built-in graph node type.
 *
 * Register a new builtin in `builtins.ts`, then follow the checklist in
 * the docs tutorial (*Adding a built-in node*). Runtime execution and Vue
 * components stay in the web/server packages; this registry owns identity,
 * connectivity, ports, and UI catalog metadata.
 */
export interface NodeDefinition {
  id: NodeType;
  /** Canonical short name (menus, lint labels fallback). */
  label: string;
  glyph: string;
  /**
   * Outbound wire color. Use a CSS var (`var(--wire-prompt)`), or
   * `"provider"` when the color comes from the node's provider id.
   */
  wireColor: string;
  /** Participates in the text→text connection product. */
  textSource?: boolean;
  textSink?: boolean;
  /** Extra structural edges FROM this type (session/context lanes, etc.). */
  structuralTo?: readonly NodeType[];
  /** Forbid text→text into these targets even when both sides allow text. */
  forbidTextTo?: readonly NodeType[];
  ports: NodePortLimits;
  /** Preflight: must have at least one inbound wire. */
  requiresInput?: boolean;
  /** Soft lint: dangling outbound text is worth warning about. */
  emitsText?: boolean;
  /** Mute / bypass allowed in the canvas context menu. */
  mutable?: boolean;
  /**
   * Counts toward “can run graph”.
   * `"session-if-wired"` is decided by the editor (session continuation).
   */
  executesOnRun?: boolean | "session-if-wired";
  /** Never executed (note, group). */
  skipExec?: boolean;
  /** Detached executor also skips (e.g. subagent-run). */
  skipInDetached?: boolean;
  /**
   * Palette Nodes-tab entry. `false` = not listed there (agents/sessions/
   * skills/rules/context have their own tabs or sections).
   */
  palette?: NodeMenuEntry | false;
  /**
   * Wire-drop / empty-canvas add menu. `false` = not listed (discovered
   * dynamically elsewhere). Array when one type has several flavors
   * (context kinds).
   */
  wireMenu?: NodeMenuEntry | NodeMenuEntry[] | false;
}
