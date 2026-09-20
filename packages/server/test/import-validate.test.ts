import { describe, expect, it } from "vitest";
import {
  validateCustomNodeManifest,
  validateDragPayload,
  validatePortableGraphImport,
  validateRulesImport,
  validateSkillImport,
  validatePortableGraphJsonText,
} from "@threadle/shared";

const goodGraph = {
  $schema: "threadle/graph@1" as const,
  name: "Import me",
  nodes: [
    {
      id: "n1",
      type: "prompt" as const,
      position: { x: 0, y: 0 },
      status: "idle" as const,
      data: { type: "prompt" as const, text: "hi" },
    },
    {
      id: "n2",
      type: "output" as const,
      position: { x: 100, y: 0 },
      status: "idle" as const,
      data: { type: "output" as const, renderMode: "text" as const },
    },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

describe("validatePortableGraphImport", () => {
  it("accepts a valid portable graph", () => {
    const r = validatePortableGraphImport(goodGraph);
    expect(r.ok).toBe(true);
  });

  it("rejects type/data.type mismatch", () => {
    const bad = structuredClone(goodGraph);
    (bad.nodes[0] as { type: string }).type = "output";
    const r = validatePortableGraphImport(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not match data\.type/);
  });

  it("rejects dangling edges", () => {
    const bad = structuredClone(goodGraph);
    bad.edges[0]!.target = "missing";
    const r = validatePortableGraphImport(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a node/);
  });

  it("rejects duplicate node ids", () => {
    const bad = structuredClone(goodGraph);
    bad.nodes.push(structuredClone(bad.nodes[0]!));
    const r = validatePortableGraphImport(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate id/);
  });

  it("rejects invalid JSON text", () => {
    const r = validatePortableGraphJsonText("{nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid JSON/);
  });
});

describe("validateSkillImport / validateRulesImport", () => {
  it("accepts kebab skill with frontmatter name", () => {
    const r = validateSkillImport({
      content: "---\nname: my-skill\ndescription: x\n---\n\n# hi\n",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.name).toBe("my-skill");
  });

  it("rejects empty skill", () => {
    const r = validateSkillImport({ content: "   " });
    expect(r.ok).toBe(false);
  });

  it("accepts rules file named CLAUDE.md", () => {
    const r = validateRulesImport({
      content: "# rules\n",
      filename: "CLAUDE.md",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.type).toBe("CLAUDE.md");
  });

  it("rejects unknown rules filename", () => {
    const r = validateRulesImport({ content: "x", filename: "NOTES.md" });
    expect(r.ok).toBe(false);
  });
});

describe("validateCustomNodeManifest", () => {
  it("accepts entry manifest", () => {
    const r = validateCustomNodeManifest({
      id: "shout",
      entry: "node.ts",
      label: "Shout",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects entry+command together", () => {
    const r = validateCustomNodeManifest({
      entry: "node.ts",
      command: ["echo", "hi"],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects path traversal in entry", () => {
    const r = validateCustomNodeManifest({ entry: "../escape.ts" });
    expect(r.ok).toBe(false);
  });
});

describe("validateDragPayload", () => {
  it("accepts a prompt drag", () => {
    const r = validateDragPayload({ kind: "prompt" });
    expect(r.ok).toBe(true);
  });

  it("accepts an mcp-tool drag", () => {
    const r = validateDragPayload({ kind: "mcp-tool" });
    expect(r.ok).toBe(true);
  });

  it("rejects subgraph without graphId", () => {
    const r = validateDragPayload({ kind: "subgraph" });
    expect(r.ok).toBe(false);
  });
});
