# SchoolFlow Canonical Accounting Implementation Report

## Scope

This implementation adds the accounting foundation needed to move SchoolFlow from a fragmented legacy accounting model toward one canonical, school-scoped accounting engine.

It is intentionally additive and non-destructive:

- no production accounting tables are removed
- legacy `transactions` and `transaction_entries` remain as historical compatibility data
- canonical `journal_entries` and `journal_lines` become the official accounting source
- operational modules create source events only
- the canonical posting service is centralized

## What was implemented

### 1) Canonical accounting database foundation

Created migration:

- `supabase/migrations/20260909150000_canonical_accounting_foundation.sql`

This adds:

- `public.accounts`
- `public.fiscal_years`
- `public.journal_entries`
- `public.journal_lines`
- `public.opening_balances`
- `public.accounting_events`
- `public.accounting_audit_log`

It also adds:

- a balanced journal-entry creation RPC
- a school accounting setup helper to create the default chart of accounts and fiscal year
- school-scoped RLS policies
- timestamp triggers

### 2) Central accounting posting service

Created file:

- `src/lib/accounting/canonical-accounting.ts`

This central service provides:

- journal validation
- balanced debit/credit enforcement
- event linkage through `accounting_events`
- idempotency checks using source module + table + record id
- default account seeding and fiscal-year bootstrap
- mapping helpers for:
  - Fees collection
  - Payroll accrual
  - Salary payment
  - Expenses
  - Contra
  - Opening balance

### 3) Default account structure

The service provides a standard base account set for every school, including:

- Cash
- Bank
- Student Fee Receivable
- Other Receivables
- Fixed Assets
- Salary Payable
- Other Payables
- Vendor Payables
- Loan Payables
- Capital / Owner Equity
- Retained Earnings
- Student Fees
- Other Income
- Transport Fees
- Interest Income
- Salary Expense
- Payroll Expense
- Maintenance
- Utilities
- Transport / Fuel
- Building Maintenance
- Office Expenses
- Academic Expenses

This is a common foundation while allowing each school to extend beyond it.

## Operational mapping model

The canonical accounting rule is:

- operational modules create source events only
- the accounting engine creates journal entries
- reports read only from the canonical accounting tables

Mapping implemented in the service includes:

- Fee collection -> cash/bank dr, student fee receivable cr
- Payroll accrual -> salary expense dr, salary payable cr
- Salary payment -> salary payable dr, bank/cash cr
- Expense -> expense dr, cash/bank or payable cr
- Contra -> cash/bank transfer between accounts
- Opening balance -> opening entry vs equity carry-forward

## Legacy compatibility status

Current status:

- legacy `transactions` and `transaction_entries` remain in the repo and must stay as compatibility/history data only
- all official reporting should use `journal_entries` and `journal_lines`
- old transaction data should only be used for reconciliation, not official reporting

## Non-destructive policy followed

This implementation does not delete or rewrite existing fee, payroll, staff attendance, or accounting productions. It adds the canonical accounting foundation without resetting current records.

## Next-pass integration completed

- Expense creation now posts through the shared canonical expense service after the source expense is saved.
- Student fee payments now post a canonical receipt entry after the fee-payment RPC succeeds.
- New student registration can create a separate Admission Fee bill immediately after
  the student record is created; payment uses the existing fee-payment flow and
  canonical receipt posting.
- Manual offline receipt numbers are accepted as arbitrary values (for example
  402, then 403); they do not need to be sequential for one student. A school-
  scoped uniqueness check prevents reuse of a number already assigned to another
  payment.
- Carry-forward balances are added to the next-year bill as a separate `Old Fee`
  line item, so old fees remain distinguishable from current-year tuition and can
  be paid independently.
- Payroll preparation now posts a canonical salary-expense / salary-payable accrual keyed by the payroll run.
- Salary payments now post canonical salary-payable / cash-or-bank settlement entries keyed by the payment transaction.
- Contra creation now posts a canonical transfer keyed by the compatibility transaction.
- `accounting_events` now has a unique source-key index to strengthen duplicate-event protection.
- Contra posting direction is canonicalized as debit destination and credit source.
- The canonical journal RPC now handles concurrent source retries with `ON CONFLICT`,
  removes the losing in-flight journal, and returns the already-posted journal id.

## Remaining follow-up work

- replace report reads that still use legacy transaction tables
- add explicit reversal workflow and approval pipeline
- harden RLS for all school-level admin flows
- add period close / year-end finalization logic
- wire the canonical accounting data to UI exports and reconciliation screens
- run migration and duplicate-event tests against a reachable Supabase project

## Validation status

The targeted next-pass files compile successfully and the full production build passes.
Targeted lint still reports existing errors and warnings in the older accounting/payment
and payroll pages; these are unrelated to the canonical posting additions.

## Conclusion

This patch establishes the canonical accounting foundation that SchoolFlow needs to move toward a professional, multi-school accounting model without disrupting existing working functionality.
