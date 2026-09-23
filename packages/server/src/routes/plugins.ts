import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { claudeHome } from "../providers/claude-code/discover.js";
import { codexHome } from "../providers/codex/paths.js";
import { copilotHome } from "../providers/copilot/paths.js";
import { cursorHome } from "../providers/cursor/paths.js";
import { grokHome } from "../providers/grok/paths.js";
import { pluginsRoot as musePluginsRoot } from "../providers/muse/paths.js";
import { pathContained } from "../path-safe.js";

export type PluginProvider =
  | "claude-code"
  | "codex"
  | "copilot"
  | "grok"
  | "cursor"
  | "muse";

export type PluginOriginKind =
  | "marketplace-catalog"
  | "installed-tree"
  | "cache"
  | "skill-bundle";

export type PluginState = "catalog-only" | "cached" | "installed";

export type PluginChildKind = "skill" | "agent" | "mcp" | "command";

export interface PluginChild {
  kind: PluginChildKind;
  name: string;
  description?: string;
  path?: string;
}

export interface PluginEntry {
  provider: PluginProvider;
  id: string;
  name: string;
  version?: string;
  description?: string;
  origin: {
    kind: PluginOriginKind;
    path: string;
    marketplaceId?: string;
  };
  state: PluginState;
  children: PluginChild[];
}

interface ManifestFields {
  name?: string;
  version?: string;
  description?: string;
  displayName?: string;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function parseManifest(file: string): ManifestFields {
  const raw = asRecord(readJson(file));
  if (!raw) return {};
  const iface = asRecord(raw.interface);
  return {
    name: str(raw.name),
    version: str(raw.version),
    description: str(raw.description) ?? str(iface?.shortDescription),
    displayName: str(iface?.displayName),
  };
}

/** Minimal YAML frontmatter: name + description (string or folded) */
function skillFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = content.slice(3, end);
  let name: string | undefined;
  let description: string | undefined;
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nm = /^name:\s*(.+)\s*$/.exec(line);
    if (nm) {
      name = nm[1]!.replace(/^["']|["']$/g, "").trim();
      continue;
    }
    const ds = /^description:\s*(.*)$/.exec(line);
    if (ds) {
      let rest = ds[1]!.trim();
      if (rest === ">" || rest === "|" || rest === "") {
        const parts: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const L = lines[j]!;
          if (/^\S/.test(L) && !/^\s/.test(L)) break;
          if (/^[a-zA-Z0-9_-]+:\s*/.test(L) && !/^\s/.test(L)) break;
          parts.push(L.replace(/^\s+/, ""));
          i = j;
        }
        description = parts.join(" ").trim() || undefined;
      } else {
        description = rest.replace(/^["']|["']$/g, "").trim() || undefined;
      }
    }
  }
  return { name, description };
}

async function readSkillMeta(
  skillMd: string,
): Promise<{ name: string; description?: string }> {
  const folder = path.basename(path.dirname(skillMd));
  try {
    const raw = await fs.promises.readFile(skillMd, "utf8");
    const fm = skillFrontmatter(raw.slice(0, 4_000));
    return {
      name: fm.name || folder,
      description: fm.description,
    };
  } catch {
    return { name: folder };
  }
}

async function walkNamedFiles(
  root: string,
  fileName: string,
  maxDepth = 8,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const abs = path.join(dir, e.name);
      if (!pathContained(abs, root) && abs !== root) continue;
      if (e.isDirectory()) {
        await walk(abs, depth + 1);
      } else if (e.isFile() && e.name === fileName) {
        out.push(abs);
      }
    }
  }
  await walk(root, 0);
  return out;
}

async function listPluginChildren(pluginRoot: string): Promise<PluginChild[]> {
  const children: PluginChild[] = [];

  async function addSkills(skillsRoot: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(skillsRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMd = path.join(skillsRoot, e.name, "SKILL.md");
      try {
        await fs.promises.access(skillMd);
      } catch {
        continue;
      }
      const meta = await readSkillMeta(skillMd);
      children.push({
        kind: "skill",
        name: meta.name,
        description: meta.description,
        path: skillMd,
      });
    }
  }

  async function addMdDir(
    dirName: string,
    kind: PluginChildKind,
  ): Promise<void> {
    const dir = path.join(pluginRoot, dirName);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      children.push({
        kind,
        name: e.name.replace(/\.md$/i, ""),
        path: path.join(dir, e.name),
      });
    }
  }

  await addSkills(path.join(pluginRoot, "skills"));
  await addMdDir("agents", "agent");
  await addMdDir("commands", "command");

  // MCP hint from .mcp.json / mcpServers
  for (const mcpName of [".mcp.json", "mcp.json"]) {
    const mcpPath = path.join(pluginRoot, mcpName);
    const raw = asRecord(readJson(mcpPath));
    const servers = asRecord(raw?.mcpServers) ?? asRecord(raw?.servers);
    if (servers) {
      for (const key of Object.keys(servers)) {
        children.push({ kind: "mcp", name: key, path: mcpPath });
      }
    }
  }

  return children;
}

function pluginsRootClaude(): string {
  return path.join(claudeHome(), "plugins");
}

/** Claude marketplace checkouts under ~/.claude/plugins/marketplaces/ */
export async function listClaudePlugins(): Promise<PluginEntry[]> {
  const root = pluginsRootClaude();
  const knownPath = path.join(root, "known_marketplaces.json");
  const known = asRecord(readJson(knownPath)) ?? {};
  const marketplacesDir = path.join(root, "marketplaces");

  const marketplaceIds = new Set<string>();
  const installById = new Map<string, string>();

  for (const [id, meta] of Object.entries(known)) {
    marketplaceIds.add(id);
    const m = asRecord(meta);
    const loc = str(m?.installLocation);
    if (loc) installById.set(id, loc);
  }

  try {
    for (const name of await fs.promises.readdir(marketplacesDir)) {
      marketplaceIds.add(name);
      if (!installById.has(name)) {
        installById.set(name, path.join(marketplacesDir, name));
      }
    }
  } catch {
    /* no marketplaces dir */
  }

  const out: PluginEntry[] = [];
  const seen = new Set<string>();

  for (const marketplaceId of marketplaceIds) {
    const base = installById.get(marketplaceId);
    if (!base) continue;
    const manifestPaths = await walkNamedFiles(base, "plugin.json", 6);
    for (const manifestPath of manifestPaths) {
      if (!manifestPath.includes(`${path.sep}.claude-plugin${path.sep}`)) {
        continue;
      }
      const pluginRoot = path.dirname(path.dirname(manifestPath));
      if (seen.has(pluginRoot)) continue;
      seen.add(pluginRoot);
      const fields = parseManifest(manifestPath);
      const id = fields.name || path.basename(pluginRoot);
      out.push({
        provider: "claude-code",
        id,
        name: fields.displayName || id,
        version: fields.version,
        description: fields.description,
        origin: {
          kind: "marketplace-catalog",
          path: pluginRoot,
          marketplaceId,
        },
        state: "catalog-only",
        children: await listPluginChildren(pluginRoot),
      });
    }
  }

  return out;
}

/** Codex cached curated plugins under ~/.codex/plugins/cache/ */
export async function listCodexPlugins(): Promise<PluginEntry[]> {
  const cacheRoot = path.join(codexHome(), "plugins", "cache");
  const manifests = await walkNamedFiles(cacheRoot, "plugin.json", 8);
  const out: PluginEntry[] = [];
  const seen = new Set<string>();

  for (const manifestPath of manifests) {
    if (!manifestPath.includes(`${path.sep}.codex-plugin${path.sep}`)) continue;
    const pluginRoot = path.dirname(path.dirname(manifestPath));
    if (seen.has(pluginRoot)) continue;
    seen.add(pluginRoot);

    const fields = parseManifest(manifestPath);
    const id = fields.name || path.basename(pluginRoot);
    const version =
      fields.version ||
      path.basename(pluginRoot).match(/^\d+\.\d+/)?.[0] ||
      undefined;

    // Parent may hold remote id sidecar
    let marketplaceId: string | undefined;
    const sidecar = path.join(
      path.dirname(pluginRoot),
      ".codex-remote-plugin-install.json",
    );
    const side = asRecord(readJson(sidecar));
    marketplaceId = str(side?.remote_plugin_id);

    // cache/<curated-id>/<name>/<ver>/
    const parts = pluginRoot.split(path.sep);
    const cacheIdx = parts.lastIndexOf("cache");
    if (cacheIdx >= 0 && parts[cacheIdx + 1]) {
      marketplaceId = marketplaceId ?? parts[cacheIdx + 1];
    }

    out.push({
      provider: "codex",
      id,
      name: fields.displayName || id,
      version,
      description: fields.description,
      origin: {
        kind: "cache",
        path: pluginRoot,
        marketplaceId,
      },
      state: "cached",
      children: await listPluginChildren(pluginRoot),
    });
  }

  return out;
}

/** Copilot installed-plugins tree (often empty) */
export async function listCopilotPlugins(): Promise<PluginEntry[]> {
  const root = path.join(copilotHome(), "installed-plugins");
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: PluginEntry[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    const pluginRoot = path.join(root, e.name);
    // Prefer known manifest locations
    const candidates = [
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      path.join(pluginRoot, ".grok-plugin", "plugin.json"),
      path.join(pluginRoot, "plugin.json"),
      path.join(pluginRoot, "package.json"),
    ];
    let fields: ManifestFields = {};
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        fields = parseManifest(c);
        break;
      }
    }
    const id = fields.name || e.name;
    out.push({
      provider: "copilot",
      id,
      name: fields.displayName || id,
      version: fields.version,
      description: fields.description,
      origin: { kind: "installed-tree", path: pluginRoot },
      state: "installed",
      children: await listPluginChildren(pluginRoot),
    });
  }
  return out;
}

/** Grok installed-plugins + marketplace-cache packs */
export async function listGrokPlugins(): Promise<PluginEntry[]> {
  const out: PluginEntry[] = [];
  const seen = new Set<string>();

  async function addFromRoot(
    root: string,
    originKind: PluginOriginKind,
    state: PluginState,
    marketplaceId?: string,
  ): Promise<void> {
    const manifests = await walkNamedFiles(root, "plugin.json", 8);
    for (const manifestPath of manifests) {
      const isGrok = manifestPath.includes(`${path.sep}.grok-plugin${path.sep}`);
      const isClaude = manifestPath.includes(
        `${path.sep}.claude-plugin${path.sep}`,
      );
      if (!isGrok && !isClaude) continue;
      const pluginRoot = path.dirname(path.dirname(manifestPath));
      if (seen.has(pluginRoot)) continue;
      seen.add(pluginRoot);
      const fields = parseManifest(manifestPath);
      const id = fields.name || path.basename(pluginRoot);
      out.push({
        provider: "grok",
        id,
        name: fields.displayName || id,
        version: fields.version,
        description: fields.description,
        origin: {
          kind: originKind,
          path: pluginRoot,
          marketplaceId,
        },
        state,
        children: await listPluginChildren(pluginRoot),
      });
    }
  }

  await addFromRoot(
    path.join(grokHome(), "installed-plugins"),
    "installed-tree",
    "installed",
  );

  const cacheRoot = path.join(grokHome(), "marketplace-cache");
  let hashes: string[] = [];
  try {
    hashes = await fs.promises.readdir(cacheRoot);
  } catch {
    hashes = [];
  }
  for (const hash of hashes) {
    const abs = path.join(cacheRoot, hash);
    try {
      const st = await fs.promises.stat(abs);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    await addFromRoot(abs, "cache", "cached", hash);
  }

  return out;
}

/** Cursor bundled skills under ~/.cursor/skills-cursor/ */
export async function listCursorPlugins(): Promise<PluginEntry[]> {
  const root = path.join(cursorHome(), "skills-cursor");
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const sync = asRecord(readJson(path.join(root, ".sync-manifest.json")));
  const syncSkills = asRecord(sync?.skills);

  const out: PluginEntry[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const skillMd = path.join(root, e.name, "SKILL.md");
    try {
      await fs.promises.access(skillMd);
    } catch {
      continue;
    }
    const meta = await readSkillMeta(skillMd);
    const syncRow = asRecord(syncSkills?.[e.name]);
    out.push({
      provider: "cursor",
      id: e.name,
      name: meta.name || e.name,
      description: meta.description,
      origin: {
        kind: "skill-bundle",
        path: path.join(root, e.name),
        marketplaceId: "skills-cursor",
      },
      state: "installed",
      children: [
        {
          kind: "skill",
          name: meta.name || e.name,
          description: meta.description,
          path: skillMd,
        },
      ],
    });
    void syncRow; // reserved for lastSyncedAt if UI needs it later
  }
  return out;
}

/** Muse plugin cache under ~/.local/share/muse/plugins (read-only). */
export async function listMusePlugins(): Promise<PluginEntry[]> {
  const roots = [
    path.join(musePluginsRoot(), "cache", "builtin"),
    path.join(musePluginsRoot(), "installed"),
  ];
  const out: PluginEntry[] = [];
  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const pluginRoot = path.join(root, e.name);
      out.push({
        provider: "muse",
        id: e.name,
        name: e.name,
        origin: {
          kind: root.includes("cache") ? "cache" : "installed-tree",
          path: pluginRoot,
        },
        state: root.includes("cache") ? "cached" : "installed",
        children: await listPluginChildren(pluginRoot),
      });
    }
  }
  return out;
}

export async function listAllPlugins(
  providerFilter?: string,
): Promise<PluginEntry[]> {
  const want = providerFilter?.trim();
  const tasks: Array<Promise<PluginEntry[]>> = [];
  if (!want || want === "claude-code" || want === "claude") {
    tasks.push(listClaudePlugins());
  }
  if (!want || want === "codex") tasks.push(listCodexPlugins());
  if (!want || want === "copilot") tasks.push(listCopilotPlugins());
  if (!want || want === "grok") tasks.push(listGrokPlugins());
  if (!want || want === "cursor") tasks.push(listCursorPlugins());
  if (!want || want === "muse") tasks.push(listMusePlugins());

  const chunks = await Promise.all(tasks);
  const out = chunks.flat();
  out.sort((a, b) => {
    const pc = a.provider.localeCompare(b.provider);
    if (pc) return pc;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export const pluginRoutes = new Hono();

pluginRoutes.get("/", async (c) => {
  const provider = c.req.query("provider") ?? undefined;
  const items = await listAllPlugins(provider);
  return c.json(items);
});
