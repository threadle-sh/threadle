import { describe, expect, it } from "vitest";
import { jobs } from "../src/jobs.js";

describe("JobRecord.sessionRef", () => {
  it("stores sessionRef on create when provided", () => {
    const { jobId } = jobs.create("run-session", "abc123", "g1", {
      sessionRef: { provider: "claude-code", sessionId: "sess-full-id" },
    });
    const job = jobs.get(jobId);
    expect(job?.sessionRef).toEqual({
      provider: "claude-code",
      sessionId: "sess-full-id",
    });
    jobs.finish(jobId, { status: "cancelled", error: "test cleanup" });
  });

  it("omits sessionRef when not provided", () => {
    const { jobId } = jobs.create("run-agent", "claude-code:x");
    expect(jobs.get(jobId)?.sessionRef).toBeUndefined();
    jobs.finish(jobId, { status: "cancelled", error: "test cleanup" });
  });
});
