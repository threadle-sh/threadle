/**
 * ~/.config/threadle/triggers.json — cron / path-watch workflow triggers.
 */

export type TriggerKind = "cron" | "watch";

export interface TriggerDef {
  id: string;
  graphId: string;
  kind: TriggerKind;
  /** Five-field cron: min hour dom mon dow (e.g. every 5 minutes via slash-star/5). */
  cron?: string;
  /** Glob / path list for kind=watch. */
  paths?: string[];
  params?: Record<string, string>;
  approveAll?: boolean;
  projectDir?: string;
}

export interface TriggersFile {
  triggers: TriggerDef[];
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GRAPH_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseTriggersJson(raw: unknown): TriggersFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("triggers root must be an object");
  }
  const triggersRaw = (raw as { triggers?: unknown }).triggers;
  if (!Array.isArray(triggersRaw)) {
    throw new Error("triggers.triggers must be an array");
  }
  if (triggersRaw.length > 100) throw new Error("too many triggers (max 100)");

  const triggers: TriggerDef[] = [];
  const seen = new Set<string>();
  for (const item of triggersRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("each trigger must be an object");
    }
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || !ID_RE.test(t.id)) {
      throw new Error(`invalid trigger id: ${String(t.id)}`);
    }
    if (seen.has(t.id)) throw new Error(`duplicate trigger id: ${t.id}`);
    seen.add(t.id);
    if (typeof t.graphId !== "string" || !GRAPH_RE.test(t.graphId)) {
      throw new Error(`trigger ${t.id}: invalid graphId`);
    }
    if (t.kind !== "cron" && t.kind !== "watch") {
      throw new Error(`trigger ${t.id}: kind must be cron|watch`);
    }
    const def: TriggerDef = {
      id: t.id,
      graphId: t.graphId,
      kind: t.kind,
    };
    if (t.kind === "cron") {
      if (typeof t.cron !== "string" || !t.cron.trim()) {
        throw new Error(`trigger ${t.id}: cron expression required`);
      }
      def.cron = t.cron.trim();
      validateCron(def.cron, t.id);
    } else {
      if (!Array.isArray(t.paths) || !t.paths.length) {
        throw new Error(`trigger ${t.id}: paths required for watch`);
      }
      if (t.paths.length > 50) throw new Error(`trigger ${t.id}: too many paths`);
      def.paths = [];
      for (const p of t.paths) {
        if (typeof p !== "string" || !p.trim() || p.length > 500) {
          throw new Error(`trigger ${t.id}: invalid path`);
        }
        def.paths.push(p.trim());
      }
    }
    if (t.params !== undefined) {
      if (typeof t.params !== "object" || t.params === null || Array.isArray(t.params)) {
        throw new Error(`trigger ${t.id}: params must be an object`);
      }
      def.params = {};
      for (const [k, v] of Object.entries(t.params as Record<string, unknown>)) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(k) || typeof v !== "string" || v.length > 100_000) {
          throw new Error(`trigger ${t.id}: invalid param ${k}`);
        }
        def.params[k] = v;
      }
    }
    if (t.approveAll === true) def.approveAll = true;
    if (typeof t.projectDir === "string" && t.projectDir.trim()) {
      def.projectDir = t.projectDir.trim();
    }
    triggers.push(def);
  }
  return { triggers };
}

/** Validate a simple 5-field cron (min hour dom mon dow). */
export function validateCron(expr: string, id?: string): void {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`${id ? `trigger ${id}: ` : ""}cron must have 5 fields`);
  }
  for (const p of parts) {
    if (!/^(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)+$/.test(p) && p !== "*") {
      // allow common forms; reject empty / weird
      if (!/^[\d*,/\-]+$/.test(p)) {
        throw new Error(`${id ? `trigger ${id}: ` : ""}invalid cron field "${p}"`);
      }
    }
  }
}

/**
 * Does `expr` match `date`? Supports *, N, N-M, * /N, N/N, lists.
 * Dow: 0=Sun … 6=Sat (also 7=Sun).
 */
export function cronMatches(expr: string, date: Date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  const vals = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  const fields = [min, hour, dom, mon, dow];
  for (let i = 0; i < 5; i++) {
    if (!fieldMatches(fields[i]!, vals[i]!, i === 4)) return false;
  }
  return true;
}

function fieldMatches(field: string, value: number, isDow: boolean): boolean {
  for (const piece of field.split(",")) {
    if (pieceMatches(piece, value, isDow)) return true;
  }
  return false;
}

function pieceMatches(piece: string, value: number, isDow: boolean): boolean {
  const [rangePart, stepPart] = piece.split("/");
  const step = stepPart ? Number(stepPart) : 1;
  if (!Number.isFinite(step) || step < 1) return false;
  if (rangePart === "*") {
    return value % step === 0;
  }
  if (!rangePart) return false;
  if (rangePart.includes("-")) {
    const [a, b] = rangePart.split("-").map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (value < a! || value > b!) return false;
    return (value - a!) % step === 0;
  }
  const n = Number(rangePart);
  if (!Number.isFinite(n)) return false;
  if (isDow && n === 7 && value === 0) return step === 1 || value % step === 0;
  if (value !== n) return false;
  return true;
}
