import { describe, expect, it } from "vitest";
import { deriveRunPhase } from "@threadle/shared";

describe("deriveRunPhase", () => {
  it("defaults to starting with no logs", () => {
    expect(deriveRunPhase([])).toEqual({ phase: "starting", label: "starting" });
  });

  it("maps thinking / tool / text lanes", () => {
    expect(
      deriveRunPhase([{ lane: "thinking", line: "hmm" }]).phase,
    ).toBe("thinking");
    expect(
      deriveRunPhase([{ lane: "tool", line: "Read: /tmp/a.ts" }]),
    ).toEqual({ phase: "tool", label: "tool · Read" });
    expect(
      deriveRunPhase([{ lane: "text", line: "ok" }]).phase,
    ).toBe("answering");
  });

  it("prefers the latest meaningful log", () => {
    const logs = [
      { lane: "meta", line: "run started" },
      { lane: "thinking", line: "…" },
      { lane: "tool", line: "Bash: ls" },
      { lane: "text", line: "done" },
    ];
    expect(deriveRunPhase(logs)).toEqual({
      phase: "answering",
      label: "answering",
    });
  });

  it("maps terminal and extra meta", () => {
    expect(
      deriveRunPhase([{ lane: "meta", line: "■ 1.2s · 10→2 tok" }]).phase,
    ).toBe("done");
    expect(
      deriveRunPhase([{ lane: "meta", line: "⎇ spawn skill-reminder" }]).phase,
    ).toBe("extra");
  });

  it("maps raw errors", () => {
    expect(
      deriveRunPhase([{ lane: "raw", line: "✗ boom" }]).phase,
    ).toBe("error");
  });
});
