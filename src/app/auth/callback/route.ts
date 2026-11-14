import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  let destination = "/dashboard";

  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = await createClient();

    const { data } = await supabase.auth.exchangeCodeForSession(code);

    if (data.user) {
      const { data: memberships, error } = await supabase
        .from("school_users")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("is_active", true);

      if (
        !error &&
        memberships?.some(({ role }) =>
          ["staff", "teacher", "employee"].includes(
            String(role || "").trim().toLowerCase()
          )
        )
      ) {
        destination = "/dashboard/staff/home";
      }
    }
  }

  return NextResponse.redirect(
    new URL(destination, requestUrl.origin)
  );
}
