import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const read = (path) => readFile(new URL(path, root), "utf8");

test("portal layouts enforce the role on the server, not in the browser", async () => {
  const admin = await read("src/app/super-admin/(portal)/layout.tsx");
  const sales = await read("src/app/sales/layout.tsx");
  assert.match(admin, /requirePortalRole\("super_admin"/);
  assert.match(sales, /requirePortalRole\("sales_rep"/);
  assert.ok(!admin.includes('"use client"') && !sales.includes('"use client"'));

  const gate = await read("src/lib/auth/portal-access.ts");
  assert.match(gate, /is_active !== true/);
  assert.match(gate, /status !== "active"/, "inactive representatives are refused");
});

test("the provisioning route never uses the service role for database access", async () => {
  const route = await read("src/app/api/business/provisioning/process/route.ts");
  const adminUses = route.match(/getAdmin\(\)/g) ?? [];
  assert.ok(adminUses.length >= 3);
  for (const match of route.matchAll(/getAdmin\(\)\s*\.([a-zA-Z]+)/g)) {
    assert.equal(match[1], "auth", `getAdmin() may only be used for the Auth Admin API, found .${match[1]}`);
  }
  assert.ok(!/admin\.from\(/.test(route), "no service-role table access");
  assert.match(route, /Authorization: `Bearer \$\{token\}`/, "database calls use the caller's JWT");
  assert.match(route, /Authorization token is required/);
});

test("no browser code reads the service-role key", async () => {
  const files = [
    ...(await walk(new URL("src/components/business", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"))),
    ...(await walk(new URL("src/app/sales", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"))),
    ...(await walk(new URL("src/lib/business", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"))),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.ok(!/SERVICE_ROLE/.test(source), `${file} references the service-role key`);
  }
});

test("business writes go through RPCs, not direct table writes on financial tables", async () => {
  const files = await walk(new URL("src/components/business", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const forbidden = ["school_payments", "school_invoices", "school_mous", "payment_reversals", "school_sales_ownership", "school_subscriptions"];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const table of forbidden) {
      const writes = new RegExp(`from\\(["']${table}["']\\)\\s*\\.(insert|update|delete|upsert)\\(`);
      assert.ok(!writes.test(source), `${file} writes to ${table} directly`);
    }
  }
});

test("the old Phase 1 direct-insert school page is gone and the wizard uses the sale RPC", async () => {
  const page = await read("src/app/sales/schools/new/page.tsx");
  assert.match(page, /SchoolWizard/);
  const wizard = await read("src/components/business/school-wizard.tsx");
  assert.match(wizard, /create_school_sale/);
  assert.match(wizard, /quote_subscription/, "price preview comes from the server");
  assert.ok(!/from\("schools"\)\s*\.insert/.test(wizard));
});

test("prices are never hardcoded in application code", async () => {
  const files = [
    ...(await walk(new URL("src/components/business", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"))),
    ...(await walk(new URL("src/lib/business", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"))),
    ...(await walk(new URL("src/app/api/business", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"))),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const offending = source
      .split("\n")
      .filter((line) => /price|amount|rate/i.test(line) && /\b(100|150|2000|5000)\b/.test(line.replace(/className="[^"]*"|iconClassName="[^"]*"/g, "")) && !/min=|max=|minLength|maxLength|slice|substr|padStart/.test(line));
    assert.deepEqual(offending, [], `${file} appears to hardcode a plan price`);
  }
});

test("public policy pages need no authentication and are linked from the footer", async () => {
  const proxy = await read("src/proxy.ts");
  assert.ok(!/privacy-policy|terms-and-conditions/.test(proxy), "proxy must not gate the public pages");
  const access = await read("src/lib/auth/proxy-access.ts");
  assert.ok(!/privacy-policy|terms-and-conditions/.test(access));

  const privacy = await read("src/app/privacy-policy/page.tsx");
  const terms = await read("src/app/terms-and-conditions/page.tsx");
  assert.match(privacy, /privacy_policy/);
  assert.match(terms, /terms_and_conditions/);
  const publicPage = await read("src/components/business/public-policy.tsx");
  assert.ok(!publicPage.includes("SUPABASE_SERVICE_ROLE") && !publicPage.includes("supabase/server"), "uses the anonymous client only");

  const home = await read("src/app/page.tsx");
  assert.match(home, /href="\/privacy-policy"/);
  assert.match(home, /href="\/terms-and-conditions"/);
});

test("MOU terms and website policies are managed by separate tables and RPCs", async () => {
  const editor = await read("src/components/business/policy-editor.tsx");
  assert.match(editor, /website_policies/);
  assert.match(editor, /mou_terms_versions/);
  assert.match(editor, /publish_website_policy/);
  assert.match(editor, /publish_mou_terms/);
});

test("representatives are sent to the new portal and the Super Admin routes moved into the guarded group", async () => {
  const login = await read("src/app/login/page.tsx");
  assert.match(login, /router\.replace\("\/sales"\)/);
  assert.match(login, /href="\/super-admin\/login"/);
  assert.match(login, /Sales Team members, use the platform login/);
  const platformLogin = await read("src/app/super-admin/login/page.tsx");
  assert.match(platformLogin, /profile\.platform_role === "sales_rep"/);
  assert.match(platformLogin, /representative\?\.status !== "active"/);
  assert.match(platformLogin, /router\.replace\("\/sales"\)/);
  const nav = await read("src/app/super-admin/(portal)/layout.tsx");
  for (const href of ["/super-admin/schools", "/super-admin/sales-team", "/super-admin/leads", "/super-admin/plans", "/super-admin/mous/initial", "/super-admin/mous/final", "/super-admin/invoices", "/super-admin/payments", "/super-admin/outstanding", "/super-admin/company-settings", "/super-admin/policies/privacy", "/super-admin/policies/terms", "/super-admin/reports"]) {
    assert.ok(nav.includes(href), `missing nav item ${href}`);
  }
  const sales = await read("src/app/sales/layout.tsx");
  assert.match(sales, /requirePortalRole\("sales_rep", "\/super-admin\/login"\)/);
  assert.match(sales, /signOutRedirect="\/super-admin\/login"/);
  for (const href of ["/sales/schools/new", "/sales/mous/initial", "/sales/mous/final", "/sales/collections", "/sales/reports", "/sales/profile"]) {
    assert.ok(sales.includes(href), `missing nav item ${href}`);
  }
  const homepage = await read("src/app/page.tsx");
  assert.match(homepage, /Sales Team Login/);
  assert.match(homepage, /Sales Team \/ Super Admin Login/);
});
