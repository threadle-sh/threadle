import { describe, expect, it } from "vitest";
import {
  classifyContentHref,
  decorateContentLinkHtml,
  isInternalContentHref,
  normalizePosixPath,
  resolveLocalFilePath,
} from "./contentLinks";

describe("contentLinks", () => {
  it("normalizes relative paths against baseDir", () => {
    expect(resolveLocalFilePath("emeland-ui-refactor.md", "/Users/x/memory")).toBe(
      "/Users/x/memory/emeland-ui-refactor.md",
    );
    expect(resolveLocalFilePath("./topic.md", "/Users/x/memory")).toBe(
      "/Users/x/memory/topic.md",
    );
    expect(resolveLocalFilePath("../other.md", "/Users/x/memory")).toBe(
      "/Users/x/other.md",
    );
  });

  it("accepts absolute and file:// paths", () => {
    expect(resolveLocalFilePath("/tmp/a.md")).toBe("/tmp/a.md");
    expect(resolveLocalFilePath("file:///Users/x/a.md")).toBe("/Users/x/a.md");
  });

  it("classifies http(s) as external", () => {
    const k = classifyContentHref("https://example.com/a");
    expect(k).toEqual({
      kind: "external",
      url: "https://example.com/a",
      domain: "example.com",
    });
  });

  it("classifies relative md as local when baseDir set", () => {
    expect(classifyContentHref("foo.md", "/proj")).toEqual({
      kind: "local",
      path: "/proj/foo.md",
    });
  });

  it("treats hash-only as hash", () => {
    expect(classifyContentHref("#section")).toEqual({ kind: "hash" });
  });

  it("normalizePosixPath collapses dots", () => {
    expect(normalizePosixPath("/a/b/../c/./d")).toBe("/a/c/d");
  });

  it("marks relative and file paths as internal", () => {
    expect(isInternalContentHref("emeland-ui-refactor.md")).toBe(true);
    expect(isInternalContentHref("/Users/x/a.md")).toBe(true);
    expect(isInternalContentHref("https://example.com")).toBe(false);
    expect(isInternalContentHref("#section")).toBe(false);
  });

  it("decorates local anchors with cl-local", () => {
    const out = decorateContentLinkHtml(
      `<p><a href="emeland-ui-refactor.md">topic</a> · <a href="https://ex.com">web</a></p>`,
    );
    expect(out).toMatch(/class="cl-local"/);
    expect(out).toMatch(/href="emeland-ui-refactor\.md"/);
    expect(out).not.toMatch(/href="https:\/\/ex\.com"[^>]*class="cl-local"/);
  });
});
