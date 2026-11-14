import { redirect } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getTransportMemberships } from "@/lib/transport/memberships";
import type { TransportRole } from "@/lib/transport/roles";

async function getTransportSchoolContexts(role: TransportRole) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError && authError.name !== "AuthSessionMissingError" && authError.status !== 401 && authError.status !== 403) {
    throw new Error(`Unable to verify your session: ${authError.message}`);
  }
  if (!user || authError) redirect("/login");

  const memberships = await getTransportMemberships(supabase, user.id);
  const roleMemberships = memberships.filter((item) => item.role === role);
  if (roleMemberships.length === 0) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase server configuration is missing.");
  const admin = createAdminClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const schoolIds = Array.from(new Set(roleMemberships.map((item) => item.school_id)));
  const { data: schools, error: schoolError } = await admin
    .from("schools")
    .select("id, enabled_modules, status, expires_on")
    .in("id", schoolIds);
  if (schoolError) throw new Error(`Unable to verify transport access: ${schoolError.message}`);
  if (!schools || schools.some((school) => !Array.isArray(school.enabled_modules))) {
    throw new Error("Unable to verify transport access for your school.");
  }

  const schoolsById = new Map(
    schools.map((school) => [school.id, school]),
  );
  return roleMemberships.flatMap((membership) => {
    const school = schoolsById.get(membership.school_id);
    return school
      ? [{
          schoolId: membership.school_id,
          enabledModules: school.enabled_modules,
          status: school.status,
          expiresOn: school.expires_on,
        }]
      : [];
  });
}

export async function getPortalAccess(role: TransportRole) {
  const schools = await getTransportSchoolContexts(role);
  if (!schools) return "not-available" as const;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eligibleSchools = schools.filter((school) => {
    if (school.status === "suspended") return false;
    if (!school.expiresOn) return true;
    const expiresAt = new Date(`${school.expiresOn}T00:00:00`).getTime();
    return Number.isFinite(expiresAt) && expiresAt >= today.getTime();
  });
  if (eligibleSchools.length === 0) {
    return "school-unavailable" as const;
  }
  return eligibleSchools.some((school) => school.enabledModules.includes("transport"))
    ? "allowed" as const
    : "not-included" as const;
}
