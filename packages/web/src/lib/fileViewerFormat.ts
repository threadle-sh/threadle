import hljs from "highlight.js/lib/common";
import { renderMd, safeHighlight } from "@/lib/safeHtml";

/** Manual override + auto. Code values match highlight.js language ids where possible. */
export type FileViewerFormat =
  | "auto"
  | "text"
  | "markdown"
  | "json"
  | "yaml"
  | "xml"
  | "css"
  | "javascript"
  | "typescript"
  | "python"
  | "shell"
  | "sql"
  | "diff"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "ruby"
  | "php"
  | "lua"
  | "graphql"
  | "ini"
  | "makefile";

export type ResolvedFormat = Exclude<FileViewerFormat, "auto">;

export const FORMAT_OPTIONS: { value: FileViewerFormat; label: string }[] = [
  { value: "auto", label: "auto" },
  { value: "text", label: "txt" },
  { value: "markdown", label: "markdown" },
  { value: "json", label: "json" },
  { value: "yaml", label: "yaml" },
  { value: "xml", label: "xml / html" },
  { value: "css", label: "css" },
  { value: "javascript", label: "javascript" },
  { value: "typescript", label: "typescript" },
  { value: "python", label: "python" },
  { value: "shell", label: "shell" },
  { value: "sql", label: "sql" },
  { value: "diff", label: "diff" },
  { value: "go", label: "go" },
  { value: "rust", label: "rust" },
  { value: "java", label: "java" },
  { value: "c", label: "c" },
  { value: "cpp", label: "c++" },
  { value: "ruby", label: "ruby" },
  { value: "php", label: "php" },
  { value: "lua", label: "lua" },
  { value: "graphql", label: "graphql" },
  { value: "ini", label: "ini / toml" },
  { value: "makefile", label: "makefile" },
];

const EXT_FORMAT: Record<string, ResolvedFormat> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".txt": "text",
  ".log": "text",
  ".json": "json",
  ".jsonc": "json",
  ".jsonl": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xml": "xml",
  ".html": "xml",
  ".htm": "xml",
  ".svg": "xml",
  ".vue": "xml",
  ".css": "css",
  ".scss": "css",
  ".less": "css",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".sql": "sql",
  ".diff": "diff",
  ".patch": "diff",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".rb": "ruby",
  ".php": "php",
  ".lua": "lua",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".toml": "ini",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".env": "ini",
  ".lock": "json",
};

const BASE_FORMAT: Record<string, ResolvedFormat> = {
  makefile: "makefile",
  dockerfile: "shell",
  containerfile: "shell",
  gemfile: "ruby",
  rakefile: "ruby",
  procfile: "shell",
  readme: "markdown",
  changelog: "markdown",
  license: "text",
  licence: "text",
  "agents.md": "markdown",
  "claude.md": "markdown",
  "skill.md": "markdown",
};

const MD_MARKERS =
  /(^|\n)#{1,6}\s|\*\*[^*\n]+\*\*|(^|\n)\s*[-*]\s+\S|(^|\n)\s*\d+\.\s+\S|\[[^\]]+\]\([^)]+\)|```|(^|\n)>\s/;

/** Skip heavy highlight/render above this — still show plain text. */
const RENDER_CAP = 200_000;

function extOf(filePath: string): string {
  const base = filePath.split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i).toLowerCase() : "";
}

function baseOf(filePath: string): string {
  return (filePath.split("/").pop() ?? "").toLowerCase();
}

/** Format implied by path alone (no content sniff). */
export function formatFromPath(filePath: string): ResolvedFormat | undefined {
  const base = baseOf(filePath);
  if (BASE_FORMAT[base]) return BASE_FORMAT[base];
  if (base.startsWith(".env")) return "ini";
  const ext = extOf(filePath);
  if (ext && EXT_FORMAT[ext]) return EXT_FORMAT[ext];
  return undefined;
}

function sniffContent(content: string): ResolvedFormat {
  const t = content.trim();
  if (!t) return "text";
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* fall through */
    }
  }
  if (/^(diff --git|--- |\+\+\+ |@@ )/m.test(t)) return "diff";
  if (MD_MARKERS.test(t)) return "markdown";
  // YAML frontmatter or dense key: value lines without code punctuation
  if (/^---\s*\n[\s\S]*?\n---\s*\n/.test(t)) return "yaml";
  return "text";
}

export function resolveFormat(
  mode: FileViewerFormat,
  filePath: string,
  content: string,
): ResolvedFormat {
  if (mode !== "auto") return mode;
  const fromPath = formatFromPath(filePath);
  if (fromPath && fromPath !== "text") return fromPath;
  if (fromPath === "text") return sniffContent(content);
  return sniffContent(content);
}

function hljsLang(format: ResolvedFormat): string | undefined {
  if (format === "text" || format === "markdown") return undefined;
  if (format === "shell") return "bash";
  return format;
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export type ViewerRender =
  | { kind: "plain"; text: string }
  | { kind: "html"; html: string; className: string };

export function renderViewer(
  mode: FileViewerFormat,
  filePath: string,
  content: string,
): { format: ResolvedFormat; render: ViewerRender } {
  const format = resolveFormat(mode, filePath, content);
  if (!content) {
    return { format, render: { kind: "plain", text: "" } };
  }

  if (format === "markdown") {
    if (content.length > RENDER_CAP) {
      return { format, render: { kind: "plain", text: content } };
    }
    return {
      format,
      render: { kind: "html", html: renderMd(content), className: "fv-md" },
    };
  }

  let source = content;
  if (format === "json") source = prettyJson(content);

  if (format === "text" || source.length > RENDER_CAP) {
    return { format, render: { kind: "plain", text: source } };
  }

  const lang = hljsLang(format);
  try {
    const html =
      lang && hljs.getLanguage(lang)
        ? hljs.highlight(source, { language: lang }).value
        : hljs.highlightAuto(source).value;
    return {
      format,
      render: {
        kind: "html",
        html: `<code class="hljs">${safeHighlight(html)}</code>`,
        className: "fv-code",
      },
    };
  } catch {
    return { format, render: { kind: "plain", text: source } };
  }
}
