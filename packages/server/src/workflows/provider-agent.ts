import type { InjectResult, ProviderId } from "@threadle/shared";
import { runClaudeAgent } from "../providers/claude-code/inject.js";
import { runCursorAgent } from "../providers/cursor/inject.js";
import { runAntigravityAgent } from "../providers/antigravity/inject.js";
import { runCodexAgent } from "../providers/codex/inject.js";
import { runCopilotAgent } from "../providers/copilot/inject.js";
import { runGrokAgent } from "../providers/grok/inject.js";
import { runOpencodeAgent } from "../providers/opencode/inject.js";
import type { LogSink } from "../providers/stream.js";

export interface ProviderAgentOpts {
  provider: ProviderId;
  prompt: string;
  model?: string;
  projectDir: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}

/** One-shot agent run via the chosen provider CLI (no agent-def / session resume). */
export async function runProviderAgent(opts: ProviderAgentOpts): Promise<InjectResult> {
  const common = {
    prompt: opts.prompt,
    projectDir: opts.projectDir,
    model: opts.model,
    onLog: opts.onLog,
    signal: opts.signal,
  };
  switch (opts.provider) {
    case "opencode":
      return runOpencodeAgent(common);
    case "cursor":
      return runCursorAgent(common);
    case "antigravity":
      return runAntigravityAgent(common);
    case "codex":
      return runCodexAgent(common);
    case "copilot":
      return runCopilotAgent(common);
    case "grok":
      return runGrokAgent(common);
    case "claude-code":
    default:
      return runClaudeAgent(common);
  }
}
