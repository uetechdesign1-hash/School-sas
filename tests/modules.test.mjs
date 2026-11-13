import assert from "node:assert/strict";
import test from "node:test";
import {
  MODULE_CODES,
  MODULE_LABELS,
  MODULES,
  validateModules,
} from "../src/lib/modules.ts";

test("defines the module codes and labels", () => {
  assert.deepEqual(MODULE_CODES, {
    fees: 1,
    payroll: 2,
    transport: 3,
  });
  assert.deepEqual(MODULE_LABELS, {
    fees: "1 – Fee collection & payments",
    payroll: "2 – Staff attendance & payroll",
    transport: "3 – Live bus tracking (coming soon)",
  });
  assert.equal(MODULES.length, 3);
});

test("validates known modules and preserves their order", () => {
  assert.deepEqual(validateModules(["transport", "fees"]), [
    "transport",
    "fees",
  ]);
});

test("accepts every nonempty combination of supported modules", () => {
  const combinations = [
    ["fees"], ["payroll"], ["transport"],
    ["fees", "payroll"], ["fees", "transport"], ["payroll", "transport"],
    ["fees", "payroll", "transport"],
  ];
  for (const modules of combinations) {
    assert.deepEqual(validateModules(modules), modules);
  }
});

test("rejects unknown modules", () => {
  assert.throws(() => validateModules(["fees", "books"]), /Unknown module: books/);
});

test("rejects duplicate modules", () => {
  assert.throws(
    () => validateModules(["payroll", "payroll"]),
    /Duplicate module: payroll/,
  );
});

test("rejects empty and non-array input", () => {
  assert.throws(() => validateModules([]), /At least one module/);
  assert.throws(() => validateModules(null), /At least one module/);
});
