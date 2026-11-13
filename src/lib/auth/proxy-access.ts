export function getAnonymousRedirectPath(
  pathname: string,
  isAuthenticated: boolean,
): "/login" | null {
  if (
    !isAuthenticated &&
    (pathname.startsWith("/dashboard") || pathname.startsWith("/accounting"))
  ) {
    return "/login";
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
