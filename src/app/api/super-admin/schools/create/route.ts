import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
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

/**
 * Creates a school together with its owner login.
 *
 * This runs on the server with the service role key (the same pattern as
 * /api/super-admin/schools/manage) so school creation no longer depends on a
 * separately deployed edge function.
 *
 * Important behaviours:
 *  - The owner logs in with the email address entered in the create form.
 *  - A leftover (orphan) login that still uses that email but is no longer
 *    attached to an active school is removed and re-created, so deleting a
 *    school and re-creating it with the same owner email / School ID always
 *    works.
 *  - A login that is still attached to an active school is never touched; a
 *    clear error is returned instead.
 */
export async function POST(request: Request) {
  const created: { schoolId?: string; ownerId?: string } = {};

  try {
    const { admin, user } = await getSuperAdmin(request);

    const body: Record<string, unknown> = await request
      .json()
      .catch(() => ({}));

    const read = (...keys: string[]) => {
      for (const key of keys) {
        const value = clean(body?.[key]);
        if (value) {
          return value;
        }
      }

      return "";
    };

    const schoolName = read("schoolName", "school_name");
    const schoolCode = read("schoolCode", "school_code").toUpperCase();
    const schoolEmail = read("schoolEmail", "school_email", "email");
    const schoolPhone = read("schoolPhone", "school_phone", "phone");
    const address = read("address");
    const city = read("city");
    const state = read("state");
    const postalCode = read("postalCode", "postal_code");

    const planCode = read("planCode", "plan_code").toLowerCase() || "starter";
    const studentLimit = Number(read("studentLimit", "student_limit") || 300);
    const startsOn = read("startsOn", "starts_on");
    const expiresOn = read("expiresOn", "expires_on");
    const amount = Number(read("amount") || 0);

    const ownerName = read("ownerName", "owner_name");
    const ownerPhone = read("ownerPhone", "owner_phone");
    const ownerEmail = read("ownerEmail", "owner_email").toLowerCase();
    const password = read("password", "ownerPassword", "owner_password");

    // --------------------------------------------------
    // VALIDATION
    // --------------------------------------------------

    if (!schoolName) {
      return json(
        { success: false, error: "School name is required." },
        400,
      );
    }

    if (!schoolCode) {
      return json(
        { success: false, error: "School ID is required." },
        400,
      );
    }

    if (!/^[A-Z0-9_-]{3,30}$/.test(schoolCode)) {
      return json(
        {
          success: false,
          error:
            "School ID may contain only letters, numbers, underscore and hyphen.",
        },
        400,
      );
    }

    if (!ownerName) {
      return json(
        { success: false, error: "Owner name is required." },
        400,
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      return json(
        { success: false, error: "Please enter a valid owner email address." },
        400,
      );
    }

    if (password.length < 8) {
      return json(
        {
          success: false,
          error: "Owner password must contain at least 8 characters.",
        },
        400,
      );
    }

    if (!Number.isInteger(studentLimit) || studentLimit < 1) {
      return json(
        { success: false, error: "Student limit is invalid." },
        400,
      );
    }

    if (!startsOn || !expiresOn) {
      return json(
        {
          success: false,
          error: "Start date and expiry date are required.",
        },
        400,
      );
    }

    // --------------------------------------------------
    // CLEANUP HELPER
    // Removes the school / owner created by this request.
    // --------------------------------------------------

    const rollback = async () => {
      if (created.ownerId) {
        await admin.from("user_profiles").delete().eq("id", created.ownerId);
        await admin.from("profiles").delete().eq("id", created.ownerId);
        await admin.auth.admin.deleteUser(created.ownerId);
        created.ownerId = undefined;
      }

      if (created.schoolId) {
        await admin
          .from("school_users")
          .delete()
          .eq("school_id", created.schoolId);

        await admin
          .from("school_subscriptions")
          .delete()
          .eq("school_id", created.schoolId);

        await admin.from("schools").delete().eq("id", created.schoolId);
        created.schoolId = undefined;
      }
    };

    // --------------------------------------------------
    // SCHOOL ID MUST BE UNIQUE
    // --------------------------------------------------

    const { data: codeMatches, error: codeMatchError } = await admin
      .from("schools")
      .select("id,name")
      .or(`school_code.ilike.${schoolCode},code.ilike.${schoolCode}`)
      .limit(1);

    if (codeMatchError) {
      return json(
        { success: false, error: codeMatchError.message },
        400,
      );
    }

    if (codeMatches && codeMatches.length > 0) {
      return json(
        {
          success: false,
          error: "This School ID already exists.",
        },
        409,
      );
    }

    // --------------------------------------------------
    // LOGIN EMAIL
    //
    // The owner signs in with the email address entered in the create form.
    // When no owner email is supplied we fall back to an internal address so
    // the school can still be created.
    // --------------------------------------------------

    const loginEmail =
      ownerEmail || `${schoolCode.toLowerCase()}@login.schoolerp.local`;

    // --------------------------------------------------
    // REMOVE A LEFTOVER (ORPHAN) LOGIN WITH THE SAME EMAIL
    //
    // Deleting a school used to remove the school data but leave the owner
    // login behind in Supabase Auth, which made re-creating the same owner
    // email fail with "A user with this email address has already been
    // registered". Recycle that stale account instead of failing.
    // --------------------------------------------------

    let existingLoginId: string | null = null;
    let page = 1;

    while (true) {
      const { data: users, error: usersError } = await admin.auth.admin
        .listUsers({ page, perPage: 1000 });

      if (usersError) {
        console.error("LIST USERS ERROR:", usersError);

        return json(
          { success: false, error: usersError.message },
          500,
        );
      }

      const found = users.users.find(
        (user) => user.email?.trim().toLowerCase() === loginEmail,
      );

      if (found) {
        existingLoginId = found.id;
        break;
      }

      if (users.users.length < 1000) {
        break;
      }

      page += 1;
    }

    if (existingLoginId) {
      const { data: activeMemberships, error: membershipLookupError } =
        await admin
          .from("school_users")
          .select("id")
          .eq("user_id", existingLoginId)
          .eq("is_active", true)
          .limit(1);

      if (membershipLookupError) {
        return json(
          { success: false, error: membershipLookupError.message },
          400,
        );
      }

      if (activeMemberships && activeMemberships.length > 0) {
        return json(
          {
            success: false,
            error:
              `The email ${loginEmail} is already used by an active school login. ` +
              "Use a different owner email, or delete that school first.",
          },
          409,
        );
      }

      console.log(
        "Recycling orphan school owner login:",
        existingLoginId,
        loginEmail,
      );

      await admin.from("user_profiles").delete().eq("id", existingLoginId);
      await admin.from("profiles").delete().eq("id", existingLoginId);

      const { error: deleteLoginError } = await admin.auth.admin.deleteUser(
        existingLoginId,
      );

      if (deleteLoginError) {
        return json(
          {
            success: false,
            error:
              `Unable to clear the previous login for ${loginEmail}: ` +
              deleteLoginError.message,
          },
          400,
        );
      }
    }

    // Stale profile rows that still use this School ID as their login id.
    await admin.from("user_profiles").delete().eq("login_id", schoolCode);

    // --------------------------------------------------
    // CREATE SCHOOL
    // --------------------------------------------------

    const { data: school, error: schoolError } = await admin
      .from("schools")
      .insert({
        name: schoolName,
        code: schoolCode,
        school_code: schoolCode,
        email: schoolEmail || ownerEmail || null,
        phone: schoolPhone || ownerPhone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        postal_code: postalCode || null,
        plan_code: planCode,
        student_limit: studentLimit,
        starts_on: startsOn,
        expires_on: expiresOn,
        status: "active",
        created_by: user.id,
      })
      .select("id,name,code,school_code")
      .single();

    if (schoolError || !school) {
      return json(
        {
          success: false,
          error: schoolError?.message || "Unable to create the school.",
        },
        400,
      );
    }

    created.schoolId = school.id;

    // --------------------------------------------------
    // CREATE OWNER LOGIN
    // --------------------------------------------------

    const { data: authResult, error: authError } =
      await admin.auth.admin.createUser({
        email: loginEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: ownerName,
          school_code: schoolCode,
        },
        app_metadata: {
          account_type: "school_owner",
        },
      });

    if (authError || !authResult?.user) {
      await rollback();

      const message =
        authError?.message || "Unable to create the owner login.";

      if (message.toLowerCase().includes("already been registered")) {
        return json(
          {
            success: false,
            error:
              `A user with the email ${loginEmail} already exists. ` +
              "It could not be recycled automatically - remove it from " +
              "Supabase Auth (Authentication > Users) and try again.",
          },
          409,
        );
      }

      return json({ success: false, error: message }, 400);
    }

    created.ownerId = authResult.user.id;
    const ownerId = authResult.user.id;

    // --------------------------------------------------
    // OWNER PROFILE
    //
    // A database trigger may already have created a profile row, so this is
    // an upsert and it never blocks school creation.
    // --------------------------------------------------

    const { error: profileError } = await admin
      .from("user_profiles")
      .upsert(
        {
          id: ownerId,
          full_name: ownerName,
          login_id: schoolCode,
          phone: ownerPhone || null,
          platform_role: "user",
          is_active: true,
        },
        { onConflict: "id" },
      );

    if (profileError) {
      console.error("OWNER PROFILE UPSERT ERROR:", profileError);
    }

    const { error: legacyProfileError } = await admin
      .from("profiles")
      .upsert(
        {
          id: ownerId,
          full_name: ownerName,
          phone: ownerPhone || null,
        },
        { onConflict: "id" },
      );

    if (legacyProfileError) {
      console.error("LEGACY PROFILE UPSERT ERROR:", legacyProfileError);
    }

    // --------------------------------------------------
    // LINK OWNER TO THE SCHOOL
    // --------------------------------------------------

    const { error: membershipError } = await admin
      .from("school_users")
      .insert({
        user_id: ownerId,
        school_id: school.id,
        role: "owner",
        is_active: true,
      });

    if (membershipError) {
      await rollback();

      return json(
        {
          success: false,
          error: membershipError.message,
        },
        400,
      );
    }

    // --------------------------------------------------
    // SUBSCRIPTION (kept recoverable, school already exists)
    // --------------------------------------------------

    let warning = "";

    const { error: subscriptionError } = await admin
      .from("school_subscriptions")
      .insert({
        school_id: school.id,
        plan_code: planCode,
        status: "active",
        amount,
        started_on: startsOn,
        expires_on: expiresOn,
        student_limit: studentLimit,
        created_by: user.id,
      });

    if (subscriptionError) {
      console.error("SUBSCRIPTION CREATION FAILED:", subscriptionError);

      warning =
        "School and owner were created, but the subscription could not be saved.";
    }

    // --------------------------------------------------
    // SUCCESS
    // --------------------------------------------------

    return json(
      {
        success: true,
        schoolId: school.id,
        schoolCode,
        schoolName,
        ownerName,
        loginId: loginEmail,
        temporaryPassword: password,
        expiresOn,
        message: warning
          ? `School and owner created successfully. ${warning}`
          : "School and owner created successfully.",
        ...(warning ? { warning } : {}),
      },
      201,
    );
  } catch (error) {
    console.error("CREATE SCHOOL API ERROR:", error);

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to create school.",
      },
      500,
    );
  }
}
