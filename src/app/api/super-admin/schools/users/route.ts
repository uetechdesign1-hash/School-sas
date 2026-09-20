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

type SchoolUserRow = {
  user_id: string;
  role: string;
  is_active: boolean;
  created_at: string | null;
};

type UserProfileRow = {
  id: string;
  full_name: string | null;
  login_id: string | null;
  phone: string | null;
  platform_role: string | null;
  is_active: boolean | null;
};

type StaffRow = {
  id: string;
  user_id: string | null;
  employee_no: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  status: string | null;
};

function getStaffFullName(staff: StaffRow | undefined) {
  if (!staff) {
    return "";
  }

  return (
    [staff.first_name, staff.middle_name, staff.last_name]
      .filter(Boolean)
      .join(" ") || ""
  );
}

export async function GET(request: Request) {
  try {
    const { admin } = await getSuperAdmin(request);

    const requestUrl = new URL(request.url);
    const schoolId = requestUrl.searchParams.get("schoolId") || "";

    if (!schoolId) {
      return json(
        { success: false, error: "School ID is required." },
        400,
      );
    }

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

    const { data: membershipData, error: membershipError } = await admin
      .from("school_users")
      .select("user_id, role, is_active, created_at")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: true });

    if (membershipError) {
      return json(
        { success: false, error: membershipError.message },
        400,
      );
    }

    const memberships = (membershipData || []) as SchoolUserRow[];

    const userIds = Array.from(
      new Set(
        memberships
          .map((membership) => membership.user_id)
          .filter(Boolean),
      ),
    );

    const profilesById = new Map<string, UserProfileRow>();
    const staffByUserId = new Map<string, StaffRow>();

    if (userIds.length > 0) {
      const [profileResult, staffResult] = await Promise.all([
        admin
          .from("user_profiles")
          .select("id, full_name, login_id, phone, platform_role, is_active")
          .in("id", userIds),
        admin
          .from("staff")
          .select(
            "id, user_id, employee_no, first_name, middle_name, last_name, designation, status",
          )
          .eq("school_id", schoolId)
          .in("user_id", userIds),
      ]);

      if (profileResult.error) {
        return json(
          { success: false, error: profileResult.error.message },
          400,
        );
      }

      for (const profile of (profileResult.data || []) as UserProfileRow[]) {
        profilesById.set(profile.id, profile);
      }

      // The staff record lookup is only used to show employee details, so a
      // failure here never blocks the staff login list.
      if (!staffResult.error) {
        for (const staff of (staffResult.data || []) as StaffRow[]) {
          if (staff.user_id) {
            staffByUserId.set(staff.user_id, staff);
          }
        }
      }
    }

    const members = [];

    for (const membership of memberships) {
      let email = "";
      let lastSignInAt: string | null = null;

      try {
        const { data: authData } = await admin.auth.admin.getUserById(
          membership.user_id,
        );

        email = authData.user?.email || "";
        lastSignInAt = authData.user?.last_sign_in_at || null;
      } catch {
        // The auth user may already be gone - the row can still be shown and
        // cleaned up from this screen.
      }

      const profile = profilesById.get(membership.user_id);
      const staff = staffByUserId.get(membership.user_id);
      const staffFullName = getStaffFullName(staff);

      members.push({
        userId: membership.user_id,
        role: membership.role || "staff",
        isActive: membership.is_active === true,
        memberSince: membership.created_at,
        email,
        lastSignInAt,
        fullName:
          profile?.full_name ||
          staffFullName ||
          email.split("@")[0] ||
          "Unnamed user",
        loginId: profile?.login_id || null,
        phone: profile?.phone || null,
        employeeNo: staff?.employee_no || null,
        designation: staff?.designation || null,
        staffStatus: staff?.status || null,
        isLinkedToStaffRecord: Boolean(staff),
      });
    }

    return json({
      success: true,
      school,
      members,
    });
  } catch (error) {
    console.error("SUPER ADMIN SCHOOL USERS API ERROR:", error);

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load school users.",
      },
      500,
    );
  }
}


export async function POST(request: Request) {
  try {
    const { admin, user } = await getSuperAdmin(request);
    const body = await request.json();

    const action = String(body?.action || "");
    const schoolId = String(body?.schoolId || "");
    const userId = String(body?.userId || "");

    if (action !== "delete") {
      return json(
        { success: false, error: "Unknown action." },
        400,
      );
    }

    if (!schoolId || !userId) {
      return json(
        { success: false, error: "School ID and User ID are required." },
        400,
      );
    }

    if (userId === user.id) {
      return json(
        {
          success: false,
          error:
            "You cannot delete the account you are currently signed in with.",
        },
        400,
      );
    }

    const { data: school, error: schoolError } = await admin
      .from("schools")
      .select("id, name")
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
      .select("user_id")
      .eq("school_id", schoolId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      return json(
        { success: false, error: membershipError.message },
        400,
      );
    }

    if (!membership) {
      return json(
        {
          success: false,
          error: "This user does not belong to the selected school.",
        },
        404,
      );
    }

    // --------------------------------------------------
    // 1. UNLINK THE STAFF RECORD
    //
    // Keep the staff record itself, only remove the login link so no
    // dangling reference blocks the auth user deletion.
    // --------------------------------------------------

    try {
      await admin
        .from("staff")
        .update({
          user_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("school_id", schoolId)
        .eq("user_id", userId);
    } catch {
      // Best effort - continue with the deletion.
    }

    // --------------------------------------------------
    // 2. REMOVE SCHOOL MEMBERSHIPS
    //
    // The Supabase Auth account is deleted below, so every membership of
    // this user is removed here to avoid orphaned school_users rows.
    // --------------------------------------------------

    const { error: schoolUsersError } = await admin
      .from("school_users")
      .delete()
      .eq("user_id", userId);

    if (schoolUsersError) {
      return json(
        { success: false, error: schoolUsersError.message },
        400,
      );
    }

    // --------------------------------------------------
    // 3. REMOVE PROFILE ROWS
    // --------------------------------------------------

    try {
      await admin.from("user_profiles").delete().eq("id", userId);
      await admin.from("profiles").delete().eq("id", userId);
    } catch {
      // Best effort - the auth deletion below is the important step.
    }

    // --------------------------------------------------
    // 4. DELETE THE SUPABASE AUTH USER
    //
    // This removes the login from Supabase Auth so the email can be
    // registered again and the person can no longer sign in.
    // --------------------------------------------------

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(
      userId,
    );

    if (authDeleteError) {
      return json(
        {
          success: false,
          error:
            "The user rows were removed, but the Supabase Auth account " +
            `could not be deleted: ${authDeleteError.message}`,
        },
        400,
      );
    }

    return json({
      success: true,
      message:
        "User deleted successfully. The login has also been removed " +
        "from Supabase Auth.",
    });
  } catch (error) {
    console.error("SUPER ADMIN DELETE SCHOOL USER API ERROR:", error);

    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to delete the user.",
      },
      500,
    );
  }
}

