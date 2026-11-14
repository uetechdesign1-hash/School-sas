import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  DEFAULT_ENABLED_MODULES,
  parseEnabledModules,
} from "../src/lib/modules.ts";

const dataModule = (source) =>
  `data:text/javascript,${encodeURIComponent(source)}`;
const modulesUrl = new URL("../src/lib/modules.ts", import.meta.url).href;
const supabaseMock = dataModule(
  "export const createClient = () => globalThis.testAdmin;",
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/supabase-js") {
      return { url: supabaseMock, shortCircuit: true };
    }
    if (specifier === "@/lib/modules") {
      return { url: modulesUrl, shortCircuit: true };
    }
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    return nextResolve(specifier, context);
  },
});

const { POST: createSchool } = await import(
  "../src/app/api/super-admin/schools/create/route.ts"
);
const { POST: manageSchool } = await import(
  "../src/app/api/super-admin/schools/manage/route.ts"
);
const { POST: manageSchoolUser } = await import(
  "../src/app/api/super-admin/schools/users/route.ts"
);

function makeAdmin({
  existingUsers = [],
  memberships = [],
  schools = [{ id: "school-a", name: "School A", status: "active" }],
  schoolUpdateError = null,
  schoolInsertError = null,
  schoolDeleteError = null,
  auditRows = [],
  auditError = null,
  authCreateError = null,
  superAdminProfile = {
    id: "super-admin",
    platform_role: "super_admin",
    is_active: true,
  },
} = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://school.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  const state = {
    schools: schools.map((school) => ({ ...school })),
    memberships: memberships.map((membership) => ({ ...membership })),
    transportMemberships: [{ user_id: "target-user", school_id: "school-b", role: "parent" }],
  };
  const calls = {
    authDeletes: [],
    authCreates: [],
    schoolInserts: [],
    schoolDeletes: [],
    schoolUpdates: [],
    membershipDeletes: [],
    membershipUpdates: [],
  };

  function from(table) {
    let operation = "select";
    let values = null;
    const filters = [];
    const query = {
      select() {
        return query;
      },
      update(nextValues) {
        operation = "update";
        values = nextValues;
        return query;
      },
      insert(nextValues) {
        operation = "insert";
        values = nextValues;
        return query;
      },
      upsert(nextValues) {
        operation = "upsert";
        values = nextValues;
        return query;
      },
      delete() {
        operation = "delete";
        return query;
      },
      eq(column, value) {
        filters.push([column, value]);
        return query;
      },
      or() {
        return query;
      },
      limit() {
        return query;
      },
      order() {
        return query;
      },
      maybeSingle: async () => {
        const result = run();
        return {
          ...result,
          data: Array.isArray(result.data) ? result.data[0] || null : result.data,
        };
      },
      single: async () => {
        const result = run();
        return {
          ...result,
          data: Array.isArray(result.data) ? result.data[0] || null : result.data,
        };
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };

    function run() {
      const matches = (row) =>
        filters.every(([column, value]) => row[column] === value);

      if (table === "user_profiles") {
        return { data: superAdminProfile, error: null };
      }

      if (table === "schools") {
        if (operation === "insert") {
          calls.schoolInserts.push(values);
          if (schoolInsertError) return { data: null, error: schoolInsertError };
          const school = { id: "new-school", ...values };
          state.schools.push(school);
          return { data: [school], error: null };
        }
        if (operation === "update") {
          calls.schoolUpdates.push({ filters, values });
          if (schoolUpdateError) return { data: null, error: schoolUpdateError };
          const school = state.schools.find(matches);
          if (!school) return { data: [], error: null };
          Object.assign(school, values);
          return { data: [school], error: null };
        }
        if (operation === "delete") {
          calls.schoolDeletes.push(filters);
          if (schoolDeleteError) return { data: null, error: schoolDeleteError };
          state.schools = state.schools.filter((school) => !matches(school));
          return { data: [], error: null };
        }
        if (filters.length === 0) return { data: [], error: null };
        return {
          data: state.schools.filter(matches),
          error: null,
        };
      }

      if (table === "school_users") {
        if (operation === "insert") {
          state.memberships.push(values);
          return { data: [values], error: null };
        }
        if (operation === "update") {
          calls.membershipUpdates.push({ filters, values });
          const rows = state.memberships.filter(matches);
          for (const row of rows) Object.assign(row, values);
          return { data: rows, error: null };
        }
        if (operation === "delete") {
          calls.membershipDeletes.push(filters);
          state.memberships = state.memberships.filter((row) => !matches(row));
          return { data: [], error: null };
        }
        return {
          data: state.memberships.filter(matches),
          error: null,
        };
      }

      if (table === "school_subscriptions") {
        return { data: [], error: null };
      }

      if (table === "audit_logs") {
        return { data: auditError ? null : auditRows, error: auditError };
      }

      if (table === "profiles") {
        return { data: [], error: null };
      }

      throw new Error(`Unexpected table access: ${table}`);
    }

    return query;
  }

  globalThis.testAdmin = {
    from,
    auth: {
      getUser: async () => ({
        data: { user: { id: "super-admin" } },
        error: null,
      }),
      admin: {
        listUsers: async () => ({
          data: { users: existingUsers },
          error: null,
        }),
        createUser: async () => {
          calls.authCreates.push(true);
          return authCreateError
            ? { data: null, error: authCreateError }
            : { data: { user: { id: "new-owner" } }, error: null };
        },
        deleteUser: async (userId) => {
          calls.authDeletes.push(userId);
          return { error: null };
        },
      },
    },
  };

  return { state, calls };
}

function request(path, body) {
  return new Request(`https://school.test${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const validSchoolCreate = {
  schoolName: "New School",
  schoolCode: "NEW001",
  ownerName: "Owner",
  ownerEmail: "owner@example.test",
  password: "temporary-password",
  startsOn: "2026-01-01",
  expiresOn: "2027-01-01",
};

test("module lists accept only unique supported codes and preserve default onboarding", () => {
  assert.deepEqual(DEFAULT_ENABLED_MODULES, ["fees", "payroll"]);
  assert.deepEqual(parseEnabledModules(["transport"]), ["transport"]);
  assert.deepEqual(
    parseEnabledModules(["payroll", "fees"]),
    ["fees", "payroll"],
  );
  assert.equal(parseEnabledModules([]), null);
  assert.equal(parseEnabledModules(["fees", "fees"]), null);
  assert.equal(parseEnabledModules(["unknown"]), null);
});

test("school creation saves selected module combinations without changing existing schools", async () => {
  for (const enabled_modules of [
    ["transport"],
    ["fees"],
    ["payroll"],
    ["fees", "payroll"],
    ["fees", "transport"],
    ["payroll", "transport"],
    ["fees", "payroll", "transport"],
  ]) {
    const existing = { id: "school-a", name: "School A", status: "active", enabled_modules: ["fees"] };
    const { state, calls } = makeAdmin({ schools: [existing] });
    const response = await createSchool(
      request("/api/super-admin/schools/create", {
        ...validSchoolCreate,
        enabled_modules,
      }),
    );

    assert.equal(response.status, 201);
    assert.deepEqual(calls.schoolInserts[0].enabled_modules, enabled_modules);
    assert.deepEqual(state.schools[0], existing);
  }
});

test("school creation rejects an empty or unsupported module list before creating data", async () => {
  for (const enabled_modules of [[], ["fees", "unknown"], null]) {
    const { calls } = makeAdmin();
    const response = await createSchool(
      request("/api/super-admin/schools/create", {
        ...validSchoolCreate,
        enabled_modules,
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(calls.schoolInserts, []);
    assert.deepEqual(calls.authCreates, []);
  }
});

test("school creation preserves legacy module defaults and camel-case requests", async () => {
  for (const [moduleFields, expected] of [
    [{}, ["fees", "payroll"]],
    [{ enabledModules: ["transport"] }, ["transport"]],
  ]) {
    const { calls } = makeAdmin();
    const response = await createSchool(
      request("/api/super-admin/schools/create", { ...validSchoolCreate, ...moduleFields }),
    );
    assert.equal(response.status, 201);
    assert.deepEqual(calls.schoolInserts[0].enabled_modules, expected);
  }
});

test("school creation reports database rejection and denies non-Super Admins", async () => {
  const { calls } = makeAdmin({ schoolInsertError: { message: "Module selection rejected" } });
  const response = await createSchool(
    request("/api/super-admin/schools/create", { ...validSchoolCreate, enabled_modules: ["transport"] }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Module selection rejected");
  assert.deepEqual(calls.authCreates, []);

  const denied = makeAdmin({ superAdminProfile: { id: "super-admin", platform_role: "user", is_active: true } });
  const deniedResponse = await createSchool(
    request("/api/super-admin/schools/create", { ...validSchoolCreate, enabled_modules: ["transport"] }),
  );
  assert.notEqual(deniedResponse.status, 201);
  assert.deepEqual(denied.calls.schoolInserts, []);
});

test("school creation rollback retains school audit records and reports audit lookup failures", async () => {
  for (const options of [{ auditRows: [{ id: "audit-1" }] }, { auditError: { message: "audit unavailable" } }]) {
    const { state, calls } = makeAdmin({ ...options, authCreateError: { message: "Auth failure" } });
    const response = await createSchool(
      request("/api/super-admin/schools/create", { ...validSchoolCreate, enabled_modules: ["transport"] }),
    );
    const result = await response.json();
    assert.equal(response.status, 500);
    assert.match(result.error, /audit/);
    assert.deepEqual(calls.schoolDeletes, []);
    assert.ok(state.schools.some((school) => school.id === "new-school"));
  }
});

test("Super Admin module updates validate and persist the selected modules", async () => {
  const { state, calls } = makeAdmin({
    schools: [
      {
        id: "school-a",
        name: "School A",
        status: "active",
        enabled_modules: ["fees", "payroll"],
      },
    ],
  });
  const response = await manageSchool(
    request("/api/super-admin/schools/manage", {
      action: "update_modules",
      schoolId: "school-a",
      enabledModules: ["transport"],
    }),
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(state.schools[0].enabled_modules, ["transport"]);
  assert.deepEqual(calls.schoolUpdates[0].values.enabled_modules, ["transport"]);
  assert.deepEqual(result.enabledModules, ["transport"]);
});

test("school owners cannot use the Super Admin module endpoint", async () => {
  const { state, calls } = makeAdmin({
    superAdminProfile: {
      id: "super-admin",
      platform_role: "user",
      is_active: true,
    },
  });
  const response = await manageSchool(
    request("/api/super-admin/schools/manage", {
      action: "update_modules",
      schoolId: "school-a",
      enabledModules: ["transport"],
    }),
  );

  assert.equal(response.status, 500);
  assert.deepEqual(calls.schoolUpdates, []);
  assert.equal(state.schools[0].enabled_modules, undefined);
});

test("school creation preserves existing transport, parent, driver, shared, and Super Admin identities", async () => {
  for (const accountType of ["transport-only", "parent", "driver", "multi-school", "super-admin"]) {
    const { calls } = makeAdmin({
      existingUsers: [
        { id: `existing-${accountType}`, email: validSchoolCreate.ownerEmail },
      ],
    });

    const response = await createSchool(
      request("/api/super-admin/schools/create", validSchoolCreate),
    );

    assert.equal(response.status, 409, accountType);
    assert.deepEqual(calls.authDeletes, [], accountType);
    assert.deepEqual(calls.authCreates, [], accountType);
    assert.deepEqual(calls.schoolInserts, [], accountType);
  }
});

test("school-member removal deactivates only that membership", async () => {
  const { state, calls } = makeAdmin({
    schools: [
      { id: "school-a", name: "School A", status: "active" },
      { id: "school-b", name: "School B", status: "active" },
    ],
    memberships: [
      { user_id: "target-user", school_id: "school-a", role: "staff", is_active: true },
      { user_id: "target-user", school_id: "school-b", role: "admin", is_active: true },
    ],
  });

  const response = await manageSchoolUser(
    request("/api/super-admin/schools/users", {
      action: "delete",
      schoolId: "school-a",
      userId: "target-user",
    }),
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.memberships.find((row) => row.school_id === "school-a").is_active, false);
  assert.equal(state.memberships.find((row) => row.school_id === "school-b").is_active, true);
  assert.equal(state.transportMemberships.length, 1);
  assert.deepEqual(calls.authDeletes, []);
  assert.deepEqual(calls.membershipDeletes, []);
  assert.match(result.message, /Auth account and other memberships were preserved/);
});

test("school suspension preserves school records and all user memberships", async () => {
  const { state, calls } = makeAdmin({
    schools: [
      { id: "school-a", name: "School A", status: "active" },
      { id: "school-b", name: "School B", status: "active" },
    ],
    memberships: [
      { user_id: "target-user", school_id: "school-a", role: "parent", is_active: true },
      { user_id: "target-user", school_id: "school-b", role: "owner", is_active: true },
    ],
  });

  const response = await manageSchool(
    request("/api/super-admin/schools/manage", {
      action: "delete",
      schoolId: "school-a",
    }),
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.schools[0].status, "suspended");
  assert.equal(state.schools.length, 2);
  assert.equal(state.memberships.every((row) => row.is_active), true);
  assert.equal(state.transportMemberships.length, 1);
  assert.deepEqual(calls.authDeletes, []);
  assert.deepEqual(calls.schoolDeletes, []);
  assert.deepEqual(calls.membershipDeletes, []);
  assert.match(result.message, /records and all user accounts were preserved/);
});

test("inactive membership remains scoped to the requested school", async () => {
  const { state, calls } = makeAdmin({
    memberships: [
      { user_id: "target-user", school_id: "school-a", role: "staff", is_active: false },
      { user_id: "target-user", school_id: "school-b", role: "parent", is_active: true },
    ],
  });

  const response = await manageSchoolUser(
    request("/api/super-admin/schools/users", {
      action: "delete",
      schoolId: "school-a",
      userId: "target-user",
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(state.memberships.find((row) => row.school_id === "school-a").is_active, false);
  assert.equal(state.memberships.find((row) => row.school_id === "school-b").is_active, true);
  assert.deepEqual(calls.authDeletes, []);
});

test("unauthorized school context is rejected without changing membership", async () => {
  const { state, calls } = makeAdmin({
    schools: [
      { id: "school-a", name: "School A", status: "active" },
      { id: "school-b", name: "School B", status: "active" },
    ],
    memberships: [
      { user_id: "target-user", school_id: "school-a", role: "staff", is_active: true },
    ],
  });

  const response = await manageSchoolUser(
    request("/api/super-admin/schools/users", {
      action: "delete",
      schoolId: "school-b",
      userId: "target-user",
    }),
  );

  assert.equal(response.status, 404);
  assert.equal(state.memberships[0].is_active, true);
  assert.deepEqual(calls.membershipUpdates, []);
  assert.deepEqual(calls.authDeletes, []);
});

test("last active school owner cannot be deactivated", async () => {
  const { state, calls } = makeAdmin({
    memberships: [
      { user_id: "owner-user", school_id: "school-a", role: "owner", is_active: true },
    ],
  });

  const response = await manageSchoolUser(
    request("/api/super-admin/schools/users", {
      action: "delete",
      schoolId: "school-a",
      userId: "owner-user",
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(state.memberships[0].is_active, true);
  assert.deepEqual(calls.membershipUpdates, []);
});

test("failed school status update is reported and leaves the record intact", async () => {
  const { state, calls } = makeAdmin({
    schoolUpdateError: { message: "write denied" },
  });

  const response = await manageSchool(
    request("/api/super-admin/schools/manage", {
      action: "delete",
      schoolId: "school-a",
    }),
  );
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /write denied/);
  assert.equal(state.schools[0].status, "active");
  assert.deepEqual(calls.schoolDeletes, []);
});

test("school-creation rollback reports failed cleanup instead of hiding it", async () => {
  const { calls } = makeAdmin({
    schoolDeleteError: { message: "cleanup denied" },
    authCreateError: { message: "Auth creation failed" },
  });

  const response = await createSchool(
    request("/api/super-admin/schools/create", validSchoolCreate),
  );
  const result = await response.json();

  assert.equal(response.status, 500);
  assert.match(result.error, /rollback incomplete.*cleanup denied/i);
  assert.equal(calls.schoolDeletes.length, 1);
  assert.deepEqual(calls.authDeletes, []);
});

test("school creation handles a concurrent duplicate without deleting the existing identity", async () => {
  const { calls } = makeAdmin({
    authCreateError: { message: "A user with this email address has already been registered" },
  });

  const response = await createSchool(
    request("/api/super-admin/schools/create", validSchoolCreate),
  );
  const result = await response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(calls.authDeletes, []);
  assert.equal(calls.schoolDeletes.length, 1);
  assert.match(result.error, /No existing account was changed/);
});
