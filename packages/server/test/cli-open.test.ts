import { describe, expect, it } from "vitest";
import {
  openUrl,
  parseProviderSession,
  resolveOpenTarget,
} from "../src/cli-open.js";

describe("resolveOpenTarget", () => {
  it("defaults to home", () => {
    expect(resolveOpenTarget([])).toEqual({ path: "/", label: "home" });
    expect(resolveOpenTarget(["ui"])).toEqual({ path: "/", label: "home" });
  });

  it("maps dashboard views", () => {
    expect(resolveOpenTarget(["skills"]).path).toBe("/?view=skills");
    expect(resolveOpenTarget(["rules"]).path).toBe("/?view=rules");
    expect(resolveOpenTarget(["sessions"]).path).toBe("/?view=sessions");
    expect(resolveOpenTarget(["statistics"]).path).toBe("/?view=usage");
  });

  it("opens workflow by id", () => {
    expect(resolveOpenTarget(["workflow", "a1b2c3d4"])).toEqual({
      path: "/graph/a1b2c3d4",
      label: "workflow a1b2c3d4",
    });
    expect(resolveOpenTarget(["a1b2c3d4"]).path).toBe("/graph/a1b2c3d4");
  });

  it("opens session blueprint", () => {
    expect(resolveOpenTarget(["session", "cursor", "abc"])).toEqual({
      path: "/blueprint/cursor/abc",
      label: "session cursor:abc",
    });
    expect(resolveOpenTarget(["session", "cursor:abc"]).path).toBe(
      "/blueprint/cursor/abc",
    );
  });

  it("opens skill / rules with focus query", () => {
    expect(resolveOpenTarget(["skill", "review-diff"]).path).toBe(
      "/?view=skills&skill=review-diff",
    );
    expect(resolveOpenTarget(["rules", "CLAUDE.md"]).path).toBe(
      "/?view=rules&name=CLAUDE.md",
    );
  });

  it("opens run job", () => {
    expect(resolveOpenTarget(["run", "job_1"]).path).toBe(
      "/?view=runs&job=job_1",
    );
  });

  it("opens standalone routes", () => {
    expect(resolveOpenTarget(["map"]).path).toBe("/map");
    expect(resolveOpenTarget(["timeline"]).path).toBe("/timeline");
    expect(resolveOpenTarget(["lineage"]).path).toBe("/lineage");
  });

  it("rejects unknown targets", () => {
    expect(() => resolveOpenTarget(["nope"])).toThrow(/unknown open target/);
  });
});

describe("parseProviderSession / openUrl", () => {
  it("parses provider:id", () => {
    expect(parseProviderSession("cursor:ses_1")).toEqual({
      provider: "cursor",
      sessionId: "ses_1",
    });
    expect(parseProviderSession("bad")).toBeUndefined();
  });

  it("joins base + path", () => {
    expect(openUrl("http://127.0.0.1:4570", { path: "/?view=skills", label: "skills" })).toBe(
      "http://127.0.0.1:4570/?view=skills",
    );
  });
});
