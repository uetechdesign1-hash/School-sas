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

test("includes accounting protection and limits membership queries to login/signup", () => {
  assert.match(proxySource, /"\/accounting\/:path\*"/);
  assert.match(proxySource, /loginUrl\.pathname = anonymousRedirectPath/);
  assert.match(proxySource, /\.from\("school_users"\)/);
  assert.match(
    proxySource,
    /\(pathname === "\/login" \|\| pathname === "\/signup"\)[\s\S]*?\.from\("school_users"\)/,
  );
});
