import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type StudentImportAuth = {
  admin: SupabaseClient;
  userId: string;
  schoolId: string;
  role: string;
};

/**
 * Roles permitted to import students. Student record management is a school
 * administration function, so only owner and admin are authorized. The
 * accountant role is reserved for financial operations (fee collection,
 * journal entries) per the established project convention.
 */
export const AUTHORIZED_IMPORT_ROLES = ["owner", "admin"];

/**
 * Pure helper: returns true when a school_users role is authorized for student import.
 */
export function isAuthorizedImportRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return AUTHORIZED_IMPORT_ROLES.includes(String(role).trim().toLowerCase());
}

/**
 * Error thrown when the caller is not authenticated. Callers should respond with HTTP 401.
 */
export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * Error thrown when the caller is authenticated but not authorized. Callers should respond with HTTP 403.
 */
export class UnauthorizedError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Authenticate and authorize a student-import API request.
 *
 * - Verifies the Supabase bearer token (HTTP 401 when missing/invalid).
 * - Requires an active school_users membership (HTTP 403 when none).
 * - Requires an authorized role (owner or admin) for that school (HTTP 403 otherwise).
 * - Resolves the school from the verified membership; never trusts request-body school_id.
 * - When a user has multiple active memberships, selects the first membership
 *   (by created_at) that carries an authorized role.
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
    throw new UnauthenticatedError("Authorization token is required.");
  }

  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);

  if (authError || !user) {
    throw new UnauthenticatedError("You must be signed in to import students.");
  }

  const { data: memberships, error: membershipError } = await admin
    .from("school_users")
    .select("school_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw new Error(
      `Unable to determine your school: ${membershipError.message}`,
    );
  }

  if (!memberships || memberships.length === 0) {
    throw new UnauthorizedError(
      "Your account is not linked to an active school.",
    );
  }

  const authorizedMembership = memberships.find((m) =>
    isAuthorizedImportRole(m.role),
  );

  if (!authorizedMembership) {
    throw new UnauthorizedError(
      "Your account does not have an authorized role for student import.",
    );
  }

  return {
    admin,
    userId: user.id,
    schoolId: authorizedMembership.school_id as string,
    role: String(authorizedMembership.role || "").trim().toLowerCase(),
  };
}