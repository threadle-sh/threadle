import * as z from "zod/v4";
import type { ValueType, WorkflowParam } from "@threadle/workflows-shared";

/** Map workflow params → Zod raw shape for MCP `inputSchema` (SDK wraps with z.object). */
export function paramsToZodShape(
  params: WorkflowParam[] | undefined,
): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const p of params ?? []) {
    shape[p.name] = zodForValueType(p.type, p.description).optional();
  }
  return shape;
}

/** Full object schema — useful in tests. */
export function paramsToZodSchema(params: WorkflowParam[] | undefined) {
  return z.object(paramsToZodShape(params));
}

function zodForValueType(type: ValueType, description?: string): z.ZodType {
  let schema: z.ZodType;
  switch (type) {
    case "int":
      schema = z.number().int();
      break;
    case "float":
      schema = z.number();
      break;
    case "bool":
      schema = z.boolean();
      break;
    case "json":
      schema = z.unknown();
      break;
    case "text":
    default:
      schema = z.string();
      break;
  }
  return description ? schema.describe(description) : schema;
}

/** Coerce MCP tool args into string params for `executeWorkflow`. */
export function coerceToolArgsToParams(
  args: Record<string, unknown>,
  params: WorkflowParam[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const byName = new Map((params ?? []).map((p) => [p.name, p]));
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    const p = byName.get(k);
    out[k] = valueToStringParam(v, p?.type ?? "text");
  }
  return out;
}

export function valueToStringParam(v: unknown, type: ValueType): string {
  if (type === "json") {
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  if (type === "bool") {
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  }
  if (type === "int" || type === "float") {
    return typeof v === "number" ? String(v) : String(v);
  }
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function toolNameForGraphId(graphId: string): string {
  return `wf_${graphId}`;
}

export function graphIdFromToolName(name: string): string | undefined {
  if (!name.startsWith("wf_")) return undefined;
  return name.slice(3);
}
