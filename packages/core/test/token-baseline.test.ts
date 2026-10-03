import { describe, expect, it } from "vitest";
import {
  estimateTokenBaseline,
  formatBaselineSuffix,
  formatTokCompact,
} from "@threadle/shared";

describe("token baseline estimate", () => {
  it("subtracts prompt (chars÷4) from tokensIn", () => {
    const prompt = "Reply with exactly the single word: ok";
    const b = estimateTokenBaseline(6382, prompt, { ignoreLocalMarkdown: true });
    expect(b).toBeDefined();
    expect(b!.promptEst).toBe(Math.round(prompt.length / 4));
    expect(b!.baselineEst).toBe(6382 - b!.promptEst);
    expect(b!.baselineNote).toMatch(/local md skipped/);
    expect(formatBaselineSuffix(b!)).toMatch(/baseline ~/);
    expect(formatTokCompact(6382)).toBe("6.4k");
  });

  it("notes project md when not bare", () => {
    const b = estimateTokenBaseline(8000, "ok", { ignoreLocalMarkdown: false });
    expect(b!.baselineNote).toMatch(/project md/);
  });
});
