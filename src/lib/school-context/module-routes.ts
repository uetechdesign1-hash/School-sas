import type { ModuleCode } from "../modules";

function isWithin(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function moduleForRoute(pathname: string): ModuleCode | null {
  if (
    isWithin(pathname, "/dashboard/fees") ||
    isWithin(pathname, "/dashboard/expenses") ||
    isWithin(pathname, "/dashboard/daily-report") ||
    isWithin(pathname, "/dashboard/payments") ||
    isWithin(pathname, "/dashboard/students/fee-structure") ||
    /^\/dashboard\/students\/[^/]+\/(?:fees|payment|admission-payment)(?:\/|$)/.test(pathname) ||
    isWithin(pathname, "/accounting/collect-fee") ||
    isWithin(pathname, "/accounting/receipt") ||
    isWithin(pathname, "/accounting/expenses") ||
    isWithin(pathname, "/accounting/expense-categories")
  ) return "fees";

  if (
    isWithin(pathname, "/dashboard/payroll") ||
    isWithin(pathname, "/dashboard/staff-attendance") ||
    pathname === "/dashboard/staff" ||
    /^\/dashboard\/staff\/(?:home|attendance|my-attendance|my-salary|my-payslips|reports|settings)(?:\/|$)/.test(pathname) ||
    /^\/dashboard\/staff\/[^/]+\/(?:attendance|salary|payslip)(?:\/|$)/.test(pathname)
  ) return "payroll";
  return null;
}

export function isAvailableWithoutModules(pathname: string): boolean {
  return [
    "/dashboard/profile",
    "/dashboard/school-settings",
    "/dashboard/staff/profile",
  ].includes(pathname);
}

export function isModuleRouteAllowed(
  pathname: string,
  enabledModules: readonly string[],
): boolean {
  if (enabledModules.length === 0) return isAvailableWithoutModules(pathname);
  const requiredModule = moduleForRoute(pathname);
  return requiredModule === null || enabledModules.includes(requiredModule);
}
