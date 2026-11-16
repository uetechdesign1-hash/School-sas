import { NextResponse } from "next/server";
import { requireSuperAdmin, SuperAdminAuthError } from "@/lib/auth/super-admin";
import { validateModules } from "@/lib/modules";
import { errorText } from "@/lib/supabase/postgrest-errors";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(request: Request) {
  try {
    const { admin, authenticated } = await requireSuperAdmin(request);
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
          "id,name,code,school_code,status,plan_code,enabled_modules,student_limit,starts_on,expires_on,email,phone,address,city,state,postal_code",
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

      let modules;
      try {
        modules = validateModules(body?.modules);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return json({ success: false, error: error.message }, 400);
      }

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

      const { error: schoolUpdateError } = await authenticated
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
          plan_code: "starter",
          enabled_modules: modules,
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

      // Owner logins are stamped with the School ID in their auth metadata
      // and profile. Collect them as well so a login whose school_users row
      // is missing (or was removed by an earlier, partial delete) is still
      // cleaned up instead of lingering in Authentication > Users.
      const schoolCodeValue = String(school.school_code || school.code || "")
        .trim();

      if (schoolCodeValue) {
        const { data: loginProfiles } = await admin
          .from("user_profiles")
          .select("id")
          .ilike("login_id", schoolCodeValue);

        for (const row of loginProfiles || []) {
          if (row?.id) linkedUserIds.add(String(row.id));
        }

        for (let page = 1; ; page += 1) {
          const { data: authPage, error: authPageError } =
            await admin.auth.admin.listUsers({ page, perPage: 1000 });

          if (authPageError || !authPage) break;

          for (const authUser of authPage.users) {
            const metaCode = String(
              authUser.user_metadata?.school_code || "",
            ).trim();

            if (
              authUser.app_metadata?.account_type === "school_owner" &&
              metaCode.toLowerCase() === schoolCodeValue.toLowerCase()
            ) {
              linkedUserIds.add(authUser.id);
            }
          }

          if (authPage.users.length < 1000) break;
        }
      }

      // Phase 2 subscription, MOU, invoice, payment and sales-history rows
      // have restrictive foreign keys and immutable audit triggers. Remove
      // them through the server-only transactional cleanup RPC first.
      const { error: businessCleanupError } = await admin.rpc(
        "cleanup_school_business_records",
        { p_school_id: schoolId },
      );
      if (businessCleanupError) {
        return json(
          {
            success: false,
            error: `Unable to delete the school's subscription, billing, or sales records: ${errorText(businessCleanupError, "cleanup failed")}`,
          },
          500,
        );
      }

      // Delete all school data in correct order
      // Using raw SQL for cascade delete since we need to delete from multiple tables

      const tablesToDelete = [
        "audit_logs",
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
        // Optional modules
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

      const cleanupErrors: { table: string; error: string }[] = [];

      for (const table of tablesToDelete) {
        try {
          const { error } = await admin.from(table).delete().eq("school_id", schoolId);
          if (error) {
            const missingRelation = error.code === "42P01" &&
              (error.message === `relation "${table}" does not exist` ||
               error.message === `relation "public.${table}" does not exist`);
            const missingCacheEntry = error.code === "PGRST205" &&
              error.message === `Could not find the table 'public.${table}' in the schema cache`;
            if (!missingRelation && !missingCacheEntry) {
              cleanupErrors.push({ table, error: errorText(error, "Unable to delete school data.") });
            }
          }
        } catch (error) {
          cleanupErrors.push({ table, error: errorText(error, "Unable to delete school data.") });
        }
      }

      if (cleanupErrors.length > 0) {
        return json({
          success: false,
          error: `School cleanup failed; some data may already have been deleted. ${cleanupErrors.map(({ table, error }) => `${table}: ${error}`).join("; ")}`,
          cleanupErrors,
        }, 500);
      }

      // --------------------------------------------------
      // DELETE THE SCHOOL LOGINS
      //
      // Without this, a deleted school leaves its owner / staff accounts in
      // Supabase Auth and re-creating the same owner email fails with
      // "A user with this email address has already been registered".
      // --------------------------------------------------

      const authDeleteErrors: string[] = [];

      for (const userId of linkedUserIds) {
        try {
          const { data: otherMembership, error: otherMembershipError } = await admin
            .from("school_users")
            .select("school_id")
            .eq("user_id", userId)
            .neq("school_id", schoolId)
            .limit(1)
            .maybeSingle();
          const { data: otherStaffRecord, error: otherStaffError } = await admin
            .from("staff")
            .select("school_id")
            .eq("user_id", userId)
            .neq("school_id", schoolId)
            .limit(1)
            .maybeSingle();

          // A login may be associated with more than one school. Removing one
          // school must not erase that user's remaining school account.
          if (otherMembershipError || otherStaffError) {
            console.error("Unable to verify whether a school login is shared:", {
              userId,
              otherMembershipError,
              otherStaffError,
            });
            authDeleteErrors.push(`${userId}: could not verify the login is unshared`);
            continue;
          }
          if (otherMembership || otherStaffRecord) continue;

          await admin.from("user_profiles").delete().eq("id", userId);
          await admin.from("profiles").delete().eq("id", userId);

          const { error: authUserError } = await admin.auth.admin.deleteUser(
            userId,
          );

          // A user that is already gone is not a failure.
          if (authUserError && authUserError.status !== 404) {
            console.error(`Could not delete auth user ${userId}:`, authUserError.message);
            authDeleteErrors.push(`${userId}: ${authUserError.message}`);
          }
        } catch (userError: unknown) {
          const message = userError instanceof Error ? userError.message : String(userError);
          console.error(`Could not delete auth user ${userId}:`, message);
          authDeleteErrors.push(`${userId}: ${message}`);
        }
      }

      // Keep the school so the delete can be retried rather than reporting
      // success while logins remain in Supabase Auth.
      if (authDeleteErrors.length > 0) {
        return json(
          {
            success: false,
            error: `School data was deleted but these logins could not be removed from Authentication: ${authDeleteErrors.join("; ")}. Press delete again to retry.`,
          },
          500,
        );
      }

      // Profile rows that still carry this School ID as their login id.
      const schoolCode = schoolCodeValue;

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
    if (error instanceof SuperAdminAuthError) {
      return json({ success: false, error: error.message }, error.status);
    }
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
