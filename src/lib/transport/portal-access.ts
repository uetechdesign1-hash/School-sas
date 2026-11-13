import { redirect } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getTransportMemberships } from "@/lib/transport/memberships";
import type { TransportRole } from "@/lib/transport/roles";

async function getTransportSchoolContext(role: TransportRole) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError && authError.name !== "AuthSessionMissingError" && authError.status !== 401 && authError.status !== 403) {
    throw new Error(`Unable to verify your session: ${authError.message}`);
  }
  if (!user || authError) redirect("/login");

  const memberships = await getTransportMemberships(supabase, user.id);
  const membership = memberships.find((item) => item.role === role);
  if (!membership) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase server configuration is missing.");
  const admin = createAdminClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: school, error: schoolError } = await admin
    .from("schools")
    .select("enabled_modules, status, expires_on")
    .eq("id", membership.school_id)
    .maybeSingle();
  if (schoolError) throw new Error(`Unable to verify transport access: ${schoolError.message}`);
  if (!school || !Array.isArray(school.enabled_modules)) {
    throw new Error("Unable to verify transport access for your school.");
  }
  return {
    schoolId: membership.school_id,
    enabledModules: school.enabled_modules,
    status: school.status,
    expiresOn: school.expires_on,
  };
}

export async function getPortalAccess(role: TransportRole) {
  const school = await getTransportSchoolContext(role);
  if (!school) return "not-available" as const;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiresOn = school.expiresOn ? new Date(`${school.expiresOn}T00:00:00`) : null;
  if (school.status === "suspended" || (expiresOn && expiresOn < today)) {
    return "school-unavailable" as const;
  }
  return school.enabledModules.includes("transport") ? "allowed" as const : "not-included" as const;
}
