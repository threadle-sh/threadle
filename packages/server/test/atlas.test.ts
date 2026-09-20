import { describe, expect, it } from "vitest";
import {
  atlasDocumentSchema,
  atlasHubNodeId,
  atlasSessionKey,
  atlasSessionNodeId,
  atlasAgentNodeId,
  type SessionRef,
} from "@threadle/shared";
import { buildAtlasDocument } from "../src/atlas/build.js";

function sess(
  partial: Partial<SessionRef> & Pick<SessionRef, "id" | "provider">,
): SessionRef {
  return {
    projectDir: "/proj",
    updatedAt: 1000,
    status: "idle",
    kind: "session",
    ...partial,
  };
}

describe("buildAtlasDocument", () => {
  it("scopes sessions and wires project → hub → session", () => {
    const doc = buildAtlasDocument({
      dir: "/proj",
      sessions: [
        sess({ id: "a", provider: "cursor", title: "Main", updatedAt: 200 }),
        sess({ id: "b", provider: "cursor", title: "Other", updatedAt: 100 }),
      ],
      payloads: [],
      injects: [],
      graphs: [],
      jobs: [],
      agents: [],
      artifacts: [],
    });

    expect(doc.dir).toBe("/proj");
    expect(doc.layers.sessions).toHaveLength(2);
    expect(doc.layers.sessions[0]!.id).toBe("a");
    expect(
      doc.edges.some(
        (e) =>
          e.kind === "project-has" && e.target === atlasHubNodeId("sessions"),
      ),
    ).toBe(true);
    expect(
      doc.edges.some(
        (e) =>
          e.kind === "hub-child" &&
          e.source === atlasHubNodeId("sessions") &&
          e.target === atlasSessionNodeId("cursor", "a"),
      ),
    ).toBe(true);
    expect(atlasDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("includes contexts sourced from project sessions only", () => {
    const doc = buildAtlasDocument({
      dir: "/proj",
      sessions: [sess({ id: "a", provider: "cursor" })],
      payloads: [
        {
          hash: "aaa111",
          kind: "transcript-excerpt",
          createdAt: 1,
          chars: 40,
          preview: "from project",
          source: { provider: "cursor", sessionId: "a" },
        },
        {
          hash: "bbb222",
          kind: "transcript-excerpt",
          createdAt: 2,
          chars: 10,
          preview: "other project",
          source: { provider: "cursor", sessionId: "zzz" },
        },
      ],
      injects: [],
      graphs: [],
      jobs: [],
      agents: [],
      artifacts: [],
    });

    expect(doc.layers.contexts.map((c) => c.hash)).toEqual(["aaa111"]);
    expect(doc.layers.sessions[0]!.contextOutCount).toBe(1);
    expect(
      doc.edges.some(
        (e) => e.kind === "context-from" && e.source === atlasSessionNodeId("cursor", "a"),
      ),
    ).toBe(true);
  });

  it("includes contexts when session id matches even if provider string differs", () => {
    const doc = buildAtlasDocument({
      dir: "/proj",
      sessions: [sess({ id: "a", provider: "cursor" })],
      payloads: [
        {
          hash: "prov-mismatch",
          kind: "transcript-excerpt",
          createdAt: 1,
          chars: 12,
          preview: "same id",
          source: { provider: "claude-code", sessionId: "a" },
        },
      ],
      injects: [],
      graphs: [],
      jobs: [],
      agents: [],
      artifacts: [],
    });

    expect(doc.layers.contexts.map((c) => c.hash)).toEqual(["prov-mismatch"]);
  });

  it("pulls in foreign payload when inject lands on a project session", () => {
    const doc = buildAtlasDocument({
      dir: "/proj",
      sessions: [sess({ id: "a", provider: "cursor" })],
      payloads: [
        {
          hash: "foreign",
          kind: "distilled-summary",
          createdAt: 1,
          chars: 20,
          preview: "from elsewhere",
          source: { provider: "claude-code", sessionId: "other" },
        },
      ],
      injects: [
        {
          ts: 9,
          payloadHash: "foreign",
          mode: "continue",
          target: { provider: "cursor", sessionId: "a" },
          result: { provider: "cursor", sessionId: "a" },
        },
      ],
      graphs: [],
      jobs: [],
      agents: [],
      artifacts: [],
    });

    expect(doc.layers.contexts.map((c) => c.hash)).toEqual(["foreign"]);
    expect(doc.layers.sessions[0]!.contextInCount).toBe(1);
    expect(
      doc.edges.some(
        (e) =>
          e.kind === "context-inject" &&
          e.target === atlasSessionNodeId("cursor", "a"),
      ),
    ).toBe(true);
  });

  it("links workflows that reference project sessions or via jobs", () => {
    const key = atlasSessionKey("cursor", "a");
    const doc = buildAtlasDocument({
      dir: "/proj",
      sessions: [sess({ id: "a", provider: "cursor" })],
      payloads: [],
      injects: [],
      graphs: [
        {
          id: "g1",
          name: "Uses session",
          kind: "workflow",
          nodeCount: 3,
          updatedAt: 50,
          sessionKeys: [key],
        },
        {
          id: "g2",
          name: "Unrelated",
          kind: "workflow",
          nodeCount: 1,
          updatedAt: 40,
          sessionKeys: ["cursor:zzz"],
        },
        {
          id: "g3",
          name: "Via job",
          kind: "workflow",
          nodeCount: 2,
          updatedAt: 30,
          sessionKeys: [],
        },
      ],
      jobs: [{ graphId: "g3", sessionKey: key }],
      agents: [],
      artifacts: [],
    });

    expect(doc.layers.workflows.map((w) => w.id).sort()).toEqual(["g1", "g3"]);
    expect(
      doc.edges.some(
        (e) =>
          e.kind === "graph-uses-session" &&
          e.target === atlasSessionNodeId("cursor", "a"),
      ),
    ).toBe(true);
  });

  it("splits rules vs skills and counts session children", () => {
    const doc = buildAtlasDocument({
      dir: "/proj",
      sessions: [
        sess({ id: "parent", provider: "cursor", updatedAt: 200 }),
        sess({
          id: "child",
          provider: "cursor",
          parentId: "parent",
          kind: "subagent-run",
          updatedAt: 150,
        }),
      ],
      payloads: [],
      injects: [],
      graphs: [],
      jobs: [],
      agents: [
        {
          provider: "claude-code",
          name: "reviewer",
          source: ".claude/agents/reviewer.md",
          scope: "project",
        },
      ],
      artifacts: [
        {
          path: "/proj/CLAUDE.md",
          name: "CLAUDE.md",
          kind: "rules",
          source: "CLAUDE.md",
          size: 100,
          mtime: 1,
        },
        {
          path: "/proj/.claude/skills/foo/SKILL.md",
          name: "foo",
          kind: "skill",
          source: ".claude/skills",
          size: 50,
          mtime: 2,
        },
      ],
    });

    expect(doc.layers.sessions.find((s) => s.id === "parent")!.childCount).toBe(1);
    expect(
      doc.edges.some(
        (e) =>
          e.kind === "session-child" &&
          e.source === atlasSessionNodeId("cursor", "parent") &&
          e.target === atlasSessionNodeId("cursor", "child"),
      ),
    ).toBe(true);
    expect(doc.layers.rules).toHaveLength(1);
    expect(doc.layers.skills).toHaveLength(1);
    expect(doc.layers.agents).toHaveLength(1);
    expect(atlasDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("wires sessions to matching agents", () => {
    const doc = buildAtlasDocument({
      dir: "/proj",
      sessions: [
        sess({
          id: "a",
          provider: "claude-code",
          agent: "reviewer",
          updatedAt: 10,
        }),
        sess({ id: "b", provider: "cursor", agent: "other", updatedAt: 9 }),
      ],
      payloads: [],
      injects: [],
      graphs: [],
      jobs: [],
      agents: [
        {
          provider: "claude-code",
          name: "reviewer",
          source: ".claude/agents/reviewer.md",
          scope: "project",
        },
      ],
      artifacts: [],
    });
    expect(
      doc.edges.some(
        (e) =>
          e.kind === "session-uses-agent" &&
          e.source === atlasSessionNodeId("claude-code", "a") &&
          e.target === atlasAgentNodeId("claude-code", "reviewer"),
      ),
    ).toBe(true);
    expect(
      doc.edges.some(
        (e) =>
          e.kind === "session-uses-agent" &&
          e.source === atlasSessionNodeId("cursor", "b"),
      ),
    ).toBe(false);
  });

  it("rejects malformed atlas documents via schema", () => {
    expect(
      atlasDocumentSchema.safeParse({
        dir: "/x",
        layers: { sessions: [] },
        edges: [],
      }).success,
    ).toBe(false);
  });
});
