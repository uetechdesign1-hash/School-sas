import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(\S+)$/i)?.[1];

    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: "Supabase server configuration is incomplete." },
        { status: 500 },
      );
    }

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Authentication is required." },
        { status: 401 },
      );
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user: actor },
      error: authError,
    } = await userClient.auth.getUser(token);

    if (authError || !actor) {
      return NextResponse.json(
        { success: false, error: "Your login session is invalid or expired." },
        { status: 401 },
      );
    }

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 },
      );
    }

    const input = body as Record<string, unknown>;
    const targetType = input.target_type;
    const email = typeof input.email === "string"
      ? input.email.trim().toLowerCase()
      : "";

    if (
      targetType !== "staff" &&
      targetType !== "self" &&
      targetType !== "principal"
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid email-change target." },
        { status: 400 },
      );
    }

    if ((targetType !== "staff" || email) && !emailPattern.test(email)) {
      return NextResponse.json(
        { success: false, error: "Enter a valid email address." },
        { status: 400 },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let targetUserId: string;

    if (targetType === "self") {
      const { data: membership, error: membershipError } = await admin
        .from("school_users")
        .select("user_id")
        .eq("user_id", actor.id)
        .eq("role", "owner")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        return NextResponse.json(
          { success: false, error: "Only an active school principal can change this email." },
          { status: 403 },
        );
      }

      targetUserId = actor.id;
    } else if (targetType === "staff") {
      const staffId = typeof input.staff_id === "string" ? input.staff_id.trim() : "";
      if (!staffId) {
        return NextResponse.json(
          { success: false, error: "Staff ID is required." },
          { status: 400 },
        );
      }

      const { data: staff, error: staffError } = await admin
        .from("staff")
        .select("id, school_id, user_id")
        .eq("id", staffId)
        .maybeSingle();

      if (staffError) throw staffError;
      if (!staff) {
        return NextResponse.json(
          { success: false, error: "Staff member was not found." },
          { status: 404 },
        );
      }

      const { data: principalMembership, error: principalError } = await admin
        .from("school_users")
        .select("user_id")
        .eq("user_id", actor.id)
        .eq("school_id", staff.school_id)
        .eq("role", "owner")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (principalError) throw principalError;
      if (!principalMembership) {
        return NextResponse.json(
          { success: false, error: "Only this school's active principal can change staff email." },
          { status: 403 },
        );
      }

      if (!staff.user_id) {
        const { error: updateError } = await userClient.rpc(
          "update_staff_email_by_principal",
          {
            p_staff_id: staff.id,
            p_new_email: email || null,
          },
        );

        if (updateError) throw updateError;

        return NextResponse.json({
          success: true,
          email: email || null,
          linked: false,
        });
      }

      const { data: staffMembership, error: staffMembershipError } = await admin
        .from("school_users")
        .select("user_id")
        .eq("user_id", staff.user_id)
        .eq("school_id", staff.school_id)
        .eq("is_active", true)
        .in("role", ["staff", "teacher", "employee"])
        .limit(1)
        .maybeSingle();

      if (staffMembershipError) throw staffMembershipError;
      if (!staffMembership) {
        return NextResponse.json(
          { success: false, error: "The linked login is not an active staff account for this school." },
          { status: 400 },
        );
      }

      if (!email) {
        return NextResponse.json(
          { success: false, error: "A valid email is required for a linked staff login." },
          { status: 400 },
        );
      }

      targetUserId = staff.user_id;
    } else {
      const schoolId = typeof input.school_id === "string" ? input.school_id.trim() : "";
      if (!schoolId) {
        return NextResponse.json(
          { success: false, error: "School ID is required." },
          { status: 400 },
        );
      }

      const { data: profile, error: profileError } = await admin
        .from("user_profiles")
        .select("platform_role, is_active")
        .eq("id", actor.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (profile?.platform_role !== "super_admin" || profile.is_active !== true) {
        return NextResponse.json(
          { success: false, error: "Super Admin access is required." },
          { status: 403 },
        );
      }

      const { data: ownerMembership, error: ownerError } = await admin
        .from("school_users")
        .select("user_id")
        .eq("school_id", schoolId)
        .eq("role", "owner")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (ownerError) throw ownerError;
      if (!ownerMembership?.user_id) {
        return NextResponse.json(
          { success: false, error: "No active principal login was found for this school." },
          { status: 404 },
        );
      }

      targetUserId = ownerMembership.user_id;
    }

    const { data: target, error: targetError } =
      await admin.auth.admin.getUserById(targetUserId);
    if (targetError || !target.user) {
      throw targetError || new Error("The login account could not be found.");
    }

    if (target.user.email?.toLowerCase() === email) {
      return NextResponse.json(
        { success: false, error: "That is already the current login email." },
        { status: 400 },
      );
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(
      targetUserId,
      { email, email_confirm: true },
    );

    if (updateError) {
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 400 },
      );
    }

    const { error: cleanupError } = await admin
      .from("auth_email_change_requests")
      .delete()
      .eq("user_id", targetUserId);

    if (cleanupError) {
      console.error("CLEAR PENDING EMAIL CHANGE ERROR:", cleanupError);
      return NextResponse.json({
        success: true,
        email,
        warning: "Email changed, but an older pending request could not be cleared. Reload the page before making another change.",
        ...(targetType === "staff" ? { linked: true } : {}),
      });
    }

    return NextResponse.json({
      success: true,
      email,
      ...(targetType === "staff" ? { linked: true } : {}),
    });
  } catch (error) {
    console.error("CHANGE ACCOUNT EMAIL API ERROR:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unable to change the account email.",
      },
      { status: 500 },
    );
  }
}
