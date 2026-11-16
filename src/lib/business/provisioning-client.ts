import type { SupabaseClient } from "@supabase/supabase-js";

export type ProvisionOutcome = { ok: true; invited: boolean } | { ok: false; error: string };

/** Calls the provisioning route with the signed-in user's session token. */
export async function runProvisioningJob(
  supabase: SupabaseClient,
  jobId: string,
  mode: "invite" | "password",
  temporaryPassword?: string,
): Promise<ProvisionOutcome> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "Your session has expired. Sign in again." };

  const response = await fetch("/api/business/provisioning/process", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ jobId, mode, temporaryPassword }),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; invited?: boolean };
  if (!response.ok || !result.success) {
    return { ok: false, error: result.error || "Unable to create the login." };
  }
  return { ok: true, invited: Boolean(result.invited) };
}
