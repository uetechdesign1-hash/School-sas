import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

async function getSuperAdmin(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server configuration is missing.");
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new Error("Authorization token is required.");
  }

  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);

  if (authError || !user) {
    throw new Error("You must be signed in as Super Admin.");
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
    throw new Error("Super Admin access required.");
  }

  return { admin, user };
}

export async function POST(request: Request) {
  try {
    const { admin } = await getSuperAdmin(request);
    const body = await request.json();

    const action = String(body?.action || "");
    const schoolId = String(body?.schoolId || "");

    if (!schoolId) {
      return json(
        { success: false, error: "School ID is required." },
        400,
      );
    }

    if (action === "get") {
      const { data: school, error: schoolError } = await admin
        .from("schools")
        .select(
          "id,name,code,school_code,status,plan_code,student_limit,starts_on,expires_on,email,phone,address,city,state,postal_code",
        )
        .eq("id", schoolId)
        .maybeSingle();

      if (schoolError) {
        return json(
          { success: false, error: schoolError.message },
          400,
        );
      }

      if (!school) {
        return json(
          { success: false, error: "School not found." },
          404,
        );
      }

      const { data: membership, error: membershipError } = await admin
        .from("school_users")
        .select("user_id,role,is_active")
        .eq("school_id", schoolId)
        .eq("role", "owner")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        return json(
          { success: false, error: membershipError.message },
          400,
        );
      }

      let owner = {
        userId: null as string | null,
        name: "",
        phone: "",
        email: "",
      };

      if (membership?.user_id) {
        owner.userId = membership.user_id;

        const { data: userResult } =
          await admin.auth.admin.getUserById(membership.user_id);

        owner.email = userResult.user?.email || "";

        const { data: userProfile } = await admin
          .from("user_profiles")
          .select("full_name")
          .eq("id", membership.user_id)
          .maybeSingle();

        owner.name = userProfile?.full_name || "";

        const { data: profile } = await admin
          .from("profiles")
          .select("full_name,phone")
          .eq("id", membership.user_id)
          .maybeSingle();

        if (!owner.name) {
          owner.name = profile?.full_name || "";
        }

        owner.phone = profile?.phone || "";
      }

      return json({
        success: true,
        school,
        owner,
      });
    }

    if (action === "update") {
      const school = body?.school || {};
      const owner = body?.owner || {};

      const studentLimit = Number(school.student_limit);

      if (!String(school.name || "").trim()) {
        return json(
          { success: false, error: "School name is required." },
          400,
        );
      }

      if (!String(school.code || "").trim()) {
        return json(
          { success: false, error: "School code is required." },
          400,
        );
      }

      if (!Number.isFinite(studentLimit) || studentLimit < 1) {
        return json(
          { success: false, error: "Student limit must be at least 1." },
          400,
        );
      }

      const { error: schoolUpdateError } = await admin
        .from("schools")
        .update({
          name: String(school.name).trim(),
          code: String(school.code).trim().toUpperCase(),
          email: String(school.email || "").trim() || null,
          phone: String(school.phone || "").trim() || null,
          address: String(school.address || "").trim() || null,
          city: String(school.city || "").trim() || null,
          state: String(school.state || "").trim() || null,
          postal_code: String(school.postal_code || "").trim() || null,
          plan_code: String(school.plan_code || "starter"),
          student_limit: studentLimit,
          starts_on: school.starts_on || null,
          expires_on: school.expires_on || null,
          status: String(school.status || "trial"),
        })
        .eq("id", schoolId);

      if (schoolUpdateError) {
        return json(
          { success: false, error: schoolUpdateError.message },
          400,
        );
      }

      const { data: membership } = await admin
        .from("school_users")
        .select("user_id")
        .eq("school_id", schoolId)
        .eq("role", "owner")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membership?.user_id) {
        const ownerName = String(owner.name || "").trim();
        const ownerPhone = String(owner.phone || "").trim() || null;

        if (ownerName) {
          await admin
            .from("user_profiles")
            .update({ full_name: ownerName })
            .eq("id", membership.user_id);

          await admin
            .from("profiles")
            .update({
              full_name: ownerName,
              phone: ownerPhone,
            })
            .eq("id", membership.user_id);
        } else if (ownerPhone) {
          await admin
            .from("profiles")
            .update({ phone: ownerPhone })
            .eq("id", membership.user_id);
        }
      }

      return json({ success: true });
    }

    if (action === "reset_password") {
      const password = String(body?.password || "");

      if (password.length < 8) {
        return json(
          {
            success: false,
            error: "Password must contain at least 8 characters.",
          },
          400,
        );
      }

      const { data: membership, error: membershipError } = await admin
        .from("school_users")
        .select("user_id,role,is_active")
        .eq("school_id", schoolId)
        .eq("role", "owner")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        return json(
          { success: false, error: membershipError.message },
          400,
        );
      }

      if (!membership?.user_id) {
        return json(
          {
            success: false,
            error: "No active school owner login was found.",
          },
          404,
        );
      }

      const { error: updatePasswordError } =
        await admin.auth.admin.updateUserById(
          membership.user_id,
          { password },
        );

      if (updatePasswordError) {
        return json(
          { success: false, error: updatePasswordError.message },
          400,
        );
      }

      return json({ success: true });
    }

    // --------------------------------------------------
    // DELETE SCHOOL (with all data)
    // --------------------------------------------------
    if (action === "delete") {
      const schoolId = body?.schoolId || "";

      if (!schoolId) {
        return json(
          { success: false, error: "School ID is required." },
          400,
        );
      }

      // First verify school exists
      const { data: school, error: schoolError } = await admin
        .from("schools")
        .select("id, name, code, school_code")
        .eq("id", schoolId)
        .maybeSingle();

      if (schoolError) {
        return json(
          { success: false, error: schoolError.message },
          400,
        );
      }

      if (!school) {
        return json(
          { success: false, error: "School not found." },
          404,
        );
      }

      // --------------------------------------------------
      // COLLECT THE LOGINS THAT BELONG TO THIS SCHOOL
      //
      // school_users / staff rows are deleted by the cleanup loop below, so
      // the ids must be read first. Reading school_users afterwards returned
      // nothing and left orphaned Supabase Auth users behind, which then
      // blocked re-creating the same School ID / owner email with
      // "A user with this email address has already been registered".
      // --------------------------------------------------

      const linkedUserIds = new Set<string>();

      const { data: schoolUserRows } = await admin
        .from("school_users")
        .select("user_id")
        .eq("school_id", schoolId);

      for (const row of schoolUserRows || []) {
        if (row?.user_id) {
          linkedUserIds.add(String(row.user_id));
        }
      }

      const { data: staffRows } = await admin
        .from("staff")
        .select("user_id")
        .eq("school_id", schoolId);

      for (const row of staffRows || []) {
        if (row?.user_id) {
          linkedUserIds.add(String(row.user_id));
        }
      }

      // Delete all school data in correct order
      // Using raw SQL for cascade delete since we need to delete from multiple tables

      const tablesToDelete = [
        // Accounting
        "accounting_audit_log",
        "accounting_events",
        "opening_balances",
        "journal_lines",
        "journal_entries",
        "fiscal_years",
        "accounts",
        // Fees
        "fee_payment_allocations",
        "fee_payments",
        "fee_concessions",
        "fee_carry_forwards",
        "fee_bill_items",
        "fee_bills",
        "fee_categories",
        // Students & Staff
        "students",
        "staff",
        // Classes & Academics
        "sections",
        "classes",
        "academic_years",
        // User associations (delete before auth users)
        "school_users",
        // Optional modules (will fail silently if not exist)
        "transport_routes",
        "transport_fees",
        "library_transactions",
        "library_books",
        "attendance",
        "teacher_attendance",
        "expenses",
        "expense_categories",
        "payroll_items",
        "payroll_runs",
        "salary_slips",
        "leave_requests",
        "bill_payment_allocations",
        "vendor_payments",
        "vendor_purchases",
        "vendors",
        "inventory_transactions",
        "inventory_items",
        "purchase_returns",
        "purchase_orders",
        "transactions",
        "documents",
        "messages_read",
        "messages",
        "notice_read",
        "notice",
        "exam_results",
        // Attendance & subscriptions
        "student_attendance",
        "staff_attendance_timings",
        "school_subscriptions",
      ];

      // Delete from each table
      for (const table of tablesToDelete) {
        try {
          await admin.from(table).delete().eq("school_id", schoolId);
        } catch {
          // Table might not exist or have no records - ignore
        }
      }

      // --------------------------------------------------
      // DELETE THE SCHOOL LOGINS
      //
      // Without this, a deleted school leaves its owner / staff accounts in
      // Supabase Auth and re-creating the same owner email fails with
      // "A user with this email address has already been registered".
      // --------------------------------------------------

      for (const userId of linkedUserIds) {
        try {
          await admin.from("user_profiles").delete().eq("id", userId);
          await admin.from("profiles").delete().eq("id", userId);

          const { error: authUserError } = await admin.auth.admin.deleteUser(
            userId,
          );

          if (authUserError) {
            console.log(
              `Could not delete auth user ${userId}:`,
              authUserError.message,
            );
          }
        } catch (userError: unknown) {
          // User might already be deleted or not exist - ignore
          console.log(
            `Could not delete auth user ${userId}:`,
            userError instanceof Error ? userError.message : String(userError),
          );
        }
      }

      // Profile rows that still carry this School ID as their login id.
      const schoolCode = String(school.school_code || school.code || "").trim();

      if (schoolCode) {
        await admin.from("user_profiles").delete().eq("login_id", schoolCode);
      }

      // Finally delete the school itself
      const { error: schoolDeleteError } = await admin
        .from("schools")
        .delete()
        .eq("id", schoolId);

      if (schoolDeleteError) {
        return json(
          { success: false, error: schoolDeleteError.message },
          400,
        );
      }

      return json({
        success: true,
        message:
          `School "${school.name}", all its data and ` +
          `${linkedUserIds.size} login(s) have been deleted.`,
      });
    }

    return json(
      { success: false, error: "Unknown action." },
      400,
    );
  } catch (error) {
    console.error("SUPER ADMIN SCHOOL MANAGEMENT API ERROR:", error);

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to manage school.",
      },
      500,
    );
  }
}
