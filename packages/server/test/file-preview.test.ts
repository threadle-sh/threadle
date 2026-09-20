import { describe, expect, it } from "vitest";
import { isLikelyTextPath, FILE_PREVIEW_MAX_BYTES } from "../src/routes/files.js";

describe("file preview helpers", () => {
  it("recognizes common text paths", () => {
    expect(isLikelyTextPath("/tmp/SKILL.md")).toBe(true);
    expect(isLikelyTextPath("/tmp/foo.ts")).toBe(true);
    expect(isLikelyTextPath("/tmp/.env")).toBe(true);
    expect(isLikelyTextPath("/tmp/Makefile")).toBe(true);
    expect(isLikelyTextPath("/tmp/photo.png")).toBe(false);
    expect(isLikelyTextPath("/tmp/blob")).toBe(false);
  });

  it("caps previews at 1.5 MB", () => {
    expect(FILE_PREVIEW_MAX_BYTES).toBe(1_500_000);
  });
});
