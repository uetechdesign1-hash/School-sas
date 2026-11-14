# Phase 0.5: Foundation security report

## Scope and safety

- No database migration was run or changed.
- No live Supabase data was read or modified.
- No existing Auth user was deleted during this work.
- Existing transport identity files and migration were retained.
- Physical school deletion is disabled in the application and the manual SQL
  cleanup script now stops with an explicit error.

## Files changed

- `src/app/api/super-admin/schools/create/route.ts`
- `src/app/api/super-admin/schools/manage/route.ts`
- `src/app/api/super-admin/schools/users/route.ts`
- `src/app/super-admin/page.tsx`
- `src/app/super-admin/schools/[id]/page.tsx`
- `src/lib/transport/portal-access.ts`
- `supabase/functions/create-school-owner/index.ts`
- `supabase/delete_school_data.sql`
- `tests/transport-roles.test.mjs`
- `tests/transport-foundation-security.test.mjs`
- This report

## Security issues addressed

### Auth account lifecycle

- School creation no longer treats a matching Auth email as an orphan based
  solely on the absence of an active `school_users` row. It returns a conflict
  before creating a school or changing the existing account.
- School-member removal now deactivates only that user's membership in the
  selected school. It does not delete the Auth account, profiles, staff record,
  transport memberships, or memberships in other schools.
- The last active school owner cannot be deactivated through this endpoint.
- School-creation rollback reports failed cleanup steps. Auth cleanup in these
  creation paths is limited to the owner identity newly created by the same
  request; no pre-existing identity is recycled.

### School deletion

- The super-admin "Delete" action now suspends the school. School records,
  financial history, audit records, student/staff records, memberships, and
  Auth identities are left intact.
- Returned errors from the school status update are returned to the caller.
- The suspension only changes the school status; it does not append a
  separate audit event because no approved school-status audit path was
  established in the checked-in schema.
- The manual SQL deletion script no longer contains a hard-coded destructive
  cleanup operation; executing it raises an explicit exception.
- School-creation rollback in the API route and Edge Function checks and
  reports cleanup errors instead of silently ignoring them.

### Multi-school transport access

- Transport portal access considers every active membership for the requested
  transport role. It can use another authorized school when an earlier
  membership's school is suspended or expired, and it requires transport
  entitlement on at least one eligible school.
- School IDs used for this check come from the authenticated user's
  `transport_users` rows, not from a browser-supplied ID.

### Super-admin and module protection

- The school API routes continue to verify an active `super_admin` profile
  before creating or managing schools.
- No module-entitlement management endpoint or local module migration was
  found. School owners therefore have no new module-grant path from this work.

## Remaining risks and incomplete requirements

- General school-dashboard context selection is **not fully implemented**.
  `src/lib/supabase/current-school.ts` exists, but it calls
  `get_my_school_id()` whose definition is absent from local migrations, then
  falls back to the oldest active school membership. Numerous pages also
  choose a first membership independently. Transport portal eligibility is
  now multi-school-aware, but there is no user-selected school switcher or
  verified shared context used across the ERP. A follow-up must define and
  validate a central context mechanism before claiming full multi-school
  support.
- `transport_users` has no separate membership-expiry field. Portal access
  checks school suspension and `schools.expires_on`; deployed semantics and
  live RLS remain unverified.
- Transport route/trip/vehicle data and parent-to-student or driver-to-trip
  relationships are not implemented. Membership alone must not authorize
  access to those future records.
- Existing foreign keys in the transport migration use `ON DELETE CASCADE`
  for school and Auth references. Application hard-delete paths are disabled,
  but a future physical deletion design must review those constraints and
  retention requirements first.
- The suspension update feeds existing application status checks, but those
  checks include client-side guards. With live RLS and policies unverified,
  suspension must not be treated as proven database/API revocation.
- The Phase 0 audit's statement that no school-context helper exists is
  inaccurate: `src/lib/supabase/current-school.ts` is present. Its fallback
  does not provide explicit multi-school selection, and its RPC is not defined
  in this branch.
- The prior audit's `audit_logs` wording is imprecise. The checked-in schema
  uses `accounting_audit_log`, which the former school cleanup list included
  and would have deleted. The new suspension flow does not delete it.
- The Edge Function is not included in the repository's TypeScript check
  (`supabase/functions` is excluded), and Deno was not available for a
  separate check.

## Database design recommendation

Use **`schools.enabled_modules` as the single canonical entitlement source**
for the next phase. It is the only module-entitlement shape referenced by
application code in this branch, specifically by transport portal access.
Do not add a parallel `school_features` table or another module column during
reconciliation.

Before writing a migration, inspect the live schema and applied migration
history read-only. The checked-in migrations contain no module-column or
module-helper definition, so live state cannot be inferred. A future new
migration should reconcile the existing column if present, add it only if
absent, validate/backfill allowed module keys, and update consumers in a
controlled rollout. Do not edit or replay already-applied migrations. The
database authorization helper and RLS/RPC enforcement still need an approved
design and live validation; a JSON entitlement value by itself is not an
authorization boundary.

## Migration and deletion requirements

- No migration was created or applied in this phase.
- Reconcile the deployed `enabled_modules` definition, defaults, triggers,
  grants, and module-helper history before preparing a forward migration.
- Keep school removal as suspension until a transactional deletion/archive
  operation is approved. Any future physical deletion requires an atomic
  server-side workflow, explicit audit-retention policy, dependency inventory,
  and reviewed foreign-key behavior. It must not delete shared Auth identities.

## Tests and verification

- `node --test tests\transport-roles.test.mjs tests\transport-foundation-security.test.mjs`:
  **18 passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**.
- Full `node --test`: **53 passed, 1 failed**. The unrelated
  `tests/academic-year-history.test.mjs` cannot import `SchoolScopeError` from
  `src/lib/students/enrollment-history.ts`; neither file was changed here.
- The Edge Function passed a TypeScript syntax-transpile check; Deno was not
  available for a runtime/type check.
- No live RLS, database, or browser verification was performed.

## Next steps

1. Review and approve this reversible account and school-suspension behavior.
2. Inspect live module schema and migration history read-only, then approve a
   forward-only compatibility migration.
3. Design a central, membership-validated school-context selector and migrate
   school-scoped pages to consume it consistently.
4. Define transport relationships and server/RLS authorization for school,
   driver, and parent resources.
5. Keep hard deletion disabled until a transactional retention-safe workflow
   is approved.
6. Only after review, begin the separate Bus Tracking implementation phase.
