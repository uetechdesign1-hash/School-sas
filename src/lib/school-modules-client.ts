import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEnabledModules, type SchoolModule } from "@/lib/modules";

/**
 * Reads a school's subscribed plans for client pages that must adapt to the
 * plan (for example the shared Students pages). RLS limits the read to the
 * signed-in user's own school. It throws instead of guessing, so a failed or
 * malformed lookup never grants or hides a plan silently.
 *
 * Authorization is still enforced by the Proxy and database; this only drives
 * what a page renders.
 */
export async function fetchSchoolModules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  schoolId: string,
): Promise<SchoolModule[]> {
  const { data, error } = await supabase
    .from("schools")
    .select("enabled_modules")
    .eq("id", schoolId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to verify school plans: ${error.message}`);
  }

  const modules = parseEnabledModules(data?.enabled_modules);
  if (!modules) {
    throw new Error("School plan configuration could not be verified.");
  }

  return modules;
}
