export function parseSchoolModules(value: unknown): string[] | null {
  const allowed = ["fees", "payroll", "transport"];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((module) => typeof module !== "string" || !allowed.includes(module)) ||
    new Set(value).size !== value.length
  ) return null;

  return allowed.filter((module) => value.includes(module));
}
