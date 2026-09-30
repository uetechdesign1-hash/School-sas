import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type AdminAccount = {
  user_id: string;
  full_name: string;
  email: string;
};

type ManageAdminRequest = {
  user_id?: unknown;
  email?: unknown;
  password?: unknown;
};

function json(
  data: {
    success: boolean;
    error?: string;
    admins?: AdminAccount[];
    email?: string;
  },
  status = 200,
) {
  return NextResponse.json(data, { status });
}

async function getPrincipalContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error("Supabase server configuration is incomplete.");
  }

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return { response: json({ success: false, error: "Please sign in again." }, 401) };
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(authorization.slice(7).trim());

  if (authError || !user) {
    return {
      response: json(
        { success: false, error: "Your login session is invalid or expired." },
        401,
      ),
    };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: membership, error: membershipError } = await admin
    .from("school_users")
    .select("school_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Unable to verify school role: ${membershipError.message}`);
  }

  if (!membership?.school_id || membership.role !== "owner") {
    return {
      response: json(
        {
          success: false,
          error: "Only the school Principal can manage Admin accounts.",
        },
        403,
      ),
    };
  }

  return { admin, schoolId: membership.school_id };
}

export async function GET(request: NextRequest) {
  try {
    const context = await getPrincipalContext(request);
    if ("response" in context) return context.response;

    const { data: memberships, error: membershipsError } =
      await context.admin
        .from("school_users")
        .select("user_id")
        .eq("school_id", context.schoolId)
        .eq("role", "admin")
        .eq("is_active", true)
        .order("created_at", { ascending: true });

    if (membershipsError) {
      throw new Error(`Unable to load Admin accounts: ${membershipsError.message}`);
    }

    const userIds = (memberships || []).map((membership) => membership.user_id);
    if (userIds.length === 0) {
      return json({ success: true, admins: [] });
    }

    const { data: profiles, error: profilesError } = await context.admin
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Unable to load Admin details: ${profilesError.message}`);
    }

    const profilesById = new Map(
      (profiles || []).map((profile) => [profile.id, profile.full_name]),
    );
    const admins = await Promise.all(
      userIds.map(async (userId) => {
        const { data, error } =
          await context.admin.auth.admin.getUserById(userId);
        if (error) {
          throw new Error(`Unable to load an Admin login: ${error.message}`);
        }

        const user = data.user;
        return {
          user_id: userId,
          full_name:
            profilesById.get(userId) ||
            user.user_metadata?.full_name ||
            user.email?.split("@")[0] ||
            "School Admin",
          email: user.email || "",
        };
      }),
    );

    return json({ success: true, admins });
  } catch (error) {
    console.error("LOAD SCHOOL ADMIN ACCOUNTS ERROR:", error);
    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Admin accounts.",
      },
      500,
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await getPrincipalContext(request);
    if ("response" in context) return context.response;

    let body: ManageAdminRequest;
    try {
      body = (await request.json()) as ManageAdminRequest;
    } catch {
      return json({ success: false, error: "Invalid request body." }, 400);
    }

    const userId =
      typeof body.user_id === "string" ? body.user_id.trim() : "";
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password =
      typeof body.password === "string" ? body.password : "";

    if (!userId) {
      return json({ success: false, error: "Admin account is required." }, 400);
    }

    if (!email && !password) {
      return json(
        { success: false, error: "Enter a new email or password." },
        400,
      );
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ success: false, error: "Enter a valid email address." }, 400);
    }

    if (password && password.length < 8) {
      return json(
        {
          success: false,
          error: "New password must contain at least 8 characters.",
        },
        400,
      );
    }

    const { data: targetMembership, error: targetError } = await context.admin
      .from("school_users")
      .select("user_id")
      .eq("user_id", userId)
      .eq("school_id", context.schoolId)
      .eq("role", "admin")
      .eq("is_active", true)
      .maybeSingle();

    if (targetError) {
      throw new Error(`Unable to verify Admin account: ${targetError.message}`);
    }

    if (!targetMembership) {
      return json(
        { success: false, error: "Active Admin account was not found." },
        404,
      );
    }

    const update: { email?: string; email_confirm?: boolean; password?: string } =
      {};
    if (email) {
      update.email = email;
      update.email_confirm = true;
    }
    if (password) update.password = password;

    const { data, error: updateError } =
      await context.admin.auth.admin.updateUserById(userId, update);

    if (updateError) {
      return json(
        { success: false, error: updateError.message },
        400,
      );
    }

    return json({
      success: true,
      email: data.user.email || email,
    });
  } catch (error) {
    console.error("UPDATE SCHOOL ADMIN ACCOUNT ERROR:", error);
    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to update Admin account.",
      },
      500,
    );
  }
}
