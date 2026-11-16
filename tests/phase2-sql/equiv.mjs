import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDb } from "./load.mjs";
const repo = fileURLToPath(new URL("../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const files = readdirSync(`${repo}/supabase/migrations`).filter(f => f.startsWith("20261116")).sort();
console.log(files.join("\n"));

async function schemaFingerprint(db) {
  const q = async (s) => (await db.query(s)).rows.map(r => Object.values(r).join("|")).join("\n");
  return {
    tables: await q(`select c.relname||':'||c.relrowsecurity from pg_class c where relnamespace='public'::regnamespace and relkind in ('r','v') order by 1`),
    cols: await q(`select table_name||'.'||column_name||':'||data_type||coalesce(numeric_precision::text,'')||coalesce(numeric_scale::text,'') from information_schema.columns where table_schema='public' order by 1`),
    funcs: await q(`select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||p.prosecdef from pg_proc p where pronamespace='public'::regnamespace order by 1`),
    trig: await q(`select c.relname||'.'||t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace order by 1`),
    pol: await q(`select schemaname||'.'||tablename||'.'||policyname from pg_policies order by 1`),
    idx: await q(`select indexname from pg_indexes where schemaname='public' order by 1`),
    con: await q(`select conrelid::regclass::text||'.'||conname from pg_constraint where connamespace='public'::regnamespace order by 1`),
  };
}

// A: apply the individual migration files in order (CLI style, one at a time)
const dbA = await loadDb();
for (const f of files) {
  try { await dbA.exec(readFileSync(`${repo}/supabase/migrations/${f}`, "utf8")); console.log("A ok", f); }
  catch (e) { console.log("A FAIL", f, e.message); process.exit(1); }
}
// B: consolidated SQL Editor scripts
const dbB = await loadDb();
await dbB.exec(readFileSync(`${repo}/docs/phase-2-step-1-sales-rep-enum.sql`, "utf8"));
await dbB.exec(readFileSync(`${repo}/docs/phase-2-supabase-sql-editor.sql`, "utf8"));
const fa = await schemaFingerprint(dbA), fb = await schemaFingerprint(dbB);
let same = true;
for (const k of Object.keys(fa)) if (fa[k] !== fb[k]) { same = false; console.log("DIFF in", k); }
console.log(same ? "individual migrations == consolidated script" : "MISMATCH");

// C: re-running the consolidated script must not fail or duplicate anything
await dbB.exec(readFileSync(`${repo}/docs/phase-2-step-1-sales-rep-enum.sql`, "utf8"));
await dbB.exec(readFileSync(`${repo}/docs/phase-2-supabase-sql-editor.sql`, "utf8"));
const fc = await schemaFingerprint(dbB);
console.log(JSON.stringify(fb) === JSON.stringify(fc) ? "re-run is idempotent" : "RE-RUN CHANGED SCHEMA");
console.log("tenant rows:", (await dbB.query(`select count(*)::int c from schools where is_platform_internal`)).rows[0].c,
  "plans:", (await dbB.query(`select count(*)::int c from subscription_plans`)).rows[0].c,
  "prices:", (await dbB.query(`select count(*)::int c from subscription_plan_prices`)).rows[0].c,
  "policies:", (await dbB.query(`select count(*)::int c from website_policies`)).rows[0].c,
  "terms:", (await dbB.query(`select count(*)::int c from mou_terms_versions`)).rows[0].c,
  "accounts:", (await dbB.query(`select count(*)::int c from accounts`)).rows[0].c);

// D: verification script runs and the EXPECT-0 blocks are empty
const ver = readFileSync(`${repo}/docs/phase-2-verification.sql`, "utf8");
const results = await dbB.exec(ver);
console.log("verification statements:", results.length);
results.forEach((r, i) => {
  const rows = r.rows.length;
  const first = r.fields.map(f => f.name).slice(0, 3).join(",");
  console.log(i + 1, rows, "rows", first);
});
