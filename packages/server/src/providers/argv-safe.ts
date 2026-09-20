/**
 * Neutralize argument injection through text that lands in a POSITIONAL argv
 * slot of an agent CLI. Prompts can be attacker-influenced (upstream node
 * output, MCP tool text, transcript excerpts); a value beginning with "-"
 * would be parsed as a flag by the child CLI (`--config=…`, `--settings=…`).
 * A single leading space keeps it a plain value for every arg parser while
 * being semantically invisible to the model. Value-position args (`-p <x>`)
 * don't need this; trailing positionals do.
 */
export function positionalSafe(text: string): string {
  return /^\s*-/.test(text) ? ` ${text}` : text;
}
