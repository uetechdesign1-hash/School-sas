import assert from "node:assert/strict";
import test from "node:test";
import {
  requireSchoolRole,
  UnauthenticatedError,
  UnauthorizedError,
} from "../src/lib/auth/server.ts";

async function withSupabase(fetchHandler, callback) {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://school-auth-test.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  globalThis.fetch = fetchHandler;

  try {
    return await callback();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnv.url === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousEnv.url;
    }
    if (previousEnv.publishableKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousEnv.publishableKey;
    }
    if (previousEnv.serviceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousEnv.serviceRoleKey;
    }
  }
}

function createFetch({ memberships = [], school, invalidToken = false }) {
  const requests = [];

  const fetchHandler = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url, init });

    if (url.pathname === "/auth/v1/user") {
      if (invalidToken) {
        return Response.json({ message: "Invalid token" }, { status: 401 });
      }

      return Response.json({
        id: "user-1",
        aud: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
      });
    }

    if (url.pathname === "/rest/v1/school_users") {
      assert.equal(url.searchParams.get("user_id"), "eq.user-1");
      assert.equal(url.searchParams.get("is_active"), "eq.true");
      assert.match(url.searchParams.get("order"), /created_at\.asc/);

      const sorted = [...memberships].sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) ||
          a.school_id.localeCompare(b.school_id),
      );
      return Response.json(sorted);
    }

    if (url.pathname === "/rest/v1/schools") {
      return Response.json(school);
    }

    return Response.json({ message: `Unexpected request: ${url}` }, { status: 500 });
  };

  return { fetchHandler, requests };
}

function bearerRequest(authorization = "Bearer valid-token") {
  return new Request("https://school-auth-test.invalid/api", {
    headers: authorization ? { authorization } : {},
  });
}

test("authenticates, selects the oldest active membership, and returns its school role", async () => {
  const mock = createFetch({
    memberships: [
      {
        school_id: "school-new",
        role: "admin",
        created_at: "2026-02-01T00:00:00.000Z",
      },
      {
        school_id: "school-old",
        role: "owner",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    school: { id: "school-old", status: "active", expires_on: null },
  });

  await withSupabase(mock.fetchHandler, async () => {
    const auth = await requireSchoolRole(bearerRequest(), ["OWNER"]);

    assert.equal(auth.userId, "user-1");
    assert.equal(auth.schoolId, "school-old");
    assert.equal(auth.role, "owner");
    assert.ok(auth.admin);
    assert.equal(mock.requests[0].url.pathname, "/auth/v1/user");
    assert.equal(mock.requests[1].url.pathname, "/rest/v1/school_users");
    assert.equal(mock.requests[2].url.pathname, "/rest/v1/schools");
  });
});

test("requires a bearer token and rejects invalid tokens with 401 errors", async () => {
  const missingTokenMock = createFetch({});
  await withSupabase(missingTokenMock.fetchHandler, async () => {
    await assert.rejects(
      requireSchoolRole(bearerRequest(""), ["owner"]),
      (error) => error instanceof UnauthenticatedError && error.status === 401,
    );
    assert.equal(missingTokenMock.requests.length, 0);
  });

  const invalidTokenMock = createFetch({ invalidToken: true });
  await withSupabase(invalidTokenMock.fetchHandler, async () => {
    await assert.rejects(
      requireSchoolRole(bearerRequest(), ["owner"]),
      (error) => error instanceof UnauthenticatedError && error.status === 401,
    );
    assert.equal(invalidTokenMock.requests.length, 1);
    assert.equal(invalidTokenMock.requests[0].url.pathname, "/auth/v1/user");
  });
});

test("rejects accounts without an active school membership with 403", async () => {
  const mock = createFetch({ memberships: [] });
  await withSupabase(mock.fetchHandler, async () => {
    await assert.rejects(
      requireSchoolRole(bearerRequest(), ["owner"]),
      (error) => error instanceof UnauthorizedError && error.status === 403,
    );
  });
});

test("checks the oldest membership role before considering later memberships", async () => {
  const mock = createFetch({
    memberships: [
      {
        school_id: "school-new",
        role: "owner",
        created_at: "2026-02-01T00:00:00.000Z",
      },
      {
        school_id: "school-old",
        role: "staff",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  await withSupabase(mock.fetchHandler, async () => {
    await assert.rejects(
      requireSchoolRole(bearerRequest(), ["owner"]),
      (error) => error instanceof UnauthorizedError && error.status === 403,
    );
    assert.equal(mock.requests.some(({ url }) => url.pathname === "/rest/v1/schools"), false);
  });
});

test("rejects suspended and expired schools with 403", async () => {
  for (const school of [
    { id: "school-old", status: "suspended", expires_on: null },
    { id: "school-old", status: "active", expires_on: "2020-01-01" },
  ]) {
    const mock = createFetch({
      memberships: [
        {
          school_id: "school-old",
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      school,
    });

    await withSupabase(mock.fetchHandler, async () => {
      await assert.rejects(
        requireSchoolRole(bearerRequest(), ["owner"]),
        (error) => error instanceof UnauthorizedError && error.status === 403,
      );
    });
  }
});
