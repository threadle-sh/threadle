/** Agent-def error out-port (`out:err`) — composes with Judge / fallback arms. */

export const AGENT_ERR_PORT = "err" as const;

export function isAgentErrHandle(handle?: string | null): boolean {
  if (!handle) return false;
  return handle === "out:err" || handle === "err";
}

export function agentErrWired(
  edges: ReadonlyArray<{ source: string; sourceHandle?: string | null }>,
  nodeId: string,
): boolean {
  return edges.some((e) => e.source === nodeId && isAgentErrHandle(e.sourceHandle));
}

/** Success: keep err lane empty so named outs never fall back to primary text. */
export function agentSuccessPorts(): Record<string, string> {
  return { [AGENT_ERR_PORT]: "" };
}

/** Failure after retries: emit only on err; happy-path text stays empty. */
export function agentErrorPorts(message: string): Record<string, string> {
  return { [AGENT_ERR_PORT]: message };
}
