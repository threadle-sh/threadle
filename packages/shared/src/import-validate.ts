import { z } from "zod";
import { isAbsolutePath } from "./paths.js";

/** Soft cap shared by skill/rules text imports and similar write surfaces. */
export const IMPORT_TEXT_MAX_BYTES = 512_000;

export type ImportOk<T> = { ok: true; data: T };
export type ImportErr = { ok: false; error: string };
export type ImportResult<T> = ImportOk<T> | ImportErr;

export function formatZodIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "schema mismatch";
  const where = issue.path.filter((p) => p !== undefined && p !== "").join(".") || "root";
  return `${where}: ${issue.message}`;
}

/** Parse JSON text for any import surface — never throws. */
export function parseImportJson(text: string): ImportResult<unknown> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "empty file" };
  try {
    return { ok: true, data: JSON.parse(trimmed) as unknown };
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---- skills / rules text ----

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const RULE_FILENAMES = [
  "CLAUDE.md",
  "CLAUDE.local.md",
  "AGENTS.md",
  ".cursorrules",
] as const;
export type RuleFilename = (typeof RULE_FILENAMES)[number];

export function skillNameFromImportText(content: string, filename?: string): string {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m?.[1]) {
    const nameLine = m[1].match(/^name:\s*(.+)$/m);
    const rawName = nameLine?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (rawName && SKILL_NAME_RE.test(rawName)) return rawName;
  }
  const base = (filename ?? "")
    .replace(/\.SKILL\.md$/i, "")
    .replace(/\/SKILL\.md$/i, "")
    .replace(/\.md$/i, "")
    .split(/[/\\]/)
    .pop() ?? "";
  if (SKILL_NAME_RE.test(base)) return base;
  return "";
}

export interface SkillImportInput {
  content: unknown;
  name?: unknown;
  filename?: string;
  /** When true, name may be derived from frontmatter / filename. */
  allowDeriveName?: boolean;
}

export interface SkillImportData {
  content: string;
  name: string;
}

export function validateSkillImport(input: SkillImportInput): ImportResult<SkillImportData> {
  if (typeof input.content !== "string") {
    return { ok: false, error: "content required" };
  }
  const content = input.content;
  if (!content.trim()) return { ok: false, error: "content required" };
  if (content.length > IMPORT_TEXT_MAX_BYTES) {
    return { ok: false, error: `content too large (max ${IMPORT_TEXT_MAX_BYTES} bytes)` };
  }
  let name =
    typeof input.name === "string" ? input.name.trim() : "";
  if (!name && input.allowDeriveName !== false) {
    name = skillNameFromImportText(content, input.filename);
  }
  if (!name || !SKILL_NAME_RE.test(name)) {
    return {
      ok: false,
      error:
        "skill name required (kebab-case a-z0-9-) — set name or include name: in frontmatter",
    };
  }
  return { ok: true, data: { content, name } };
}

export interface RulesImportInput {
  content: unknown;
  type?: unknown;
  filename?: string;
}

export interface RulesImportData {
  content: string;
  type: RuleFilename;
}

function ruleTypeFromFilename(filename?: string): RuleFilename | undefined {
  if (!filename) return undefined;
  const base = filename.split(/[/\\]/).pop() ?? "";
  return (RULE_FILENAMES as readonly string[]).includes(base)
    ? (base as RuleFilename)
    : undefined;
}

export function validateRulesImport(input: RulesImportInput): ImportResult<RulesImportData> {
  if (typeof input.content !== "string") {
    return { ok: false, error: "content required" };
  }
  const content = input.content;
  if (!content.trim()) return { ok: false, error: "content required" };
  if (content.length > IMPORT_TEXT_MAX_BYTES) {
    return { ok: false, error: `content too large (max ${IMPORT_TEXT_MAX_BYTES} bytes)` };
  }
  const type =
    (typeof input.type === "string" &&
    (RULE_FILENAMES as readonly string[]).includes(input.type)
      ? (input.type as RuleFilename)
      : undefined) ?? ruleTypeFromFilename(input.filename);
  if (!type) {
    return {
      ok: false,
      error: `type must be one of: ${RULE_FILENAMES.join(", ")} (or name the file accordingly)`,
    };
  }
  return { ok: true, data: { content, type } };
}

/** Shared size check for PUT /content and similar. */
export function validateImportTextContent(content: unknown): ImportResult<string> {
  if (typeof content !== "string") return { ok: false, error: "content required" };
  if (!content.trim()) return { ok: false, error: "content required" };
  if (content.length > IMPORT_TEXT_MAX_BYTES) {
    return { ok: false, error: `content too large (max ${IMPORT_TEXT_MAX_BYTES} bytes)` };
  }
  return { ok: true, data: content };
}

// ---- custom node.json ----

const valueTypeSchema = z.enum(["text", "int", "float", "bool", "json"]);
const paramTypeSchema = z.enum(["text", "int", "float", "bool", "json", "choice"]);
const portNameSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "letter first, then letters/digits/_/-");

const customPortSchema = z.object({
  name: portNameSchema,
  type: valueTypeSchema.optional(),
  required: z.boolean().optional(),
  maxConnections: z.number().int().min(1).max(64).optional(),
});

const customParamSchema = z.object({
  name: portNameSchema,
  type: paramTypeSchema,
  label: z.string().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  choices: z.array(z.string()).optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  multiline: z.boolean().optional(),
});

/**
 * node.json shape accepted on import/upload. Extra keys are allowed (forward
 * compatible). `entry` XOR `command` may be omitted when a bare class file
 * exists — scanNodes still decides flavor — but when present they must be
 * well-typed.
 */
export const customNodeManifestSchema = z.object({
  id: z.string().optional(),
  env: z.string().optional(),
  label: z.string().optional(),
  glyph: z.string().optional(),
  description: z.string().optional(),
  entry: z.string().min(1).optional(),
  command: z.array(z.string().min(1)).min(1).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).optional(),
  input: z.string().optional(),
  output: z.string().optional(),
  inputs: z.array(customPortSchema).optional(),
  outputs: z.array(customPortSchema).optional(),
  params: z.array(customParamSchema).optional(),
});

export type CustomNodeManifestImport = z.infer<typeof customNodeManifestSchema>;

export function validateCustomNodeManifest(
  raw: unknown,
): ImportResult<CustomNodeManifestImport> {
  if (raw === undefined || raw === null) {
    return { ok: false, error: "node.json missing" };
  }
  const parsed = customNodeManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `invalid node.json — ${formatZodIssue(parsed.error)}` };
  }
  if (parsed.data.entry && parsed.data.command) {
    return { ok: false, error: 'invalid node.json — use either "entry" or "command", not both' };
  }
  if (parsed.data.entry?.includes("..") || isAbsolutePath(parsed.data.entry ?? "")) {
    return { ok: false, error: 'invalid node.json — "entry" must be a relative file name' };
  }
  for (const p of parsed.data.params ?? []) {
    if (p.type === "choice") {
      if (!p.options?.length) {
        return {
          ok: false,
          error: `invalid node.json — param "${p.name}": choice params need "options", a non-empty string array`,
        };
      }
    }
  }
  return { ok: true, data: parsed.data };
}

export function validateCustomNodeManifestJsonText(
  text: string,
): ImportResult<CustomNodeManifestImport> {
  const json = parseImportJson(text);
  if (!json.ok) return { ok: false, error: `node.json ${json.error}` };
  return validateCustomNodeManifest(json.data);
}
