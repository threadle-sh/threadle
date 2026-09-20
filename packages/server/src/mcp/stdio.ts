import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { invokeWorkflowTool, listWorkflowTools } from "./workflow-tools.js";

/**
 * Stdio MCP server: each saved workflow becomes a tool `wf_<graphId>`.
 * Logs only to stderr — stdout is the JSON-RPC channel.
 */
export function startMcpStdio(): void {
  console.error("threadle mcp — workflow tools over stdio");

  void serveStdio(async () => {
    const server = new McpServer({
      name: "threadle",
      version: "0.1.0",
    });

    const tools = await listWorkflowTools();
    console.error(`threadle mcp — ${tools.length} workflow tool(s)`);

    // Workspace zod/v4 vs SDK nested zod disagree on ZodRawShape; register via loose fn.
    const register = server.registerTool.bind(server) as (
      name: string,
      config: {
        title?: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      },
      cb: (args: Record<string, unknown>) => Promise<{
        content: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      }>,
    ) => void;

    for (const t of tools) {
      register(
        t.name,
        {
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
        },
        async (args) => {
          try {
            const res = await invokeWorkflowTool({
              toolName: t.name,
              args: args ?? {},
              projectDir: process.env.THREADLE_MCP_PROJECT_DIR ?? process.cwd(),
            });
            return { content: [{ type: "text" as const, text: res.text }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[mcp] ${t.name} failed: ${msg}`);
            return {
              content: [{ type: "text" as const, text: msg }],
              isError: true,
            };
          }
        },
      );
    }

    return server;
  });
}
