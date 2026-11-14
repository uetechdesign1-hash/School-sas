import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessSchoolPath,
  hasRequiredModule,
  parseEnabledModules,
  requiredModulesForPath,
} from "../src/lib/modules.ts";

const PLAN1 = ["fees"];
const PLAN2 = ["payroll"];

const plan1Pages = [
  "/dashboard/fees",
  "/dashboard/fees/structure",
  "/dashboard/fees/assign",
  "/dashboard/students/fee-structure",
  "/dashboard/students/abc/fees",
  "/dashboard/students/abc/payment",
  "/dashboard/attendance",
  "/dashboard/expenses",
  "/dashboard/reports",
  "/dashboard/daily-report",
  "/dashboard/accounting/vendor-purchases",
  "/accounting/accounts",
  "/accounting/opening-balance",
  "/accounting/cash-bank",
  "/accounting/collect-fee",
  "/accounting/receipt",
  "/accounting/contra",
  "/accounting/journal",
  "/accounting/ledger",
  "/accounting/bank-reconciliation",
  "/accounting/trial-balance",
  "/accounting/profit-loss",
  "/accounting/balance-sheet",
];

const plan2Pages = [
  "/dashboard/staff",
  "/dashboard/staff/new",
  "/dashboard/staff/add",
  "/dashboard/staff/abc",
  "/dashboard/staff/abc/edit",
  "/dashboard/staff/abc/salary",
  "/dashboard/staff/abc/payslip",
  "/dashboard/staff/abc/attendance",
  "/dashboard/staff/home",
  "/dashboard/staff/attendance",
  "/dashboard/staff/my-attendance",
  "/dashboard/staff/my-salary",
  "/dashboard/staff/my-payslips",
  "/dashboard/staff/settings",
  "/dashboard/staff/reports",
  "/dashboard/staff-attendance",
  "/dashboard/payroll",
];

const sharedStudentPages = [
  "/dashboard/students",
  "/dashboard/students/new",
  "/dashboard/students/import",
  "/dashboard/students/abc",
  "/dashboard/classes",
  "/dashboard/academic-years",
];

const alwaysAvailable = [
  "/dashboard",
  "/dashboard/school-settings",
  "/dashboard/staff/profile",
];

test("every school page maps to exactly the plan that owns it", () => {
  for (const path of plan1Pages) {
    assert.deepEqual(requiredModulesForPath(path), PLAN1, path);
  }
  for (const path of plan2Pages) {
    assert.deepEqual(requiredModulesForPath(path), PLAN2, path);
  }
  for (const path of sharedStudentPages) {
    assert.deepEqual(requiredModulesForPath(path), ["fees"], path);
  }
  for (const path of alwaysAvailable) {
    assert.deepEqual(requiredModulesForPath(path), [], path);
  }
});

test("the payment screen follows fee or salary entitlement", () => {
  assert.deepEqual(requiredModulesForPath("/accounting/payment"), ["fees", "payroll"]);
  assert.deepEqual(
    requiredModulesForPath("/accounting/payment", new URLSearchParams("type=salary")),
    PLAN2,
  );
});

test("Plan 1 alone shows school management and accounting but no staff", () => {
  const modules = parseEnabledModules(PLAN1);
  for (const path of [...plan1Pages, ...sharedStudentPages, ...alwaysAvailable]) {
    assert.equal(canAccessSchoolPath(modules, path), true, path);
  }
  for (const path of [...plan2Pages.filter((p) => p !== "/dashboard/staff/profile")]) {
    assert.equal(canAccessSchoolPath(modules, path), false, path);
  }
});

test("Plan 2 alone shows staff tools but not students or accounting", () => {
  const modules = parseEnabledModules(PLAN2);
  for (const path of [...plan2Pages, ...alwaysAvailable]) {
    assert.equal(canAccessSchoolPath(modules, path), true, path);
  }
  for (const path of [...plan1Pages, ...sharedStudentPages]) {
    assert.equal(canAccessSchoolPath(modules, path), false, path);
  }
});

test("combined plans show the union of their pages", () => {
  const everything = [
    ...plan1Pages,
    ...plan2Pages,
    ...sharedStudentPages,
    ...alwaysAvailable,
    "/accounting/payment",
  ];
  const all = parseEnabledModules(["fees", "payroll"]);
  for (const path of everything) {
    assert.equal(canAccessSchoolPath(all, path), true, path);
  }

  // The default existing schools (Plans 1 and 2) keep their whole dashboard.
  const legacy = parseEnabledModules(["fees", "payroll"]);
  for (const path of [...plan1Pages, ...plan2Pages, ...sharedStudentPages, ...alwaysAvailable]) {
    assert.equal(canAccessSchoolPath(legacy, path), true, path);
  }
});

test("redirect targets for a denied school are never themselves denied", () => {
  // The Proxy and layout redirect to /dashboard or the staff profile; if those
  // required a plan, a school without it would loop.
  for (const modules of [PLAN1, PLAN2]) {
    assert.equal(canAccessSchoolPath(modules, "/dashboard"), true);
    assert.equal(canAccessSchoolPath(modules, "/dashboard/staff/profile"), true);
  }
});

test("module route checks allow any valid module combination and fail closed", () => {
  const feesOnly = parseEnabledModules(["fees"]);

  assert.equal(hasRequiredModule(feesOnly, ["fees", "payroll"]), true);
  assert.equal(hasRequiredModule(null, ["fees"]), false);
  assert.equal(canAccessSchoolPath(null, "/dashboard/students"), false);
  assert.equal(canAccessSchoolPath(undefined, "/dashboard/staff"), false);
});
