import type { SupabaseClient } from "@supabase/supabase-js";

export async function getLoginRecycleConflict(
  admin: SupabaseClient,
  userId: string,
  email: string,
): Promise<string | null> {
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (profile?.platform_role === "super_admin") {
    return `The email ${email} belongs to a Super Admin account and cannot be recycled.`;
  }

  const { data: activeMemberships, error: activeMembershipError } = await admin
    .from("school_users")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1);

  if (activeMembershipError) {
    throw new Error(activeMembershipError.message);
  }

  if (activeMemberships && activeMemberships.length > 0) {
    return (
      `The email ${email} is already used by an active school login. ` +
      "Use a different owner email, or delete that school first."
    );
  }

  const { data: memberships, error: membershipsError } = await admin
    .from("school_users")
    .select("school_id")
    .eq("user_id", userId);

  if (membershipsError) {
    throw new Error(membershipsError.message);
  }

  const schoolIds = [
    ...new Set(
      (memberships || [])
        .map(({ school_id }) => school_id)
        .filter((schoolId): schoolId is string => Boolean(schoolId)),
    ),
  ];

  if (schoolIds.length === 0) {
    return null;
  }

  const { data: schools, error: schoolsError } = await admin
    .from("schools")
    .select("id")
    .in("id", schoolIds);

  if (schoolsError) {
    throw new Error(schoolsError.message);
  }

  if (schools && schools.length > 0) {
    return (
      `The email ${email} is still linked to an existing school. ` +
      "Remove that school membership or use a different owner email."
    );
  }

  return null;
}
