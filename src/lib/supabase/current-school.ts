import { createClient } from "@/lib/supabase/client";

/**
 * Get the school belonging to the currently
 * authenticated Supabase user.
 *
 * IMPORTANT:
 * - No school UUID is hard-coded.
 * - Works across different schools.
 * - Uses the existing get_my_school_id() RPC first.
 * - Falls back to school_users.
 */
export async function getCurrentSchoolId(): Promise<string> {
  const supabase = createClient();

  // --------------------------------------------------
  // 1. Get authenticated user
  // --------------------------------------------------

  const {
    data: userData,
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(
      `Unable to get authenticated user: ${userError.message}`
    );
  }

  const user = userData.user;

  if (!user) {
    throw new Error(
      "No authenticated user found. Please log in again."
    );
  }

  // --------------------------------------------------
  // 2. Try central school-detection RPC
  // --------------------------------------------------

  const {
    data: rpcSchoolId,
    error: rpcError,
  } = await supabase.rpc("get_my_school_id");

  if (!rpcError && rpcSchoolId) {
    return rpcSchoolId as string;
  }

  // --------------------------------------------------
  // 3. Fallback to school_users
  // --------------------------------------------------

  const {
    data: schoolUser,
    error: schoolUserError,
  } = await supabase
    .from("school_users")
    .select(
      "school_id, is_active, created_at"
    )
    .eq(
      "user_id",
      user.id
    )
    .eq(
      "is_active",
      true
    )
    .order(
      "created_at",
      {
        ascending: true,
      }
    )
    .limit(1)
    .maybeSingle();

  if (schoolUserError) {
    throw new Error(
      `Unable to determine school: ${schoolUserError.message}`
    );
  }

  if (!schoolUser?.school_id) {
    if (rpcError) {
      throw new Error(
        `Unable to determine school: ${rpcError.message}`
      );
    }

    throw new Error(
      "Your account is not linked to an active school."
    );
  }

  return schoolUser.school_id as string;
}