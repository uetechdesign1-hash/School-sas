import { createClient } from "@supabase/supabase-js";

export class SuperAdminAuthError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "SuperAdminAuthError";
    this.status = status;
  }
}

async function getPlatformUser(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    throw new SuperAdminAuthError("Authorization token is required.", 401);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase server configuration is missing.");
  }

  const authClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    throw new SuperAdminAuthError("You must be signed in as Super Admin.", 401);
  }

  const { data: profile, error: profileError } = await authClient
    .from("user_profiles")
    .select("platform_role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Unable to verify platform access: ${profileError.message}`);
  }

  const authenticated = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { authenticated, user, profile, url };
}

function withAdminClient<T extends { url: string }>(result: T) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Supabase server configuration is missing.");
  }
  const admin = createClient(result.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { ...result, admin };
}

export async function requireSuperAdmin(request: Request) {
  const result = await getPlatformUser(request);
  if (
    !result.profile ||
    result.profile.platform_role !== "super_admin" ||
    result.profile.is_active !== true
  ) {
    throw new SuperAdminAuthError("Super Admin access required.", 403);
  }
  return withAdminClient(result);
}

export async function requireSchoolCreator(request: Request) {
  const result = await getPlatformUser(request);
  if (
    !result.profile ||
    !["super_admin", "sales_rep"].includes(result.profile.platform_role) ||
    result.profile.is_active !== true
  ) {
    throw new SuperAdminAuthError(
      "School creation access is restricted to active Super Admins and authorized Sales Representatives.",
      403,
    );
  }
  return withAdminClient(result);
}
