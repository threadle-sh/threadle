// @vitest-environment jsdom
// jsdom, NOT happy-dom: DOMPurify silently returns unsanitized markup under
// happy-dom while isSupported stays true — these tests would pass while
// proving nothing. The canary test below fails loudly if that ever regresses.
import { describe, expect, it } from "vitest";
import {
  domPurifyOperational,
  escapeHtml,
  renderMd,
  safeExternalHref,
  safeSvg,
  sanitizeHtmlDocument,
} from "./safeHtml";

describe("environment canary", () => {
  it("DOMPurify actually sanitizes in this test environment", () => {
    expect(domPurifyOperational()).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("escapes angle brackets and amp", () => {
    expect(escapeHtml(`<img onerror="alert(1)">`)).toBe(
      `&lt;img onerror=&quot;alert(1)&quot;&gt;`,
    );
  });
});

describe("renderMd", () => {
  it("does not execute raw HTML from markdown", () => {
    const html = renderMd(`hello <img onerror="fetch('/api/files/read?path=/etc/passwd')">`);
    expect(html).not.toMatch(/<img/i);
    expect(html).toMatch(/onerror/);
    expect(html).toMatch(/&lt;img|&lt;IMG/i);
  });

  it("still renders normal markdown", () => {
    const html = renderMd("**bold** and `code`");
    expect(html).toMatch(/<strong>bold<\/strong>/);
    expect(html).toMatch(/<code>code<\/code>/);
  });

  it("neutralizes script tags in markdown source", () => {
    const html = renderMd(`<script>fetch('/api/run/workflow',{method:'POST'})</script>`);
    expect(html).not.toMatch(/<script/i);
  });
});

describe("sanitizeHtmlDocument", () => {
  it("strips script tags from srcdoc HTML", () => {
    const out = sanitizeHtmlDocument(
      `<html><body><p>hi</p><script>fetch('/api/run/workflow')</script></body></html>`,
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).toMatch(/hi/);
  });

  it("strips onerror handlers", () => {
    const out = sanitizeHtmlDocument(`<img src=x onerror="alert(1)">`);
    expect(out).not.toMatch(/onerror/i);
  });
});

describe("safeExternalHref", () => {
  it("allows https only for share-like urls", () => {
    expect(safeExternalHref("https://example.com/s/abc")).toBe("https://example.com/s/abc");
    expect(safeExternalHref("http://example.com/s")).toBeUndefined();
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("data:text/html,x")).toBeUndefined();
  });
});

describe("safeSvg", () => {
  it("allows a plain svg circle", () => {
    const out = safeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="3"/></svg>`);
    expect(out).toMatch(/^<svg/i);
    expect(out).toMatch(/circle/i);
  });

  it("rejects script inside svg", () => {
    const out = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle/></svg>`,
    );
    expect(out).toMatch(/^<svg/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).toMatch(/circle/i);
  });

  it("rejects onload handlers", () => {
    const out = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="fetch('/api/health')"><circle/></svg>`,
    );
    expect(out).toMatch(/^<svg/i);
    expect(out).not.toMatch(/\sonload\s*=/i);
  });

  it("rejects foreignObject", () => {
    const out = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body onload="x()"></body></foreignObject><circle cx="1" cy="1" r="1"/></svg>`,
    );
    expect(out).toMatch(/^<svg/i);
    expect(out).not.toMatch(/foreignObject/i);
    expect(out).not.toMatch(/\sonload\s*=/i);
    expect(out).toMatch(/circle/i);
  });

  it("rejects style and SMIL animate", () => {
    const out = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><style>*{fill:red}</style><animate attributeName="x" from="0" to="10"/><circle cx="1" cy="1" r="1"/></svg>`,
    );
    expect(out).toMatch(/^<svg/i);
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/<animate/i);
    expect(out).toMatch(/circle/i);
  });

  it("defeats comment-breakout mXSS (XML→HTML reparse)", () => {
    const out = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!--><img src=/nope.png/onerror="alert(document.domain)" --><circle r="4"/></svg>`,
    );
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<!--/);
  });

  it("defeats CDATA breakout in desc/title integration points", () => {
    const out = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><desc><![CDATA[><img src=x onerror=alert(1)>]]></desc><circle r="4"/></svg>`,
    );
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/onerror/i);
  });

  it("defeats processing-instruction breakout", () => {
    const out = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><?x ><img src=x onerror="alert(1)" ?><circle r="4"/></svg>`,
    );
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/onerror/i);
  });

  it("strips use/image external refs", () => {
    const out = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil/x.svg#a"/><image href="https://evil/i.png"/><circle r="4"/></svg>`,
    );
    expect(out).not.toMatch(/<use/i);
    expect(out).not.toMatch(/<image/i);
  });
});

describe("sanitizeHtmlDocument (sandboxed srcdoc only)", () => {
  it("drops comment nodes that could re-tokenize as markup", () => {
    const out = sanitizeHtmlDocument(
      `<html><body><p>ok</p><!--><img src=x onerror="alert(1)" --></body></html>`,
    );
    expect(out).not.toMatch(/<!--/);
    expect(out).not.toMatch(/onerror/i);
    expect(out).toMatch(/ok/);
  });

  it("strips control-char-obfuscated javascript: URLs", () => {
    const out = sanitizeHtmlDocument(`<a href="jav\tascript:alert(1)">x</a>`);
    expect(out).not.toMatch(/href/i);
  });
});
