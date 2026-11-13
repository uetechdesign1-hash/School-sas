import assert from "node:assert/strict";
import test from "node:test";
import { getLoginRecycleConflict } from "../src/lib/auth/login-recycle.ts";

function mockAdmin({ profile, activeMemberships = [], memberships = [], schools = [] }) {
  const calls = [];

  return {
    calls,
    from(table) {
      const filters = {};
      let selected;
      const query = {
        select(columns) {
          selected = columns;
          return query;
        },
        eq(column, value) {
          filters[column] = value;
          return query;
        },
        in(column, values) {
          filters[column] = values;
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          calls.push({ table, selected, filters });
          return Promise.resolve({ data: profile, error: null });
        },
        then(resolve, reject) {
          calls.push({ table, selected, filters });
          const data =
            table === "school_users"
              ? filters.is_active === true
                ? activeMemberships
                : memberships
              : table === "schools"
                ? schools.filter((school) => filters.id.includes(school.id))
                : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    }
  };
}

test("does not recycle a Super Admin login", async () => {
  const admin = mockAdmin({
    profile: { platform_role: "super_admin" },
  });

  assert.match(
    await getLoginRecycleConflict(admin, "user-1", "owner@example.test"),
    /Super Admin/,
  );
  assert.equal(admin.calls.some(({ table }) => table === "school_users"), false);
});

test("does not recycle a login linked to an existing school by an inactive membership", async () => {
  const admin = mockAdmin({
    profile: { platform_role: "user" },
    memberships: [{ school_id: "school-1" }],
    schools: [{ id: "school-1" }],
  });

  assert.match(
    await getLoginRecycleConflict(admin, "user-1", "owner@example.test"),
    /still linked to an existing school/,
  );
  assert.ok(admin.calls.some(({ table }) => table === "schools"));
});

test("allows recycling when remaining memberships do not point to an existing school", async () => {
  const admin = mockAdmin({
    profile: { platform_role: "user" },
    memberships: [{ school_id: "deleted-school" }],
  });

  assert.equal(
    await getLoginRecycleConflict(admin, "user-1", "owner@example.test"),
    null,
  );
});
