import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const pageUrl = new URL("../src/app/login/page.tsx", import.meta.url).href;
const portalUrls = ["driver", "parent"].map((role) =>
  new URL(`../src/app/${role}/page.tsx`, import.meta.url).href,
);
const portalGuardUrl = new URL("../src/lib/transport/portal-guard.tsx", import.meta.url).href;
const rootGuardUrl = new URL("../src/components/auth/SchoolAccessGuard.tsx", import.meta.url).href;
const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const reactMock = dataModule(`
  export const useState = () => [globalThis.loginState.shift(), () => {}];
  export const useEffect = () => {};
  export const useMemo = (fn) => fn();
`);
const navigationMock = dataModule(`
  export const useRouter = () => ({ replace: (path) => { globalThis.loginRedirect = path; } });
  export const usePathname = () => globalThis.currentPath;
  export const redirect = (path) => { throw new Error("REDIRECT:" + path); };
`);
const serverMock = dataModule(`export const createClient = async () => globalThis.testSupabase;`);
const clientMock = dataModule(`export const createClient = () => globalThis.testSupabase;`);
const ssrMock = dataModule(`export const createServerClient = () => globalThis.testSupabase;`);
const adminMock = dataModule(`
  export const createClient = () => {
    globalThis.adminCreated++;
    return globalThis.adminSupabase;
  };
`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier === "next/navigation" && (
      context.parentURL === pageUrl || context.parentURL === rootGuardUrl ||
      context.parentURL?.endsWith("/src/lib/transport/portal-access.ts")
    )) return { url: navigationMock, shortCircuit: true };
    if (specifier === "react" && context.parentURL === pageUrl) {
      return { url: reactMock, shortCircuit: true };
    }
    if (specifier === "@supabase/ssr" && context.parentURL?.endsWith("/src/proxy.ts")) {
      return { url: ssrMock, shortCircuit: true };
    }
    if (specifier === "@supabase/supabase-js" && context.parentURL?.endsWith("/src/lib/transport/portal-access.ts")) {
      return { url: adminMock, shortCircuit: true };
    }
    if (specifier === "@/lib/supabase/server") return { url: serverMock, shortCircuit: true };
    if (specifier === "@/lib/supabase/client" && (context.parentURL === pageUrl || context.parentURL === rootGuardUrl)) {
      return { url: clientMock, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === pageUrl || url === portalGuardUrl || url === rootGuardUrl || portalUrls.includes(url)) {
      return {
        format: "module",
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
        }).outputText,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { NextRequest } = await import("next/server.js");
const { proxy, config } = await import("../src/proxy.ts");
const { GET } = await import("../src/app/auth/callback/route.ts");
const { getPortalAccess } = await import("../src/lib/transport/portal-access.ts");
const { default: LoginPage } = await import(pageUrl);
const { default: DriverPage } = await import(portalUrls[0]);
const { default: ParentPage } = await import(portalUrls[1]);
const { PortalGuard } = await import(portalGuardUrl);
const { default: SchoolAccessGuard } = await import(rootGuardUrl);

function supabase({ schoolRoles = [], transportRoles = [], user = true, modules = ["transport"], status = "active", expiresOn = null, membershipError = null, transportError = null } = {}) {
  const requests = [];
  const schoolMemberships = schoolRoles.map((role, index) => ({ role, school_id: `school-${index}` }));
  const transportMemberships = transportRoles.map((role, index) => ({ role, school_id: `transport-school-${index}` }));
  globalThis.adminCreated = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://transport.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  globalThis.adminSupabase = {
    from(table) {
      assert.equal(table, "schools");
      const request = { table, filters: [] };
      requests.push(request);
      const query = {
        select() { return query; },
        eq(column, value) { request.filters.push([column, value]); return query; },
        maybeSingle: async () => ({ data: { enabled_modules: modules, status, expires_on: expiresOn }, error: null }),
      };
      return query;
    },
  };
  const client = {
    requests,
    auth: {
      getUser: async () => ({ data: { user: user ? { id: "user-1" } : null }, error: null }),
      signInWithPassword: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: { id: "user-1" } } }),
      signOut: async () => {},
    },
    from(table) {
      const request = { table, filters: [] };
      requests.push(request);
      const query = {
        select() { return query; },
        eq(column, value) { request.filters.push([column, value]); return query; },
        order() { return query; },
        then(resolve, reject) {
          const result = table === "school_users"
            ? { data: schoolMemberships, error: membershipError }
            : { data: transportMemberships, error: transportError };
          return Promise.resolve(result).then(resolve, reject);
        },
        maybeSingle: async () => ({ data: { id: "staff-1", status: "active" }, error: null }),
      };
      return query;
    },
  };
  globalThis.testSupabase = client;
  return client;
}

function destination(response) {
  const location = response.headers.get("location");
  return location && new URL(location).pathname;
}

test("proxy protects anonymous portals and redirects transport dashboard access", async () => {
  for (const path of ["/driver", "/driver/route", "/parent", "/parent/route"]) {
    supabase({ user: false });
    assert.equal(destination(await proxy(new NextRequest(`https://school.test${path}`))), "/login");
  }
  for (const role of ["driver", "parent"]) {
    supabase({ transportRoles: [role] });
    assert.equal(destination(await proxy(new NextRequest("https://school.test/dashboard/students"))), `/${role}`);
  }
  supabase({ schoolRoles: ["owner"] });
  assert.equal(destination(await proxy(new NextRequest("https://school.test/dashboard/students"))), null);
  assert.ok(config.matcher.includes("/driver/:path*"));
  assert.ok(config.matcher.includes("/parent/:path*"));
});

test("proxy and callback retain school and staff routing and handle transport roles", async () => {
  for (const [membership, expected] of [
    [{ transportRoles: ["driver"] }, "/driver"],
    [{ transportRoles: ["parent"] }, "/parent"],
    [{ schoolRoles: ["staff"] }, "/dashboard/staff/home"],
    [{ schoolRoles: ["teacher"] }, "/dashboard/staff/home"],
    [{ schoolRoles: ["employee"] }, "/dashboard/staff/home"],
    [{ schoolRoles: ["owner"] }, "/dashboard"],
    [{ schoolRoles: ["admin"] }, "/dashboard"],
    [{ schoolRoles: ["owner"], transportRoles: ["driver"] }, "/dashboard"],
    [{ schoolRoles: ["teacher"], transportRoles: ["parent"] }, "/dashboard/staff/home"],
  ]) {
    for (const path of ["/login", "/signup"]) {
      supabase(membership);
      assert.equal(destination(await proxy(new NextRequest(`https://school.test${path}`))), expected);
    }
    supabase(membership);
    assert.equal(destination(await GET(new NextRequest("https://school.test/auth/callback?code=ok"))), expected);
  }
});

test("dashboard fails closed if membership lookup fails", async () => {
  supabase({ transportRoles: ["driver"], membershipError: { message: "unavailable" } });
  const response = await proxy(new NextRequest("https://school.test/dashboard"));
  assert.equal(response.status, 503);
});

test("portal access checks the selected membership and its school's module", async () => {
  for (const role of ["driver", "parent"]) {
    const client = supabase({ transportRoles: [role] });
    assert.equal(await getPortalAccess(role), "allowed");
    const schoolRequest = client.requests.find(({ table }) => table === "schools");
    assert.deepEqual(schoolRequest.filters, [["id", "transport-school-0"]]);
    const transportRequest = client.requests.find(({ table }) => table === "transport_users");
    assert.deepEqual(transportRequest.filters, [["user_id", "user-1"], ["is_active", true]]);
    assert.equal(globalThis.adminCreated, 1);
    supabase({ transportRoles: [role], modules: ["fees"] });
    assert.equal(await getPortalAccess(role), "not-included");
    supabase({ schoolRoles: ["owner"], transportRoles: [role] });
    assert.equal(await getPortalAccess(role), "allowed");
    const normal = supabase({ schoolRoles: ["owner"] });
    assert.equal(await getPortalAccess(role), "not-available");
    assert.equal(normal.requests.some(({ table }) => table === "schools"), false);
    assert.equal(globalThis.adminCreated, 0);
    supabase({ transportRoles: [role === "driver" ? "parent" : "driver"] });
    assert.equal(await getPortalAccess(role), "not-available");
    supabase({ transportRoles: [role], status: "suspended" });
    assert.equal(await getPortalAccess(role), "school-unavailable");
    supabase({ transportRoles: [role], expiresOn: "2000-01-01" });
    assert.equal(await getPortalAccess(role), "school-unavailable");
  }
  supabase({ transportError: { message: "unavailable" } });
  await assert.rejects(getPortalAccess("driver"), /Unable to verify transport membership/);
  assert.equal(globalThis.adminCreated, 0);
  supabase({ user: false });
  await assert.rejects(getPortalAccess("driver"), /REDIRECT:\/login/);
});

test("transport migration grants only self-select to authenticated users", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261113140000_transport_users.sql", import.meta.url), "utf8");
  assert.match(sql, /FOR SELECT TO authenticated\s+USING \(user_id = auth\.uid\(\)\)/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.transport_users FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT SELECT ON TABLE public\.transport_users TO authenticated/i);
  assert.match(sql, /GRANT ALL ON TABLE public\.transport_users TO service_role/i);
  assert.doesNotMatch(sql, /school_users/i);
});

test("portal pages show placeholders only for authorized enabled roles", async () => {
  for (const [role, Page] of [["driver", DriverPage], ["parent", ParentPage]]) {
    const render = async () => renderToStaticMarkup(
      React.createElement(React.Fragment, null, await PortalGuard({ role, children: React.createElement(Page) })),
    );
    supabase({ transportRoles: [role] });
    assert.match(await render(), /portal – coming soon/);
    supabase({ transportRoles: [role], modules: ["payroll"] });
    assert.match(await render(), /This module is not included in your plan/);
    supabase({ schoolRoles: ["owner"] });
    assert.match(await render(), /Not available/);
  }
});

test("school-only guard does not block server-guarded transport portals", () => {
  for (const path of ["/driver", "/parent/trip"]) {
    supabase();
    globalThis.currentPath = path;
    const html = renderToStaticMarkup(React.createElement(SchoolAccessGuard, null, "portal content"));
    assert.match(html, /portal content/);
  }
  supabase();
  globalThis.currentPath = "/dashboard";
  assert.match(renderToStaticMarkup(React.createElement(SchoolAccessGuard, null, "dashboard content")), /Checking school access/);
});

function findForm(element) {
  if (!element || typeof element !== "object") return null;
  if (element.type === "form") return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const result = findForm(child);
    if (result) return result;
  }
  return null;
}

test("password login sends driver and parent to their portals without changing school roles", async () => {
  for (const [membership, expected] of [
    [{ transportRoles: ["driver"] }, "/driver"],
    [{ transportRoles: ["parent"] }, "/parent"],
    [{ schoolRoles: ["owner"] }, "/dashboard"],
    [{ schoolRoles: ["admin"] }, "/dashboard"],
    [{ schoolRoles: ["teacher"] }, "/dashboard/staff/home"],
    [{ schoolRoles: ["owner"], transportRoles: ["driver"] }, "/dashboard"],
  ]) {
    supabase(membership);
    globalThis.loginState = ["person@example.test", "password", false, false, "", null];
    globalThis.loginRedirect = null;
    const form = findForm(LoginPage());
    assert.ok(form);
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(globalThis.loginRedirect, expected);
  }
});
