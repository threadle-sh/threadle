/**
 * Trusted rendering for untrusted transcript / file / payload text.
 * Markdown never passes raw HTML; SVG is allowlisted via DOM walk;
 * full HTML documents for sandboxed iframes go through DOMPurify.
 */
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { decorateContentLinkHtml } from "./contentLinks";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let purifyOk: boolean | undefined;

/**
 * DOMPurify can be silently non-operational in non-browser DOMs (happy-dom
 * returns unsanitized markup while `isSupported` stays true). Never trust it
 * blind — probe with a known-bad payload once and fall back to escaping when
 * the probe survives.
 */
export function domPurifyOperational(): boolean {
  if (purifyOk === undefined) {
    try {
      const probe = DOMPurify.sanitize('<img src=x onerror=alert(1)><script>1</script>', {
        USE_PROFILES: { html: true },
      });
      purifyOk = !/onerror|<script/i.test(probe);
    } catch {
      purifyOk = false;
    }
  }
  return purifyOk;
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight: (str, lang) => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(str, { language: lang }).value;
      }
      return hljs.highlightAuto(str).value;
    } catch {
      return escapeHtml(str);
    }
  },
});

/** Markdown → HTML; raw HTML in source is escaped (html:false) then purified. */
export function renderMd(text: string): string {
  const raw = md.render(text ?? "");
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
    FORBID_ATTR: ["style"],
  });
  return decorateContentLinkHtml(clean);
}

const HTML_DOC_ALLOW = new Set([
  "html",
  "head",
  "body",
  "div",
  "span",
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "img",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "code",
  "pre",
  "blockquote",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
]);

const HTML_DOC_ATTR = new Set([
  "href",
  "src",
  "alt",
  "title",
  "class",
  "id",
  "width",
  "height",
  "colspan",
  "rowspan",
]);

/**
 * True when an attribute value parses to a scheme we refuse. Parse-based —
 * regexes miss control-char obfuscation (`jav\tascript:`) that the browser's
 * URL parser strips. Unparseable values are treated as dangerous.
 */
function isDangerousUrl(value: string): boolean {
  try {
    const proto = new URL(value, "https://relative.invalid/").protocol.toLowerCase();
    return proto === "javascript:" || proto === "data:" || proto === "vbscript:";
  } catch {
    return true;
  }
}

/**
 * Sanitize a full HTML document/fragment for sandboxed iframe srcdoc.
 *
 * SECURITY INVARIANT: output is only ever used behind `sandbox=""` (no
 * allow-scripts, no allow-same-origin) — see OutputNode.vue. Do not reuse for
 * inline `v-html`; use renderMd/safeSvg for that.
 */
export function sanitizeHtmlDocument(text: string): string {
  const t = text ?? "";
  if (!t.trim()) return "";
  if (typeof DOMParser === "undefined") {
    return escapeHtml(t);
  }
  try {
    const doc = new DOMParser().parseFromString(t, "text/html");
    // Comments/CDATA/PIs round-trip verbatim through serialization and can
    // re-tokenize as markup on re-parse (mXSS) — drop every non-element node
    // that isn't text.
    const stripJunkNodes = (node: Node): void => {
      for (const child of [...node.childNodes]) {
        const kind = child.nodeType;
        if (kind === 8 /* comment */ || kind === 4 /* cdata */ || kind === 7 /* PI */) {
          child.remove();
        }
      }
    };
    const walk = (el: Element): void => {
      stripJunkNodes(el);
      const kids = [...el.children];
      for (const child of kids) {
        const name = child.localName.toLowerCase();
        if (!HTML_DOC_ALLOW.has(name)) {
          child.remove();
          continue;
        }
        for (const attr of [...child.attributes]) {
          const an = attr.name.toLowerCase();
          if (!HTML_DOC_ATTR.has(an) || an.startsWith("on")) {
            child.removeAttribute(attr.name);
            continue;
          }
          if ((an === "href" || an === "src") && isDangerousUrl(attr.value)) {
            child.removeAttribute(attr.name);
          }
        }
        walk(child);
      }
    };
    const root = doc.body ?? doc.documentElement;
    if (!root) return escapeHtml(t);
    walk(root);
    // Prefer body inner HTML for fragments; fall back to full serialize.
    // Belt-and-braces backstop only — the walk above is the real control.
    // `[\s"'/<]on…` (not `\son…`) so `/onerror=` is caught too.
    const out = doc.body ? doc.body.innerHTML : new XMLSerializer().serializeToString(root);
    if (/(^|[\s"'/<])on[a-z]+\s*=/i.test(out) || /<script/i.test(out)) {
      return escapeHtml(t);
    }
    return out;
  } catch {
    return escapeHtml(t);
  }
}

/** Only https: (and intentional app custom schemes) for bound external links. */
export function safeExternalHref(raw: string | undefined | null): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  try {
    const u = new URL(t);
    const proto = u.protocol.toLowerCase();
    if (proto === "https:") return u.href;
    // Editor / app deep links used elsewhere — not for opencode share pages
    if (
      proto === "cursor:" ||
      proto === "vscode:" ||
      proto === "vscode-insiders:" ||
      proto === "zed:"
    ) {
      return u.href;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sanitize SVG for inline display via DOMPurify's SVG profile.
 *
 * Deliberately NOT a hand-rolled DOM walk: the previous implementation
 * parsed as XML, walked `el.children`, and re-serialized — comment/CDATA/PI
 * node data round-trips verbatim through XMLSerializer and re-tokenizes as
 * live HTML at the `v-html` sink (mXSS, e.g. `<!--><img src=x onerror=…> -->`).
 * DOMPurify parses in the destination context and drops that whole class.
 * External refs, links, animation, and CSS stay forbidden as before.
 */
export function safeSvg(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  if (!/^<svg[\s>]/i.test(t)) {
    return `<pre>${escapeHtml(t)}</pre>`;
  }
  if (!domPurifyOperational()) {
    return `<pre>${escapeHtml(t)}</pre>`;
  }
  const out = DOMPurify.sanitize(t, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      "a",
      "use",
      "image",
      "style",
      "animate",
      "animateTransform",
      "animateMotion",
      "set",
      "foreignObject",
    ],
    FORBID_ATTR: ["href", "xlink:href", "style"],
  });
  if (!out || !/^<svg[\s>]/i.test(out.trim())) {
    return `<pre>${escapeHtml(t)}</pre>`;
  }
  return out;
}

/** Highlight.js output is trusted structure from escaped source — still purify. */
export function safeHighlight(html: string): string {
  // No USE_PROFILES here — it would silently OVERWRITE the allowlists below
  // (DOMPurify applies profiles after ALLOWED_TAGS/ALLOWED_ATTR).
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["span", "code", "pre"],
    ALLOWED_ATTR: ["class"],
  });
}
