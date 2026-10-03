import { describe, expect, it } from "vitest";
import {
  isAbsolutePath,
  isPathInside,
  normalizePathForCompare,
  pathBasename,
} from "@threadle/shared";
import { fileUriToPath } from "../src/providers/antigravity/discover.js";
import { pathContained, pathSameOrNested } from "../src/path-safe.js";

describe("shared path helpers", () => {
  it("isAbsolutePath covers Unix, Windows, UNC", () => {
    expect(isAbsolutePath("/Users/a")).toBe(true);
    expect(isAbsolutePath("C:\\Users\\a")).toBe(true);
    expect(isAbsolutePath("C:/Users/a")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("relative/path")).toBe(false);
  });

  it("pathBasename handles both separators", () => {
    expect(pathBasename("/a/b/c.txt")).toBe("c.txt");
    expect(pathBasename("C:\\a\\b\\c.txt")).toBe("c.txt");
  });

  it("isPathInside is case-insensitive when asked", () => {
    expect(
      isPathInside("C:\\Users\\a\\proj\\f.ts", "c:\\Users\\a\\proj", {
        caseInsensitive: true,
      }),
    ).toBe(true);
    expect(
      isPathInside("C:\\Users\\a\\other", "C:\\Users\\a\\proj", {
        caseInsensitive: true,
      }),
    ).toBe(false);
    expect(
      isPathInside("/tmp/a/b", "/tmp/a", { caseInsensitive: false }),
    ).toBe(true);
    expect(
      isPathInside("/tmp/ab", "/tmp/a", { caseInsensitive: false }),
    ).toBe(false);
  });

  it("normalizePathForCompare unifies separators", () => {
    expect(normalizePathForCompare("C:\\Users\\A", { caseInsensitive: true })).toBe(
      "c:/users/a",
    );
  });
});

describe("fileUriToPath", () => {
  it("decodes Unix file URLs", () => {
    expect(fileUriToPath("file:///tmp/x.ts")).toBe("/tmp/x.ts");
  });

  it("uses fileURLToPath for Windows drive URLs", () => {
    const p = fileUriToPath("file:///C:/Users/a/proj/f.ts");
    expect(p).toBeTruthy();
    expect(isAbsolutePath(p!)).toBe(true);
    if (process.platform === "win32") {
      // Must be a real Windows path, not URL.pathname's `/C:/…`
      expect(p!.replace(/\//g, "\\").toLowerCase()).toBe(
        "c:\\users\\a\\proj\\f.ts",
      );
    } else {
      // Node on Unix still yields `/C:/…` for that URI — same as fileURLToPath
      expect(p).toBe("/C:/Users/a/proj/f.ts");
    }
  });
});

describe("pathContained", () => {
  it("treats equal and nested paths as contained", () => {
    const root = process.platform === "win32" ? "C:\\Users\\a\\proj" : "/Users/a/proj";
    const child =
      process.platform === "win32"
        ? "C:\\Users\\a\\proj\\src\\x.ts"
        : "/Users/a/proj/src/x.ts";
    expect(pathContained(child, root)).toBe(true);
    expect(pathContained(root, root)).toBe(true);
    expect(pathSameOrNested(child, root)).toBe(true);
  });

  it("is case-insensitive on win32 for drive letters", () => {
    if (process.platform !== "win32") return;
    expect(pathContained("c:\\Users\\a\\proj\\f.ts", "C:\\Users\\a\\proj")).toBe(true);
  });
});
