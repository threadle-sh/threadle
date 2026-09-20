import type { DistillConfig, ProviderId } from "@threadle/shared";
import type { LogSink } from "../providers/stream.js";
import { runProviderAgent } from "../workflows/provider-agent.js";

const DISTILL_PROMPT = `Distill the following transcript into a dense context brief for another AI agent. Cover:
- Goal: what the session set out to do
- Current state: what has been accomplished so far
- Key decisions and their reasons
- Files touched and what changed in them
- Unresolved issues or open questions
- Exact next steps

Output markdown only, no preamble, no closing remarks.`;

export interface DistillResult {
  summary: string;
  model?: string;
  provider?: ProviderId;
}

export interface DistillOpts {
  renderedTranscript: string;
  config: DistillConfig;
  projectDir: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}

/** Distill a rendered transcript via any provider CLI (default Claude). */
export async function distill(opts: DistillOpts): Promise<DistillResult>;
/** @deprecated Prefer distill({ renderedTranscript, config, projectDir, … }) */
export async function distill(
  renderedTranscript: string,
  config: DistillConfig,
  onLog?: LogSink,
  signal?: AbortSignal,
  projectDir?: string,
): Promise<DistillResult>;
export async function distill(
  a: string | DistillOpts,
  config?: DistillConfig,
  onLog?: LogSink,
  signal?: AbortSignal,
  projectDir?: string,
): Promise<DistillResult> {
  const opts: DistillOpts =
    typeof a === "string"
      ? {
          renderedTranscript: a,
          config: config!,
          projectDir: projectDir ?? process.cwd(),
          onLog,
          signal,
        }
      : a;

  const provider: ProviderId = opts.config.provider ?? "claude-code";
  const instructions = opts.config.extraInstructions
    ? `${DISTILL_PROMPT}\n\nAdditional instructions: ${opts.config.extraInstructions}`
    : DISTILL_PROMPT;
  const prompt = `${instructions}\n\n---\n\n${opts.renderedTranscript}`;

  opts.onLog?.(
    "raw",
    `distill via ${provider}${opts.config.model ? ` (${opts.config.model})` : ""}`,
  );

  const result = await runProviderAgent({
    provider,
    prompt,
    model: opts.config.model,
    projectDir: opts.projectDir,
    onLog: opts.onLog,
    signal: opts.signal,
  });

  const text = result.resultText?.trim();
  if (!text) throw new Error(`distill failed: no result from ${provider}`);

  return {
    summary: stripOuterFence(text),
    model: opts.config.model,
    provider,
  };
}

/** Models sometimes wrap the whole answer in a ```markdown fence — unwrap it. */
function stripOuterFence(text: string): string {
  const m = /^```(?:markdown|md)?\n([\s\S]*)\n```\s*$/.exec(text.trim());
  return m ? m[1]! : text;
}
