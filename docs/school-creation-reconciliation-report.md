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
  allow only the Fees, Payroll, or combined plans, reject invalid/duplicate
  codes, and explicitly insert the selected modules. Empty plans remain valid
  only for existing schools awaiting reassignment.
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

- The focused school, module, dashboard, and accounting test run passed
  **49 tests**. Proxy auth and login-redirect tests passed **7/7** after adding
  the accounting matcher and wiring the tested redirect helpers into
  `src/proxy.ts`. The full `node --test` suite had **94 passes and 1 failure**:
  `tests/academic-year-history.test.mjs` imports `SchoolScopeError` and other
  exports that do not exist in `src/lib/students/enrollment-history.ts`.
- `npx tsc --noEmit` and `npm run build` passed for the application;
  Supabase Edge files are excluded by the repository's TypeScript
  configuration.
- Focused ESLint over touched application files reported **18 errors and 63
  warnings**. All 18 errors were on lines unchanged from `HEAD`; none were
  introduced on changed lines. No autofix was run.
- The target is PostgreSQL 17.6, but no local Docker/`psql` runtime is
  available, and the Supabase project plan does not support development
  branches. Edge deployment/runtime, SQL execution, mail delivery, live RLS,
  and the proposed migration remain unverified. No backup or deployment was
  performed.

## Approved school-creation policy — current Phase 1 addendum

This addendum supersedes the earlier path dispositions above. The approved
business rule is that only an active Super Admin or Sales Representative may
create a school, and the creator must record the selected plans, agreed price,
student strength, payment terms, and confirmation that these were discussed
with the school.

### Read-only live database findings

- `public.create_school_with_owner(p_school_name text, p_school_code text,
  p_email text DEFAULT NULL, p_phone text DEFAULT NULL) RETURNS uuid` is the
  deployed signature. It is `SECURITY DEFINER`, inserts a school without
  module or agreement fields (therefore relying on database defaults), then
  creates a row in `school_memberships` and `school_settings`. It does not
  accept `p_city` or a plan selection.
- Its deployed ACL grants execution only to `postgres`; `anon`,
  `authenticated`, and `service_role` do not have `EXECUTE`. The onboarding
  page nevertheless called it with an extra `p_city` argument, so that
  client call did not match the deployed signature.
- `public.schools.enabled_modules` had a `{fees,payroll}` default, while
  `student_limit` and `plan_code` also had defaults. RLS was enabled, but the
  deployed `create-school` Edge Function used a service-role insert and
  omitted `enabled_modules`; service-role writes bypass RLS.
- The deployed `platform_role` enum contained only `user` and `super_admin`.
  Existing `user_profiles` RLS limited role changes to Super Admins.
- The deployed Edge Function inventory contained `create-school` v2 and
  `quick-task`. `create-school` created schools with service-role privileges.
  `quick-task` does not insert into `schools`; it creates an Auth user and
  owner membership for a supplied existing school ID, without an
  application-level role check. It remains a separate owner-link security
  concern, not a school-creation path.

### Phase 1 code and migration changes

- Public onboarding no longer invokes `create_school_with_owner`. Anonymous
  users are sent to login; signed-in, unassigned users see the authorized
  registration process; active platform creators are routed to their
  respective workspaces. Public signup still creates Auth accounts and does
  not create schools.
- The Super Admin API, local Edge creation candidates, and the Sales
  Representative workspace require an active creator, explicit non-empty
  plan selection, student strength, price, payment terms, and a discussion
  confirmation. School table inserts use the caller JWT, not service-role
  credentials.
- The migration adds the `sales_rep` platform role; removes the `schools`
  defaults for `enabled_modules`, `student_limit`, and `plan_code`; and records
  agreement terms and server-generated creator/time metadata. The agreement
  is written to `audit_logs`.
- A database trigger rejects service-role or unauthenticated school inserts,
  unknown/empty plans, omitted student strength or price, missing terms, and
  missing confirmation. The entitlement constraint still accepts `[]` for
  existing legacy schools, while the insert trigger rejects `[]` for new
  schools. Existing school rows and owner accounts are not rewritten.
- The exact legacy RPC signature is guarded as a migration precondition and
  client execution is revoked. The function is retained rather than dropped.
  Its no-plan body cannot create a school after the defaults are removed and
  the insert trigger is installed.
- The deployed `create-school` v2 function has not been replaced. Once the
  migration is applied, its service-role school insert will be rejected; the
  checked-in replacement uses the authenticated creator JWT and the required
  agreement fields. Deploy that replacement only as an approved cutover.

### Assignment and validation status

`sales_rep` is a new privileged platform role; existing profile RLS means a
Super Admin must assign it. This phase adds no separate role-management UI.
The migration and Edge Function changes are local only: no live migration,
function deployment, or school/Auth data write was performed. Until the
migration and replacement Edge Function are deployed, the currently deployed
service-role `create-school` remains capable of relying on the live defaults.
Do not treat the live project as enforcing the new policy until the approved
cutover is completed and verified.
