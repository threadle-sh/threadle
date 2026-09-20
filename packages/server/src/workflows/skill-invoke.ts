import type { InjectResult, ProviderId } from "@threadle/shared";
import type { LogSink } from "../providers/stream.js";
import { runProviderAgent } from "./provider-agent.js";

export interface SkillInvokeOpts {
  provider: ProviderId;
  /** Slash skill name without leading slash */
  skillName: string;
  /** Optional inbound text appended after `/{name}` */
  extra?: string;
  model?: string;
  projectDir: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}

/** Build the headless prompt used for Agent Skills slash invoke. */
export function skillInvokePrompt(skillName: string, extra?: string): string {
  const name = skillName.trim().replace(/^\//, "");
  const base = `/${name}`;
  const more = extra?.trim();
  return more ? `${base}\n\n${more}` : base;
}

/**
 * Run `/{skill}` via the chosen provider CLI (plain agent run, no agent-def).
 * Claude and Cursor resolve Agent Skills natively; others get the same slash
 * prompt (skills dirs vary by tool).
 */
export async function runSkillInvoke(opts: SkillInvokeOpts): Promise<InjectResult> {
  return runProviderAgent({
    provider: opts.provider,
    prompt: skillInvokePrompt(opts.skillName, opts.extra),
    model: opts.model,
    projectDir: opts.projectDir,
    onLog: opts.onLog,
    signal: opts.signal,
  });
}
