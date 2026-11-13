import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "next/navigation") return nextResolve("next/navigation.js", context);
    if (specifier === "./module-routes") {
      return nextResolve(new URL("../src/lib/school-context/module-routes.ts", import.meta.url).href, context);
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/src/lib/school-context/index.tsx")) {
      const source = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { isModuleRouteAllowed } = await import("../src/lib/school-context/module-routes.ts");
const { ModuleGate } = await import("../src/lib/school-context/index.tsx");
const { POST } = await import("../src/app/api/staff/attendance/offline-sync/route.ts");

test("the page guard does not render blocked or loading module children", () => {
  let renders = 0;
  function Page() {
    renders++;
    return React.createElement("p", null, "module data");
  }
  const render = (school) => renderToStaticMarkup(
    React.createElement(ModuleGate, { pathname: "/dashboard/payroll", school }, React.createElement(Page)),
  );
  const state = { schoolId: "school-1", modules: ["transport"], loading: false, error: null };
  assert.match(render({ ...state, loading: true }), /Checking module access/);
  assert.match(render(state), /This module is not included in your plan/);
  assert.match(render({ ...state, error: "School unavailable" }), /School unavailable/);
  assert.equal(renders, 0);
  assert.match(render({ ...state, modules: ["payroll"] }), /module data/);
  assert.equal(renders, 1);
});

test("transport-only schools cannot open fee or payroll pages", () => {
  for (const path of [
    "/dashboard/fees/structure",
    "/dashboard/students/123/fees/create",
    "/dashboard/students/123/admission-payment",
    "/accounting/collect-fee",
    "/accounting/receipt",
    "/dashboard/expenses",
    "/dashboard/daily-report",
    "/accounting/expenses",
    "/accounting/expenses/new",
    "/accounting/expense-categories",
    "/dashboard/payroll",
    "/dashboard/staff/attendance",
    "/dashboard/staff/123/salary",
  ]) {
    assert.equal(isModuleRouteAllowed(path, ["transport"]), false, path);
  }
  assert.equal(isModuleRouteAllowed("/dashboard/transport", ["transport"]), true);
  assert.equal(isModuleRouteAllowed("/dashboard/students", ["transport"]), true);
  assert.equal(isModuleRouteAllowed("/accounting/ledger", ["transport"]), true);
});

test("fees-only schools cannot open payroll pages; payroll can use the shared ledger", () => {
  assert.equal(isModuleRouteAllowed("/dashboard/payroll", ["fees"]), false);
  assert.equal(isModuleRouteAllowed("/dashboard/staff/my-payslips", ["fees"]), false);
  assert.equal(isModuleRouteAllowed("/dashboard/fees", ["fees"]), true);
  assert.equal(isModuleRouteAllowed("/accounting/ledger", ["payroll"]), true);
  assert.equal(isModuleRouteAllowed("/accounting/payment", ["payroll"]), true);
  assert.equal(isModuleRouteAllowed("/dashboard/payroll", ["payroll"]), true);
  assert.equal(isModuleRouteAllowed("/dashboard/expenses", ["payroll"]), false);
  assert.equal(isModuleRouteAllowed("/dashboard/daily-report", ["payroll"]), false);
  assert.equal(isModuleRouteAllowed("/dashboard/expenses", ["fees"]), true);
});

test("expense and daily report guards do not render blocked children", () => {
  let renders = 0;
  function Page() {
    renders++;
    return React.createElement("p", null, "financial data");
  }
  for (const pathname of ["/dashboard/expenses", "/dashboard/daily-report", "/accounting/expenses/new"]) {
    const school = { schoolId: "school-1", modules: ["payroll"], loading: false, error: null };
    const html = renderToStaticMarkup(
      React.createElement(ModuleGate, { pathname, school }, React.createElement(Page)),
    );
    assert.match(html, /This module is not included in your plan/);
  }
  assert.equal(renders, 0);
});

const staffId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";

async function withSupabase(modules, staffSchool, callback) {
  const previousFetch = globalThis.fetch;
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://module-access.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    if (url.pathname === "/rest/v1/school_users") {
      return Response.json([{ school_id: "school-1", role: "staff", created_at: "2026-01-01" }]);
    }
    if (url.pathname === "/rest/v1/schools") {
      assert.equal(url.searchParams.get("id"), "eq.school-1");
      return Response.json(url.searchParams.get("select") === "enabled_modules"
        ? { enabled_modules: modules }
        : { id: "school-1", status: "active", expires_on: null });
    }
    if (url.pathname === "/rest/v1/staff") {
      assert.equal(url.searchParams.get("school_id"), "eq.school-1");
      return Response.json(staffSchool === "school-1" ? { id: staffId } : null);
    }
    if (url.pathname === "/rest/v1/rpc/sync_staff_offline_attendance") {
      return Response.json({ success: true });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await callback(requests);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function request() {
  return new Request("https://module-access.invalid/api", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({
      request_id: "33333333-3333-4333-8333-333333333333",
      user_id: userId,
      staff_id: staffId,
      action: "check_in",
      captured_at: "2026-01-01T10:00:00Z",
      latitude: 1,
      longitude: 1,
      accuracy_meters: 10,
    }),
  });
}

test("offline attendance rejects transport-only and fees-only schools before the RPC", async () => {
  for (const modules of [["transport"], ["fees"]]) {
    await withSupabase(modules, "school-1", async (requests) => {
      const response = await POST(request());
      assert.equal(response.status, 403);
      assert.match((await response.json()).error, /not included/);
      assert.equal(requests.some((url) => url.pathname.includes("/rpc/")), false);
    });
  }
});

test("offline attendance checks the staff school before invoking the RPC", async () => {
  await withSupabase(["payroll"], "other-school", async (requests) => {
    const response = await POST(request());
    assert.equal(response.status, 403);
    assert.equal(requests.some((url) => url.pathname.includes("/rpc/")), false);
  });
  await withSupabase(["payroll"], "school-1", async (requests) => {
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal(requests.some((url) => url.pathname.includes("/rpc/")), true);
  });
});
