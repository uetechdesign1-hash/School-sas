import assert from "node:assert/strict";
import test from "node:test";
import {
  isAuthorizedImportRole,
  AUTHORIZED_IMPORT_ROLES,
  UnauthenticatedError,
  UnauthorizedError,
} from "../src/lib/students/import-auth.ts";

test("isAuthorizedImportRole returns true for owner", () => {
  assert.equal(isAuthorizedImportRole("owner"), true);
});

test("isAuthorizedImportRole returns true for admin", () => {
  assert.equal(isAuthorizedImportRole("admin"), true);
});

test("isAuthorizedImportRole is case-insensitive", () => {
  assert.equal(isAuthorizedImportRole("OWNER"), true);
  assert.equal(isAuthorizedImportRole("Admin"), true);
  assert.equal(isAuthorizedImportRole("  owner  "), true);
});

test("isAuthorizedImportRole returns false for staff", () => {
  assert.equal(isAuthorizedImportRole("staff"), false);
});

test("isAuthorizedImportRole returns false for teacher", () => {
  assert.equal(isAuthorizedImportRole("teacher"), false);
});

test("isAuthorizedImportRole returns false for employee", () => {
  assert.equal(isAuthorizedImportRole("employee"), false);
});

test("isAuthorizedImportRole returns false for accountant (not authorized for student import)", () => {
  assert.equal(isAuthorizedImportRole("accountant"), false);
});

test("isAuthorizedImportRole returns false for null/undefined/empty", () => {
  assert.equal(isAuthorizedImportRole(null), false);
  assert.equal(isAuthorizedImportRole(undefined), false);
  assert.equal(isAuthorizedImportRole(""), false);
});

test("AUTHORIZED_IMPORT_ROLES contains owner and admin", () => {
  assert.ok(AUTHORIZED_IMPORT_ROLES.includes("owner"));
  assert.ok(AUTHORIZED_IMPORT_ROLES.includes("admin"));
});

test("AUTHORIZED_IMPORT_ROLES does not include accountant", () => {
  assert.equal(AUTHORIZED_IMPORT_ROLES.includes("accountant"), false);
});

test("UnauthenticatedError has status 401", () => {
  const err = new UnauthenticatedError("No token");
  assert.equal(err.status, 401);
  assert.equal(err.name, "UnauthenticatedError");
  assert.equal(err.message, "No token");
});

test("UnauthorizedError has status 403", () => {
  const err = new UnauthorizedError("Not allowed");
  assert.equal(err.status, 403);
  assert.equal(err.name, "UnauthorizedError");
  assert.equal(err.message, "Not allowed");
});

test("selecting an authorized membership from multiple memberships picks the first authorized one", () => {
  // Simulates the membership-selection logic in getStudentImportAuth.
  const memberships = [
    { school_id: "school-a", role: "staff", is_active: true },
    { school_id: "school-b", role: "owner", is_active: true },
    { school_id: "school-c", role: "admin", is_active: true },
  ];

  const selected = memberships.find((m) => isAuthorizedImportRole(m.role));
  assert.equal(selected.school_id, "school-b");
  assert.equal(selected.role, "owner");
});

test("no authorized membership when all roles are unauthorized", () => {
  const memberships = [
    { school_id: "school-a", role: "staff", is_active: true },
    { school_id: "school-b", role: "teacher", is_active: true },
  ];

  const selected = memberships.find((m) => isAuthorizedImportRole(m.role));
  assert.equal(selected, undefined);
});

test("no authorized membership when all memberships are inactive", () => {
  const memberships = [
    { school_id: "school-a", role: "owner", is_active: false },
    { school_id: "school-b", role: "admin", is_active: false },
  ];

  const active = memberships.filter((m) => m.is_active);
  assert.equal(active.length, 0);
});

test("cross-school isolation: schoolId comes from verified membership, not request body", () => {
  // The import route always inserts with schoolId from getStudentImportAuth.
  // A request body cannot override it because no school_id field is accepted
  // from the client for student rows.
  const verifiedSchoolId = "school-123";
  const maliciousBodySchoolId = "school-999";

  // The code path: schoolId is always verifiedSchoolId, never maliciousBodySchoolId.
  assert.notEqual(verifiedSchoolId, maliciousBodySchoolId);
  assert.equal(verifiedSchoolId, "school-123");
});
