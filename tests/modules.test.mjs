import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessSchoolPath,
  hasRequiredModule,
  isTransportPortalPath,
  parseEnabledModules,
  requiredModulesForPath,
  TRANSPORT_MANAGEMENT_FEATURES,
} from "../src/lib/modules.ts";

const PLAN1 = ["fees"];
const PLAN2 = ["payroll"];
const PLAN3 = ["transport"];

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
    assert.deepEqual(requiredModulesForPath(path), ["fees", "transport"], path);
  }
  for (const path of alwaysAvailable) {
    assert.deepEqual(requiredModulesForPath(path), [], path);
  }
  assert.deepEqual(requiredModulesForPath("/dashboard/transport/routes"), PLAN3);
  assert.deepEqual(requiredModulesForPath("/driver/trip"), PLAN3);
  assert.deepEqual(requiredModulesForPath("/parent"), PLAN3);
});

test("the payment screen follows fee or salary entitlement", () => {
  assert.deepEqual(requiredModulesForPath("/accounting/payment"), ["fees", "payroll"]);
  assert.deepEqual(
    requiredModulesForPath("/accounting/payment", new URLSearchParams("type=salary")),
    PLAN2,
  );
});

test("Plan 1 alone shows school management and accounting but no staff or transport", () => {
  const modules = parseEnabledModules(PLAN1);
  for (const path of [...plan1Pages, ...sharedStudentPages, ...alwaysAvailable]) {
    assert.equal(canAccessSchoolPath(modules, path), true, path);
  }
  for (const path of [...plan2Pages.filter((p) => p !== "/dashboard/staff/profile"), "/dashboard/transport"]) {
    assert.equal(canAccessSchoolPath(modules, path), false, path);
  }
});

test("Plan 2 alone shows staff tools but not students, accounting or transport", () => {
  const modules = parseEnabledModules(PLAN2);
  for (const path of [...plan2Pages, ...alwaysAvailable]) {
    assert.equal(canAccessSchoolPath(modules, path), true, path);
  }
  for (const path of [...plan1Pages, ...sharedStudentPages, "/dashboard/transport"]) {
    assert.equal(canAccessSchoolPath(modules, path), false, path);
  }
});

test("Plan 3 alone keeps shared student pages without fees, accounting or staff", () => {
  const modules = parseEnabledModules(PLAN3);
  for (const path of [...sharedStudentPages, ...alwaysAvailable, "/dashboard/transport", "/dashboard/transport/drivers"]) {
    assert.equal(canAccessSchoolPath(modules, path), true, path);
  }
  for (const path of [...plan1Pages, ...plan2Pages.filter((p) => p !== "/dashboard/staff/profile")]) {
    assert.equal(canAccessSchoolPath(modules, path), false, path);
  }
});

test("combined plans show the union of their pages", () => {
  const everything = [
    ...plan1Pages,
    ...plan2Pages,
    ...sharedStudentPages,
    ...alwaysAvailable,
    "/dashboard/transport",
    "/accounting/payment",
  ];
  const all = parseEnabledModules(["fees", "payroll", "transport"]);
  for (const path of everything) {
    assert.equal(canAccessSchoolPath(all, path), true, path);
  }

  const plan1And3 = parseEnabledModules(["fees", "transport"]);
  assert.equal(canAccessSchoolPath(plan1And3, "/dashboard/students"), true);
  assert.equal(canAccessSchoolPath(plan1And3, "/accounting/ledger"), true);
  assert.equal(canAccessSchoolPath(plan1And3, "/dashboard/transport"), true);
  assert.equal(canAccessSchoolPath(plan1And3, "/dashboard/payroll"), false);

  const plan2And3 = parseEnabledModules(["payroll", "transport"]);
  assert.equal(canAccessSchoolPath(plan2And3, "/dashboard/students"), true);
  assert.equal(canAccessSchoolPath(plan2And3, "/dashboard/staff"), true);
  assert.equal(canAccessSchoolPath(plan2And3, "/accounting/ledger"), false);

  // The default existing schools (Plans 1 and 2) keep their whole dashboard.
  const legacy = parseEnabledModules(["fees", "payroll"]);
  for (const path of [...plan1Pages, ...plan2Pages, ...sharedStudentPages, ...alwaysAvailable]) {
    assert.equal(canAccessSchoolPath(legacy, path), true, path);
  }
  assert.equal(canAccessSchoolPath(legacy, "/dashboard/transport"), false);
});

test("redirect targets for a denied school are never themselves denied", () => {
  // The Proxy and layout redirect to /dashboard or the staff profile; if those
  // required a plan, a school without it would loop.
  for (const modules of [PLAN1, PLAN2, PLAN3]) {
    assert.equal(canAccessSchoolPath(modules, "/dashboard"), true);
    assert.equal(canAccessSchoolPath(modules, "/dashboard/staff/profile"), true);
  }
});

test("module route checks allow any valid module combination and fail closed", () => {
  const transportOnly = parseEnabledModules(["transport"]);
  const feesOnly = parseEnabledModules(["fees"]);

  assert.equal(hasRequiredModule(transportOnly, ["transport"]), true);
  assert.equal(hasRequiredModule(feesOnly, ["fees", "payroll"]), true);
  assert.equal(hasRequiredModule(transportOnly, ["fees", "payroll"]), false);
  assert.equal(hasRequiredModule(null, ["fees"]), false);
  assert.equal(canAccessSchoolPath(null, "/dashboard/students"), false);
  assert.equal(canAccessSchoolPath(undefined, "/dashboard/staff"), false);
});

test("transport portals are identified separately from school pages", () => {
  assert.equal(isTransportPortalPath("/driver"), true);
  assert.equal(isTransportPortalPath("/parent/children"), true);
  assert.equal(isTransportPortalPath("/dashboard/transport"), false);
});

test("Plan 3 management catalog never links a page that does not exist yet", () => {
  assert.equal(TRANSPORT_MANAGEMENT_FEATURES.length, 12);
  assert.equal(new Set(TRANSPORT_MANAGEMENT_FEATURES.map((item) => item.id)).size, 12);
  for (const item of TRANSPORT_MANAGEMENT_FEATURES) {
    assert.equal(item.status, "planned", item.title);
    assert.deepEqual(requiredModulesForPath(item.href), PLAN3, item.href);
  }
});
