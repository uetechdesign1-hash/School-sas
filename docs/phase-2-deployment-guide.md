# Phase 2 deployment guide - Business Management database

Status: **prepared, not executed.** Nothing in this guide has been run against
the live Supabase project. The only live access during preparation was
read-only catalog `SELECT`s to verify the schema the SQL depends on.

## 1. Deliverables

| File | Purpose |
|---|---|
| `docs/phase-2-step-1-sales-rep-enum.sql` | **Run first, alone.** Adds `sales_rep` to `platform_role`. |
| `docs/phase-2-supabase-sql-editor.sql` | **Run second, in a new query.** Everything else, in one transaction. |
| `docs/phase-2-verification.sql` | Read-only checks to run after step 2. |
| `supabase/migrations/20261116090000_phase2_sales_rep_enum.sql` | Step 1 as a migration file |
| `supabase/migrations/20261116100000_phase2_foundation.sql` | Preflight, Phase 1 agreement prerequisites, tenant protections, privilege guard, audit log, numbering |
| `supabase/migrations/20261116110000_phase2_company_documents_plans.sql` | Company settings, `website_policies`, `mou_terms_versions`, plans and versioned prices |
| `supabase/migrations/20261116120000_phase2_sales_crm.sql` | Sales reps, provisioning jobs, ownership + history, leads, activity log |
| `supabase/migrations/20261116130000_phase2_contracts.sql` | Agreement columns on `school_subscriptions`, history, MOU snapshots, billing-count confirmations |
| `supabase/migrations/20261116140000_phase2_billing.sql` | Invoices, payments, verification log, refunds/reversals |
| `supabase/migrations/20261116150000_phase2_accounting_integration.sql` | Hidden platform-company tenant and ledger posting |
| `supabase/migrations/20261116160000_phase2_business_rpcs.sql` | All business RPCs |
| `supabase/migrations/20261116170000_phase2_reporting_storage.sql` | Reporting views, dashboard totals, private storage bucket, schema reload |
| `supabase/migrations/20261116180000_super_admin_school_cleanup.sql` | Server-only transactional cleanup for subscription, billing, MOU, and sales records when a Super Admin deletes a school |
| `supabase/migrations/20261116181000_school_cleanup_audit_scope.sql` | Restricts audit-log cleanup to rows for the selected school while preserving append-only behavior otherwise |
| `scripts/build-phase2-sql.mjs` | Generates the two `docs/*.sql` scripts from the migrations |

The two `docs/` scripts are generated, never hand-edited:

```
node scripts/build-phase2-sql.mjs          # regenerate
node scripts/build-phase2-sql.mjs --check  # exit 1 if they are stale
```

## 2. What was verified on the live database (read-only)

- `platform_role` has only `user`, `super_admin`. `schools` lacks every Phase 1
  agreement column, and `school_subscriptions` lacks `payment_terms`. The Phase 1
  migrations from `20261113` onward are not applied (only three are recorded in
  `schema_migrations`). Step 2 therefore includes the Phase 1 agreement
  prerequisites (identical text, so applying the Phase 1 file later is a no-op).
- `accounting_events` has the unique index
  `(school_id, source_module, source_table, source_record_id)`; posting relies on it.
- `journal_entries.entry_type` already allows `receipt` and `refund`.
- Every accounting table is per-school (`school_id NOT NULL`, FK to `schools`).
- `ensure_school_accounting_setup` creates one fiscal year and the codes `CASH`,
  `BANK`, `STUDENT_FEES`, `OTHER_INCOME`; there is no subscription income account.
- Supabase default privileges grant **ALL on every new public table and function to
  `anon` and `authenticated`**. Every Phase 2 object is explicitly revoked and
  re-granted (checked by `phase-2-verification.sql`).
- Storage has no buckets and no policies yet.

### Existing risk found (not changed by Phase 2)

The live `create_journal_entry` and `ensure_school_accounting_setup` are the
**pre-hardening versions**: no caller authorisation and executable by `anon`. The
hardening migrations `20261109140000` and `20261109150000` are in the repository
but not applied. Phase 2 does not depend on them, but you should apply them.

Because the hardened `create_journal_entry` requires the caller to be an
owner/admin/accountant of the target school, and the platform-company tenant has
no members by design, Phase 2 posts to the same canonical tables through its own
internal functions (same balance, fiscal-year, account-ownership and
`accounting_events` idempotency rules). See migration 07.

## 3. Impact on the running application

Read this before running step 2.

1. Step 2 activates the Phase 1 school-creation guard (explicit plan, student
   strength, agreed price, payment terms, confirmed discussion, `created_by =
   caller`). School creation by service-role code that does not send those fields
   will be rejected. The Phase 1 create route in the working tree is compatible.
   **Deploy the Phase 1 application code together with this SQL.**
2. Sales representatives can no longer insert into `schools` directly; they must
   use `create_school_sale`. The Phase 2D app already does (the old
   `/sales/schools/new` page was replaced by the guided wizard). Super Admin
   creation is unaffected at the database level.
3. Hard-deleting a school that has sales or billing records is now refused
   (`ON DELETE RESTRICT`) to protect financial history.
4. The hidden platform-company tenant is a row in `schools` with
   `is_platform_internal = true`. RLS hides it from every API reader, but
   **service-role queries bypass RLS**. Reviewed: the only existing server code that
   lists schools in bulk with the service role is
   `/api/super-admin/schools/student-counts`; the tenant has no students, so it only
   adds one harmless zero-count query. It was deliberately not changed, because
   filtering on `is_platform_internal` would break that route if the app were
   deployed before this SQL. All Phase 2 screens read through the user's JWT.

## 4. Execution (Supabase Dashboard > SQL Editor)

1. Take a backup / confirm point-in-time recovery is enabled.
2. **New query** > paste `docs/phase-2-step-1-sales-rep-enum.sql` > **Run**. Wait
   for success. It commits on its own.
3. **New query** > paste `docs/phase-2-supabase-sql-editor.sql` > **Run**. The
   whole script is one `BEGIN ... COMMIT`; a failed preflight or statement rolls
   everything back. A preflight failure lists every missing dependency, e.g.
   `enum value platform_role.sales_rep (run ... first and let it commit)`.
4. **New query** > paste `docs/phase-2-verification.sql` > **Run** and review:
   - results 2, 4, 8 and 17 must return **0 rows**;
   - result 1 shows all 20 tables with `rls_enabled = true` and only `SELECT`
     for `authenticated` on financial tables;
   - result 16 shows exactly one platform tenant with 3 accounts and 0 members;
   - result 13 shows plan1 = 100, plan2 = 5000 (range 2000-5000), both = 150.
5. The script ends with `NOTIFY pgrst, 'reload schema';`. If the API still shows
   stale schema after a minute, run it again from the SQL Editor.

Re-running step 2 is safe: it is idempotent (seeds are conditional and
objects use `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP ... IF EXISTS` only on
Phase 2's own triggers and policies). Do not run the individual migration files
*and* the consolidated script as two separate deployments; choose one path.

**Supabase CLI alternative:** `supabase db push` applies the same nine files in
order; step 1 commits before step 2 because each file is its own transaction.

### Rollback

All Phase 2 changes are additive. There is no destructive rollback script by
design. If step 2 fails it leaves the database unchanged. After a successful
commit, revert through the backup / PITR taken in step 1, or write a reviewed,
targeted rollback for the specific objects you want removed.

## 5. How the design corrections are met

| # | Requirement | Where |
|---|---|---|
| 1 | Independent version histories | `website_policies` (per type) and `mou_terms_versions` are separate tables with their own version triggers, publish RPCs and immutability; each MOU stores `terms_version_id`, `terms_version` and the full text in its snapshot |
| 2 | Hidden platform tenant | `is_platform_internal` + single-row unique index; RESTRICTIVE select policies; triggers reject members, subscriptions, ownership, invoices, payments, MOUs; flag and row cannot be changed or deleted; creation only from an operator session |
| 3 | Payment security | per-submitter `idempotency_key`; non-null normalised unique `transaction_reference` (rejected payments release it); duplicate guard with explicit acknowledgement; `payment_reversals` for partial refunds with locked running total; verified rows immutable and undeletable (trigger + no DML grants); `accounting_journal_entry_id` unique plus the `accounting_events` unique index |
| 4 | Attribution | `school_sales_ownership.original_acquisition_rep_id` (immutable, trigger-enforced) vs `current_rep_id`; append-only `school_sales_assignments`; `sales_rep_performance` credits the original rep |
| 5 | Safe invitations | `business_provisioning_jobs` + claim / record / complete / fail / reset / cancel RPCs (section 6) |
| 6 | Enum step | separate file and separate script; step 2 preflight refuses to run until the value exists |
| 7 | Accounting verification | section 2; preflight re-checks the index, entry-type constraint, unique `accounts(school_id, code)` |
| 8 | Pricing | seeded in `subscription_plan_prices`; no price in app code |
| 9 | Accounting policy | contract and invoice post nothing; pending posts nothing; verified: Dr `CASH`/`BANK`, Cr `SUBSCRIPTION_INCOME` once; refund/reversal: one reversing `refund` entry per refund row |
| 10 | Consistency | generated scripts; both paths tested to produce identical schemas |

## 6. Provisioning workflow for the application (Phase 2D)

The Auth Admin API cannot join a database transaction, so the flow is resumable
and every step is idempotent. The service-role key is used **only** for the Auth
Admin calls; every database call uses the signed-in user's JWT.

```
start_sales_rep_provisioning / create_school_sale / start_school_owner_provisioning
    -> job (pending)            [DB transaction]
claim_provisioning_job          -> 5-minute lease, attempts + 1
Auth Admin: inviteUserByEmail or createUser, looked up by job.target_email first
record_provisioned_auth_user    -> job (auth_created), login id stored durably
complete_provisioning_job       -> role / profile / membership, job (completed)  [DB transaction]
on error: fail_provisioning_job (keeps the stored login id; retry resumes)
```

- A crash after the Auth call leaves `auth_created` with the login id stored, so
  a retry never creates a second login.
- A school is created atomically with its agreement, ownership, first invoice and
  owner job. If owner provisioning stalls, the school stays visible to its
  representative and Super Admin with a retry action; it is never orphaned.
- `cancel_provisioning_job` reports `safe_to_delete_auth_user`; the API deletes the
  login only when that is true.
- `list_orphan_auth_accounts()` (Super Admin) lists logins older than 15 minutes
  with no profile, membership or job.

## 7. Assumptions to confirm

1. **Plan 2 list price = 5,000**, with advisory range 2,000-5,000 per school per
   year. A negotiated price outside the range is allowed and flagged
   (`price_outside_recommended_range`), as your examples require (Both Plans at
   60 against a 150 default).
2. All prices are **per 12-month contract year**; terms are whole years
   (`contract_term_months` multiple of 12). Contract = units x price x years -
   discount.
3. Monthly invoicing requires `monthly_instalments_allowed`. Each invoice spreads
   what is still uninvoiced over the periods still missing, so the contract is
   never invoiced twice. An approved Final MOU increase after every period was
   invoiced becomes one supplementary invoice (issued by Super Admin through
   `generate_school_invoices`). Decreases are handled by cancelling/reissuing or
   refunds, not negative invoices.
4. GST (`company_settings.default_gst_rate`, default 0) is added on top of the
   contract amount; `invoice_due_days` defaults to 15.
5. Payments must reference an invoice. Cash without a reference gets a generated
   unique one. Cheque references should include the bank (e.g. `HDFC-000123`)
   because references are unique across all modes.
6. The seeded privacy policy, website terms and MOU terms are short generic
   starter texts published as version 1. Have counsel review and publish your own.
7. Company logo and signature are stored in the private `company-assets` bucket;
   representatives can read them so the PDFs they download carry the branding.
   The PDF must label the signature as a visual signature only; the snapshot
   carries that notice.

## 8. Testing performed

The SQL was executed against an in-process PostgreSQL (PGlite) loaded with a
stand-in for the inspected live schema, including the default `anon` /
`authenticated` grants, the live triggers and the live accounting constraints,
using real role switching so RLS and privileges were exercised. 87 checks pass:

- Representatives A and B created through the provisioning flow, failure/retry,
  idempotency, exhausted retries, reset and cancel.
- A cannot read, pay, invoice or generate MOUs for B's school; B cannot touch A's
  payment; representatives cannot approve their own payments or Final MOU
  requests, change roles, prices or company settings, or insert schools directly.
- 300 x 60 = 18,000 for Both Plans; Plan 1 (100/student); Plan 2 per school;
  monthly (1,500 x 12) and yearly invoicing without duplicates.
- Initial MOU versions, branding/terms snapshots surviving later changes, Final
  MOU 350 x 60 = 21,000 with the Initial MOU intact.
- Pending payment posts nothing and is not counted; verification posts exactly one
  entry in the hidden tenant; repeat verification posts nothing; partial and full
  refunds and reversals post one reversing entry each; verified payments cannot
  be edited or deleted even from a privileged session.
- Reassignment preserves original attribution; platform tenant is invisible and
  cannot gain members or records.
- Anonymous access limited to published policies; no `anon` privileges or
  executable functions on Phase 2 objects.
- Individual migration files and the consolidated script produce identical
  schemas, re-running is a no-op, and preflight failures abort cleanly.

**Re-running the checks locally** (the test dependency is deliberately not added to
`package.json`):

```
npm install --no-save @electric-sql/pglite
node tests/phase2-sql/scenarios.mjs     # 87 scenario / security checks
node tests/phase2-sql/equiv.mjs    # migrations == consolidated script, re-run idempotent, verification SQL
```

**Not yet done:** nothing has run on the real Supabase instance (storage policies
and Supabase's own roles behave slightly differently from the stand-in, so run the
verification script and review its output), and no application code, TypeScript,
ESLint or build checks apply until Phase 2D.
