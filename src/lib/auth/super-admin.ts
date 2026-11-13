import { createClient } from "@supabase/supabase-js";

export class SuperAdminAuthError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "SuperAdminAuthError";
    this.status = status;
  }
}

export async function requireSuperAdmin(request: Request) {
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
    throw new Error(`Unable to verify Super Admin access: ${profileError.message}`);
  }
  if (!profile || profile.platform_role !== "super_admin" || profile.is_active !== true) {
    throw new SuperAdminAuthError("Super Admin access required.", 403);
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Supabase server configuration is missing.");
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { admin, user };
}
