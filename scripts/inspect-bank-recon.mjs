import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const schoolRes = await supabase.from("schools").select("id, name");
console.log("ALL SCHOOLS:");
for (const s of schoolRes.data || []) console.log("  ", s.id, JSON.stringify(s.name));

const TARGET = process.argv[2];
const matches = (schoolRes.data || []).filter((s) => s.name === TARGET || s.id === TARGET);
const sid = matches[matches.length - 1]?.id;
console.log("\nTARGET:", TARGET, "SID:", sid, "matches:", matches.length);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const su = await supabase
  .from("school_users")
  .select("user_id, role, is_active")
  .eq("school_id", sid)
  .eq("is_active", true);
console.log("SCHOOL_USERS:", JSON.stringify(su.data));

const ownerId = (su.data || []).find((r) => r.role === "owner")?.user_id || (su.data || [])[0]?.user_id;
const email = (await admin.auth.admin.getUserById(ownerId)).data.user.email;
console.log("AUTH AS:", email, ownerId);

const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
const userClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const verify = await userClient.auth.verifyOtp({
  token_hash: link.data.properties.hashed_token,
  type: "magiclink",
});
if (verify.error) { console.log("VERIFY FAIL", verify.error.message); process.exit(1); }
const token = verify.data.session.access_token;

const headers = { Authorization: `Bearer ${token}`, apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
async function q(path) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { headers });
  const body = await r.text();
  try { return JSON.parse(body); } catch { return { error: body.slice(0, 300) }; }
}

const accounts = await q("accounts?select=id,code,name,account_type,is_active&school_id=eq." + sid + "&is_active=eq.true");
const bankAccounts = accounts.filter((a) => a.account_type === "bank");
console.log("BANK ACCOUNTS:", bankAccounts.map((a) => `${a.name}(${a.code}) ${a.id}`).join(" | "));

const entries = await q("ledger_entries?select=id,school_id,transaction_id,account_id,debit,credit,description&school_id=eq." + sid);
const tx = await q("ledger_transactions?select=id&school_id=eq." + sid + "&order=transaction_date.asc,created_at.asc");
console.log("tx rows:", tx.length, "entry rows:", entries.length);

// Verify PostgREST max-rows limit
const ranged = await q("ledger_transactions?select=id&school_id=eq." + sid + "&order=transaction_date.asc,created_at.asc&limit=1000");
const ranged2 = await q("ledger_transactions?select=id&school_id=eq." + sid + "&order=transaction_date.asc,created_at.asc&offset=1000&limit=1000");
console.log("page1:", ranged.length, "page2:", ranged2.length);
const exact = await q("ledger_transactions?select=id&school_id=eq." + sid + "&order=transaction_date.asc,created_at.asc&limit=5000");
console.log("limit=5000 ->", exact.length);

// Base tables
const jeAll = await q("journal_entries?select=id&school_id=eq." + sid);
const jlAll = await q("journal_lines?select=id&school_id=eq." + sid);
console.log("journal_entries:", jeAll.length, "journal_lines:", jlAll.length);

// RPC truncation check
const rh = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/get_receipt_history`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ p_school_id: sid }),
});
const rhBody = await rh.json();
console.log("get_receipt_history rows:", Array.isArray(rhBody) ? rhBody.length : JSON.stringify(rhBody).slice(0, 200));

// Cash / Bank book views
for (const view of ["cash_book", "bank_book"]) {
  const rows = await q(`${view}?select=*&school_id=eq.${sid}`);
  console.log(`${view} rows:`, rows.length);
}

// Is there an exec_sql RPC?
const exec = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ sql: "select 1" }),
});
console.log("exec_sql status:", exec.status);

// Test 1: Range header pagination (what supabase-js .range() uses)
async function qRange(path, from, to) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...headers, Range: `${from}-${to}` },
  });
  const body = await r.text();
  try { return JSON.parse(body); } catch { return { error: body.slice(0, 300) }; }
}
const base = "ledger_transactions?select=id&school_id=eq." + sid + "&order=transaction_date.asc,created_at.asc";
console.log("RANGE page1 (0-999):", (await qRange(base, 0, 999)).length);
console.log("RANGE page2 (1000-1999):", (await qRange(base, 1000, 1999)).length);
console.log("RANGE page3 (2000-2999):", (await qRange(base, 2000, 2999)).length);

// Test 2: offset/limit pagination
async function qOffset(path, offset, limit) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}${sep}offset=${offset}&limit=${limit}`, { headers });
  const body = await r.text();
  try { return JSON.parse(body); } catch { return { error: body.slice(0, 300) }; }
}
console.log("OFFSET page1:", (await qOffset(base, 0, 1000)).length);
console.log("OFFSET page2:", (await qOffset(base, 1000, 1000)).length);
console.log("OFFSET page3:", (await qOffset(base, 2000, 1000)).length);

// Test 3: exact count via Prefer: count=exact
const cr = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${base}&limit=1`, {
  headers: { ...headers, Prefer: "count=exact" },
});
console.log("count header:", cr.headers.get("content-range"));

// Test 4: other table counts
for (const t of ["accounts", "opening_balances", "transactions", "transaction_entries"]) {
  const rr = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?select=id&school_id=eq.${sid}&limit=1`, {
    headers: { ...headers, Prefer: "count=exact" },
  });
  console.log(`${t} count:`, rr.headers.get("content-range"));
}
for (const v of ["ledger_transactions", "ledger_entries"]) {
  const rr = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${v}?select=id&school_id=eq.${sid}&limit=1`, {
    headers: { ...headers, Prefer: "count=exact" },
  });
  console.log(`${v} count:`, rr.headers.get("content-range"));
}

const txMap = new Map(tx.map((t) => [t.id, t]));

// Duplicate detection: entries whose transaction_id appears twice with same account+amount
const dupes = {};
for (const e of entries) {
  const t = txMap.get(e.transaction_id);
  if (!t) { console.log("ORPHAN entry (no tx):", e.id, e.description); continue; }
  const key = `${t.transaction_date}|${e.account_id}|${e.debit}|${e.credit}`;
  dupes[key] = (dupes[key] || 0) + 1;
}
console.log("\n=== DUPLICATE DETECTION (same date+account+amount) ===");
let dupCount = 0;
for (const [k, v] of Object.entries(dupes)) if (v > 1) { console.log("DUP x" + v, k); dupCount++; }
console.log("duplicate groups:", dupCount);

const superseded = await q("legacy_superseded_transactions?select=*&school_id=eq." + sid);
console.log("\nSUPERSEDED legacy tx count:", superseded.length);
console.log(JSON.stringify(superseded, null, 2));

const legacyTx = await q("transactions?select=id,transaction_date,transaction_type,reference_type,reference_id,description&school_id=eq." + sid);
console.log("\nLEGACY transactions rows:", legacyTx.length);
console.log(JSON.stringify(legacyTx, null, 2));

const legacyEntries = await q("transaction_entries?select=id,transaction_id,account_id,debit,credit,description&school_id=eq." + sid);
console.log("\nLEGACY transaction_entries rows:", legacyEntries.length);
console.log(JSON.stringify(legacyEntries.slice(0, 12), null, 2));

// Simulate the page's bankRows for the SBI bank account
for (const bank of bankAccounts) {
  const rows = entries
    .filter((e) => e.account_id === bank.id)
    .map((e) => ({ e, t: txMap.get(e.transaction_id) }))
    .filter((x) => x.t);
  console.log(`\n=== PAGE bankRows for ${bank.name} ===`, rows.length);
  for (const { e, t } of rows) {
    console.log(`${t.transaction_date} | ${t.transaction_type.padEnd(14)} | in=${e.debit} out=${e.credit} | ${e.description} | tx=${t.description}`);
  }
}
