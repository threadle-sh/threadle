import { useFileViewersStore } from "@/stores/fileViewers";
import {
  formatMcpInfoMarkdown,
  formatMcpProbeLine,
  mcpDeepProbeArgs,
  pickMcpDeepProbeTool,
  summarizeMcpProbe,
  type McpProbeResult,
  type McpServerInfoRow,
  type McpToolInfoRow,
} from "@threadle/shared";

export type { McpProbeResult, McpServerInfoRow, McpToolInfoRow };
export { formatMcpInfoMarkdown };
/** @deprecated use formatMcpProbeLine — kept as alias for call sites */
export const formatProbeLine = formatMcpProbeLine;

function serversUrl(projectDir?: string): string {
  if (!projectDir?.trim()) return "/api/mcp/servers";
  return `/api/mcp/servers?dir=${encodeURIComponent(projectDir.trim())}`;
}

function toolsUrl(serverId: string, projectDir?: string): string {
  const base = `/api/mcp/servers/${encodeURIComponent(serverId)}/tools`;
  if (!projectDir?.trim()) return base;
  return `${base}?dir=${encodeURIComponent(projectDir.trim())}`;
}

/**
 * Spawn/connect the MCP server, list tools, and optionally run a cheap
 * metadata tool (`list-databases` / …) to verify the backend is reachable.
 */
export async function probeMcpConnection(opts: {
  serverId: string;
  selectedTool?: string;
  projectDir?: string;
  /** When true, also call a safe metadata tool if the server exposes one. */
  deep?: boolean;
}): Promise<McpProbeResult> {
  const serverId = opts.serverId.trim();
  const t0 = performance.now();
  if (!serverId) {
    return { ok: false, ms: 0, toolCount: 0, error: "no server selected" };
  }

  try {
    const toolsRes = await fetch(toolsUrl(serverId, opts.projectDir));
    const toolsBody = (await toolsRes.json()) as {
      tools?: McpToolInfoRow[];
      stderr?: string;
      error?: string;
    };
    if (!toolsRes.ok) {
      return summarizeMcpProbe({
        ms: Math.round(performance.now() - t0),
        toolNames: [],
        listError: toolsBody.error ?? `HTTP ${toolsRes.status}`,
        stderr: toolsBody.stderr,
      });
    }

    const tools = toolsBody.tools ?? [];
    const toolNames = tools.map((t) => t.name);

    let deepOk: boolean | undefined;
    let deepTool: string | undefined;
    let deepPreview: string | undefined;
    let deepError: string | undefined;

    if (opts.deep !== false) {
      deepTool = pickMcpDeepProbeTool(toolNames);
      if (deepTool) {
        try {
          const callRes = await fetch("/api/mcp/call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              server: serverId,
              tool: deepTool,
              args: mcpDeepProbeArgs(deepTool),
              projectDir: opts.projectDir,
            }),
          });
          const callBody = (await callRes.json()) as {
            output?: string;
            error?: string;
            stderr?: string;
          };
          if (!callRes.ok || callBody.error) {
            deepOk = false;
            deepError = callBody.error ?? `HTTP ${callRes.status}`;
          } else {
            deepOk = true;
            deepPreview = (callBody.output ?? "").slice(0, 240);
          }
        } catch (err) {
          deepOk = false;
          deepError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    return summarizeMcpProbe({
      ms: Math.round(performance.now() - t0),
      toolNames,
      selectedTool: opts.selectedTool,
      deepTool,
      deepOk,
      deepPreview,
      deepError,
      stderr: toolsBody.stderr,
    });
  } catch (err) {
    return {
      ok: false,
      ms: Math.round(performance.now() - t0),
      toolCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetch live MCP server + tool schemas and open a floating viewer window.
 * Dedups by server id so reopening focuses the same window.
 */
export async function openMcpServerInfo(opts: {
  serverId: string;
  selectedTool?: string;
  projectDir?: string;
}): Promise<void> {
  const serverId = opts.serverId.trim();
  if (!serverId) return;

  const viewers = useFileViewersStore();
  const key = `mcp:${serverId}`;
  const name = `◈ ${serverId}`;

  viewers.openDocument({
    key,
    name,
    content: `_Loading MCP server **${serverId}**…_`,
    format: "markdown",
  });

  let listBody: {
    servers?: McpServerInfoRow[];
    registryPath?: string;
    mcpClientEnabled?: boolean;
    error?: string;
  } = {};
  let toolsBody: {
    server?: McpServerInfoRow;
    tools?: McpToolInfoRow[];
    stderr?: string;
    error?: string;
  } = {};

  try {
    const listRes = await fetch(serversUrl(opts.projectDir));
    listBody = (await listRes.json()) as typeof listBody;
    if (!listRes.ok) throw new Error(listBody.error ?? `HTTP ${listRes.status}`);

    const toolsRes = await fetch(toolsUrl(serverId, opts.projectDir));
    toolsBody = (await toolsRes.json()) as typeof toolsBody;
    if (!toolsRes.ok) {
      const discovered = (listBody.servers ?? []).find((s) => s.id === serverId);
      const md = formatMcpInfoMarkdown({
        server: discovered ?? {
          id: serverId,
          label: serverId,
          source: "—",
        },
        tools: [],
        selectedTool: opts.selectedTool,
        projectDir: opts.projectDir,
        registryPath: listBody.registryPath,
        error: toolsBody.error ?? `HTTP ${toolsRes.status}`,
      });
      viewers.openDocument({ key, name, content: md, format: "markdown" });
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    viewers.openDocument({
      key,
      name,
      content: `# ◈ MCP · ${serverId}\n\n**Error:** ${msg}\n`,
      format: "markdown",
    });
    return;
  }

  const server =
    toolsBody.server ??
    (listBody.servers ?? []).find((s) => s.id === serverId) ?? {
      id: serverId,
      label: serverId,
      source: "—",
    };

  const fromList = (listBody.servers ?? []).find((s) => s.id === serverId);
  const merged: McpServerInfoRow = {
    ...server,
    envKeys: server.envKeys ?? fromList?.envKeys,
    headerKeys: server.headerKeys ?? fromList?.headerKeys,
    command: server.command ?? fromList?.command,
    args: server.args ?? fromList?.args,
    cwd: server.cwd ?? fromList?.cwd,
    disabled: fromList?.disabled,
    threadle: server.threadle ?? fromList?.threadle,
  };

  const md = formatMcpInfoMarkdown({
    server: merged,
    tools: toolsBody.tools ?? [],
    selectedTool: opts.selectedTool,
    projectDir: opts.projectDir,
    registryPath: listBody.registryPath,
    stderr: toolsBody.stderr,
    error:
      listBody.mcpClientEnabled === false
        ? "MCP client is disabled in Settings"
        : undefined,
  });
  viewers.openDocument({ key, name, content: md, format: "markdown", w: 640, h: 520 });
}
