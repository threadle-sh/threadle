import { describe, expect, it } from "vitest";
import { mapClaudeLiveStatus } from "../src/providers/claude-code/discover.js";

describe("mapClaudeLiveStatus", () => {
  it("maps Claude registry idle → live (open terminal, not generating)", () => {
    expect(mapClaudeLiveStatus("idle")).toBe("live");
  });

  it("maps waiting / running explicitly", () => {
    expect(mapClaudeLiveStatus("waiting")).toBe("waiting");
    expect(mapClaudeLiveStatus("running")).toBe("running");
  });

  it("does not invent running for unknown statuses", () => {
    expect(mapClaudeLiveStatus(undefined)).toBe("unknown");
    expect(mapClaudeLiveStatus("")).toBe("unknown");
    expect(mapClaudeLiveStatus("mystery")).toBe("unknown");
  });
});
