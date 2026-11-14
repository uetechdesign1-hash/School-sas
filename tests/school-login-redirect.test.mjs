import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const mock = `data:text/javascript,${encodeURIComponent(
  "export const createServerClient = () => globalThis.testSchoolClient;",
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr" && context.parentURL?.endsWith("/src/proxy.ts")) {
      return { url: mock, shortCircuit: true };
    }
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { NextRequest } = await import("next/server.js");
const { proxy } = await import("../src/proxy.ts");

function client(memberships, error = null) {
  const query = {
    select() { return query; },
    eq() { return query; },
    then(resolve, reject) {
      return Promise.resolve({ data: memberships, error }).then(resolve, reject);
    },
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => query,
  };
}

test("login remains accessible when the signed-in user has no active school", async () => {
  globalThis.testSchoolClient = client([]);
  const response = await proxy(new NextRequest("https://example.test/login?reason=no-school"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
});

test("active school and staff memberships retain their dashboard redirects", async () => {
  for (const [role, destination] of [["owner", "/dashboard"], ["teacher", "/dashboard/staff/home"]]) {
    globalThis.testSchoolClient = client([{ role }]);
    const response = await proxy(new NextRequest("https://example.test/login"));
    assert.equal(new URL(response.headers.get("location")).pathname, destination);
  }
});

test("membership lookup failures do not redirect to a school dashboard", async () => {
  globalThis.testSchoolClient = client(null, { message: "lookup failed" });
  const response = await proxy(new NextRequest("https://example.test/login"));
  assert.equal(response.status, 503);
});
