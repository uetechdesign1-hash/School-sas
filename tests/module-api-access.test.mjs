import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const supabaseMock = `data:text/javascript,${encodeURIComponent(
  "export const createClient = (...args) => globalThis.testClients.shift();",
)}`;
const modulesUrl = new URL("../src/lib/modules.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/supabase-js") {
      return { url: supabaseMock, shortCircuit: true };
    }
    if (specifier === "@/lib/modules") {
      return { url: modulesUrl, shortCircuit: true };
    }
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    return nextResolve(specifier, context);
  },
});

const { POST: syncAttendance } = await import(
  "../src/app/api/staff/attendance/offline-sync/route.ts"
);

function makeRequest() {
  return new Request("https://school.test/api/staff/attendance/offline-sync", {
    method: "POST",
    headers: {
      authorization: "Bearer user-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      request_id: "4bb1d5bc-a1a0-4c69-8d86-4fdb2bcdad9a",
      user_id: "staff-user",
      staff_id: "a11b8d23-fd9c-45b0-80f1-8c8f4e9780b4",
      action: "check_in",
      captured_at: "2026-11-13T08:00:00.000Z",
      latitude: 17.4,
      longitude: 78.4,
      accuracy_meters: 15,
    }),
  });
}

function query(data) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle: async () => ({ data, error: null }),
  };
  return builder;
}

function installClients(enabledModules) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://school.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

  const rpcCalls = [];
  globalThis.testClients = [
    {
      auth: {
        getUser: async () => ({
          data: { user: { id: "staff-user" } },
          error: null,
        }),
      },
    },
    {
      from(table) {
        if (table === "staff") {
          return query({ school_id: "school-a" });
        }
        if (table === "schools") {
          return query({ enabled_modules: enabledModules });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
      rpc: async (...args) => {
        rpcCalls.push(args);
        return { data: { success: true }, error: null };
      },
    },
  ];

  return rpcCalls;
}

test("offline attendance API denies schools without payroll entitlement", async () => {
  const rpcCalls = installClients(["fees"]);
  const response = await syncAttendance(makeRequest());
  const result = await response.json();

  assert.equal(response.status, 403);
  assert.match(result.error, /not included/);
  assert.equal(rpcCalls.length, 0);
});

test("offline attendance API continues for payroll-entitled schools", async () => {
  const rpcCalls = installClients(["payroll"]);
  const response = await syncAttendance(makeRequest());

  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, 1);
});
