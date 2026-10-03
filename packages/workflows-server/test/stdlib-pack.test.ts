/**
 * Stdlib pack: every node.json validates; class nodes run via the custom-node runner.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateCustomNodeManifest } from "@threadle/shared";
import { runCustomDef, scanNodes, LEGACY_PORT } from "../src/routes/custom-nodes.js";

const REPO_STDLIB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../examples/nodes/stdlib",
);

const PACK_IDS = [
  "jq",
  "extract-json",
  "split-md",
  "diff",
  "rg",
  "token-estimate",
  "test-run",
  "git-status",
  "git-diff",
] as const;

let configDir: string;

beforeAll(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-stdlib-"));
  process.env.THREADLE_CONFIG_DIR = configDir;
  const nodesRoot = path.join(configDir, "nodes");
  fs.mkdirSync(nodesRoot, { recursive: true });
  for (const id of PACK_IDS) {
    fs.cpSync(path.join(REPO_STDLIB, id), path.join(nodesRoot, id), {
      recursive: true,
    });
  }
});

afterAll(() => {
  delete process.env.THREADLE_CONFIG_DIR;
  fs.rmSync(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("stdlib pack", () => {
  it("ships every catalog id with a valid node.json", () => {
    expect(fs.existsSync(path.join(REPO_STDLIB, "PACK.md"))).toBe(true);
    for (const id of PACK_IDS) {
      const raw = JSON.parse(
        fs.readFileSync(path.join(REPO_STDLIB, id, "node.json"), "utf8"),
      ) as unknown;
      const checked = validateCustomNodeManifest(raw);
      expect(checked.ok, `${id}: ${!checked.ok ? checked.error : ""}`).toBe(true);
      if (checked.ok) expect(checked.data.id ?? id).toBe(id);
    }
  });

  it("scanNodes loads the pack without invalid entries", async () => {
    const { defs, invalid } = await scanNodes();
    expect(invalid).toEqual([]);
    const names = new Set(defs.map((d) => d.name));
    for (const id of PACK_IDS) expect(names.has(id)).toBe(true);
  });

  it("extract-json pulls a fenced block", async () => {
    const def = (await scanNodes()).defs.find((d) => d.name === "extract-json")!;
    const res = await runCustomDef(def, {
      [LEGACY_PORT]: [
        'Here you go:\n```json\n{"ok": true, "n": 2}\n```\nthanks',
      ],
    });
    expect(JSON.parse(res.text)).toEqual({ ok: true, n: 2 });
  });

  it("split-md emits a JSON array of ## sections", async () => {
    const def = (await scanNodes()).defs.find((d) => d.name === "split-md")!;
    const res = await runCustomDef(def, {
      [LEGACY_PORT]: ["# Title\n\nintro\n\n## One\n\na\n\n## Two\n\nb"],
    });
    const chunks = JSON.parse(res.text) as string[];
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.startsWith("## One"))).toBe(true);
    expect(chunks.some((c) => c.startsWith("## Two"))).toBe(true);
  });

  it("diff returns unified hunks for changed ports", async () => {
    const def = (await scanNodes()).defs.find((d) => d.name === "diff")!;
    const res = await runCustomDef(
      def,
      { a: ["line1\nline2\n"], b: ["line1\nlineX\n"] },
      { context: "1" },
    );
    expect(res.text).toContain("--- a");
    expect(res.text).toContain("-line2");
    expect(res.text).toContain("+lineX");
    expect(res.ports?.diff).toBe(res.text);
  });

  it("token-estimate returns chars÷4", async () => {
    const def = (await scanNodes()).defs.find((d) => d.name === "token-estimate")!;
    const res = await runCustomDef(
      def,
      { [LEGACY_PORT]: ["abcd"] },
      { divisor: "4" },
    );
    expect(res.text).toBe("1");
  });

  it("jq transforms when jq is on PATH", async () => {
    const def = (await scanNodes()).defs.find((d) => d.name === "jq")!;
    try {
      const res = await runCustomDef(
        def,
        { [LEGACY_PORT]: ['{"a":1,"b":2}'] },
        { filter: ".a", raw: "true" },
      );
      expect(res.text.trim()).toBe("1");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found on PATH|ENOENT/i.test(msg)) return;
      throw err;
    }
  });
});
