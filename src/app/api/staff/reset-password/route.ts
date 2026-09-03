import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL!;

const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: Request) {
  try {
    const authorization =
      request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 }
      );
    }

    const accessToken =
      authorization.replace("Bearer ", "").trim();

    const authClient = createClient(
      supabaseUrl,
      publishableKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } =
      await authClient.auth.getUser(
        accessToken
      );

    if (authError || !user) {
      return NextResponse.json(
        {
          error:
            "Your login session is invalid or expired.",
        },
        { status: 401 }
      );
    }

    const adminClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const body = await request.json();

    const staffId =
      typeof body?.staff_id === "string"
        ? body.staff_id.trim()
        : "";

    const password =
      typeof body?.password === "string"
        ? body.password
        : "";

    if (!staffId) {
      return NextResponse.json(
        { error: "Staff ID is required." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        {
          error:
            "Password must contain at least 8 characters.",
        },
        { status: 400 }
      );
    }

    const {
      data: membership,
      error: membershipError,
    } =
      await adminClient
        .from("school_users")
        .select(
          "school_id, role, is_active"
        )
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership?.school_id) {
      return NextResponse.json(
        {
          error:
            "Your account is not assigned to an active school.",
        },
        { status: 403 }
      );
    }

    if (
      membership.role !== "owner" &&
      membership.role !== "admin"
    ) {
      return NextResponse.json(
        {
          error:
            "Only school owner or admin can reset staff passwords.",
        },
        { status: 403 }
      );
    }

    const { data: staff, error: staffError } =
      await adminClient
        .from("staff")
        .select(
          "id, school_id, user_id"
        )
        .eq("id", staffId)
        .eq(
          "school_id",
          membership.school_id
        )
        .maybeSingle();

    if (staffError) {
      throw staffError;
    }

    if (!staff) {
      return NextResponse.json(
        {
          error: "Staff member was not found.",
        },
        { status: 404 }
      );
    }

    if (!staff.user_id) {
      return NextResponse.json(
        {
          error:
            "This staff member does not have a login account yet.",
        },
        { status: 400 }
      );
    }

    const {
      data: staffMembership,
      error: staffMembershipError,
    } =
      await adminClient
        .from("school_users")
        .select(
          "user_id, school_id, role, is_active"
        )
        .eq(
          "user_id",
          staff.user_id
        )
        .eq(
          "school_id",
          membership.school_id
        )
        .eq("role", "staff")
        .eq("is_active", true)
        .maybeSingle();

    if (staffMembershipError) {
      throw staffMembershipError;
    }

    if (!staffMembership) {
      return NextResponse.json(
        {
          error:
            "The staff login account is not correctly assigned.",
        },
        { status: 400 }
      );
    }

    const { error: updateError } =
      await adminClient.auth.admin.updateUserById(
        staff.user_id,
        {
          password,
        }
      );

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      message:
        "Staff password changed successfully.",
    });
  } catch (error) {
    console.error(
      "STAFF RESET PASSWORD API ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reset staff password.",
      },
      { status: 500 }
    );
  }
}
