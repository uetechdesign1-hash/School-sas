import type { SupabaseClient } from "@supabase/supabase-js";

export async function getTransportMemberships(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("transport_users")
    .select("role, school_id, created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .order("school_id", { ascending: true })
    .order("role", { ascending: true });
  if (error) throw new Error(`Unable to verify transport membership: ${error.message}`);
  return data || [];
}

