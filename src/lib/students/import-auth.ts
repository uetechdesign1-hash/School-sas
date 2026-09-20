import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type StudentImportAuth = {
  admin: SupabaseClient;
  userId: string;
  schoolId: string;
};

/**
 * Authenticate a student-import API request.
 *
 * - Verifies the Supabase bearer token.
 * - Requires an active account.
 * - Resolves the school the user belongs to via public.school_users.
 */
export async function getStudentImportAuth(
  request: Request,
): Promise<StudentImportAuth> {
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
    throw new Error("You must be signed in to import students.");
  }

  const { data: membership, error: membershipError } = await admin
    .from("school_users")
    .select("school_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    throw new Error(
      `Unable to determine your school: ${membershipError.message}`,
    );
  }

  if (!membership?.school_id) {
    throw new Error("Your account is not linked to an active school.");
  }

  return {
    admin,
    userId: user.id,
    schoolId: membership.school_id as string,
  };
}