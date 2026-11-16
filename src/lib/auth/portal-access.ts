import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PortalUser = {
  id: string;
  name: string;
  email: string;
};

/**
 * Server-side role gate for the Super Admin and Sales portals. The role comes
 * from user_profiles through the caller's own session (RLS applies); nothing
 * here is trusted from the browser.
 */
export async function requirePortalRole(
  role: "super_admin" | "sales_rep",
  loginPath: string,
): Promise<PortalUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(loginPath);

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name, platform_role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.is_active !== true || profile.platform_role !== role) {
    redirect(loginPath);
  }

  if (role === "sales_rep") {
    const { data: rep } = await supabase
      .from("sales_representatives")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (rep?.status !== "active") redirect(loginPath);
  }

  return {
    id: user.id,
    name: profile.full_name || user.email || "User",
    email: user.email || "",
  };
}
