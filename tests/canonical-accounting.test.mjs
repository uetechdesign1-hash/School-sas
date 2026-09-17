import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_ACCOUNT_TEMPLATES,
  ensureSchoolAccountingSetup,
} from "../src/lib/accounting/canonical-accounting.ts";

const schoolId = "test-school";
const accounts = DEFAULT_ACCOUNT_TEMPLATES.map((template, index) => ({
  ...template,
  id: `account-${index}`,
  school_id: schoolId,
}));

function mockClient(steps) {
  const pending = [...steps];
  const client = createClient("https://accounting-test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.searchParams.get("school_id"),
          init?.method === "POST" ? null : `eq.${schoolId}`);
        if (url.pathname.endsWith("/fiscal_years")) {
          return Response.json({ id: "fiscal-year", name: "2026-27" });
        }
        assert.ok(url.pathname.endsWith("/accounts"));
        const step = pending.shift();
        assert.ok(step, "Unexpected accounts request");
        assert.equal(init?.method || "GET", step.method || "GET");
        step.check?.(url, init);
        return Response.json(step.data, { status: step.status || 200 });
      },
    },
  });
  return { client, done: () => assert.equal(pending.length, 0) };
}

function checkUpsert(url, init) {
  assert.equal(url.searchParams.get("on_conflict"), "school_id,name");
  assert.match(new Headers(init.headers).get("Prefer"), /resolution=ignore-duplicates/);
  assert.ok(JSON.parse(init.body).every((row) => row.school_id === schoolId));
}

function assertComplete(setup, rows = accounts) {
  assert.equal(setup.fiscalYearId, "fiscal-year");
  assert.deepEqual(setup.accountMap, Object.fromEntries(
    DEFAULT_ACCOUNT_TEMPLATES.map((template) => [
      template.code,
      rows.find((row) => row.code === template.code || row.name === template.name).id,
    ]),
  ));
}

test("creates missing defaults and returns their IDs", async () => {
  const mock = mockClient([
    { data: [] },
    { method: "POST", data: accounts, check: checkUpsert },
  ]);
  assertComplete(await ensureSchoolAccountingSetup(mock.client, schoolId));
  mock.done();
});

test("two concurrent setup calls reuse rows skipped by the upsert", async () => {
  // Both reads observe an empty school before either insert completes.
  const mock = mockClient([
    { data: [] },
    { data: [] },
    { method: "POST", data: accounts, check: checkUpsert },
    { method: "POST", data: [], check: checkUpsert },
    { data: accounts },
  ]);
  const results = await Promise.all([
    ensureSchoolAccountingSetup(mock.client, schoolId),
    ensureSchoolAccountingSetup(mock.client, schoolId),
  ]);
  results.forEach((setup) => assertComplete(setup));
  mock.done();
});

test("reuses an existing named account under a legacy code without writing", async () => {
  const rows = accounts.map((row, index) => index === 0 ? { ...row, code: "LEGACY_CASH" } : row);
  const mock = mockClient([{ data: rows }]);
  assertComplete(await ensureSchoolAccountingSetup(mock.client, schoolId), rows);
  mock.done();
});

test("refetches a concurrently inserted duplicate name under a different code", async () => {
  const legacy = { ...accounts[0], code: "LEGACY_CASH" };
  const mock = mockClient([
    { data: accounts.slice(1) },
    { method: "POST", data: [], check: checkUpsert },
    { data: [] },
    { data: [legacy], check: (url) => assert.ok(url.searchParams.get("name").includes("Cash")) },
  ]);
  assertComplete(await ensureSchoolAccountingSetup(mock.client, schoolId));
  mock.done();
});

test("fails explicitly rather than returning an incomplete map for unreadable rows", async () => {
  const mock = mockClient([
    { data: accounts.slice(1) },
    { method: "POST", data: [], check: checkUpsert },
    { data: [] },
    { data: [] },
  ]);
  await assert.rejects(
    ensureSchoolAccountingSetup(mock.client, schoolId),
    /could not resolve accounts: CASH/,
  );
  mock.done();
});

test("preserves database errors unrelated to duplicate names", async () => {
  const mock = mockClient([
    { data: [] },
    { method: "POST", data: { code: "42501", message: "permission denied" }, status: 403 },
  ]);
  await assert.rejects(ensureSchoolAccountingSetup(mock.client, schoolId), /permission denied/);
  mock.done();
});
