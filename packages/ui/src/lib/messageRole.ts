export function displayMessageRole(role: string): string {
  if (role === "assistant") return "agent";
  return role;
}
