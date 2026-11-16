# Phase 2D - application implementation

Status: **implemented and verified locally; not deployed.** The screens read
tables, views and functions that exist only after `docs/phase-2-step-1-sales-rep-enum.sql`
and `docs/phase-2-supabase-sql-editor.sql` have been run (see
`phase-2-deployment-guide.md`). Until then the business pages show load errors,
the public policy pages show "not published yet", and nothing else changes.
**Deploy the app and the SQL together.**

## Routes

Super Admin (server-guarded layout `src/app/super-admin/(portal)/layout.tsx`):

| Route | Purpose |
|---|---|
| `/super-admin` | Dashboard: totals, monthly/yearly collections, charts |
| `/super-admin/schools`, `/schools/[id]`, `/schools/new` | Existing school management (moved, unchanged) + guided wizard; the school page now also shows the agreement, MOUs, invoices, collections, owner login and reassignment |
| `/super-admin/sales-team`, `/sales-team/[id]` | Create / edit / activate / reset password / retry login; representative detail and performance |
| `/super-admin/leads` | All leads, filter by representative, reassign |
| `/super-admin/plans` | Versioned price configuration |
| `/super-admin/mous/initial`, `/mous/final` | MOU lists, downloads, Final MOU approvals |
| `/super-admin/invoices`, `/payments`, `/outstanding` | Invoicing, verification, refunds/reversals, outstanding report |
| `/super-admin/company-settings` | Company details, logo and signature upload |
| `/super-admin/policies/privacy`, `/terms`, `/mou-terms` | Three independent version histories |
| `/super-admin/reports` | Representative, monthly, school and plan reports with CSV export |

Sales representative (server-guarded layout `src/app/sales/layout.tsx`):
`/sales`, `/sales/schools`, `/sales/schools/[id]`, `/sales/schools/new`,
`/sales/leads`, `/sales/mous/initial`, `/sales/mous/final`, `/sales/collections`,
`/sales/reports`, `/sales/profile`.

Public: `/privacy-policy`, `/terms-and-conditions` (no authentication; linked from
the home page footer).

## Security model in the application

- **Three layers.** `src/proxy.ts` redirects anonymous visitors (real 307) away from
  `/sales/*` and `/super-admin/*`; the portal layouts re-check role, activation and
  representative status on the server via `requirePortalRole`; and every query and
  write is enforced by RLS / the RPCs from the SQL migrations.
- **No service role in the browser or for business data.** The only service-role use
  is `src/app/api/business/provisioning/process/route.ts`, and only for the Auth
  Admin API; every database call there uses the caller's JWT. A unit test asserts this.
- **Writes go through RPCs.** Business components never insert, update or delete the
  financial tables directly (asserted by a test). The representative id of a new
  school or collection is taken from `auth.uid()` in the database, never from the form.
- **Prices come from the database.** The wizard previews the contract through the
  `quote_subscription` function; nothing is hardcoded in components or routes.
- **Idempotency.** Each wizard session, payment dialog and refund dialog holds one
  idempotency key, so a double click or retry cannot duplicate a school, payment or
  accounting posting.
- **PDFs** (A4, header/footer, page numbers, `Rs.` formatting) are built only from the
  stored snapshot, so a regenerated download never reflects later price, branding or
  terms changes. The signature carries the "visual signature only" notice.

## Owner / representative login flow

`create_school_sale` (or `start_sales_rep_provisioning`) creates the records and a
resumable job in one database transaction. The browser then calls
`/api/business/provisioning/process`, which claims the job, creates or invites the
Auth user, stores its id on the job, and completes the job. If anything fails after
the Auth call, the school/representative stays visible with a **Retry** action; the
stored login is reused, never duplicated. See section 6 of the deployment guide.

## Old Phase 1 create-school modal

The modal on the former `/super-admin` page was replaced by the wizard link, so it
can no longer be opened. The route `/api/super-admin/schools/create` still exists but
is not called by any screen. It creates schools without a Phase 2 agreement or
ownership record, so **I recommend removing it in a follow-up** (left in place here
because deleting routes was outside the approved scope).

## Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` (all of `src/`) | clean |
| ESLint on every new/changed Phase 2 file | clean; remaining findings are pre-existing code in files I only lightly edited |
| `next build` | passes; all new routes present |
| Unit tests (`tests/business-*.test.mjs`, `tests/proxy-auth.test.mjs`) | pass: provisioning retry/crash handling, PDF content/A4/page numbers/long text, CSV formula safety, server-side role guard, no service role in browser code, no direct financial writes, no hardcoded prices, public pages ungated |
| Database scenarios (`tests/phase2-sql/scenarios.mjs`) | 87 / 87 pass |
| Full test suite | 122 pass, 1 fail: `academic-year-history.test.mjs` fails because `src/lib/students/enrollment-history.ts` does not export `SchoolScopeError`. It is **not touched by Phase 2** (verified with git) |
| Runtime smoke test (built app) | anonymous `/sales*` and `/super-admin*` return 307; `/super-admin/login`, `/privacy-policy`, `/terms-and-conditions`, `/login`, `/` return 200; provisioning API without a token returns 401; footer links present |

## Not verified

- **No browser walkthrough and no screenshots.** The UI was type-checked, linted,
  built and smoke-tested over HTTP, but I have not looked at it rendered or
  exercised the flows end to end, because the database objects it needs do not exist
  until you run the SQL. Plan a click-through after the SQL is applied (the test
  scenarios 1-30 in your brief map to the SQL and unit tests above, but not to a
  live UI run).
- **Supabase Auth invitations** (SMTP, redirect URL allow-list for
  `/auth/update-password`) depend on your project's Auth settings.
- **Storage** download of the logo/signature depends on the policies created by the
  SQL; confirm after running it.
