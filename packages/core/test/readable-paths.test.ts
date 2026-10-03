import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isReadablePath,
  isSensitivePath,
  staticReadableRoots,
} from "../src/readable-paths.js";

describe("readable paths", () => {
  it("flags sensitive locations", () => {
    expect(isSensitivePath(path.join(os.homedir(), ".ssh", "id_rsa"))).toBe(true);
    expect(isSensitivePath("/etc/passwd")).toBe(true);
    expect(isSensitivePath(path.join(os.homedir(), ".config", "threadle", "settings.json"))).toBe(
      false,
    );
  });

  it("includes threadle config among static roots, not OS tmpdir", () => {
    const roots = staticReadableRoots("/tmp/project-x");
    expect(roots.some((r) => r.includes("threadle") || r.includes("weft"))).toBe(true);
    expect(roots.some((r) => r === path.resolve("/tmp/project-x"))).toBe(true);
    const osTmp = path.resolve(os.tmpdir());
    // blanket OS tmp must not be a root (threadleConfigDir()/tmp may nest under it)
    expect(roots.includes(osTmp)).toBe(false);
  });

  it("allows files under an explicit project dir", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-read-"));
    const file = path.join(root, "note.md");
    await fs.promises.writeFile(file, "hi");
    try {
      expect(await isReadablePath(file, root)).toBe(true);
      expect(await isReadablePath(path.join(os.homedir(), ".ssh", "id_rsa"), root)).toBe(false);
      expect(await isReadablePath("/etc/hosts", root)).toBe(false);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("refuses a symlink inside an allowed root pointing outside", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-sym-"));
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-out-"));
    const secret = path.join(outside, "secret.txt");
    await fs.promises.writeFile(secret, "s3cr3t");
    const link = path.join(root, "innocent.md");
    await fs.promises.symlink(secret, link);
    try {
      // the symlink's REAL target is outside every root — must be denied
      expect(await isReadablePath(link, root)).toBe(false);
      // and a symlink to a sensitive path is denied regardless
      const sshLink = path.join(root, "notes.md");
      await fs.promises
        .symlink(path.join(os.homedir(), ".ssh", "id_rsa"), sshLink)
        .catch(() => undefined);
      expect(await isReadablePath(sshLink, root)).toBe(false);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      await fs.promises.rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("still allows not-yet-created files under a real root (exists probes)", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "threadle-new-"));
    try {
      expect(await isReadablePath(path.join(root, "not-yet.md"), root)).toBe(true);
      expect(await isReadablePath("/definitely/not/a/root/x.md", root)).toBe(false);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  it("catches case-variant sensitive paths on case-insensitive filesystems", () => {
    if (process.platform !== "darwin" && process.platform !== "win32") return;
    expect(isSensitivePath(path.join(os.homedir(), ".SSH", "id_rsa"))).toBe(true);
    expect(isSensitivePath("/ETC/passwd")).toBe(true);
    expect(isSensitivePath(path.join(os.homedir(), ".AWS", "credentials"))).toBe(true);
  });

  it("denies credential basenames inside provider store roots", async () => {
    // ~/.codex/auth.json etc. — allowed root, denied basename
    const codexAuth = path.join(os.homedir(), ".codex", "auth.json");
    expect(await isReadablePath(codexAuth)).toBe(false);
    const claudeCreds = path.join(os.homedir(), ".claude", ".credentials.json");
    expect(await isReadablePath(claudeCreds)).toBe(false);
    const geminiOauth = path.join(os.homedir(), ".gemini", "oauth_creds.json");
    expect(await isReadablePath(geminiOauth)).toBe(false);
  });
});
