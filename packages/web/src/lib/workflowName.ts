/** Next free "Workflow N" label from existing names (and optional extras). */
export function nextWorkflowName(
  existing: Iterable<{ name?: string | null } | string>,
): string {
  let max = 0;
  for (const item of existing) {
    const name = typeof item === "string" ? item : (item.name ?? "");
    const m = /^Workflow\s+(\d+)$/i.exec(name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Workflow ${max + 1}`;
}
