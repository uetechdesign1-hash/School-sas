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
  {
    code: "transport",
    label: "Plan 3 — Transport Management",
    description:
      "Students, drivers, vehicles, routes, trips, parent access and live bus tracking.",
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
 *   Plan 3 `transport` Transport management.
 *   Shared             Students, Classes & Sections and Academic Years are
 *                      foundations for Plans 1 and 3 (Add Student requires a
 *                      year, class and section).
 *
 * A path that maps to no plan (dashboard home, school profile, a staff
 * member's own profile) is available to every school.
 */
const FEES: SchoolModule[] = ["fees"];
const PAYROLL: SchoolModule[] = ["payroll"];
const TRANSPORT: SchoolModule[] = ["transport"];
const STUDENT_FOUNDATION: SchoolModule[] = ["fees", "transport"];

export function isTransportPortalPath(pathname: string): boolean {
  return (
    pathname === "/driver" ||
    pathname.startsWith("/driver/") ||
    pathname === "/parent" ||
    pathname.startsWith("/parent/")
  );
}

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function requiredModulesForPath(
  pathname: string,
  searchParams: URLSearchParams = new URLSearchParams(),
): SchoolModule[] {
  if (isTransportPortalPath(pathname)) return TRANSPORT;

  if (isUnder(pathname, "/dashboard/transport")) return TRANSPORT;

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

/*
 * Plan 3 management screens. Only entries with `status: "available"` have a
 * page; the rest are shown as planned and must not be linked.
 */
export type TransportFeature = {
  id: string;
  title: string;
  description: string;
  href: string;
  status: "available" | "planned";
};

export const TRANSPORT_MANAGEMENT_FEATURES: readonly TransportFeature[] = [
  { id: "dashboard", title: "Transport Dashboard", description: "Fleet, trips and approvals at a glance.", href: "/dashboard/transport", status: "planned" },
  { id: "add-driver", title: "Add Driver", description: "Create a driver profile.", href: "/dashboard/transport/drivers/new", status: "planned" },
  { id: "drivers", title: "Driver Management", description: "Edit, assign and deactivate drivers.", href: "/dashboard/transport/drivers", status: "planned" },
  { id: "driver-logins", title: "Driver Login Management", description: "Create and manage driver logins.", href: "/dashboard/transport/drivers/logins", status: "planned" },
  { id: "vehicles", title: "Vehicle Management", description: "Vehicles, documents and driver assignment.", href: "/dashboard/transport/vehicles", status: "planned" },
  { id: "routes", title: "Route Management", description: "Routes with ordered, approved stops.", href: "/dashboard/transport/routes", status: "planned" },
  { id: "stops", title: "Stop Management", description: "Review and approve driver-proposed stops.", href: "/dashboard/transport/stops", status: "planned" },
  { id: "trips", title: "Trip Management", description: "Morning, afternoon and evening trips.", href: "/dashboard/transport/trips", status: "planned" },
  { id: "assignments", title: "Student Transport Assignment", description: "Assign students to routes and stops.", href: "/dashboard/transport/assignments", status: "planned" },
  { id: "parents", title: "Parent Account Management", description: "Parent transport access and linked students.", href: "/dashboard/transport/parents", status: "planned" },
  { id: "tracking", title: "Live Bus Tracking", description: "Live bus locations for active trips.", href: "/dashboard/transport/tracking", status: "planned" },
  { id: "reports", title: "Transport Reports", description: "Trip history and transport summaries.", href: "/dashboard/transport/reports", status: "planned" },
];
