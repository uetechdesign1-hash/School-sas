import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type CreateAdminRequest = {
  full_name?: unknown;
  email?: unknown;
  password?: unknown;
};

function json(
  data: { success: boolean; error?: string; email?: string },
  status = 200,
) {
  return NextResponse.json(data, { status });
}

export async function POST(request: NextRequest) {
  let createdUserId: string | null = null;
  let cleanupCreatedUser:
    | ((userId: string) => Promise<void>)
    | null = null;

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return json(
        {
          success: false,
          error:
            "Supabase server configuration is incomplete. Check the URL, publishable key, and service role key.",
        },
        500,
      );
    }

    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return json(
        { success: false, error: "Please sign in again." },
        401,
      );
    }

    const supabaseAuth = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser(authorization.slice(7).trim());

    if (authError || !user) {
      return json(
        { success: false, error: "Your login session is invalid or expired." },
        401,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cleanupCreatedUser = async (userId) => {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw error;
    };

    const { data: callerMembership, error: membershipError } =
      await supabaseAdmin
        .from("school_users")
        .select("school_id, role, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

    if (membershipError) {
      console.error("ADMIN ACCOUNT CALLER LOOKUP ERROR:", membershipError);
      return json(
        { success: false, error: "Unable to verify your school role." },
        500,
      );
    }

    if (!callerMembership?.school_id || callerMembership.role !== "owner") {
      return json(
        {
          success: false,
          error: "Only the school Principal can create an Admin login.",
        },
        403,
      );
    }

    let body: CreateAdminRequest;
    try {
      body = (await request.json()) as CreateAdminRequest;
    } catch {
      return json(
        { success: false, error: "Invalid request body." },
        400,
      );
    }

    const fullName =
      typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
    const password =
      typeof body.password === "string" ? body.password : "";

    if (!fullName) {
      return json(
        { success: false, error: "Admin name is required." },
        400,
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(
        { success: false, error: "Enter a valid email address." },
        400,
      );
    }

    if (password.length < 8) {
      return json(
        {
          success: false,
          error: "Password must contain at least 8 characters.",
        },
        400,
      );
    }

    const { data: authData, error: createUserError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          account_type: "school_admin",
          school_id: callerMembership.school_id,
          full_name: fullName,
        },
      });

    if (createUserError || !authData.user) {
      return json(
        {
          success: false,
          error: createUserError?.message || "Unable to create the Admin login.",
        },
        409,
      );
    }

    createdUserId = authData.user.id;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { id: createdUserId, full_name: fullName },
        { onConflict: "id" },
      );

    if (profileError) {
      throw new Error(`Unable to save the Admin profile: ${profileError.message}`);
    }

    const { error: schoolUserError } = await supabaseAdmin
      .from("school_users")
      .insert({
        user_id: createdUserId,
        school_id: callerMembership.school_id,
        role: "admin",
        is_active: true,
      });

    if (schoolUserError) {
      throw new Error(
        `Unable to connect the Admin to this school: ${schoolUserError.message}`,
      );
    }

    return json({ success: true, email });
  } catch (error) {
    console.error("CREATE SCHOOL ADMIN ERROR:", error);

    if (createdUserId && cleanupCreatedUser) {
      try {
        await cleanupCreatedUser(createdUserId);
      } catch (cleanupError) {
        console.error("ADMIN ACCOUNT CLEANUP ERROR:", cleanupError);
      }
    }

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while creating Admin login.",
      },
      500,
    );
  }
}
