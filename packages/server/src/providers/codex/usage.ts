import { readCodexTranscript } from "./jsonl.js";

export interface CodexUsage {
  tokensIn: number;
  tokensOut: number;
  tokensReasoning?: number;
  /** Public rollouts rarely carry authoritative usage — chars÷4 for now. */
  source: "estimate";
}

/**
 * Rough token estimate from normalized transcript text (and thinking blocks).
 * Same chars÷4 rule of thumb as Cursor / Antigravity when CLI usage is missing.
 */
export async function estimateUsageFromTranscript(
  filePath: string,
): Promise<CodexUsage | undefined> {
  let inChars = 0;
  let outChars = 0;
  let thinkChars = 0;
  try {
    const msgs = await readCodexTranscript(filePath);
    for (const m of msgs) {
      for (const p of m.parts) {
        if (p.type === "thinking") {
          thinkChars += p.text?.length ?? 0;
          continue;
        }
        if (p.type === "text") {
          const n = p.text?.length ?? 0;
          if (m.role === "user") inChars += n;
          else outChars += n;
          continue;
        }
        if (p.type === "tool_use") {
          const input =
            typeof p.toolInput === "string"
              ? p.toolInput
              : p.toolInput !== undefined
                ? JSON.stringify(p.toolInput)
                : "";
          outChars += (p.toolName?.length ?? 0) + input.length;
          continue;
        }
        if (p.type === "tool_result") {
          outChars += p.text?.length ?? 0;
        }
      }
    }
  } catch {
    return undefined;
  }
  if (!inChars && !outChars && !thinkChars) return undefined;
  return {
    tokensIn: Math.max(0, Math.ceil(inChars / 4)),
    tokensOut: Math.max(0, Math.ceil(outChars / 4)),
    tokensReasoning: thinkChars ? Math.max(0, Math.ceil(thinkChars / 4)) : undefined,
    source: "estimate",
  };
}

export async function resolveCodexUsage(
  transcriptPath: string,
): Promise<CodexUsage | undefined> {
  return estimateUsageFromTranscript(transcriptPath);
}
