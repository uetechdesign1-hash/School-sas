export function getAnonymousRedirectPath(
  pathname: string,
  isAuthenticated: boolean,
): "/login" | "/super-admin/login" | null {
  if (isAuthenticated) return null;

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/accounting")) {
    return "/login";
  }

  if (pathname === "/sales" || pathname.startsWith("/sales/")) {
    return "/super-admin/login";
  }

  if (
    (pathname === "/super-admin" || pathname.startsWith("/super-admin/")) &&
    pathname !== "/super-admin/login"
  ) {
    return "/super-admin/login";
  }

  return null;
}

export function getAuthenticatedLoginRedirectPath(
  roles: readonly (string | null | undefined)[] | null,
  membershipLookupFailed: boolean,
): "/dashboard/staff/home" | "/dashboard" {
  const staffRoles = ["staff", "teacher", "employee"];
  const hasStaffMembership =
    !membershipLookupFailed &&
    roles?.some((role) =>
      staffRoles.includes(String(role || "").trim().toLowerCase()),
    );

  return hasStaffMembership ? "/dashboard/staff/home" : "/dashboard";
}
