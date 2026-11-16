import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getAnonymousRedirectPath,
  getAuthenticatedLoginRedirectPath,
} from "../src/lib/auth/proxy-access.ts";

const proxySource = await readFile(
  new URL("../src/proxy.ts", import.meta.url),
  "utf8",
);

test("redirects anonymous dashboard and accounting requests to login", () => {
  assert.equal(getAnonymousRedirectPath("/dashboard/students", false), "/login");
  assert.equal(getAnonymousRedirectPath("/accounting/reports", false), "/login");
  assert.equal(getAnonymousRedirectPath("/accounting", false), "/login");
});

test("preserves staff and school-admin login redirects", () => {
  assert.equal(
    getAuthenticatedLoginRedirectPath(["staff"], false),
    "/dashboard/staff/home",
  );
  assert.equal(
    getAuthenticatedLoginRedirectPath(["teacher"], false),
    "/dashboard/staff/home",
  );
  assert.equal(
    getAuthenticatedLoginRedirectPath(["employee"], false),
    "/dashboard/staff/home",
  );
  assert.equal(getAuthenticatedLoginRedirectPath(["owner"], false), "/dashboard");
  assert.equal(getAuthenticatedLoginRedirectPath(["admin"], false), "/dashboard");
});

test("falls back to the regular dashboard when membership lookup fails", () => {
  assert.equal(getAuthenticatedLoginRedirectPath(["staff"], true), "/dashboard");
  assert.equal(getAnonymousRedirectPath("/login", false), null);
});

test("anonymous visitors are redirected away from the sales and super admin portals", () => {
  assert.equal(getAnonymousRedirectPath("/sales", false), "/super-admin/login");
  assert.equal(getAnonymousRedirectPath("/sales/schools/new", false), "/super-admin/login");
  assert.equal(getAnonymousRedirectPath("/super-admin", false), "/super-admin/login");
  assert.equal(getAnonymousRedirectPath("/super-admin/payments", false), "/super-admin/login");
  assert.equal(getAnonymousRedirectPath("/super-admin/schools/abc", false), "/super-admin/login");
  // The login page itself, public pages and look-alike paths stay reachable.
  assert.equal(getAnonymousRedirectPath("/super-admin/login", false), null);
  assert.equal(getAnonymousRedirectPath("/privacy-policy", false), null);
  assert.equal(getAnonymousRedirectPath("/terms-and-conditions", false), null);
  assert.equal(getAnonymousRedirectPath("/salesforce", false), null);
  // Signed-in users are never bounced by the anonymous rule (roles are checked by the layouts).
  assert.equal(getAnonymousRedirectPath("/sales", true), null);
  assert.equal(getAnonymousRedirectPath("/super-admin", true), null);
});

test("proxy matcher covers the portals but never the public policy pages", () => {
  assert.match(proxySource, /"\/sales\/:path\*"/);
  assert.match(proxySource, /"\/super-admin\/:path\*"/);
  assert.doesNotMatch(proxySource, /privacy-policy|terms-and-conditions/);
});

test("includes accounting protection and limits membership queries to login/signup", () => {
  assert.match(proxySource, /"\/accounting\/:path\*"/);
  assert.match(proxySource, /loginUrl\.pathname = anonymousRedirectPath/);
  assert.match(proxySource, /\.from\("school_users"\)/);
  assert.match(
    proxySource,
    /\(pathname === "\/login" \|\| pathname === "\/signup"\)[\s\S]*?\.from\("school_users"\)/,
  );
});
