import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pageUrl = new URL("../src/app/dashboard/page.tsx", import.meta.url).href;
const fakeReact = `data:text/javascript,${encodeURIComponent(`
  export const useState = () => [globalThis.__dashboardState.shift(), () => {}];
  export const useCallback = (value) => value;
  export const useEffect = () => {};
  export const useMemo = (value) => value();
`)}`;
const fakeContext = `data:text/javascript,${encodeURIComponent(`
  export const useSchoolContext = () => globalThis.__dashboardSchool;
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === pageUrl && specifier === "react") {
      return { url: fakeReact, shortCircuit: true };
    }
    if (context.parentURL === pageUrl && specifier === "@/lib/school-context") {
      return { url: fakeContext, shortCircuit: true };
    }
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === pageUrl) {
      const source = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { default: DashboardPage } = await import(pageUrl);
const { loadFinancialStats } = await import("../src/lib/dashboard/financial-stats.ts");

function renderDashboard(modules, role = "owner") {
  globalThis.__dashboardSchool = {
    schoolId: "school-1", modules, loading: false, error: null,
  };
  globalThis.__dashboardState = [
    { id: "school-1", name: "School", status: "active", school_code: "M-2", student_limit: 100 },
    { full_name: "Principal" },
    { studentCount: 10, classCount: 3, feeCollection: 25, expenses: 5, attendancePercentage: 80 },
    role, false, "",
  ];
  return renderToStaticMarkup(React.createElement(DashboardPage));
}

test("transport and payroll dashboards hide financial UI and retain core cards", () => {
  for (const modules of [["transport"], ["payroll"]]) {
    for (const role of ["owner", "admin"]) {
      const html = renderDashboard(modules, role);
      assert.match(html, />Students</);
      assert.match(html, />Classes</);
      assert.match(html, />Attendance</);
      assert.doesNotMatch(html, />Fee Collection<|>Fees collected<|>Expenses<|>Accounting Control Center</);
      assert.doesNotMatch(html, /href="\/dashboard\/expenses"|href="\/accounting\/collect-fee"/);
      assert.doesNotMatch(html, /Plan|starter/i);
      assert.match(html, modules[0] === "transport" ? /Module: Transport/ : /Module: Payroll/);
      if (role === "owner") {
        assert.equal(html.includes('href="/dashboard/payroll"'), modules.includes("payroll"));
      }
    }
  }
});

test("fee-enabled dashboards retain financial cards and actions", () => {
  for (const role of ["owner", "admin"]) {
    const html = renderDashboard(["fees"], role);
    assert.match(html, role === "owner" ? />Fee Collection</ : />Fees collected</);
    assert.match(html, />Expenses</);
    assert.match(html, /href="\/accounting\/collect-fee"/);
    assert.match(html, /Module: Fees/);
  }
});

test("dashboard skips both financial queries without fees", async () => {
  const supabase = { from() { throw new Error("Financial query must not run"); } };
  assert.deepEqual(
    await loadFinancialStats(supabase, "school-1", "2026-11-01", "2026-12-01", false),
    { feeCollection: 0, expenses: 0 },
  );
});

test("fee-enabled financial queries preserve school scope and monthly totals", async () => {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push([table]);
      const chain = {
        select(column) { calls.at(-1).push(["select", column]); return chain; },
        eq(column, value) { calls.at(-1).push(["eq", column, value]); return chain; },
        gte(column, value) { calls.at(-1).push(["gte", column, value]); return chain; },
        lt(column, value) {
          calls.at(-1).push(["lt", column, value]);
          return Promise.resolve({ data: table === "fee_payments" ? [{ amount: "12.5" }, { amount: 3 }] : [{ amount: "4" }], error: null });
        },
      };
      return chain;
    },
  };
  assert.deepEqual(
    await loadFinancialStats(supabase, "school-1", "2026-11-01", "2026-12-01", true),
    { feeCollection: 15.5, expenses: 4 },
  );
  assert.deepEqual(calls.map((entry) => entry[0]), ["fee_payments", "expenses"]);
  for (const call of calls) assert.deepEqual(call[2], ["eq", "school_id", "school-1"]);
  assert.deepEqual(calls[0][3], ["gte", "payment_date", "2026-11-01"]);
  assert.deepEqual(calls[1][4], ["lt", "expense_date", "2026-12-01"]);
});
