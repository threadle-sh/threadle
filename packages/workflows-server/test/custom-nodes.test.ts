import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CustomNodeDef } from "../src/routes/custom-nodes.js";
import {
  buildStdin,
  getCustomDef,
  listNodeStatus,
  parseRunOutput,
  resolveCommandBin,
  resolveParams,
  runCustomDef,
  scanNodes,
  setNodeEnabled,
} from "../src/routes/custom-nodes.js";

let configDir: string;

function writeNode(name: string, manifest: object, files: Record<string, string> = {}): void {
  const dir = path.join(configDir, "nodes", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "node.json"), JSON.stringify(manifest, null, 2));
  for (const [f, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, f), content);
  }
}

// a command-flavor node exercising the full protocol: JSON stdin (named
// inputs), THREADLE_PARAMS env, JSON stdout (named outputs)
const CALC_JS = `
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const inputs = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const params = JSON.parse(process.env.THREADLE_PARAMS ?? "{}");
  const factor = Number(params.factor ?? 1);
  const sum = (Number(inputs.a) + Number(inputs.b ?? 0)) * factor;
  if (process.env.THREADLE_INPUTS_JSON !== "1") throw new Error("expected THREADLE_INPUTS_JSON=1");
  if (process.env.THREADLE_PARAM_FACTOR !== params.factor) throw new Error("bad THREADLE_PARAM_FACTOR");
  process.stdout.write(JSON.stringify({ sum, report: "a+b times " + factor }));
});
`;

beforeAll(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-custom-nodes-"));
  process.env.THREADLE_CONFIG_DIR = configDir;

  writeNode(
    "calc",
    {
      id: "calc",
      command: ["node", "./run.js"],
      inputs: [{ name: "a", type: "int" }, { name: "b", type: "int", required: false }],
      outputs: [{ name: "sum", type: "int" }, { name: "report" }],
      params: [{ name: "factor", type: "int", default: 2, min: 1, max: 100 }],
    },
    { "run.js": CALC_JS },
  );
  writeNode("plain", { id: "plain", command: ["cat"] });
  writeNode("bad-both", { id: "bad-both", command: ["cat"], input: "int", inputs: [{ name: "x" }] });
  writeNode("bad-param", {
    id: "bad-param",
    command: ["cat"],
    params: [{ name: "mode", type: "choice" }],
  });
  writeNode("bad-port-dup", {
    id: "bad-port-dup",
    command: ["cat"],
    outputs: [{ name: "x" }, { name: "x" }],
  });
});

afterAll(() => {
  delete process.env.THREADLE_CONFIG_DIR;
  fs.rmSync(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("resolveCommandBin", () => {
  it("resolves POSIX and Windows relative argv0 against the node dir", () => {
    const dir = path.join(os.tmpdir(), "threadle-node-dir");
    expect(resolveCommandBin(dir, "./run.js")).toBe(path.resolve(dir, "./run.js"));
    expect(resolveCommandBin(dir, "..\\sib\\run.js")).toBe(path.resolve(dir, "..\\sib\\run.js"));
    expect(resolveCommandBin(dir, "jq")).toBe("jq");
  });
});

describe("scanNodes with params + named ports", () => {
  it("parses named ports and params off the manifest", async () => {
    const { defs } = await scanNodes();
    const calc = defs.find((d) => d.name === "calc")!;
    expect(calc.inputs).toEqual([
      { name: "a", type: "int", required: undefined },
      { name: "b", type: "int", required: false },
    ]);
    expect(calc.outputs?.map((p) => p.name)).toEqual(["sum", "report"]);
    expect(calc.params).toEqual([
      { name: "factor", type: "int", default: "2", min: 1, max: 100 },
    ]);
  });

  it("keeps plain manifests untouched", async () => {
    const { defs } = await scanNodes();
    const plain = defs.find((d) => d.name === "plain")!;
    expect(plain.inputs).toBeUndefined();
    expect(plain.outputs).toBeUndefined();
    expect(plain.params).toBeUndefined();
  });

  it("rejects invalid manifests with reasons", async () => {
    const { invalid } = await scanNodes();
    const errors = Object.fromEntries(invalid.map((b) => [b.name, b.error]));
    expect(errors["bad-both"]).toMatch(/not both/);
    expect(errors["bad-param"]).toMatch(/options/);
    expect(errors["bad-port-dup"]).toMatch(/duplicate/);
  });

  it("lists enabled / disabled / error rows for Settings", async () => {
    await setNodeEnabled("plain", false);
    const { nodes } = await listNodeStatus();
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId.calc.status).toBe("enabled");
    expect(byId.plain.status).toBe("disabled");
    expect(byId["bad-both"].status).toBe("error");
    expect(byId["bad-both"].error).toMatch(/not both/);
    // disabled nodes stay in scanNodes but leave the runnable palette
    expect((await scanNodes()).defs.some((d) => d.name === "plain")).toBe(true);
    expect(await getCustomDef("plain")).toBeUndefined();
    await setNodeEnabled("plain", true);
    expect((await listNodeStatus()).nodes.find((n) => n.id === "plain")?.status).toBe("enabled");
    expect(await getCustomDef("plain")).toBeTruthy();
  });
});

const calcDef = async (): Promise<CustomNodeDef> =>
  (await scanNodes()).defs.find((d) => d.name === "calc")!;

describe("param resolution", () => {
  it("falls back to defaults and validates overrides", async () => {
    const def = await calcDef();
    expect(resolveParams(def)).toEqual({ factor: "2" });
    expect(resolveParams(def, { factor: "7" })).toEqual({ factor: "7" });
    expect(() => resolveParams(def, { factor: "abc" })).toThrow(/not an int/);
    expect(() => resolveParams(def, { factor: "999" })).toThrow(/above max/);
  });
});

describe("stdin / stdout protocol", () => {
  it("builds JSON stdin for named inputs and enforces required + types", async () => {
    const def = await calcDef();
    expect(JSON.parse(buildStdin(def, { a: ["1"], b: ["2"] }))).toEqual({ a: "1", b: "2" });
    expect(JSON.parse(buildStdin(def, { a: ["1"] }))).toEqual({ a: "1" }); // b optional
    expect(() => buildStdin(def, { b: ["2"] })).toThrow(/required input "a"/);
    expect(() => buildStdin(def, { a: ["nope"] })).toThrow(/expects int/);
  });

  it("keeps the legacy joined-text stdin for plain nodes", async () => {
    const plain = (await scanNodes()).defs.find((d) => d.name === "plain")!;
    expect(buildStdin(plain, { input: ["x", "y"] })).toBe("x\n\ny");
  });

  it("parses and validates named outputs", async () => {
    const def = await calcDef();
    const out = parseRunOutput(def, JSON.stringify({ sum: 6, report: "ok" }));
    expect(out.ports).toEqual({ sum: "6", report: "ok" });
    expect(out.text).toBe("6"); // primary lane = first declared port
    expect(() => parseRunOutput(def, "prose")).toThrow(/JSON object/);
    expect(() => parseRunOutput(def, JSON.stringify({ sum: 6 }))).toThrow(/missing port "report"/);
    expect(() => parseRunOutput(def, JSON.stringify({ sum: "x", report: "" }))).toThrow(/declares int/);
  });
});

describe("end to end", () => {
  it("runs a named-port command node with params over env", async () => {
    const def = await calcDef();
    const res = await runCustomDef(def, { a: ["2"], b: ["3"] }, { factor: "4" });
    expect(res.ports).toEqual({ sum: "20", report: "a+b times 4" });
    expect(res.text).toBe("20");
  });
});
