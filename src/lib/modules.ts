export const SCHOOL_MODULES = [
  {
    code: "fees",
    label: "Plan 1 — School Management + Accounting",
    description:
      "Students, classes, fees, attendance, expenses, reports and the full Accounting Control Center.",
  },
  {
    code: "payroll",
    label: "Plan 2 — Staff Management",
    description:
      "Staff records and logins, staff attendance, salary, payroll processing and payslips.",
  },
] as const;

export type SchoolModule = (typeof SCHOOL_MODULES)[number]["code"];

export const DEFAULT_ENABLED_MODULES: SchoolModule[] = ["fees", "payroll"];

const MODULE_CODES = new Set<string>(
  SCHOOL_MODULES.map((module) => module.code),
);

export function parseEnabledModules(value: unknown): SchoolModule[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (module) => typeof module !== "string" || !MODULE_CODES.has(module),
    ) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }

  return SCHOOL_MODULES
    .map((module) => module.code)
    .filter((module) => value.includes(module));
}

export function hasSchoolModule(
  enabledModules: unknown,
  module: SchoolModule,
): boolean {
  return Array.isArray(enabledModules) && enabledModules.includes(module);
}

/*
 * Plan ownership of school pages (any-of semantics, so combined plans show the
 * union and shared pages are never duplicated):
 *
 *   Plan 1 `fees`      School management + accounting.
 *   Plan 2 `payroll`   Staff management, staff attendance and payroll.
 *   Shared             Students, Classes & Sections and Academic Years are
 *                      foundations for Plan 1 (Add Student requires a
 *                      year, class and section).
 *
 * A path that maps to no plan (dashboard home, school profile, a staff
 * member's own profile) is available to every school.
 */
const FEES: SchoolModule[] = ["fees"];
const PAYROLL: SchoolModule[] = ["payroll"];
const STUDENT_FOUNDATION: SchoolModule[] = ["fees"];

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function requiredModulesForPath(
  pathname: string,
  searchParams: URLSearchParams = new URLSearchParams(),
): SchoolModule[] {

  // The payment screen contains both fee and salary workflows.
  if (pathname === "/accounting/payment") {
    return searchParams.get("type") === "salary"
      ? PAYROLL
      : ["fees", "payroll"];
  }

  // A staff member's own profile is reachable by every school so a school
  // without Plan 2 never redirects in a loop.
  if (pathname === "/dashboard/staff/profile") return [];

  if (
    isUnder(pathname, "/dashboard/staff") ||
    isUnder(pathname, "/dashboard/staff-attendance") ||
    isUnder(pathname, "/dashboard/payroll")
  ) {
    return PAYROLL;
  }

  if (
    isUnder(pathname, "/dashboard/fees") ||
    pathname === "/dashboard/students/fee-structure" ||
    /^\/dashboard\/students\/[^/]+\/(fees|payment)(\/|$)/.test(pathname) ||
    isUnder(pathname, "/accounting") ||
    isUnder(pathname, "/dashboard/accounting") ||
    isUnder(pathname, "/dashboard/expenses") ||
    isUnder(pathname, "/dashboard/attendance") ||
    isUnder(pathname, "/dashboard/reports") ||
    isUnder(pathname, "/dashboard/daily-report") ||
    pathname === "/dashboard/cash-book" ||
    pathname === "/dashboard/bank-book"
  ) {
    return FEES;
  }

  if (
    isUnder(pathname, "/dashboard/students") ||
    isUnder(pathname, "/dashboard/classes") ||
    isUnder(pathname, "/dashboard/academic-years")
  ) {
    return STUDENT_FOUNDATION;
  }

  return [];
}

export function hasRequiredModule(
  enabledModules: unknown,
  requiredModules: readonly SchoolModule[],
): boolean {
  return (
    requiredModules.length === 0 ||
    (Array.isArray(enabledModules) &&
      requiredModules.some((module) => enabledModules.includes(module)))
  );
}

/** True when the school's plans entitle it to the given school page. */
export function canAccessSchoolPath(
  enabledModules: unknown,
  pathname: string,
  searchParams?: URLSearchParams,
): boolean {
  return hasRequiredModule(
    enabledModules,
    requiredModulesForPath(pathname, searchParams),
  );
}
