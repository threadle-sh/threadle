import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, isPrivateOrLocalIp } from "../src/public-url.js";

describe("isPrivateOrLocalIp", () => {
  it("flags loopback and RFC1918", () => {
    expect(isPrivateOrLocalIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("10.0.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrLocalIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrLocalIp("::1")).toBe(true);
    expect(isPrivateOrLocalIp("8.8.8.8")).toBe(false);
  });

  it("flags IPv6 edge cases", () => {
    expect(isPrivateOrLocalIp("::")).toBe(true); // unspecified → localhost
    expect(isPrivateOrLocalIp("0:0:0:0:0:0:0:0")).toBe(true);
    expect(isPrivateOrLocalIp("::ffff:7f00:1")).toBe(true); // hex-mapped 127.0.0.1
    expect(isPrivateOrLocalIp("::ffff:127.0.0.1")).toBe(true); // dotted-mapped
    expect(isPrivateOrLocalIp("::ffff:808:808")).toBe(false); // hex-mapped 8.8.8.8
    expect(isPrivateOrLocalIp("fc00::1")).toBe(true); // unique local /7
    expect(isPrivateOrLocalIp("fd12:3456::1")).toBe(true);
    expect(isPrivateOrLocalIp("fe80::1")).toBe(true); // link-local
    expect(isPrivateOrLocalIp("2606:4700::1111")).toBe(false); // public
  });

  it("flags 0.0.0.0", () => {
    expect(isPrivateOrLocalIp("0.0.0.0")).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects private literal IPs", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/api.json")).rejects.toThrow(/private/i);
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest")).rejects.toThrow(/private/i);
  });

  it("rejects localhost hostname", async () => {
    await expect(assertPublicHttpUrl("http://localhost/x")).rejects.toThrow(/private/i);
  });

  it("rejects non-http schemes and v6 literals", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(/http/i);
    await expect(assertPublicHttpUrl("gopher://x/")).rejects.toThrow(/http/i);
    await expect(assertPublicHttpUrl("http://[::1]/x")).rejects.toThrow(/private/i);
    await expect(assertPublicHttpUrl("http://[::]/x")).rejects.toThrow(/private/i);
  });

  // NOTE: deliberately no live-network positive case here — a DNS lookup of a
  // real host in CI is flaky and proves nothing about the guard itself.
});
