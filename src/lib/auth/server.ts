import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SchoolRoleAuth = {
  admin: SupabaseClient;
  userId: string;
  schoolId: string;
  role: string;
};

export class UnauthenticatedError extends Error {
  readonly status = 401;

  constructor(message: string) {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class UnauthorizedError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function requireSchoolRole(
  request: Request,
  allowedRoles: readonly string[],
): Promise<SchoolRoleAuth> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!token) {
    throw new UnauthenticatedError("Authorization token is required.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase server configuration is missing.");
  }

  const authClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !user) {
    throw new UnauthenticatedError("You must be signed in.");
  }

  const { data: memberships, error: membershipError } = await authClient
    .from("school_users")
    .select("school_id,role,created_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .order("school_id", { ascending: true });

  if (membershipError) {
    throw new Error(`Unable to determine your school: ${membershipError.message}`);
  }

  const membership = memberships?.[0];

  if (!membership) {
    throw new UnauthorizedError(
      "Your account is not linked to an active school.",
    );
  }

  const role = String(membership.role || "").trim().toLowerCase();
  const normalizedAllowedRoles = allowedRoles.map((allowedRole) =>
    String(allowedRole).trim().toLowerCase(),
  );

  if (!normalizedAllowedRoles.includes(role)) {
    throw new UnauthorizedError(
      "Your account does not have an allowed role for this school.",
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Supabase server configuration is missing.");
  }
  const admin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: school, error: schoolError } = await admin
    .from("schools")
    .select("id,status,expires_on")
    .eq("id", membership.school_id)
    .maybeSingle();

  if (schoolError) {
    throw new Error(`Unable to verify school access: ${schoolError.message}`);
  }

  if (!school) {
    throw new UnauthorizedError("Your school could not be found.");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiresOn = school.expires_on
    ? new Date(`${school.expires_on}T00:00:00`)
    : null;
  const expired =
    school.status === "suspended" ||
    (expiresOn !== null && expiresOn < today);

  if (expired) {
    throw new UnauthorizedError("Your school subscription is suspended or expired.");
  }

  return {
    admin,
    userId: user.id,
    schoolId: membership.school_id,
    role,
  };
}
