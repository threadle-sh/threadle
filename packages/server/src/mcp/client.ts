import { Client, SSEClientTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Transport } from "@modelcontextprotocol/client";
import type { Stream } from "node:stream";
import { childProcessEnv } from "../safe-env.js";
import { readSettings } from "../routes/settings.js";
import {
  discoverMcpServers,
  looksLikeThreadleMcp,
  type DiscoveredMcpServer,
} from "./discover.js";
import { coerceParamsToMcpArgs } from "./schema.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 4 * 1024 * 1024;
const MAX_STDERR_CHARS = 256 * 1024;

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

function mcpDepth(): number {
  const raw = process.env.THREADLE_MCP_DEPTH?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * MCP stdio children get the same allowlist as custom nodes, then the
 * server's own `env` from `.mcp.json` (explicit user-declared secrets).
 * Never a full copy of the threadle process environment.
 */
export function buildMcpClientEnv(extra?: Record<string, string>): Record<string, string> {
  return childProcessEnv(extra);
}

/** Apply Settings gates to a discovered list. */
export async function filterMcpServersForClient(
  servers: DiscoveredMcpServer[],
): Promise<DiscoveredMcpServer[]> {
  const settings = await readSettings();
  if (settings.mcpClientEnabled === false) return [];
  const disabled = new Set(settings.mcpDisabledServers ?? []);
  if (!disabled.size) return servers;
  return servers.filter((s) => !disabled.has(s.id));
}

export async function assertMcpClientAllowed(serverId: string): Promise<void> {
  const settings = await readSettings();
  if (settings.mcpClientEnabled === false) {
    throw new Error("MCP client is disabled in Settings");
  }
  if ((settings.mcpDisabledServers ?? []).includes(serverId)) {
    throw new Error(`MCP server "${serverId}" is disabled in Settings`);
  }
}

/** Attach before connect so early child stderr is not lost. */
function attachStderrCapture(
  stream: Stream | null,
  onLine?: (line: string) => void,
): { flush: () => string } {
  const chunks: string[] = [];
  let total = 0;
  let buf = "";
  let truncated = false;

  const pushLine = (line: string) => {
    if (!line) return;
    if (total >= MAX_STDERR_CHARS) {
      truncated = true;
      return;
    }
    const room = MAX_STDERR_CHARS - total;
    const slice = line.length > room ? line.slice(0, room) : line;
    chunks.push(slice);
    total += slice.length;
    onLine?.(slice);
    if (line.length > room) truncated = true;
  };

  if (stream) {
    stream.on("data", (chunk: Buffer | string) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        pushLine(line);
      }
    });
  }

  return {
    flush: () => {
      if (buf.trim()) {
        pushLine(buf.replace(/\r$/, ""));
        buf = "";
      }
      const text = chunks.join("\n");
      return truncated ? `${text}\n…[stderr truncated]` : text;
    },
  };
}

function buildTransport(server: DiscoveredMcpServer): {
  transport: Transport;
  stderr: Stream | null;
} {
  if (server.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: buildMcpClientEnv(server.env),
      cwd: server.cwd,
      stderr: "pipe",
    });
    return { transport, stderr: transport.stderr };
  }

  if (!server.url) throw new Error(`MCP server "${server.id}" has no url`);
  const url = new URL(server.url);
  const requestInit =
    server.headers && Object.keys(server.headers).length
      ? { headers: server.headers }
      : undefined;

  if (server.transport === "sse") {
    return {
      transport: new SSEClientTransport(url, { requestInit }),
      stderr: null,
    };
  }

  return {
    transport: new StreamableHTTPClientTransport(url, { requestInit }),
    stderr: null,
  };
}

async function withClient<T>(
  server: DiscoveredMcpServer,
  fn: (client: Client) => Promise<T>,
  opts?: {
    timeoutMs?: number;
    onStderr?: (line: string) => void;
  },
): Promise<{ result: T; stderr: string }> {
  const { transport, stderr } = buildTransport(server);
  const capture = attachStderrCapture(stderr, opts?.onStderr);
  const client = new Client({ name: "threadle", version: "0.1.0" });
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    void client.close().catch(() => undefined);
  }, timeoutMs);
  let result!: T;
  try {
    await client.connect(transport);
    result = await fn(client);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
  return { result, stderr: capture.flush() };
}

export async function listMcpTools(
  projectDir: string,
  serverId: string,
): Promise<{ server: DiscoveredMcpServer; tools: McpToolInfo[]; stderr: string }> {
  await assertMcpClientAllowed(serverId);
  const servers = await filterMcpServersForClient(await discoverMcpServers(projectDir));
  const server = servers.find((s) => s.id === serverId);
  if (!server) throw new Error(`MCP server "${serverId}" not found in local configs`);
  const { result: tools, stderr } = await withClient(server, async (client) => {
    const res = await client.listTools();
    return (res.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
  });
  return { server, tools, stderr };
}

export async function callMcpTool(opts: {
  projectDir: string;
  serverId: string;
  tool: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
  /** Live child stderr lines (MCP servers log to stderr; stdout is JSON-RPC). */
  onStderr?: (line: string) => void;
}): Promise<{ text: string; isError?: boolean; stderr: string }> {
  await assertMcpClientAllowed(opts.serverId);
  const servers = await filterMcpServersForClient(await discoverMcpServers(opts.projectDir));
  const server = servers.find((s) => s.id === opts.serverId);
  if (!server) throw new Error(`MCP server "${opts.serverId}" not found in local configs`);

  if (looksLikeThreadleMcp(server) && mcpDepth() >= 1) {
    throw new Error("MCP recursion refused — cannot call threadle mcp while already inside it");
  }

  const { result, stderr } = await withClient(
    server,
    async (client) => {
      // Canvas stores inspector + inbound argPort values as strings; coerce from
      // the live tool schema so object/number args (e.g. MongoDB filter) validate.
      let args = opts.args;
      try {
        const listed = await client.listTools();
        const tool = (listed.tools ?? []).find((t) => t.name === opts.tool);
        const defs = jsonSchemaToParamDefaults(
          tool?.inputSchema as Record<string, unknown> | undefined,
        );
        if (defs.length) args = coerceParamsToMcpArgs(opts.args, defs);
      } catch {
        args = coerceParamsToMcpArgs(opts.args);
      }
      const res = await client.callTool({
        name: opts.tool,
        arguments: args,
      });
      const parts = Array.isArray(res.content) ? res.content : [];
      const texts: string[] = [];
      for (const p of parts) {
        if (p && typeof p === "object" && (p as { type?: string }).type === "text") {
          const t = (p as { text?: string }).text;
          if (typeof t === "string") texts.push(t);
        }
      }
      let text = texts.join("\n") || JSON.stringify(res.content ?? res);
      if (text.length > MAX_OUTPUT_CHARS) {
        text = text.slice(0, MAX_OUTPUT_CHARS) + "\n…[truncated]";
      }
      return { text, isError: Boolean(res.isError) };
    },
    { timeoutMs: opts.timeoutMs, onStderr: opts.onStderr },
  );
  return { ...result, stderr };
}

/** JSON Schema properties → string params for the canvas node. */
export function jsonSchemaToParamDefaults(
  schema: Record<string, unknown> | undefined,
): { name: string; type: string; description?: string }[] {
  if (!schema || typeof schema !== "object") return [];
  const props = schema.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return [];
  const out: { name: string; type: string; description?: string }[] = [];
  for (const [name, def] of Object.entries(props as Record<string, unknown>)) {
    if (!def || typeof def !== "object") {
      out.push({ name, type: "text" });
      continue;
    }
    const d = def as { type?: string; description?: string };
    const t = d.type === "number" || d.type === "integer"
      ? d.type === "integer" ? "int" : "float"
      : d.type === "boolean"
        ? "bool"
        : d.type === "object" || d.type === "array"
          ? "json"
          : "text";
    out.push({ name, type: t, description: d.description });
  }
  return out;
}
