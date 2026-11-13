import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(
        new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});

const { POST: createSchool } = await import("../src/app/api/super-admin/schools/create/route.ts");
const { POST: manageSchool } = await import("../src/app/api/super-admin/schools/manage/route.ts");

async function withSupabase(profile, callback, options = {}) {
  const previousFetch = globalThis.fetch;
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://school-modules-test.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const method = init?.method || "GET";
    requests.push({ url, method, headers, body: init?.body });
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: "user-1" });
    }
    if (url.pathname === "/rest/v1/user_profiles" && method === "GET") {
      return Response.json(profile);
    }
    if (url.pathname === "/rest/v1/schools" && method === "GET") {
      return Response.json(options.deleting
        ? [{ id: "school-1", name: "Example", code: "EXAMPLE", school_code: "EXAMPLE" }]
        : []);
    }
    if (url.pathname === "/auth/v1/admin/users" && method === "GET") {
      return Response.json({ users: [] });
    }
    if (url.pathname === "/auth/v1/admin/users" && method === "POST") {
      return Response.json({ id: "owner-1", email: "owner@example.test" });
    }
    if (url.pathname === "/rest/v1/schools" && method === "POST") {
      return Response.json({ id: "school-1", name: "Example", code: "EXAMPLE" }, { status: 201 });
    }
    if (url.pathname === "/rest/v1/schools" && method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE" && options.deleting && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").pop();
      const error = options.tableErrors?.[table];
      if (error) return Response.json(error, { status: 400 });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/rest/v1/school_users") {
      return method === "GET"
        ? Response.json(options.deleting ? [{ user_id: "11111111-1111-4111-8111-111111111111" }] : [])
        : new Response(null, { status: 201 });
    }
    if (url.pathname === "/rest/v1/staff" && method === "GET" && options.deleting) {
      return Response.json([]);
    }
    if (url.pathname === "/auth/v1/admin/users/11111111-1111-4111-8111-111111111111" && method === "DELETE" && options.deleting) {
      return Response.json({});
    }
    if (["/rest/v1/user_profiles", "/rest/v1/profiles", "/rest/v1/school_subscriptions"].includes(url.pathname)) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  try {
    await callback(requests);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(body, token = "valid-token") {
  return new Request("https://school-modules-test.invalid/api", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const admin = { platform_role: "super_admin", is_active: true };
const update = { action: "update", schoolId: "school-1", school: {
  name: "Example", code: "EXAMPLE", student_limit: 300,
} };

test("both endpoints reject non-super-admin and inactive super-admin callers before privileged access", async () => {
  for (const profile of [
    { platform_role: "user", is_active: true },
    { platform_role: "super_admin", is_active: false },
  ]) {
    for (const handler of [createSchool, manageSchool]) {
      await withSupabase(profile, async (requests) => {
        const response = await handler(request({ ...update, modules: ["fees"] }));
        assert.equal(response.status, 403);
        assert.match((await response.json()).error, /Super Admin access required/);
        assert.equal(requests.length, 2);
        assert.ok(requests.every(({ headers }) => headers.get("apikey") === "publishable-test-key"));
      });
    }
  }
});

test("both endpoints reject invalid module selections before modifying a school", async () => {
  for (const modules of [[], ["unknown"], ["fees", "fees"], null]) {
    for (const handler of [createSchool, manageSchool]) {
      await withSupabase(admin, async (requests) => {
        const response = await handler(request({ ...update, modules }));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /module/i);
        assert.equal(requests.some(({ url }) => url.pathname === "/rest/v1/schools"), false);
      });
    }
  }
});

test("update saves validated modules and a fixed legacy plan", async () => {
  await withSupabase(admin, async (requests) => {
    const response = await manageSchool(request({
      ...update,
      modules: ["transport", "fees"],
      school: { ...update.school, plan_code: "untrusted" },
    }));
    assert.equal(response.status, 200);
    const write = requests.find(({ url, method }) => url.pathname === "/rest/v1/schools" && method === "PATCH");
    const body = JSON.parse(write.body);
    assert.deepEqual(body.enabled_modules, ["transport", "fees"]);
    assert.equal(body.plan_code, "starter");
    assert.equal(write.headers.get("apikey"), "service-role-test-key");
  });
});

test("create saves validated modules and ignores an untrusted legacy plan", async () => {
  await withSupabase(admin, async (requests) => {
    const response = await createSchool(request({
      schoolName: "Example",
      schoolCode: "EXAMPLE",
      ownerName: "Owner",
      ownerEmail: "owner@example.test",
      password: "example-password",
      startsOn: "2026-01-01",
      expiresOn: "2027-01-01",
      modules: ["payroll", "transport"],
      planCode: "untrusted",
    }));
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const write = requests.find(({ url, method }) => url.pathname === "/rest/v1/schools" && method === "POST");
    const body = JSON.parse(write.body);
    assert.deepEqual(body.enabled_modules, ["payroll", "transport"]);
    assert.equal(body.plan_code, "starter");
    assert.equal(write.headers.get("apikey"), "service-role-test-key");
  });
});

test("school deletion removes audit logs and skips only missing tables", async () => {
  await withSupabase(admin, async (requests) => {
    const response = await manageSchool(request({ action: "delete", schoolId: "school-1" }));
    assert.equal(response.status, 200);
    const deletions = requests.filter(({ method }) => method === "DELETE");
    const auditIndex = deletions.findIndex(({ url }) => url.pathname === "/rest/v1/audit_logs");
    const schoolIndex = deletions.findIndex(({ url }) => url.pathname === "/rest/v1/schools");
    assert.ok(auditIndex >= 0 && schoolIndex > auditIndex);
    assert.equal(deletions[auditIndex].url.searchParams.get("school_id"), "eq.school-1");
    assert.ok(deletions.some(({ url }) => url.pathname === "/auth/v1/admin/users/11111111-1111-4111-8111-111111111111"));
  }, {
    deleting: true,
    tableErrors: {
      transport_routes: { code: "42P01", message: 'relation "public.transport_routes" does not exist' },
      library_books: { code: "PGRST205", message: "Could not find the table 'public.library_books' in the schema cache" },
    },
  });
});

test("school deletion reports cleanup failures and leaves the school and logins intact", async () => {
  await withSupabase(admin, async (requests) => {
    const response = await manageSchool(request({ action: "delete", schoolId: "school-1" }));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.match(body.error, /some data may already have been deleted/);
    assert.match(body.error, /audit_logs: permission denied/);
    assert.match(body.error, /fee_payments: relation "other_table" does not exist/);
    assert.deepEqual(body.cleanupErrors.map(({ table }) => table), ["audit_logs", "fee_payments"]);
    assert.equal(requests.some(({ method, url }) =>
      method === "DELETE" && (url.pathname === "/rest/v1/schools" || url.pathname.startsWith("/auth/v1/admin/users/")),
    ), false);
  }, {
    deleting: true,
    tableErrors: {
      audit_logs: { code: "42501", message: "permission denied" },
      fee_payments: { code: "42P01", message: 'relation "other_table" does not exist' },
    },
  });
});
