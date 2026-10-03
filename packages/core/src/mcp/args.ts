/**
 * Canvas MCP nodes store inspector values as strings. Tool schemas often want
 * objects / numbers / booleans — coerce using the snapshot param defs (from
 * the tool's JSON Schema) before `callTool`.
 */
export function coerceParamsToMcpArgs(
  params: Record<string, unknown>,
  defs?: Array<{ name: string; type: string }>,
): Record<string, unknown> {
  const byName = new Map((defs ?? []).map((d) => [d.name, d.type]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") {
      out[k] = v;
      continue;
    }
    const trimmed = v.trim();
    const type = byName.get(k);
    if (!trimmed && type && type !== "text" && type !== "choice") continue;

    switch (type) {
      case "json": {
        try {
          out[k] = JSON.parse(trimmed);
        } catch {
          throw new Error(`MCP arg "${k}" is not valid JSON`);
        }
        break;
      }
      case "int": {
        const n = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(n)) throw new Error(`MCP arg "${k}" is not an int`);
        out[k] = n;
        break;
      }
      case "float": {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) throw new Error(`MCP arg "${k}" is not a number`);
        out[k] = n;
        break;
      }
      case "bool":
        out[k] = /^(true|1)$/i.test(trimmed);
        break;
      default: {
        // No def (or text): still parse JSON object/array literals and plain numbers
        // so tools like MongoDB `find` work when the snapshot is missing.
        if (
          (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
          try {
            out[k] = JSON.parse(trimmed);
            break;
          } catch {
            /* keep string */
          }
        }
        if (/^-?\d+$/.test(trimmed)) {
          out[k] = Number.parseInt(trimmed, 10);
          break;
        }
        if (/^-?\d+\.\d+$/.test(trimmed)) {
          out[k] = Number(trimmed);
          break;
        }
        out[k] = v;
      }
    }
  }
  return out;
}
