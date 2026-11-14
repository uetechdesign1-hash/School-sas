# Phase 1: Modular school subscriptions

## Audit findings

- The deployed `schools.enabled_modules` column is `text[] NOT NULL`, defaults
  to `fees,payroll`, and is protected by a CHECK constraint requiring at least
  one of `fees`, `payroll`, or `transport`.
- The deployed `guard_school_modules_change` and
  `audit_school_modules_change` triggers were inspected read-only and retained.
  The guard checks active Super Admin profiles for user-authenticated changes;
  the audit trigger records module changes in `audit_logs`.
- The deployed `school_has_module(uuid,text)` helper exists, but none of the
  inspected fee, payroll, attendance, or transport RLS policies called it.
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
- Existing transport portal layouts already use a server-side `PortalGuard`
  that checks transport membership and module entitlement. No Bus Tracking UI,
  GPS, or trip/vehicle implementation was added.

## Implemented

- Added the shared module allowlist, validation, route-to-module mapping, and
  fail-closed entitlement checks in `src/lib/modules.ts`.
- Added a reusable selector for Fee Management, Staff Attendance & Payroll,
  and Live Bus Tracking.
- Added module selection to Super Admin school creation. Existing callers
  without a module list retain the deployed `fees,payroll` default; invalid or
  empty lists are rejected.
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
  the existing fee, payroll/staff-attendance, and `student_transport` tables
  without replacing their school/role policies. It requires the already
  deployed `school_has_module(uuid,text)` helper and fails explicitly if the
  expected schema/RLS is missing.

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
- `tests/transport-roles.test.mjs`
- `tests/transport-foundation-security.test.mjs`

Pre-existing Phase 0.5 worktree changes and untracked files were preserved and
not reset or discarded.

## Database and migration requirements

- No SQL migration was executed, no live data was read or modified, and nothing
  was deployed. Live inspection was limited to database metadata, function,
  trigger, policy, constraint, and migration-history queries.
- The new forward migration does not add another entitlement column/table or
  redefine the existing validation/audit functions. It depends on the deployed
  helper and checks required module tables, `school_id` columns, and RLS before
  adding restrictive policies.
- Review the migration against the exact target schema before applying it.
  `transport_users` is intentionally not restricted by this helper: transport
  portal identities may lack a `school_users` row, and preventing those users
  from reading their membership would break transport portal discovery.
- The database helper checks module inclusion and active school membership but
  does not itself check school suspension or expiry. Existing school/portal
  status enforcement remains separate.
- The migration must be applied through the user's reviewed deployment process
  before its table policies protect live PostgREST requests.

## Verification

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Focused modular-access and transport/foundation tests: **28 passed**.
- Full `node --test`: **63 passed, 1 failed**. The unchanged
  `tests/academic-year-history.test.mjs` still cannot import `SchoolScopeError`
  from `src/lib/students/enrollment-history.ts`.
- `npm run lint`: did not pass because of lint/parser findings in the existing
  repository. A focused lint run also reported findings in existing, untouched
  lines of some modified files; no lint autofix was run.
- No live RLS behavior was tested with an authenticated browser or user token.

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
5. Transport module access is guarded for the existing portal, but transport
   data relationships and future trip/vehicle/GPS APIs remain outside this
   phase.
