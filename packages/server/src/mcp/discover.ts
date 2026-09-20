import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { threadleConfigDir } from "../graphs/store.js";

export type McpTransport = "stdio" | "streamable-http" | "sse";

/** MCP server discovered from local / threadle / host configs. */
export interface DiscoveredMcpServer {
  id: string;
  label: string;
  source: string;
  transport: McpTransport;
  /** stdio */
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** http / sse */
  url?: string;
  headers?: Record<string, string>;
}

type RawServer = {
  type?: string;
  transport?: string;
  command?: string;
  args?: unknown;
  env?: unknown;
  cwd?: string;
  url?: string;
  serverUrl?: string;
  headers?: unknown;
  enabled?: boolean;
};

function asStringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function remoteTransport(entry: RawServer): McpTransport | undefined {
  const t = (entry.transport ?? entry.type ?? "").toLowerCase();
  if (t === "sse") return "sse";
  if (t === "http" || t === "streamable-http" || t === "streamable_http") {
    return "streamable-http";
  }
  const url = typeof entry.url === "string" ? entry.url : typeof entry.serverUrl === "string" ? entry.serverUrl : "";
  if (!url) return undefined;
  // bare url without type → streamable-http (MCP default for remotes)
  if (!t || t === "stdio") return "streamable-http";
  return undefined;
}

function pushServer(
  out: DiscoveredMcpServer[],
  id: string,
  entry: RawServer,
  source: string,
  cwd?: string,
): void {
  if (entry.enabled === false) return;

  const remote = remoteTransport(entry);
  const urlRaw =
    typeof entry.url === "string"
      ? entry.url.trim()
      : typeof entry.serverUrl === "string"
        ? entry.serverUrl.trim()
        : "";

  if (remote && urlRaw) {
    out.push({
      id,
      label: id,
      source,
      transport: remote,
      command: "",
      args: [],
      url: urlRaw,
      headers: asStringRecord(entry.headers),
    });
    return;
  }

  // stdio
  if (entry.type && entry.type !== "stdio") return;
  if (entry.transport && entry.transport !== "stdio") return;
  const command = typeof entry.command === "string" ? entry.command.trim() : "";
  if (!command) return;
  out.push({
    id,
    label: id,
    source,
    transport: "stdio",
    command,
    args: asStringArray(entry.args),
    env: asStringRecord(entry.env),
    cwd: typeof entry.cwd === "string" ? entry.cwd : cwd,
  });
}

/** Pull a server map from common JSON shapes used by hosts. */
function extractServersMap(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const root = raw as Record<string, unknown>;

  const candidates: unknown[] = [root.mcpServers, root.servers];
  if (root.mcp && typeof root.mcp === "object" && !Array.isArray(root.mcp)) {
    const mcp = root.mcp as Record<string, unknown>;
    candidates.push(mcp.servers, mcp.mcpServers, mcp);
  }

  for (const c of candidates) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const map = c as Record<string, unknown>;
    const values = Object.values(map);
    if (values.length === 0) return map;
    const sample = values[0];
    if (!sample || typeof sample !== "object" || Array.isArray(sample)) continue;
    const s = sample as Record<string, unknown>;
    if (
      "command" in s ||
      "url" in s ||
      "serverUrl" in s ||
      "args" in s ||
      "type" in s ||
      "transport" in s
    ) {
      return map;
    }
  }
  return undefined;
}

function parseMcpServersObject(
  raw: unknown,
  source: string,
  cwd?: string,
): DiscoveredMcpServer[] {
  const servers = extractServersMap(raw);
  if (!servers) return [];

  const out: DiscoveredMcpServer[] = [];
  for (const [id, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== "object") continue;
    pushServer(out, id, entry as RawServer, source, cwd);
  }
  return out;
}

/** Codex uses TOML `[mcp_servers.<id>]` in config.toml (not JSON mcpServers). */
function parseCodexMcpToml(
  text: string,
  source: string,
  cwd?: string,
): DiscoveredMcpServer[] {
  let root: Record<string, unknown>;
  try {
    root = parseToml(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const servers = root.mcp_servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];

  const out: DiscoveredMcpServer[] = [];
  for (const [id, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    pushServer(out, id, entry as RawServer, source, cwd);
  }
  return out;
}

async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

async function readJsonIfExists(file: string): Promise<unknown | undefined> {
  const text = await readTextIfExists(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ancestors of `start` for project-scoped MCP files, nearest first.
 * Includes `start`, walks up to the git root (or home), so monorepo
 * `packages/server` still finds a repo-root `.mcp.json`.
 */
export async function projectMcpSearchDirs(start: string): Promise<string[]> {
  const home = path.resolve(os.homedir());
  const out: string[] = [];
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    out.push(dir);
    if (dir === home) break;
    if (await pathExists(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

/** threadle-owned registry: ~/.config/threadle/mcp/servers.json */
export function threadleMcpRegistryPath(): string {
  return path.join(threadleConfigDir(), "mcp", "servers.json");
}

export function threadleMcpDir(): string {
  return path.join(threadleConfigDir(), "mcp");
}

/**
 * Discover MCP servers (stdio + HTTP/SSE) from:
 * 1. project configs (walk up to git root)
 * 2. ~/.config/threadle/mcp/servers.json
 * 3. user host configs (Cursor / Claude / opencode / Antigravity / Codex / Copilot / Grok)
 *
 * First id wins.
 */
export async function discoverMcpServers(projectDir: string): Promise<DiscoveredMcpServer[]> {
  const home = os.homedir();
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(home, ".codex");
  const copilotHome = process.env.COPILOT_HOME?.trim() || path.join(home, ".copilot");
  const grokHome = process.env.GROK_HOME?.trim() || path.join(home, ".grok");
  const projectDirs = await projectMcpSearchDirs(projectDir);

  const jsonCandidates: Array<{ file: string; cwd?: string }> = [];
  for (const dir of projectDirs) {
    jsonCandidates.push(
      { file: path.join(dir, ".mcp.json"), cwd: dir },
      { file: path.join(dir, ".github", "mcp.json"), cwd: dir },
      { file: path.join(dir, ".cursor", "mcp.json"), cwd: dir },
      { file: path.join(dir, "opencode.json"), cwd: dir },
    );
  }
  // threadle registry — after project, before user hosts
  jsonCandidates.push({ file: threadleMcpRegistryPath() });
  jsonCandidates.push(
    { file: path.join(home, ".cursor", "mcp.json") },
    { file: path.join(home, ".claude.json") },
    { file: path.join(home, ".config", "opencode", "config.json") },
    { file: path.join(home, ".config", "opencode", "opencode.json") },
    { file: path.join(home, ".gemini", "config", "mcp_config.json") },
    { file: path.join(copilotHome, "mcp-config.json") },
  );

  const tomlCandidates: Array<{ file: string; cwd?: string }> = [];
  for (const dir of projectDirs) {
    tomlCandidates.push({ file: path.join(dir, ".codex", "config.toml"), cwd: dir });
  }
  tomlCandidates.push({ file: path.join(codexHome, "config.toml") });
  tomlCandidates.push({ file: path.join(grokHome, "config.toml") });

  const byId = new Map<string, DiscoveredMcpServer>();
  const add = (servers: DiscoveredMcpServer[]) => {
    for (const s of servers) {
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
  };

  for (const c of jsonCandidates) {
    const raw = await readJsonIfExists(c.file);
    if (raw === undefined) continue;
    add(parseMcpServersObject(raw, c.file, c.cwd));
  }
  for (const c of tomlCandidates) {
    const text = await readTextIfExists(c.file);
    if (text === undefined) continue;
    add(parseCodexMcpToml(text, c.file, c.cwd));
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function looksLikeThreadleMcp(server: DiscoveredMcpServer): boolean {
  if (server.transport !== "stdio") return false;
  const cmd = server.command.toLowerCase();
  const args = server.args.map((a) => a.toLowerCase());
  if (cmd.includes("threadle") && args.includes("mcp")) return true;
  if (args.some((a) => a.includes("threadle")) && args.includes("mcp")) return true;
  return false;
}

/** Exported for unit tests. */
export const _test = {
  parseMcpServersObject,
  parseCodexMcpToml,
  extractServersMap,
  projectMcpSearchDirs,
  pushServer,
};
