/**
 * Inject-critical CLI flag strings we rely on. When a binary exists locally,
 * `threadle check --providers` probes help output for these tokens.
 *
 * Soft signal only — missing flags warn; they do not invent an upstream schema.
 */
export interface InjectFlagProbe {
  id: string;
  /** How to resolve the binary (PATH name or absolute). */
  bin: "claude" | "opencode" | "cursor-agent" | "agy" | "codex" | "copilot" | "grok" | "muse";
  /**
   * Substrings that count as present (any match). Use several when help uses
   * bracket notation (`--foo[-bar]`) or aliases.
   */
  match: string[];
  /** Why we care — shown in check detail. */
  why: string;
  /**
   * Args used to obtain help (default: try `--help` / `-h` / `help`).
   * Subcommands often own the flags we care about (`opencode run --help`).
   */
  helpArgs?: string[];
}

export const INJECT_FLAG_PROBES: InjectFlagProbe[] = [
  {
    id: "claude:output-format",
    bin: "claude",
    match: ["--output-format"],
    why: "json / stream-json inject",
  },
  {
    id: "claude:fork-session",
    bin: "claude",
    match: ["--fork-session"],
    why: "resume-fork inject",
  },
  {
    id: "claude:append-system-prompt-file",
    bin: "claude",
    // Help documents `--append-system-prompt[-file]` rather than the long form alone.
    match: ["--append-system-prompt-file", "--append-system-prompt[-file]"],
    why: "new-session context file",
  },
  {
    id: "opencode:run",
    bin: "opencode",
    match: ["run"],
    why: "opencode run --format json",
  },
  {
    id: "opencode:format",
    bin: "opencode",
    match: ["--format"],
    why: "json event stream",
    helpArgs: ["run", "--help"],
  },
  {
    id: "cursor:trust",
    bin: "cursor-agent",
    match: ["--trust"],
    why: "headless agent -p",
  },
  {
    id: "cursor:workspace",
    bin: "cursor-agent",
    match: ["--workspace"],
    why: "project cwd",
  },
  {
    id: "cursor:output-format",
    bin: "cursor-agent",
    match: ["--output-format"],
    why: "json / stream-json",
  },
  {
    id: "agy:dangerously-skip-permissions",
    bin: "agy",
    match: ["--dangerously-skip-permissions"],
    why: "headless agy -p",
  },
  {
    id: "agy:output-format",
    bin: "agy",
    match: ["--output-format"],
    why: "json / stream-json",
  },
  {
    id: "codex:exec",
    bin: "codex",
    match: ["exec"],
    why: "codex exec --json",
  },
  {
    id: "codex:sandbox",
    bin: "codex",
    match: ["--sandbox"],
    why: "workspace-write inject",
  },
  {
    id: "codex:ask-for-approval",
    bin: "codex",
    match: ["--ask-for-approval"],
    why: "never for headless",
  },
  {
    id: "copilot:prompt",
    bin: "copilot",
    match: ["--prompt", "-p"],
    why: "headless -p inject",
  },
  {
    id: "copilot:allow-all-tools",
    bin: "copilot",
    match: ["--allow-all-tools"],
    why: "non-interactive tool grant",
  },
  {
    id: "copilot:resume",
    bin: "copilot",
    match: ["--resume", "-r"],
    why: "continue session inject",
  },
  {
    id: "grok:single",
    bin: "grok",
    match: ["--single", "-p"],
    why: "headless -p inject",
  },
  {
    id: "grok:always-approve",
    bin: "grok",
    match: ["--always-approve"],
    why: "non-interactive tool grant",
  },
  {
    id: "grok:resume",
    bin: "grok",
    match: ["--resume", "-r"],
    why: "continue session inject",
  },
  {
    id: "grok:session-id",
    bin: "grok",
    match: ["--session-id", "-s"],
    why: "pin new session UUID",
  },
  {
    id: "muse:exec",
    bin: "muse",
    match: ["exec"],
    why: "muse exec headless inject",
  },
  {
    id: "muse:json",
    bin: "muse",
    match: ["--json"],
    why: "jsonl event stream",
    helpArgs: ["exec", "--help"],
  },
  {
    id: "muse:prompt-file",
    bin: "muse",
    match: ["--prompt-file"],
    why: "context file inject",
    helpArgs: ["exec", "--help"],
  },
  {
    id: "muse:approval-mode",
    bin: "muse",
    match: ["--approval-mode"],
    why: "non-interactive approval never",
    helpArgs: ["exec", "--help"],
  },
  {
    id: "muse:session-id",
    bin: "muse",
    match: ["--session-id"],
    why: "continue / pin session UUID",
    helpArgs: ["exec", "--help"],
  },
];
