import { validateModules, type ModuleCode } from "@/lib/modules";
import { UnauthorizedError, type SchoolRoleAuth } from "@/lib/auth/server";

export async function requireSchoolModule(
  auth: SchoolRoleAuth,
  module: ModuleCode,
): Promise<void> {
  const { data: school, error } = await auth.admin
    .from("schools")
    .select("enabled_modules")
    .eq("id", auth.schoolId)
    .maybeSingle();

  if (error) throw new Error(`Unable to verify school modules: ${error.message}`);
  if (!school) throw new UnauthorizedError("Your school could not be found.");
  if (!validateModules(school.enabled_modules).includes(module)) {
    throw new UnauthorizedError("This module is not included in your plan");
  }
}
