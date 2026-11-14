import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const mockSupabase = `data:text/javascript,${encodeURIComponent(
  "export const createClient = (...args) => globalThis.edgeCreateClient(...args);",
)}`;
const mockCors = `data:text/javascript,${encodeURIComponent("export const corsHeaders = {};")}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "npm:@supabase/supabase-js@2") return { url: mockSupabase, shortCircuit: true };
    if (specifier === "npm:@supabase/supabase-js@2/cors") return { url: mockCors, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const handlers = [];
const env = {
  SUPABASE_URL: "https://school.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  SUPABASE_ANON_KEY: "test-public",
};
globalThis.Deno = { env: { get: (name) => env[name] }, serve: (handler) => handlers.push(handler) };

function setup({ active = true, role = "super_admin", authCreateError = null, existingUsers = [], auditRows = [] } = {}) {
  const calls = { schoolInserts: [], schoolDeletes: [], authCreates: [], authDeletes: [], clients: [] };
  function from(table) {
    let operation = "select";
    let value;
    const query = {
      select() { return query; },
      eq() { return query; },
      ilike() { return query; },
      or() { return query; },
      limit() { return query; },
      insert(data) { operation = "insert"; value = data; return query; },
      upsert(data) { operation = "upsert"; value = data; return query; },
      delete() { operation = "delete"; return query; },
      async maybeSingle() { return result(true); },
      async single() { return result(true); },
      then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
    };
    function result(single) {
      if (table === "schools" && operation === "insert") {
        calls.schoolInserts.push(value);
        return { data: { id: "new-school", name: value.name, code: value.code, school_code: value.school_code }, error: null };
      }
      if (table === "schools" && operation === "delete") calls.schoolDeletes.push(true);
      if (table === "audit_logs") return { data: auditRows, error: null };
      if (table === "user_profiles" && operation === "select") {
        return { data: { platform_role: role, is_active: active }, error: null };
      }
      return { data: single ? null : [], error: null };
    }
    return query;
  }
  const client = {
    from,
    auth: {
      getUser: async () => ({ data: { user: { id: "super-admin" } }, error: null }),
      admin: {
        listUsers: async () => ({ data: { users: existingUsers }, error: null }),
        createUser: async (value) => {
          calls.authCreates.push(value);
          return authCreateError
            ? { data: { user: null }, error: { message: authCreateError } }
            : { data: { user: { id: "new-owner" } }, error: null };
        },
        deleteUser: async (id) => { calls.authDeletes.push(id); return { error: null }; },
      },
    },
  };
  globalThis.edgeClient = client;
  globalThis.edgeCreateClient = (url, key, options) => {
    calls.clients.push({ url, key, options });
    return {
      from: (...args) => globalThis.edgeClient.from(...args),
      auth: {
        getUser: (...args) => globalThis.edgeClient.auth.getUser(...args),
        admin: {
          listUsers: (...args) => globalThis.edgeClient.auth.admin.listUsers(...args),
          createUser: (...args) => globalThis.edgeClient.auth.admin.createUser(...args),
          deleteUser: (...args) => globalThis.edgeClient.auth.admin.deleteUser(...args),
        },
      },
    };
  };
  return calls;
}

setup();
await import("../supabase/functions/create-school-owner/index.ts");
await import("../supabase/functions/create-school/index.ts");
const [ownerHandler, deployedReplacementHandler] = handlers;

const ownerBody = {
  schoolName: "School", schoolCode: "TEST001", ownerName: "Owner",
  phone: "1234567890", password: "password123", startsOn: "2026-01-01",
  expiresOn: "2027-01-01",
};
const replacementBody = {
  school_name: "School", school_code: "TEST001", owner_name: "Owner",
  owner_email: "owner@example.test", owner_password: "password123",
};
function request(body) {
  return new Request("https://school.test/create", {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("both Edge paths validate and save every module combination with the actor JWT", async () => {
  for (const [handler, body] of [[ownerHandler, ownerBody], [deployedReplacementHandler, replacementBody]]) {
    for (const modules of [
      ["fees"], ["payroll"], ["transport"], ["fees", "payroll"],
      ["fees", "transport"], ["payroll", "transport"], ["fees", "payroll", "transport"],
    ]) {
      const calls = setup();
      const response = await handler(request({ ...body, enabled_modules: modules }));
      assert.equal(response.status, handler === ownerHandler ? 201 : 200);
      assert.deepEqual(calls.schoolInserts[0].enabled_modules, modules);
      assert.equal(calls.schoolInserts[0].code, "TEST001");
      assert.ok(calls.clients.some((client) => client.key === "test-public" &&
        client.options.global?.headers.Authorization === "Bearer test-token"));
    }
  }
});

test("both Edge paths preserve omitted-list defaults and reject invalid selections before writes", async () => {
  for (const [handler, body] of [[ownerHandler, ownerBody], [deployedReplacementHandler, replacementBody]]) {
    let calls = setup();
    assert.ok((await handler(request(body))).ok);
    assert.deepEqual(calls.schoolInserts[0].enabled_modules, ["fees", "payroll"]);
    for (const modules of [null, [], ["fees", "fees"], ["unknown"]]) {
      calls = setup();
      assert.equal((await handler(request({ ...body, enabled_modules: modules }))).status, 400);
      assert.deepEqual(calls.schoolInserts, []);
      assert.deepEqual(calls.authCreates, []);
    }
  }
});

test("both Edge paths reject unauthorized users before creating records", async () => {
  for (const [handler, body] of [[ownerHandler, ownerBody], [deployedReplacementHandler, replacementBody]]) {
    const calls = setup({ role: "user" });
    assert.equal((await handler(request(body))).status, 403);
    assert.deepEqual(calls.schoolInserts, []);
    assert.deepEqual(calls.authCreates, []);
  }
});

test("replacement retains partial school and reports an existing-email conflict without deleting users", async () => {
  const calls = setup({ authCreateError: "User already registered" });
  const response = await deployedReplacementHandler(request({ ...replacementBody, enabled_modules: ["transport"] }));
  const result = await response.json();
  assert.equal(response.status, 500);
  assert.match(result.error, /retained for Super Admin review/);
  assert.equal(result.schoolId, "new-school");
  assert.deepEqual(calls.authDeletes, []);
});

test("replacement rejects an existing owner before creating a school", async () => {
  const calls = setup({ existingUsers: [{ email: "owner@example.test" }] });
  const response = await deployedReplacementHandler(request(replacementBody));
  assert.equal(response.status, 409);
  assert.deepEqual(calls.schoolInserts, []);
  assert.deepEqual(calls.authDeletes, []);
});

test("legacy rollback does not delete a school with audit records", async () => {
  const calls = setup({ authCreateError: "Auth failure", auditRows: [{ id: "audit-1" }] });
  const response = await ownerHandler(request({ ...ownerBody, enabled_modules: ["transport"] }));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /preserve audit records/);
  assert.deepEqual(calls.schoolDeletes, []);
});

test("legacy code-based owner identity remains unchanged", async () => {
  const calls = setup();
  assert.equal((await ownerHandler(request(ownerBody))).status, 201);
  assert.equal(calls.authCreates[0].email, "test001@login.schoolerp.local");
});
