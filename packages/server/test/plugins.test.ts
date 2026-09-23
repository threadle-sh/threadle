import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
let prevClaude: string | undefined;
let prevCodex: string | undefined;
let prevCopilot: string | undefined;
let prevGrok: string | undefined;
let prevCursor: string | undefined;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-plugins-"));
  prevClaude = process.env.CLAUDE_CONFIG_DIR;
  prevCodex = process.env.CODEX_HOME;
  prevCopilot = process.env.COPILOT_HOME;
  prevGrok = process.env.GROK_HOME;
  prevCursor = process.env.CURSOR_CONFIG_DIR;

  process.env.CLAUDE_CONFIG_DIR = path.join(dir, "claude");
  process.env.CODEX_HOME = path.join(dir, "codex");
  process.env.COPILOT_HOME = path.join(dir, "copilot");
  process.env.GROK_HOME = path.join(dir, "grok");
  process.env.CURSOR_CONFIG_DIR = path.join(dir, "cursor");

  // Claude marketplace pack with skill + agent + command
  const claudeMp = path.join(
    dir,
    "claude",
    "plugins",
    "marketplaces",
    "claude-plugins-official",
  );
  const featureDev = path.join(claudeMp, "plugins", "feature-dev");
  fs.mkdirSync(path.join(featureDev, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(featureDev, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "feature-dev",
      description: "Feature development workflow",
      version: "1.2.0",
      author: { name: "Anthropic" },
    }),
  );
  fs.mkdirSync(path.join(featureDev, "skills", "explore"), { recursive: true });
  fs.writeFileSync(
    path.join(featureDev, "skills", "explore", "SKILL.md"),
    "---\nname: explore\ndescription: Explore a codebase\n---\n# Explore\n",
  );
  fs.mkdirSync(path.join(featureDev, "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(featureDev, "agents", "architect.md"),
    "# Architect\n",
  );
  fs.mkdirSync(path.join(featureDev, "commands"), { recursive: true });
  fs.writeFileSync(
    path.join(featureDev, "commands", "review.md"),
    "# Review\n",
  );
  fs.writeFileSync(
    path.join(dir, "claude", "plugins", "known_marketplaces.json"),
    JSON.stringify({
      "claude-plugins-official": {
        source: { source: "github", repo: "anthropics/claude-plugins-official" },
        installLocation: claudeMp,
        lastUpdated: "2026-09-21T00:00:00.000Z",
      },
    }),
  );

  // Codex cached plugin
  const codexPlug = path.join(
    dir,
    "codex",
    "plugins",
    "cache",
    "openai-curated-remote",
    "plugin-management",
    "0.1.0",
  );
  fs.mkdirSync(path.join(codexPlug, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(codexPlug, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "plugin-management",
      version: "0.1.0",
      description: "Manage plugins",
      interface: { displayName: "Plugin Management" },
    }),
  );
  fs.mkdirSync(path.join(codexPlug, "skills", "plugin-management"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(codexPlug, "skills", "plugin-management", "SKILL.md"),
    "---\nname: plugin-management\ndescription: Manage plugins\n---\n",
  );

  // Copilot empty installed-plugins
  fs.mkdirSync(path.join(dir, "copilot", "installed-plugins"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(dir, "copilot", "installed-plugins.lock"), "");

  // Grok marketplace-cache pack
  const grokNeon = path.join(
    dir,
    "grok",
    "marketplace-cache",
    "abc123",
    "external_plugins",
    "neon",
  );
  fs.mkdirSync(path.join(grokNeon, ".grok-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(grokNeon, ".grok-plugin", "plugin.json"),
    JSON.stringify({
      name: "neon",
      version: "1.0.0",
      description: "Neon postgres",
    }),
  );
  fs.mkdirSync(path.join(grokNeon, "skills", "neon"), { recursive: true });
  fs.writeFileSync(
    path.join(grokNeon, "skills", "neon", "SKILL.md"),
    "---\nname: neon\ndescription: Neon skill\n---\n",
  );
  fs.mkdirSync(path.join(dir, "grok", "installed-plugins"), { recursive: true });

  // Cursor skills-cursor
  const cursorSkill = path.join(dir, "cursor", "skills-cursor", "create-skill");
  fs.mkdirSync(cursorSkill, { recursive: true });
  fs.writeFileSync(
    path.join(cursorSkill, "SKILL.md"),
    "---\nname: create-skill\ndescription: Create Cursor skills\n---\n# Skill\n",
  );
  fs.writeFileSync(
    path.join(dir, "cursor", "skills-cursor", ".sync-manifest.json"),
    JSON.stringify({
      version: 1,
      skills: { "create-skill": { lastSyncedAt: 1_700_000_000_000 } },
    }),
  );
});

afterAll(() => {
  if (prevClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevClaude;
  if (prevCodex === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = prevCodex;
  if (prevCopilot === undefined) delete process.env.COPILOT_HOME;
  else process.env.COPILOT_HOME = prevCopilot;
  if (prevGrok === undefined) delete process.env.GROK_HOME;
  else process.env.GROK_HOME = prevGrok;
  if (prevCursor === undefined) delete process.env.CURSOR_CONFIG_DIR;
  else process.env.CURSOR_CONFIG_DIR = prevCursor;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("plugins inventory", () => {
  it("lists Claude marketplace packs with children", async () => {
    const { listClaudePlugins } = await import("../src/routes/plugins.js");
    const items = await listClaudePlugins();
    expect(items.length).toBe(1);
    const p = items[0]!;
    expect(p.provider).toBe("claude-code");
    expect(p.id).toBe("feature-dev");
    expect(p.version).toBe("1.2.0");
    expect(p.origin.kind).toBe("marketplace-catalog");
    expect(p.origin.marketplaceId).toBe("claude-plugins-official");
    expect(p.state).toBe("catalog-only");
    const kinds = p.children.map((c) => c.kind).sort();
    expect(kinds).toEqual(["agent", "command", "skill"]);
    expect(p.children.find((c) => c.kind === "skill")?.name).toBe("explore");
  });

  it("lists Codex cached plugins", async () => {
    const { listCodexPlugins } = await import("../src/routes/plugins.js");
    const items = await listCodexPlugins();
    expect(items.length).toBe(1);
    expect(items[0]!.id).toBe("plugin-management");
    expect(items[0]!.name).toBe("Plugin Management");
    expect(items[0]!.state).toBe("cached");
    expect(items[0]!.children.some((c) => c.kind === "skill")).toBe(true);
  });

  it("returns empty for Copilot with no installs", async () => {
    const { listCopilotPlugins } = await import("../src/routes/plugins.js");
    expect(await listCopilotPlugins()).toEqual([]);
  });

  it("lists Grok marketplace-cache packs", async () => {
    const { listGrokPlugins } = await import("../src/routes/plugins.js");
    const items = await listGrokPlugins();
    expect(items.some((p) => p.id === "neon")).toBe(true);
    const neon = items.find((p) => p.id === "neon")!;
    expect(neon.state).toBe("cached");
    expect(neon.children[0]?.name).toBe("neon");
  });

  it("lists Cursor skills-cursor bundles", async () => {
    const { listCursorPlugins } = await import("../src/routes/plugins.js");
    const items = await listCursorPlugins();
    expect(items.length).toBe(1);
    expect(items[0]!.provider).toBe("cursor");
    expect(items[0]!.id).toBe("create-skill");
    expect(items[0]!.origin.kind).toBe("skill-bundle");
    expect(items[0]!.children[0]?.path?.endsWith("SKILL.md")).toBe(true);
  });

  it("GET /api/plugins merges providers and filters", async () => {
    const { listAllPlugins } = await import("../src/routes/plugins.js");
    const all = await listAllPlugins();
    expect(all.length).toBeGreaterThanOrEqual(4);
    const providers = new Set(all.map((p) => p.provider));
    expect(providers.has("claude-code")).toBe(true);
    expect(providers.has("codex")).toBe(true);
    expect(providers.has("grok")).toBe(true);
    expect(providers.has("cursor")).toBe(true);
    expect(providers.has("copilot")).toBe(false);

    const onlyCodex = await listAllPlugins("codex");
    expect(onlyCodex.every((p) => p.provider === "codex")).toBe(true);
    expect(onlyCodex.length).toBe(1);
  });
});
