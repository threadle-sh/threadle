#!/usr/bin/env node
/**
 * Tiny stdio MCP server for canvas ◈ MCP tool demos.
 * Tools: echo({ message: string }) → text
 *
 * Run via examples/mcp/mcp.json.echo.example (cwd = threadle repo root).
 * Logs only to stderr — stdout is the protocol.
 *
 * Uses fromJsonSchema (not zod/v4) so the demo stays quiet against the
 * workspace zod 3.x tree; the MCP SDK’s nested zod 4 is not required here.
 */
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const inputSchema = fromJsonSchema({
  type: "object",
  properties: {
    message: { type: "string", description: "Text to echo back" },
  },
  required: ["message"],
  additionalProperties: false,
});

void serveStdio(() => {
  const server = new McpServer({ name: "threadle-echo", version: "0.1.0" });
  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Return the message unchanged (demo for threadle MCP tool nodes)",
      inputSchema,
    },
    async (args) => {
      const message = args && typeof args === "object" && "message" in args ? args.message : "";
      return {
        content: [{ type: "text", text: String(message ?? "") }],
      };
    },
  );
  return server;
});

console.error("threadle-echo MCP server on stdio");
