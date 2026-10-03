/**
 * Minimal SKILL.md frontmatter helpers (flat `key: value` only).
 * Enough for name / description / disable-model-invocation without a YAML dep.
 */

export interface SkillFrontmatter {
  fields: Record<string, string>;
  body: string;
  /** true when the file starts with a --- … --- block */
  hasFm: boolean;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillFrontmatter(raw: string): SkillFrontmatter {
  const m = raw.match(FM_RE);
  if (!m) return { fields: {}, body: raw, hasFm: false };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key || key.startsWith("#")) continue;
    fields[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { fields, body: m[2] ?? "", hasFm: true };
}

/** Model may auto-pick the skill unless disable-model-invocation is true. */
export function skillAutoInvoke(fields: Record<string, string>): boolean {
  const v = (fields["disable-model-invocation"] ?? fields["disable_model_invocation"] ?? "")
    .toLowerCase();
  return v !== "true" && v !== "1" && v !== "yes";
}

export function skillDescription(fields: Record<string, string>): string | undefined {
  const d = fields.description?.trim();
  return d || undefined;
}

/**
 * Set or remove a flat frontmatter field. Creates a frontmatter block if missing.
 * Pass `null` to remove the key.
 */
export function setFrontmatterField(
  raw: string,
  key: string,
  value: string | boolean | null,
): string {
  const parsed = parseSkillFrontmatter(raw);
  const fields = { ...parsed.fields };
  if (value === null) {
    delete fields[key];
  } else {
    fields[key] = typeof value === "boolean" ? (value ? "true" : "false") : value;
  }

  const preferredOrder = [
    "name",
    "description",
    "paths",
    "disable-model-invocation",
    "metadata",
  ];
  const keys = [
    ...preferredOrder.filter((k) => k in fields),
    ...Object.keys(fields).filter((k) => !preferredOrder.includes(k)),
  ];
  const fm = keys.map((k) => `${k}: ${fields[k]}`).join("\n");
  const body = parsed.body.replace(/^\r?\n/, "");
  if (!fm) return body;
  return `---\n${fm}\n---\n\n${body}`;
}

/** Prefer frontmatter `name`, else folder name, else undefined. */
export function skillNameFromContent(raw: string, fallback?: string): string | undefined {
  const n = parseSkillFrontmatter(raw).fields.name?.trim();
  if (n && /^[a-z0-9][a-z0-9-]{0,63}$/.test(n)) return n;
  if (fallback && /^[a-z0-9][a-z0-9-]{0,63}$/.test(fallback)) return fallback;
  return undefined;
}
