import { describe, expect, it } from "vitest";
import { toAddonWorkflowsPath, workflowsWindowName } from "./app-links";

describe("workflowsWindowName", () => {
  it("uses a per-graph browsing-context name", () => {
    expect(workflowsWindowName("/addon/workflows/graph/abc123")).toBe("threadle-wf-abc123");
    expect(workflowsWindowName("/addon/workflows/graph/abc123?x=1")).toBe("threadle-wf-abc123");
    expect(workflowsWindowName("/workflows/graph/abc123")).toBe("threadle-wf-abc123");
  });

  it("shares one name for non-graph addon pages", () => {
    expect(workflowsWindowName("/addon/workflows")).toBe("threadle-workflows");
    expect(workflowsWindowName("/addon/workflows/runs")).toBe("threadle-workflows");
    expect(workflowsWindowName("/addon/workflows/nodes")).toBe("threadle-workflows");
  });
});

describe("toAddonWorkflowsPath", () => {
  it("normalizes legacy paths", () => {
    expect(toAddonWorkflowsPath("/graph/x")).toBe("/addon/workflows/graph/x");
    expect(toAddonWorkflowsPath("/wire/x")).toBe("/addon/workflows/graph/x");
    expect(toAddonWorkflowsPath("/workflows/runs")).toBe("/addon/workflows/runs");
  });
});
