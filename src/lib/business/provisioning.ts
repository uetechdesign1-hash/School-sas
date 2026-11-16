// Resumable Supabase Auth provisioning used by the sales-rep and school-owner
// workflows. The database holds the durable job state (business_provisioning_jobs);
// this module only orchestrates the Auth Admin call, so it is dependency-injected
// and runs unchanged under unit tests.

export type ProvisioningMode = "invite" | "password";

export type ProvisioningJobRecord = {
  id: string;
  job_type: "sales_rep" | "school_owner";
  status: string;
  target_email: string;
  display_name: string | null;
  auth_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export class AuthUserExistsError extends Error {
  constructor(message = "A login with this email already exists.") {
    super(message);
    this.name = "AuthUserExistsError";
  }
}

export class ProvisioningError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ProvisioningError";
    this.status = status;
  }
}

export type ProvisioningDeps = {
  rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
  createUser(input: { email: string; password: string; fullName: string; accountType: string }): Promise<{ id: string }>;
  inviteUser(input: { email: string; fullName: string; redirectTo: string; accountType: string }): Promise<{ id: string }>;
  findUserByEmail(email: string): Promise<{ id: string; createdAt: string } | null>;
};

export type ProvisioningRequest = {
  jobId: string;
  mode: ProvisioningMode;
  temporaryPassword?: string;
  redirectTo: string;
};

export type ProvisioningResult = {
  status: "completed";
  authUserId: string | null;
  invited: boolean;
  alreadyCompleted: boolean;
};

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unexpected provisioning error.";
}

/**
 * Drives one job to completion. Every step is idempotent: the stored Auth user
 * id is reused on retries, so a crash between the Auth call and the database
 * never leaves an orphaned or duplicate login.
 */
export async function processProvisioningJob(
  deps: ProvisioningDeps,
  request: ProvisioningRequest,
): Promise<ProvisioningResult> {
  const { jobId, mode, temporaryPassword, redirectTo } = request;

  if (mode === "password" && (temporaryPassword ?? "").length < 8) {
    throw new ProvisioningError("A temporary password of at least 8 characters is required.", 400);
  }

  let job: ProvisioningJobRecord;
  try {
    job = await deps.rpc<ProvisioningJobRecord>("claim_provisioning_job", { p_job_id: jobId });
  } catch (error) {
    throw new ProvisioningError(messageOf(error), 409);
  }

  if (job.status === "completed") {
    return { status: "completed", authUserId: job.auth_user_id, invited: false, alreadyCompleted: true };
  }

  const fail = async (error: unknown, status = 500): Promise<never> => {
    const message = messageOf(error);
    try {
      await deps.rpc("fail_provisioning_job", { p_job_id: jobId, p_error: message });
    } catch {
      // The job keeps its lease and becomes retryable when it expires.
    }
    throw new ProvisioningError(message, status);
  };

  const accountType = job.job_type === "sales_rep" ? "sales_rep" : "school_owner";
  const fullName = job.display_name ?? job.target_email;
  let authUserId = job.auth_user_id;
  let invited = false;

  if (!authUserId) {
    try {
      const created =
        mode === "password"
          ? await deps.createUser({ email: job.target_email, password: temporaryPassword as string, fullName, accountType })
          : await deps.inviteUser({ email: job.target_email, fullName, redirectTo, accountType });
      authUserId = created.id;
      invited = mode === "invite";
    } catch (error) {
      if (!(error instanceof AuthUserExistsError)) return fail(error);

      // A previous attempt may have created the login and crashed before the
      // database link was stored. Adopt it only if it was created after the
      // job started; never adopt a pre-existing, unrelated account.
      const existing = await deps.findUserByEmail(job.target_email).catch(() => null);
      const jobStarted = Date.parse(job.created_at) - 2000;
      if (!existing || !(Date.parse(existing.createdAt) >= jobStarted)) {
        return fail(
          new Error("A login with this email already exists. Use a different email or remove the unused login first."),
          409,
        );
      }
      authUserId = existing.id;
    }

    try {
      await deps.rpc("record_provisioned_auth_user", { p_job_id: jobId, p_auth_user_id: authUserId });
    } catch (error) {
      return fail(error);
    }
  }

  try {
    await deps.rpc("complete_provisioning_job", { p_job_id: jobId });
  } catch (error) {
    return fail(error);
  }

  return { status: "completed", authUserId, invited, alreadyCompleted: false };
}
