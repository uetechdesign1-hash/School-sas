// Builds the Supabase SQL Editor deployment scripts from the Phase 2 migration
// files, so the two can never drift apart.
//
//   node scripts/build-phase2-sql.mjs          write the docs/ scripts
//   node scripts/build-phase2-sql.mjs --check  fail if the docs/ scripts are stale
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = join(root, "supabase", "migrations");

const STEP_1 = "20261116090000_phase2_sales_rep_enum.sql";
const STEP_2 = [
  "20261116100000_phase2_foundation.sql",
  "20261116110000_phase2_company_documents_plans.sql",
  "20261116120000_phase2_sales_crm.sql",
  "20261116130000_phase2_contracts.sql",
  "20261116140000_phase2_billing.sql",
  "20261116150000_phase2_accounting_integration.sql",
  "20261116160000_phase2_business_rpcs.sql",
  "20261116170000_phase2_reporting_storage.sql",
  "20261116180000_super_admin_school_cleanup.sql",
  "20261116181000_school_cleanup_audit_scope.sql",
];

const read = (name) => readFileSync(join(migrations, name), "utf8").replace(/\r\n/g, "\n").trimEnd();
const rule = "-- " + "=".repeat(76);

function step1() {
  return [
    "-- PHASE 2 - STEP 1 OF 2 (run this on its own, FIRST)",
    "-- Supabase Dashboard > SQL Editor > New query > paste > Run.",
    "-- It only adds the sales_rep enum value. Wait for it to succeed (it commits),",
    "-- then open a NEW query and run docs/phase-2-supabase-sql-editor.sql.",
    "-- Generated from supabase/migrations/" + STEP_1 + " - do not edit by hand.",
    "",
    read(STEP_1),
    "",
  ].join("\n");
}

function step2() {
  const parts = [
    "-- PHASE 2 - STEP 2 OF 2: complete Business Management schema",
    "-- Supabase Dashboard > SQL Editor > New query > paste > Run.",
    "--",
    "-- Prerequisite: docs/phase-2-step-1-sales-rep-enum.sql has already succeeded.",
    "-- The whole script runs in one transaction: any failed preflight or statement",
    "-- rolls everything back and leaves the database unchanged.",
    "-- Run it once. After it succeeds, run docs/phase-2-verification.sql.",
    "-- Generated from supabase/migrations/ - do not edit by hand; re-run",
    "-- `node scripts/build-phase2-sql.mjs` after changing a migration.",
    "",
    "BEGIN;",
    "",
  ];
  for (const name of STEP_2) {
    parts.push(rule, "-- " + name, rule, "", read(name), "");
  }
  parts.push(
    "COMMIT;",
    "",
    "-- Make PostgREST pick up the new tables, views and functions.",
    "NOTIFY pgrst, 'reload schema';",
    "",
  );
  return parts.join("\n");
}

const outputs = {
  [join(root, "docs", "phase-2-step-1-sales-rep-enum.sql")]: step1(),
  [join(root, "docs", "phase-2-supabase-sql-editor.sql")]: step2(),
};

if (process.argv.includes("--check")) {
  let stale = false;
  for (const [path, content] of Object.entries(outputs)) {
    const current = existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : null;
    if (current !== content) {
      console.error("STALE: " + path);
      stale = true;
    }
  }
  process.exit(stale ? 1 : 0);
}

for (const [path, content] of Object.entries(outputs)) {
  writeFileSync(path, content);
  console.log("wrote " + path);
}
