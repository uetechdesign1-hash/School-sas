import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: "Supabase server configuration is missing." },
        { status: 500 },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "",
    );

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "You must be signed in as Super Admin." },
        { status: 401 },
      );
    }

    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("platform_role,is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (
      profileError ||
      !profile ||
      profile.platform_role !== "super_admin" ||
      profile.is_active !== true
    ) {
      return NextResponse.json(
        { success: false, error: "Super Admin access required." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const schoolId = String(body?.schoolId || "");
    const password = String(body?.password || "");

    if (!schoolId) {
      return NextResponse.json(
        { success: false, error: "School ID is required." },
        { status: 400 },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Password must contain at least 8 characters." },
        { status: 400 },
      );
    }

    const { data: ownerMembership, error: membershipError } = await admin
      .from("school_users")
      .select("user_id,role,is_active")
      .eq("school_id", schoolId)
      .eq("role", "owner")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { success: false, error: membershipError.message },
        { status: 400 },
      );
    }

    if (!ownerMembership?.user_id) {
      return NextResponse.json(
        { success: false, error: "No active school owner login was found." },
        { status: 404 },
      );
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(
      ownerMembership.user_id,
      { password },
    );

    if (updateError) {
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("RESET SCHOOL OWNER PASSWORD API ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to reset school owner password.",
      },
      { status: 500 },
    );
  }
}
