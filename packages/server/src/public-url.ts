/**
 * Reject fetches to private / link-local / metadata addresses (SSRF floor).
 * Used for settings-driven outbound URLs (pricing).
 */
import dns from "node:dns/promises";
import net from "node:net";

function ipv4Octets(ip: string): number[] | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined;
  return nums as number[];
}

/** True for addresses that must not be reached via user-configured fetch URLs. */
export function isPrivateOrLocalIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "0:0:0:0:0:0:0:1") return true;
  // Unspecified v6 — connects to localhost on most stacks
  if (v === "::" || v === "0:0:0:0:0:0:0:0") return true;
  // IPv4-mapped IPv6, dotted-quad form ::ffff:a.b.c.d
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) return isPrivateOrLocalIp(mapped[1]!);
  // IPv4-mapped IPv6, hex form ::ffff:7f00:1
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(v);
  if (hexMapped) {
    const hi = Number.parseInt(hexMapped[1]!, 16);
    const lo = Number.parseInt(hexMapped[2]!, 16);
    return isPrivateOrLocalIp(
      `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`,
    );
  }
  if (v.startsWith("fe80:")) return true;
  // fc00::/7 (unique local) — real range test, not a string prefix
  const firstGroup = /^([0-9a-f]{1,4}):/i.exec(v);
  if (firstGroup) {
    const g = Number.parseInt(firstGroup[1]!, 16);
    if ((g & 0xfe00) === 0xfc00) return true;
  }

  const o = ipv4Octets(ip);
  if (!o) return false;
  const [a, b] = o;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b! >= 64 && b! <= 127) return true; // CGNAT
  return false;
}

/**
 * Validate an http(s) URL and ensure its resolved address is not private.
 * Throws Error with a short message on failure.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid pricing url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("pricing url must be http(s)");
  }
  // URL.hostname keeps brackets on v6 literals (`[::1]`) — strip them or the
  // net.isIP branch never fires and v6 literals dodge the literal-IP check.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error("pricing url missing host");

  // Literal IP in the URL
  if (net.isIP(host)) {
    if (isPrivateOrLocalIp(host)) {
      throw new Error("pricing url must not target a private or local address");
    }
    return url;
  }

  // Block obvious localhost names before DNS
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower === "metadata.google.internal") {
    throw new Error("pricing url must not target a private or local address");
  }

  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`pricing url host could not be resolved: ${host}`);
  }
  if (!addrs.length) throw new Error(`pricing url host could not be resolved: ${host}`);
  for (const a of addrs) {
    if (isPrivateOrLocalIp(a.address)) {
      throw new Error("pricing url must not target a private or local address");
    }
  }
  return url;
}

/**
 * fetch() with the SSRF floor enforced on EVERY hop. Default fetch follows
 * redirects transparently, so a public host answering `302 → http://127.0.0.1:…`
 * would sail past `assertPublicHttpUrl` — follow manually and re-validate
 * each Location instead.
 */
export async function fetchPublicUrl(
  raw: string,
  init?: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let url = await assertPublicHttpUrl(raw);
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      res.body?.cancel().catch(() => undefined);
      url = await assertPublicHttpUrl(new URL(loc, url).href);
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}
