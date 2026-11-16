# Phase 1: Modular school subscriptions

## Audit findings

- The deployed `schools.enabled_modules` column was `text[] NOT NULL` with a
  `fees,payroll` default and a CHECK constraint that also allowed the retired
  module. The unapplied forward migration removes that default and leaves only
  Fees and Payroll as selectable values.
- The deployed `guard_school_modules_change` and
  `audit_school_modules_change` triggers were inspected read-only and retained.
  The guard checks active Super Admin profiles for user-authenticated changes;
  the audit trigger records module changes in `audit_logs`.
- The deployed `school_has_module(uuid,text)` helper exists, but none of the
  inspected fee, payroll, or attendance RLS policies called it.
  Multiple existing policies are permissive, so an additional permissive policy
  would not restrict access.
- The helper is `SECURITY DEFINER`; several fee, attendance, and payroll RPCs
  are also `SECURITY DEFINER` and do not call the module helper. Table RLS alone
  will not enforce entitlements inside those routines.
- The live migration history and this branch contain no migration defining the
  deployed module column/helper/triggers. The module schema appears to have been
  installed outside the checked-in migration history.
- The Super Admin create-school UI invoked a `create-school` Edge Function,
  while the checked-in Super Admin create API was a separate path. Creation now
  uses the checked-in API so module selection is validated and persisted there.
- The checked-in application contains no transport route pages, layouts,
  components, APIs, Edge Functions, or transport-specific test files. The
  deployed database does contain legacy transport tables; their inventory and
  retirement plan are documented below.

## Implemented

- Added the shared module allowlist, validation, route-to-module mapping, and
  fail-closed entitlement checks in `src/lib/modules.ts`.
- Added a reusable selector for Fees and Payroll.
- Added explicit module selection to Super Admin school creation. New schools
  must select Fees, Payroll, or both; empty module arrays are retained only for
  existing schools awaiting reassignment.
- The Create School form submits its selected codes as `enabled_modules` and
  shows a validation message when none are selected. Alternate legacy school
  creation paths do not yet accept these selections and must not be used to
  create a school with a specific module combination.
- Added module display and saving to the school details page. The new
  `update_modules` API action verifies an active Super Admin and writes with
  that user's bearer token, so the existing database guard and audit trigger
  receive the authenticated actor instead of a service-role write.
- Added entitlement route checks in Next.js Proxy for fee and payroll pages,
  and protected accounting paths with the existing login flow. Unauthorized
  module pages are redirected; membership/schema lookup failures fail closed.
- Aligned dashboard school selection with its existing staff-first, then
  first-active-membership behavior. Module links and fee dashboard totals are
  filtered by the selected school's entitlement.
- Added a payroll entitlement check to the server-side offline attendance API.
- Added a new **unapplied** migration that adds restrictive module policies to
  the existing fee and payroll/staff-attendance tables without replacing
  their school/role policies. It requires the already deployed
  `school_has_module(uuid,text)` helper and fails explicitly if the expected
  schema/RLS is missing.

## Phase 1 files changed

- `src/lib/modules.ts` (new)
- `src/components/super-admin/module-selector.tsx` (new)
- `src/app/super-admin/page.tsx`
- `src/app/super-admin/schools/[id]/page.tsx`
- `src/app/api/super-admin/schools/create/route.ts`
- `src/app/api/super-admin/schools/manage/route.ts`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/page.tsx`
- `src/proxy.ts`
- `src/app/api/staff/attendance/offline-sync/route.ts`
- `supabase/migrations/20261114120000_enforce_school_module_entitlements.sql` (new, unapplied)
- `tests/modules.test.mjs` (new)
- `tests/module-api-access.test.mjs` (new)

Pre-existing Phase 0.5 worktree changes and untracked files were preserved and
not reset or discarded.

## Database and migration requirements

- No SQL migration was executed, no live school/customer records were read or
  modified, and nothing was deployed. Live inspection was limited to database
  metadata, function, trigger, policy, constraint, and aggregate role queries.
- The new forward migration does not add another entitlement column/table or
  redefine the existing validation/audit functions. It depends on the deployed
  helper and checks required module tables, `school_id` columns, and RLS before
  adding restrictive policies.
- Review the migration against the exact target schema before applying it.
  The shared module helper continues to guard only fee and payroll data.
- The database helper checks module inclusion and active school membership but
  does not itself check school suspension or expiry. Existing school/portal
  status enforcement remains separate.
- The migration must be applied through the user's reviewed deployment process
  before its table policies protect live PostgREST requests.

## Verification

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Focused school, module, dashboard, and accounting tests: **49 passed**.
- Proxy auth and login-redirect tests: **7 passed** after restoring the
  accounting matcher and using the tested redirect helpers in `src/proxy.ts`.
- Full `node --test`: **94 passed, 1 failed**. The unchanged
  `tests/academic-year-history.test.mjs` imports exports such as
  `SchoolScopeError` and `assertSameSchool` that do not exist in
  `src/lib/students/enrollment-history.ts`.
- Focused ESLint over touched application files reported **18 errors and 63
  warnings**. All 18 errors are pre-existing on lines unchanged from `HEAD`:
  10 `react/no-unescaped-entities`, 7 `react-hooks/set-state-in-effect`, and
  1 `prefer-const`. No autofix was run; no error is on a changed line.
- The production build and TypeScript check passed, but the forward SQL
  migration has not been executed against a disposable PostgreSQL database.
- No live RLS behavior was tested with an authenticated browser or user token.

## Authorized school creation policy addendum

The approved creation policy is implemented locally in
`supabase/migrations/20261115210000_retire_transport_plan_entitlement.sql`.
This addendum supersedes earlier statements in this report that new schools
retain the `fees,payroll` default or that the legacy onboarding caller remains
active.

- New schools are restricted to active Super Admins and Sales Representatives.
  The new `sales_rep` platform role is assignable only through existing
  Super-Admin-controlled `user_profiles` access; this phase does not add a role
  management UI.
- Every creation path must supply at least one plan, student strength, agreed
  price, payment terms, and an attestation that the sales discussion occurred.
  The database records the creator and confirmation time in the school row and
  writes an agreement audit entry.
- `schools.enabled_modules`, `schools.student_limit`, and `schools.plan_code`
  no longer receive creation defaults. The CHECK constraint still permits
  `enabled_modules = []` for existing legacy no-entitlement schools, while the
  database insert trigger rejects empty plans for new schools.
- Public onboarding no longer invokes `create_school_with_owner`; it preserves
  public Auth signup but routes school provisioning through authorized staff.
  The inspected live four-argument RPC remains in the database with
  `EXECUTE` revoked for `anon`, `authenticated`, and `service_role`.
- The existing deployed `create-school` Edge Function is still v2 and has not
  been replaced. After the migration, its service-role school insert will fail
  closed. The checked-in replacement and both local Edge creation candidates
  use the caller JWT and require the complete agreement.
- The migration and Edge changes were not applied to the live Supabase project.
  The current deployed `create-school` and database defaults remain unchanged
  until an approved cutover, so live enforcement must not yet be claimed.
- The deployed `quick-task` function creates owner memberships, not schools.
  Its missing application-level authorization is recorded as a separate
  owner-link security concern and was not changed in this phase.

## Remaining security gaps and next steps

1. The migration is unapplied, so live RLS currently has no module-policy
   enforcement from this work.
2. Security-definer RPCs can bypass table RLS. Before claiming complete
   entitlement enforcement, add and test explicit `school_has_module` checks
   to every exposed fee/payroll/attendance RPC that reads or changes those
   records, or revoke direct execution and route those operations through
   authenticated server APIs. The generic accounting payment screen also
   contains salary workflows and needs a module-aware treatment.
3. Apply the migration only after review, then verify both direct PostgREST
   table access and each security-definer RPC with enabled and disabled module
   entitlements.
4. The ERP still selects school context automatically; there is no explicit
   school switcher. This change uses the existing staff-first/first-active
   membership selection and does not resolve the broader multi-school
   context-selection gap.
## Transport Management retirement inventory and plan

The read-only inventory was collected from the active Supabase project on
2026-11-15. It inspected schema metadata, foreign keys, policies, aggregate
row counts, and account references only; no record values were exported or
changed.

### Application and database inventory

- The checked-in repository has no transport page, layout, component, API
  route, or Edge Function. It also has no transport-specific test file. This
  work removes the remaining salary allowance, chart-of-account defaults,
  cleanup stubs, examples, and obsolete access-policy references.
- Five tracked `payroll-client.tsx.backup*` snapshots still contain the former
  allowance implementation. They are inert archival files, not active `.tsx`
  modules, and were left unchanged; do not restore them as application code.
- The live database contains `public.buses`, `public.routes`, `public.stops`,
  and `public.student_transport`; each currently has **0 rows** and RLS enabled.
  `routes.bus_id` references `buses`; `stops.route_id` references `routes`;
  `student_transport.route_id` and `stop_id` reference `routes` and `stops`.
  Their other foreign keys point to shared schools and students, with
  `ON DELETE CASCADE` on school/student relationships. No other tables have
  incoming foreign keys to these four. They have nine RLS policies in total
  (3 on `buses`, 2 on each remaining table) and no non-internal triggers; table
  policies will be removed with the tables.
- No live `transport_users`, `transport_routes`, or `transport_fees` table was
  found. The `routes` and `stops` tables are legacy transport objects, not
  separate app routes.
- No transport-named database routine exists. The existing
  `create_default_accounts(uuid)` and
  `ensure_school_accounting_setup(uuid,text)` routines still seed old transport
  accounts; the forward migration replaces both bodies to stop future seeding.
- No storage bucket or storage object name contains `transport` or `bus`.
  `cron.job` is absent, so no PostgreSQL cron jobs were found. The only deployed
  Edge Functions are `quick-task` and `create-school`; neither is transport
  functionality.
- The live `staff_salary_structures` and `payroll_items` tables contain 148 and
  34 rows respectively; neither has a non-zero `transport_allowance`. The
  forward migration removes the two unused allowance columns after checking
  this condition.
- Installed extensions on the live target are `pg_stat_statements` 1.11,
  `pgcrypto` 1.3, `plpgsql` 1.0, `supabase_vault` 0.3.1, and `uuid-ossp` 1.1.
- Nine `TRANSPORT_FEES` and nine `TRANSPORT_FUEL` chart-of-account rows exist.
  No foreign-key references were found in any account-dependent table, and no
  child accounts refer to them. The migration also stops seeding legacy
  `4200` Transport Fees and `5300` Bus EMI accounts.
- Nine schools currently have module selections: eight have Fees + Payroll,
  and one has Fees + Payroll + the retired module. No Fees-only, Payroll-only,
  transport-only, or empty-plan school exists. The migration will leave all
  nine schools with Fees + Payroll. The `school_subscriptions` table currently
  has 0 rows; `schools.plan_code` contains only `starter` (5) and
  `professional` (4).
- Generic fee categories, shared accounting rows, school/student/staff records,
  and audit history are not deleted or rewritten.

### Backup and migration plan

1. Create a full encrypted external backup of the database and storage, then
   restore it into an isolated PostgreSQL 17.6 project and verify the restore.
   Include schema, data, extension versions, functions, triggers, RLS policies,
   storage buckets/objects, and relevant Edge Function configuration.
2. On that isolated copy, apply
   `20261114120000_enforce_school_module_entitlements.sql`, then
   `20261115210000_retire_transport_plan_entitlement.sql`. Include other
   approved pending migrations in timestamp order; the unrelated
   `20261115190500_email_change_workflow.sql` belongs between them only if that
   feature is included in the release. Run the database-backed security matrix
   before approving the cutover.
3. Enter production maintenance mode and freeze payroll, school creation, and
   other database writes. Keep the old app from serving requests while the
   destructive schema migration runs.
4. Apply the same approved migrations in the same chronological order. Keep
   maintenance mode active, then deploy the compatible Next.js app and
   replacement `create-school` Edge Function. Do not leave deployed v2
   `create-school` active after installing the school-creation guard.
5. Run post-migration object, cohort, core-record, accounting, and
   role-specific authorization checks. Reopen traffic only after all checks
   pass. If any check fails, keep maintenance mode and restore the pre-cutover
   database/storage backup before restoring prior app and Edge Function
   versions.

No external backup, restore verification, database migration, or deployment
has been performed. The active target is PostgreSQL 17.6. Its applied migration
history currently ends at `20261114055807`; neither requested migration is
applied. There is no local Docker or `psql`, and Supabase development branches
are unavailable on the target project plan. Historical migrations, audit
records, the legacy-value rejection test, and the five archival payroll
snapshots may retain the retired name; no active app source or selectable
module retains it.

### Final validation and release gate

- The read-only live check confirms the four transport tables are empty, their
  nine policies are attached only to those tables, no external foreign keys or
  triggers depend on them, and no transport storage buckets/objects or cron
  jobs were found. The two account-seeding routines are the only database
  routines with transport references and are replaced by the migration.
- Current `enabled_modules` cohorts are 8 Fees + Payroll and 1 Fees + Payroll +
  Transport. There are no current Plan 1-only, Plan 2-only, transport-only, or
  empty schools; removing Transport will leave all nine schools with both
  supported modules. The `school_subscriptions` table has no rows.
- Existing mocked tests cover module gates, empty entitlements, school
  creation authorization, and Sales Representative creation. Direct PostgREST
  RLS and SECURITY DEFINER RPC behavior have **not** been tested against a
  disposable database or role-specific JWTs.
- A disposable Supabase branch could not be created because the target project
  is not on a plan that supports branching; no local PostgreSQL/Docker runtime
  is installed. No destructive operation was run against production.
- Rollback is a full restore, not a reverse migration: the retirement removes
  tables, columns, policies, and account rows. After a restore is verified,
  restore the database snapshot first, then the prior app and Edge Function
  versions. Do not deploy the old app against the retired schema.
