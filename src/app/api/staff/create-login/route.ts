import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(
  data: Record<string, any>,
  status = 200
) {
  return NextResponse.json(data, { status });
}

export async function POST(request: NextRequest) {
  try {
    // =====================================================
    // ENVIRONMENT
    // =====================================================

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const publishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      return json(
        {
          success: false,
          error:
            "NEXT_PUBLIC_SUPABASE_URL is missing.",
        },
        500
      );
    }

    if (!publishableKey) {
      return json(
        {
          success: false,
          error:
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.",
        },
        500
      );
    }

    if (!serviceRoleKey) {
      return json(
        {
          success: false,
          error:
            "SUPABASE_SERVICE_ROLE_KEY is missing.",
        },
        500
      );
    }

    // =====================================================
    // GET ACCESS TOKEN
    // =====================================================

    const authorization =
      request.headers.get("authorization");

    if (!authorization) {
      return json(
        {
          success: false,
          error:
            "Authorization header is missing.",
        },
        401
      );
    }

    if (!authorization.startsWith("Bearer ")) {
      return json(
        {
          success: false,
          error:
            "Invalid authorization header.",
        },
        401
      );
    }

    const accessToken =
      authorization.slice(7).trim();

    if (!accessToken) {
      return json(
        {
          success: false,
          error:
            "Access token is missing.",
        },
        401
      );
    }

    // =====================================================
    // CLIENT 1
    // VERIFY LOGGED-IN USER
    // =====================================================

    const supabaseAuth = createClient(
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
      data: {
        user: currentUser,
      },
      error: authError,
    } =
      await supabaseAuth.auth.getUser(
        accessToken
      );

    if (authError) {
      console.error(
        "VERIFY USER ERROR:",
        authError
      );

      return json(
        {
          success: false,
          error:
            authError.message ||
            "Unable to verify current user.",
        },
        401
      );
    }

    if (!currentUser) {
      return json(
        {
          success: false,
          error:
            "Your login session is invalid or expired.",
        },
        401
      );
    }

    // =====================================================
    // CLIENT 2
    // SERVER ADMIN CLIENT
    // =====================================================

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // =====================================================
    // READ BODY
    // =====================================================

    let body: any;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          success: false,
          error: "Invalid JSON request.",
        },
        400
      );
    }

    const staffId =
      typeof body.staff_id === "string"
        ? body.staff_id.trim()
        : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    if (!staffId) {
      return json(
        {
          success: false,
          error: "Staff ID is required.",
        },
        400
      );
    }

    if (!email) {
      return json(
        {
          success: false,
          error: "Email is required.",
        },
        400
      );
    }

    if (!email.includes("@")) {
      return json(
        {
          success: false,
          error:
            "Please enter a valid email address.",
        },
        400
      );
    }

    if (password.length < 8) {
      return json(
        {
          success: false,
          error:
            "Password must contain at least 8 characters.",
        },
        400
      );
    }

    // =====================================================
    // FIND ADMIN SCHOOL
    // =====================================================

    const {
      data: callerSchool,
      error: schoolError,
    } = await supabaseAdmin
      .from("school_users")
      .select(
        "school_id, role, is_active"
      )
      .eq(
        "user_id",
        currentUser.id
      )
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (schoolError) {
      console.error(
        "SCHOOL LOOKUP ERROR:",
        schoolError
      );

      return json(
        {
          success: false,
          error: schoolError.message,
        },
        500
      );
    }

    if (!callerSchool) {
      return json(
        {
          success: false,
          error:
            "Your account is not assigned to an active school.",
        },
        403
      );
    }

    // =====================================================
    // ADMIN CHECK
    // =====================================================

    const role =
      String(callerSchool.role)
        .toLowerCase();

    if (
      role !== "owner" &&
      role !== "admin"
    ) {
      return json(
        {
          success: false,
          error:
            "Only school owner or admin can create staff login accounts.",
        },
        403
      );
    }

    // =====================================================
    // GET STAFF
    // =====================================================

    const {
      data: staff,
      error: staffError,
    } = await supabaseAdmin
      .from("staff")
      .select(
        `
          id,
          school_id,
          user_id,
          first_name,
          middle_name,
          last_name,
          employee_no,
          email,
          phone,
          status
        `
      )
      .eq("id", staffId)
      .eq(
        "school_id",
        callerSchool.school_id
      )
      .maybeSingle();

    if (staffError) {
      console.error(
        "STAFF LOOKUP ERROR:",
        staffError
      );

      return json(
        {
          success: false,
          error: staffError.message,
        },
        500
      );
    }

    if (!staff) {
      return json(
        {
          success: false,
          error:
            "Staff member not found.",
        },
        404
      );
    }

    // =====================================================
    // EXISTING LOGIN?
    // =====================================================

    if (staff.user_id) {
      return json(
        {
          success: false,
          error:
            "This staff member already has a login account.",
        },
        409
      );
    }

    // =====================================================
    // CHECK AUTH EMAIL
    // =====================================================

    let existingUser = null;

    let page = 1;

    while (true) {
      const {
        data: users,
        error: usersError,
      } =
        await supabaseAdmin.auth.admin.listUsers(
          {
            page,
            perPage: 1000,
          }
        );

      if (usersError) {
        console.error(
          "LIST USERS ERROR:",
          usersError
        );

        return json(
          {
            success: false,
            error: usersError.message,
          },
          500
        );
      }

      const found =
        users.users.find(
          (u) =>
            u.email?.toLowerCase() ===
            email
        );

      if (found) {
        existingUser = found;
        break;
      }

      if (users.users.length < 1000) {
        break;
      }

      page++;
    }

    if (existingUser) {
      return json(
        {
          success: false,
          error:
            "A login account with this email already exists.",
        },
        409
      );
    }

    // =====================================================
    // STAFF NAME
    // =====================================================

    const fullName =
      [
        staff.first_name,
        staff.middle_name,
        staff.last_name,
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || "Staff Member";

    // =====================================================
    // CREATE AUTH ACCOUNT
    // =====================================================

    const {
      data: authData,
      error: createUserError,
    } =
      await supabaseAdmin.auth.admin.createUser(
        {
          email,
          password,
          email_confirm: true,

          user_metadata: {
            account_type: "staff",
            staff_id: staff.id,
            school_id: staff.school_id,
          },
        }
      );

    if (
      createUserError ||
      !authData.user
    ) {
      console.error(
        "CREATE AUTH ACCOUNT ERROR:",
        createUserError
      );

      return json(
        {
          success: false,
          error:
            createUserError?.message ||
            "Failed to create Auth account.",
        },
        500
      );
    }

    const userId =
      authData.user.id;

    // =====================================================
    // CREATE PROFILE
    // =====================================================

    const {
      error: profileError,
    } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          full_name: fullName,
          phone: staff.phone || null,
        },
        {
          onConflict: "id",
        }
      );

    if (profileError) {
      console.error(
        "PROFILE ERROR:",
        profileError
      );

      await supabaseAdmin.auth.admin.deleteUser(
        userId
      );

      return json(
        {
          success: false,
          error:
            `Profile creation failed: ${profileError.message}`,
        },
        500
      );
    }

    // =====================================================
    // CREATE SCHOOL USER
    // =====================================================

    const {
      error: schoolUserError,
    } = await supabaseAdmin
      .from("school_users")
      .insert({
        user_id: userId,
        school_id: staff.school_id,
        role: "staff",
        is_active: true,
      });

    if (schoolUserError) {
      console.error(
        "SCHOOL USER ERROR:",
        schoolUserError
      );

      await supabaseAdmin
        .from("profiles")
        .delete()
        .eq("id", userId);

      await supabaseAdmin.auth.admin.deleteUser(
        userId
      );

      return json(
        {
          success: false,
          error:
            `School account creation failed: ${schoolUserError.message}`,
        },
        500
      );
    }

    // =====================================================
    // LINK STAFF
    // =====================================================

    const {
      error: updateStaffError,
    } = await supabaseAdmin
      .from("staff")
      .update({
        user_id: userId,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", staff.id)
      .eq(
        "school_id",
        staff.school_id
      );

    if (updateStaffError) {
      console.error(
        "STAFF LINK ERROR:",
        updateStaffError
      );

      await supabaseAdmin
        .from("school_users")
        .delete()
        .eq("user_id", userId)
        .eq(
          "school_id",
          staff.school_id
        );

      await supabaseAdmin
        .from("profiles")
        .delete()
        .eq("id", userId);

      await supabaseAdmin.auth.admin.deleteUser(
        userId
      );

      return json(
        {
          success: false,
          error:
            `Staff linking failed: ${updateStaffError.message}`,
        },
        500
      );
    }

    // =====================================================
    // SUCCESS
    // =====================================================

    return json(
      {
        success: true,
        message:
          "Teacher login account created and linked successfully.",
        user_id: userId,
        staff_id: staff.id,
        school_id: staff.school_id,
        staff_name: fullName,
        email,
      },
      200
    );
  } catch (error: any) {
    console.error(
      "UNEXPECTED CREATE LOGIN ERROR:",
      error
    );

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Unexpected server error.",
      },
      500
    );
  }
}