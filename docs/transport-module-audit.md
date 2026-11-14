# Phase 0: Transport and modular ERP audit

## Scope and evidence

This is a repository-only audit of branch
`feature/modular-subscriptions-bus-tracking` at `bb36771`. The existing
transport identity files were inspected and preserved. No migration was
executed and no application code was changed. The live database, deployed
Edge Functions, existing data, and runtime RLS policies were not inspected.
The user previously reported that the school-modules migration was applied
to the live database; its definition and deployed state cannot be verified
from this branch.

The comparison uses the requirements supplied in the conversation: isolated
driver and parent memberships; school-specific transport entitlement and
role checks; modular fees, payroll, and transport access; a shared accounting
engine that remains usable for payroll-only schools; and preservation of
existing financial calculations. The full transport functional specification,
tracking behavior, and Phase 0 acceptance criteria were not provided for this
audit. Items beyond those explicit requirements are identified as questions
or recommendations, not asserted requirements.

## Inventory

| Area | Status | Evidence and observations |
| --- | --- | --- |
| Transport identities | Partially implemented | [transport_users migration](../supabase/migrations/20261113140000_transport_users.sql) defines school and Auth foreign keys, driver/parent roles, active state, uniqueness, indexes, own-row SELECT RLS, and service-role writes. Its deployment and real RLS behavior are unverified. |
| Isolation from school roles | Partially implemented | [Isolation guidance](transport-isolation.md) prohibits placing transport-only users in `school_users`; existing vendor SELECT policy grants active school members access regardless of role ([migration](../supabase/migrations/20260915120000_vendor_purchases.sql)). Mixed accounts retain their existing school privileges. Existing data has not been audited. |
| Login and routing | Partially implemented | [Proxy](../src/proxy.ts), [password login](../src/app/login/page.tsx), and [callback](../src/app/auth/callback/route.ts) prefer active school membership, then use an active transport membership. The [lookup](../src/lib/transport/memberships.ts) orders memberships deterministically. |
| Driver and parent portals | Placeholder only | [Driver](../src/app/driver/page.tsx) and [parent](../src/app/parent/page.tsx) pages say coming soon. Their layouts call the [portal guard](../src/lib/transport/portal-guard.tsx), which verifies role, school status, expiry, and transport entitlement using [server-side access logic](../src/lib/transport/portal-access.ts). |
| School-side transport | Missing | No dedicated `src/app/dashboard/transport` page, `src/app/api/transport`, or `src/features/transport` was found. The generic [dashboard module page](../src/app/dashboard/%5Bmodule%5D/page.tsx) has no transport entry and shows its not-found message. |
| Transport operations | Missing in inspected source | No transport route/vehicle/trip/location or parent-child assignment implementation was found in the dedicated transport paths. The old school-deletion list mentions `transport_routes` and `transport_fees`, but does not establish that they exist or implement tracking. Provisioning, revocation, management, and tracking workflows remain to be specified and implemented. |
| School module configuration | Missing from this branch | No `src/lib/modules.ts`, school context, module migration, or `school_has_module` implementation was found. The portal expects `schools.enabled_modules`, but the repository cannot establish that column on a fresh database. |
| Super-admin module management | Missing | The [super-admin page](../src/app/super-admin/page.tsx) uses `plan_code` and invokes an Edge Function for creation; [create](../src/app/api/super-admin/schools/create/route.ts) and [manage](../src/app/api/super-admin/schools/manage/route.ts) routes use `plan_code`, not validated `modules`. The deployed Edge Function is not verified. |
| Module navigation and page guards | Missing | The actual [dashboard layout](../src/app/dashboard/layout.tsx) has static fee, expenses, and other menus without module checks. The separate [dashboard shell](../src/components/dashboard/dashboard-shell.tsx) also has static navigation; no usage of `DashboardShell` was found. Neither establishes entitlement enforcement. |
| Dashboard and daily report | Missing module filtering | [Dashboard home](../src/app/dashboard/page.tsx) queries fee payments and expenses unconditionally and displays `plan_code`. [Daily report](../src/app/dashboard/daily-report/page.tsx) queries receipts, fee allocations, expenses, and vendor payments without an entitlement check. |
| Server and database enforcement | Missing or unverified | No module enforcement references were found in the checked-in application routes or migrations. Fee and payroll screens use direct Supabase queries/RPCs, so hiding menus or guarding Next.js routes alone would not enforce module access. Actual live policies and RPC definitions are unknown. |
| Shared accounting | Existing integration; entitlement design missing | [Payroll](../src/app/dashboard/payroll/payroll-client.tsx) uses shared accounting setup and `/accounting/payment`. Fee-only gating of the entire ledger would break payroll-only operation. No calculations were reviewed or changed. |
| Tests | Partial | [Transport tests](../tests/transport-roles.test.mjs) cover mocked routing, role and module decisions, school suspension/expiry, plus SQL text assertions. They do not execute SQL, test real RLS or cross-school relationships, exercise live sessions, or prove module enforcement across ERP entry points. |

## Potentially unsafe or blocking findings

1. **High - Auth account recycling can delete a transport identity.**
   [School creation](../src/app/api/super-admin/schools/create/route.ts)
   checks only for an active `school_users` row before deleting a matching
   Auth user. A transport-only driver or parent can therefore be treated as
   an orphan. With the new foreign key, deleting the Auth user cascades to
   all their `transport_users` rows. The same code also lacks the previously
   requested super-admin and inactive-existing-school protections. Confirm
   which creation path is deployed and address all identity relationships
   before provisioning real transport accounts.
2. **High - Deleting a school user can affect other schools and transport.**
   [School deletion](../src/app/api/super-admin/schools/manage/route.ts)
   collects school/staff users and deletes their Auth accounts without
   checking other memberships; [school-user deletion](../src/app/api/super-admin/schools/users/route.ts)
   explicitly removes all school memberships before deleting the Auth user.
   The transport Auth foreign key cascades across schools as well. A
   transport-only user's membership cascades when its school is deleted,
   while its Auth account is not included in the collected school/staff
   user IDs. Safe unlinking and account lifecycle policy need explicit design.
3. **High - Entitlements are not an authorization boundary on this branch.**
   Fee and payroll pages issue direct data requests without module checks,
   and dashboard/report queries are unconditional. A transport-only or
   fees-only subscription cannot be assumed to block those operations for
   school members. Independently validate database/RPC and API enforcement
   against real deployed policy; retain access to shared payroll accounting.
4. **High - Deployment prerequisites are not reproducible from this tree.**
   `portal-access.ts` selects `schools.enabled_modules`, yet neither the
   modules migration nor the split trigger migration is in this branch.
   A fresh schema lacking the column causes the portal lookup to error.
   Reconcile migration history and live definitions without editing migrations
   already applied; verify the audit trigger runs after school insertion.
5. **Medium - Portal layouts are not sufficient for future data access.**
   The root [SchoolAccessGuard](../src/components/auth/SchoolAccessGuard.tsx)
   exempts portal paths and the server layouts wrap their children. Server
   components can render in parallel, so future pages, route handlers,
   actions, subscriptions, and database policies must independently authorize
   the exact user, role, school, entitlement, and resource before fetching or
   mutating data. Current children are static placeholders.
6. **Medium - Cross-school selection and relationship authorization are
   incomplete.** Portal access takes the first ordered membership matching
   the role, not a user-selected school; an unavailable first school can
   prevent use of another eligible school. No driver-to-vehicle/trip or
   parent-to-student relationship exists in the inspected transport files.
   Membership alone must not authorize every school's transport data.
7. **Medium - Proxy coverage differs from the requested baseline.**
   [Proxy matcher](../src/proxy.ts) does not include `/accounting/:path*`.
   The root guard is client-side and must not be treated as a server/RLS
   security boundary. School-membership query failures on login/signup and
   callback fall back toward `/dashboard`, whereas dashboard lookup errors
   fail closed with 503; assess this behavior and test it explicitly.
8. **Medium - School deletion can silently ignore cleanup failures.**
   [Manage route](../src/app/api/super-admin/schools/manage/route.ts) does not
   include `audit_logs` in its cleanup list and ignores returned table-delete
   errors. The earlier requested error reporting fix is absent on this
   branch. Audit preservation and deletion policy require explicit approval.
9. **Medium - Onboarding and privileges need verification.** The tagged
   [onboarding page](../src/app/onboarding/school/page.tsx) calls
   `create_school_with_owner`; its definition was not found in checked-in
   migrations. Verify that its insert works with the deployed module guard,
   that it cannot select unauthorized modules, and that default entitlements
   and audit behavior are correct. Do not assume its live behavior.
10. **Medium - Membership policy exception is intentional, but limited.**
    The user approved self-only `transport_users` SELECT without
    `school_has_module`, because the existing helper was described as
    checking `school_users`. It permits users to read their own membership
    even when transport is disabled. Other transport data tables need
    independently designed, testable role, relationship, school and
    entitlement enforcement; do not copy this exception to them.

## Phase 0 outcomes and prerequisites for implementation

- Preserve the existing transport files and migration; never add drivers or
  parents to `school_users` merely to make RLS or module checks work.
- Resolve the identity lifecycle issues before real transport users are
  provisioned. Include mixed-role and multi-school users, inactive
  memberships, super-admins, retries, and account deletion/cascade behavior.
- Reconcile the live database's applied migration history, module helper,
  audit schema, trigger order, defaults, and grants with version control.
  Do not reapply or edit an already-applied migration.
- Agree how super-admins configure modules, how onboarding defaults work,
  how a school context is chosen, and which accounting entry points are
  fee-specific versus shared with payroll.
- Define transport scope: school-side management, driver and parent workflows,
  assignment relationships, location/trip lifecycle, and data retention and
  privacy requirements. Their precise behavior is not established by the
  supplied requirements.
- Use a `feature/transport-*` branch before implementation, as previously
  requested; this audit was performed on the current differently named branch.
  Obtain approval before editing existing files or deleting any file.

## Verification

`node --test tests\transport-roles.test.mjs`: **8 passed** on this checkout.
These are mocked/static tests, not database or browser integration tests.
Future acceptance should include real RLS tests for anonymous, transport-only,
school-only, mixed-role and cross-school users; disabled modules and expired
schools; service-role-only writes; direct URLs, RPCs and APIs; account
deletion; and transport-only, fees-only and payroll-only subscriptions.
Explicitly verify payroll-only shared ledger operations and unchanged
financial calculations. No migration, live database operation, or
application change was performed for this audit.
