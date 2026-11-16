import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthUserExistsError,
  ProvisioningError,
  processProvisioningJob,
} from "../src/lib/business/provisioning.ts";

function makeDeps(overrides = {}) {
  const calls = [];
  const state = { job: { id: "job-1", job_type: "sales_rep", status: "pending", target_email: "rep@co.test", display_name: "Rep", auth_user_id: null, payload: {}, created_at: new Date().toISOString() } };
  const deps = {
    calls,
    state,
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      if (name === "claim_provisioning_job") return state.job;
      if (name === "record_provisioned_auth_user") {
        state.job = { ...state.job, status: "auth_created", auth_user_id: args.p_auth_user_id };
      }
      return {};
    },
    async createUser(input) {
      calls.push(["createUser", input.email]);
      return { id: "auth-1" };
    },
    async inviteUser(input) {
      calls.push(["inviteUser", input.email]);
      return { id: "auth-1" };
    },
    async findUserByEmail() {
      return null;
    },
    ...overrides,
  };
  return deps;
}

const request = { jobId: "job-1", mode: "invite", redirectTo: "https://x.test/auth/update-password" };
const names = (deps) => deps.calls.map((call) => call[1]);

test("invite flow claims, creates the login, records it, then completes", async () => {
  const deps = makeDeps();
  const result = await processProvisioningJob(deps, request);
  assert.equal(result.status, "completed");
  assert.equal(result.invited, true);
  assert.deepEqual(names(deps), ["claim_provisioning_job", "rep@co.test", "record_provisioned_auth_user", "complete_provisioning_job"]);
});

test("a retry reuses the stored login and never creates a second account", async () => {
  const deps = makeDeps();
  deps.state.job = { ...deps.state.job, status: "auth_created", auth_user_id: "auth-existing" };
  const result = await processProvisioningJob(deps, request);
  assert.equal(result.authUserId, "auth-existing");
  assert.ok(!names(deps).includes("rep@co.test"), "no createUser / inviteUser call");
  assert.ok(!names(deps).includes("record_provisioned_auth_user"));
  assert.ok(names(deps).includes("complete_provisioning_job"));
});

test("an already completed job is a no-op", async () => {
  const deps = makeDeps();
  deps.state.job = { ...deps.state.job, status: "completed", auth_user_id: "auth-9" };
  const result = await processProvisioningJob(deps, request);
  assert.equal(result.alreadyCompleted, true);
  assert.deepEqual(names(deps), ["claim_provisioning_job"]);
});

test("a crash after the Auth call keeps the job retryable and reports the failure", async () => {
  const deps = makeDeps({
    async rpc(name, args) {
      deps.calls.push(["rpc", name, args]);
      if (name === "claim_provisioning_job") return deps.state.job;
      if (name === "record_provisioned_auth_user") throw new Error("database unavailable");
      return {};
    },
  });
  await assert.rejects(() => processProvisioningJob(deps, request), (error) => {
    assert.ok(error instanceof ProvisioningError);
    assert.match(error.message, /database unavailable/);
    return true;
  });
  assert.ok(names(deps).includes("fail_provisioning_job"), "failure is recorded on the job");
  assert.ok(!names(deps).includes("complete_provisioning_job"));
});

test("an Auth failure is recorded and surfaced", async () => {
  const deps = makeDeps({
    async inviteUser() {
      throw new Error("smtp down");
    },
  });
  await assert.rejects(() => processProvisioningJob(deps, request), /smtp down/);
  const fail = deps.calls.find((call) => call[1] === "fail_provisioning_job");
  assert.equal(fail[2].p_error, "smtp down");
});

test("an unrelated pre-existing login is never adopted", async () => {
  const deps = makeDeps({
    async inviteUser() {
      throw new AuthUserExistsError();
    },
    async findUserByEmail() {
      return { id: "old-user", createdAt: "2020-01-01T00:00:00Z" };
    },
  });
  await assert.rejects(() => processProvisioningJob(deps, request), (error) => {
    assert.equal(error.status, 409);
    return true;
  });
  assert.ok(!names(deps).includes("record_provisioned_auth_user"));
});

test("a login created by an earlier attempt of the same job is adopted", async () => {
  const deps = makeDeps({
    async inviteUser() {
      throw new AuthUserExistsError();
    },
    async findUserByEmail() {
      return { id: "auth-from-crash", createdAt: new Date(Date.now() + 1000).toISOString() };
    },
  });
  const result = await processProvisioningJob(deps, request);
  assert.equal(result.authUserId, "auth-from-crash");
  const record = deps.calls.find((call) => call[1] === "record_provisioned_auth_user");
  assert.equal(record[2].p_auth_user_id, "auth-from-crash");
});

test("password mode needs a strong enough password and never invites", async () => {
  const deps = makeDeps();
  await assert.rejects(() => processProvisioningJob(deps, { ...request, mode: "password", temporaryPassword: "short" }), /8 characters/);
  assert.equal(deps.calls.length, 0, "nothing is claimed before validation");

  const ok = makeDeps();
  const result = await processProvisioningJob(ok, { ...request, mode: "password", temporaryPassword: "longenough1" });
  assert.equal(result.invited, false);
  assert.ok(names(ok).includes("rep@co.test"));
});

test("a job that is leased by another worker is rejected with 409", async () => {
  const deps = makeDeps({
    async rpc() {
      throw new Error("already being processed");
    },
  });
  await assert.rejects(() => processProvisioningJob(deps, request), (error) => {
    assert.equal(error.status, 409);
    return true;
  });
});
