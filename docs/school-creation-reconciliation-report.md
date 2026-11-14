# School creation and module reconciliation

## Status and scope

This is a local implementation and deployment proposal, not a completed live
cutover. No live database, Auth user, Edge Function, migration, or deployment
was changed. The SQL draft is outside `supabase/migrations` and was not run.
Live metadata and deployed function source were inspected read-only.

The requested operating model is Super Admin provisioned school logins. The
user also asked to retain the legacy school-code login path and to allow
email-based password recovery for accounts with a deliverable login email.

## Creation-path inventory

| Path | Finding | Local disposition |
| --- | --- | --- |
| Super Admin form and `/api/super-admin/schools/create` | Active Super Admin required; writes selected modules with caller JWT. Missing module list retains the legacy fees/payroll default. | Supported; audit-safe rollback added. |
| Deployed Edge Function `create-school` v2 | Active Super Admin required, but service-role school insert omits modules; cleanup errors are not all checked. External callers are unknown. | A replacement is prepared at `supabase/functions/create-school/index.ts`, **not deployed**. It accepts the existing snake-case request, validates and writes modules using the caller JWT, and retains partial records on failure for review. |
| Checked-in Edge Function `create-school-owner` | Active Super Admin required; school insert used service role and omitted modules. The generated owner Auth email is internal and cannot receive recovery mail. | Updated locally to validate and write modules using caller JWT. Existing school-code identity behavior is retained as requested. |
| `public.create_school_with_owner(text,text,text,text)` | Live `SECURITY DEFINER` routine accepts any authenticated caller, does not accept modules, writes only the legacy membership table, and uses the database module default. | Retirement is **blocked**, not completed. The draft revokes access only after caller inventory and onboarding cutover. |
| `/onboarding/school` | Calls the legacy RPC with `p_city`; the inspected live RPC has only four arguments. This checked-in caller has not been removed or changed. | Must be reconciled with Super Admin provisioning before RPC retirement. Preserve signup, existing Auth accounts, login and password recovery during that cutover. |
| Direct table writes / privileged integrations | `schools` has RLS enabled, broad table grants, multiple permissive policies and service-role bypass. A direct authorized insert can omit the column and receive the database default. Unknown external or administrative callers cannot be ruled out. | Inventory and approve all callers before tightening the trigger or grants. No claim that every external caller has been reconciled. |

The repository search also found school inserts inside historical migration test
blocks, not active application creation routes. The two deployed Edge Functions
were inspected. `quick-task` does not create schools, but accepts a school ID
and creates an owner membership using a privileged client without an
application-level Super Admin check. JWT verification is enabled at the
gateway; the function itself does not verify the caller's role or school.
Whether its privileged key is configured and whether this path is exploitable
were not tested. Treat it as a high-priority security review and do not deploy
or disable it without caller inventory and approval.

## Module and account safety

- Both local Edge candidates accept `enabled_modules` or `enabledModules`,
  allow all seven non-empty combinations, reject invalid/duplicate codes, and
  explicitly insert the selected modules. Omitted values retain fees/payroll
  for compatibility; they are not treated as an explicit transport choice.
- School writes use the active Super Admin's bearer token and public client key
  so database authorization and audit triggers can observe the actor. The
  Edge environment must provide `SUPABASE_ANON_KEY`; verify the configured
  publishable-key mechanism in staging before deployment.
- `create-school` preflights duplicate owner emails, never deletes an existing
  identity, and reports retained school/owner IDs after a partial failure.
  An Auth race or later failure can leave partial records requiring a reviewed
  recovery process; it does not silently report success or delete audit data.
- The live `audit_logs.school_id` foreign key uses `ON DELETE CASCADE`.
  Consequently, deleting a newly created school after a later failure can
  erase its module audit entry. The Next.js API and checked-in legacy Edge
  rollback now retain the school and report failure if audit rows exist or the
  audit lookup fails. Their existing cleanup of identities created by the same
  request is otherwise unchanged.
- The main login already links to `/forgot-password`, which sends recovery mail
  to the Auth login email; the recovery page now states this explicitly.
  Generated internal legacy emails are not deliverable. Also, the current
  login page signs in with an email and contains no school-code-to-email
  resolver. Do not silently link a contact email to an existing identity:
  email ownership and account mapping must be verified before an approved
  recovery migration. Until then, those legacy users need Super Admin help.
  Recovery behavior and configured email redirect URLs were not tested live.

## Trigger, policies and previous security findings

The live `guard_school_modules_change()` permits a changed module value when
`auth.uid()` is NULL or `auth.role()` is `service_role`. The audit trigger
records `auth.uid()` and logs an insert only when modules differ from the
fees/payroll default. Thus privileged changes can lack attribution and default
inserts do not produce a module-change audit entry.

The draft `supabase/drafts/school-creation-module-guard.sql` requires an
authenticated active Super Admin for every school insert and each actual
module update, including rejecting NULL actors. It retains ordinary updates
that do not change modules and does not add or delete entitlement data. Its
RPC revoke is a **breaking cutover**: it cannot be applied until the checked-in
onboarding caller and every supported external caller have been addressed.
It would also block unauthenticated maintenance and service-role school
inserts; inventory and replace those workflows first. A privileged database
owner can still bypass ordinary RLS/trigger controls.

The draft does not change `school_has_module()`, school-context selection, fee
or payroll RPCs, the existing draft RLS migration, table grants, or audit
trigger behavior. The previously documented suspension/expiry, cross-school,
security-definer RPC and shared-accounting gaps therefore remain. Inspected
policies and grants are metadata evidence only, not a live authorization test.

## Suggested rollout after approval

1. Inventory clients of the live RPC and both Edge Functions, including
   privileged scripts and maintenance jobs. Confirm legacy account recovery
   ownership and decide how to preserve their login experience.
2. Replace or retire the self-service onboarding caller without removing
   existing accounts; confirm signup, Super Admin provisioning and recovery.
3. Test both Edge candidates and the Next.js API against an isolated copy of
   the actual schema. Review partial-creation recovery and audit retention.
4. Review the SQL draft with the exact deployed trigger, grants, audit policy
   and dependent routines. Test with active/inactive Super Admins, owners,
   anonymous/NULL actors, service roles and unchanged updates. Review all
   existing direct inserts and background jobs before applying.
5. Coordinate application and Edge deployment with the forward migration.
   Verify live RLS and audit attribution with approved test accounts only.

## Validation and limitations

- `node --test tests/school-creation-edge.test.mjs tests/transport-foundation-security.test.mjs`:
  **24 passed**, using mocks; no live writes.
- `npx tsc --noEmit`: passed for the application; Supabase Edge files are
  excluded by the repository's TypeScript configuration.
- The final combined school-creation, transport and module test run passed
  **38 tests**. `npm run build` passed.
- Focused ESLint on the changed Edge code and creation API: passed.
- Deno and a local PostgreSQL server were unavailable. Edge deployment/runtime,
  SQL execution, mail delivery, live RLS and the proposed migration have not
  been verified. Re-run the checks against a disposable environment before
  approval or deployment.
