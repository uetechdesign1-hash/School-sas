import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AuthUserExistsError,
  ProvisioningError,
  processProvisioningJob,
  type ProvisioningMode,
} from "@/lib/business/provisioning";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function userClient(token: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// The service-role client is used ONLY for the Auth Admin API below. Every
// database read and write goes through the caller's own JWT, so authorisation
// is decided by the database (RLS + SECURITY DEFINER checks), not by this key.
function authAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function isAlreadyRegistered(error: { message?: string; status?: number; code?: string }) {
  return (
    error.code === "email_exists" ||
    error.status === 422 ||
    /already (been )?registered|already exists/i.test(error.message ?? "")
  );
}

/**
 * Drives a provisioning job (sales representative login or school owner login)
 * to completion. Safe to call repeatedly for the same job.
 */
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return json({ success: false, error: "Authorization token is required." }, 401);

    const body = (await request.json().catch(() => ({}))) as {
      jobId?: unknown;
      mode?: unknown;
      temporaryPassword?: unknown;
    };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    const mode: ProvisioningMode = body.mode === "password" ? "password" : "invite";
    const temporaryPassword = typeof body.temporaryPassword === "string" ? body.temporaryPassword : undefined;
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ success: false, error: "A valid job id is required." }, 400);

    const db = userClient(token);
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return json({ success: false, error: "You must be signed in." }, 401);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
    let admin: SupabaseClient | null = null;
    const getAdmin = () => (admin ??= authAdminClient());

    const result = await processProvisioningJob(
      {
        async rpc(name, args) {
          const { data, error } = await db.rpc(name, args);
          if (error) throw new Error(error.message);
          return data as never;
        },
        async createUser({ email, password, fullName, accountType }) {
          const { data, error } = await getAdmin().auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName },
            app_metadata: { account_type: accountType },
          });
          if (error) {
            if (isAlreadyRegistered(error)) throw new AuthUserExistsError();
            throw new Error(error.message);
          }
          return { id: data.user.id };
        },
        async inviteUser({ email, fullName, redirectTo, accountType }) {
          const { data, error } = await getAdmin().auth.admin.inviteUserByEmail(email, {
            redirectTo,
            data: { full_name: fullName, account_type: accountType },
          });
          if (error) {
            if (isAlreadyRegistered(error)) throw new AuthUserExistsError();
            throw new Error(error.message);
          }
          return { id: data.user.id };
        },
        async findUserByEmail(email) {
          for (let page = 1; page <= 20; page += 1) {
            const { data, error } = await getAdmin().auth.admin.listUsers({ page, perPage: 1000 });
            if (error) throw new Error(error.message);
            const found = data.users.find((user) => user.email?.trim().toLowerCase() === email);
            if (found) return { id: found.id, createdAt: found.created_at };
            if (data.users.length < 1000) break;
          }
          return null;
        },
      },
      { jobId, mode, temporaryPassword, redirectTo: `${baseUrl}/auth/update-password` },
    );

    return json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ProvisioningError) {
      return json({ success: false, error: error.message }, error.status);
    }
    console.error("PROVISIONING ERROR:", error);
    return json({ success: false, error: error instanceof Error ? error.message : "Provisioning failed." }, 500);
  }
}
