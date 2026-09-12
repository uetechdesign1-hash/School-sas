# SchoolFlow Accounting Internal Audit Report

This audit was compiled from the current app source and Supabase migration state in this repository. The accounting code is in a transition state: the project is partly moving from a legacy transaction model toward a canonical journal model, but the source of truth is not yet fully standardized across the app.

## A. Current source of accounting truth

The repository shows a dual-source accounting model in active transition:

- Canonical accounting tables are represented by `journal_entries` and `journal_lines`.
- Legacy accounting tables still exist in the app surface as `transactions` and `transaction_entries`.
- Some reports query both sets, and some migration views deliberately union both sets together.

The practical answer is: as of the current repository state, the source of truth is not fully centralized. The project is moving toward the canonical journal model, but the legacy transaction tables still influence the app and reports.

## B. Legacy accounting tables

The visible legacy tables are:

- `public.transactions`
- `public.transaction_entries`

Evidence in the code:

- `src/app/accounting/trial-balance/page.tsx` queries `transactions` and `transaction_entries`.
- `src/app/accounting/balance-sheet/page.tsx` does the same.
- `src/app/accounting/journal/page.tsx` loads `transactions` where `transaction_type = 'journal'` and then hydrates detail via `transaction_entries`.
- `src/app/accounting/payment/page.tsx` and `src/app/accounting/receipt/page.tsx` are still built around the legacy transaction flow.

These tables still matter for compatibility and old reporting paths, but they must not be treated as a second accounting ledger for the same event.

## C. Canonical accounting tables

The canonical accounting tables visible in the code and migration layer are:

- `public.accounts`
- `public.journal_entries`
- `public.journal_lines`
- `public.opening_balances`

The repo also contains pattern usage aimed at a more professional accounting flow:

- reports build ledger-style balances from month/date ranges
- opening balances are treated as a separate journalized/posted base state
- bank and cash books are defined as unified views over canonical and legacy records

The intended architecture is consistent with a standard double-entry accounting model:

`journal_entries -> journal_lines -> ledger -> trial balance -> profit & loss -> balance sheet`

## D. Duplicate accounting paths

The codebase still contains multiple parallel paths that can both read and write accounting activity:

- legacy path: `transactions` -> `transaction_entries`
- canonical path: `journal_entries` -> `journal_lines`
- opening balance path: `opening_balances` and `accounts.opening_balance`
- accounting summary views: `cash_book` and `bank_book` that union both sources

This is the core duplication risk in the current structure.

## E. Which modules write transactions

The following areas are still effectively built around transaction writes or transaction reads:

- `src/app/accounting/journal/page.tsx`
- `src/app/accounting/payment/page.tsx`
- `src/app/accounting/receipt/page.tsx`
- `src/app/accounting/contra/page.tsx`
- `src/app/accounting/cash-bank/cash-bank-client.tsx`
- `src/app/dashboard/expenses/page.tsx`

These modules still query or push through `transactions` / `transaction_entries`, which is a compatibility risk if the same financial event also exists as a journal entry.

## F. Which modules write journals

The direct journal-writing path is still inconsistent:

- `src/app/accounting/journal/page.tsx` is the clearest journal-oriented screen but it is still transaction-based in the loading logic.
- `src/app/accounting/ledger/page.tsx` explicitly reads both transaction and journal sources.
- `src/app/accounting/profit-loss/page.tsx` and `src/app/accounting/trial-balance/page.tsx` also read both paths.

This means the app still lacks a clean one-way rule that says: every operational record must create a canonical journal and the reports must consume that journal only.

## G. Which reports read transactions

The current reports that read legacy transactions include:

- Trial Balance (`src/app/accounting/trial-balance/page.tsx`)
- Balance Sheet (`src/app/accounting/balance-sheet/page.tsx`)
- Bank Reconciliation (`src/app/accounting/bank-reconciliation/page.tsx`)
- Receipt (`src/app/accounting/receipt/page.tsx`)
- Ledger (`src/app/accounting/ledger/page.tsx`)
- Cash/Bank summaries (`src/app/accounting/cash-bank/cash-bank-client.tsx`)

These are the biggest signs that the reports are not yet aligned to a single canonical source.

## H. Which reports read `journal_entries`

The codebase explicitly checks `journal_entries` in multiple reporting screens:

- `src/app/accounting/ledger/page.tsx`
- `src/app/accounting/profit-loss/page.tsx`
- `src/app/accounting/balance-sheet/page.tsx` (in the code structure and fallback logic)
- `src/app/accounting/trial-balance/page.tsx`

These pages are already mid-migration: they consult both data sources to keep older records visible.

## I. Which reports read `journal_lines`

The canonical journal-line layer is read by the same migration-oriented reports:

- `src/app/accounting/ledger/page.tsx`
- `src/app/accounting/profit-loss/page.tsx`
- `src/app/accounting/trial-balance/page.tsx`
- `src/app/accounting/balance-sheet/page.tsx`

The important issue is not only that these reports read `journal_lines`, but that they may do so in parallel with equivalent legacy calculations, which can double count if not de-duped.

## J. Which reports read `opening_balances`

The opening-balance tables are read by:

- `src/app/accounting/opening-balance/page.tsx`
- `src/app/accounting/ledger/page.tsx`
- `src/app/accounting/trial-balance/page.tsx`
- `src/app/accounting/balance-sheet/page.tsx`
- `src/app/accounting/bank-reconciliation/page.tsx`

This is correct in principle, but the repository also still uses `accounts.opening_balance` in multiple places, which makes the data model ambiguous.

## K. Whether `accounts.opening_balance` is also being used

Yes — it is still being used.

Examples from the repo:

- `src/app/accounting/accounts/page.tsx` selects and displays `opening_balance` on each account.
- `src/app/accounting/journal/page.tsx` selects `opening_balance` when loading accounts.
- `src/app/accounting/payment/page.tsx` and `src/app/accounting/payment/payment-client.tsx` also carry `opening_balance` in account records.

This is a clear data-model conflict: there is a dedicated `opening_balances` table, but the account record also carries an opening balance field. That duplication is dangerous because it creates two ways to store opening balance state.

## L. Where double counting can occur

The risk points are explicit:

1. A financial event can be stored once in `transactions/transaction_entries` and once in `journal_entries/journal_lines`.
2. `cash_book` and `bank_book` in the migration explicitly `UNION ALL` both sources.
3. Opening balances can be sourced from both `opening_balances` and `accounts.opening_balance`.
4. Reports such as ledger, trial balance, P&L, and balance sheet are reading from multiple sources instead of one canonical ledger.

For a professional accounting system, this must be prevented by de-duping and by forbidding direct report reads from both paths for the same event.

## M. Missing accounting links

The current implementation is missing or incomplete on several essential accounting links:

- no single immutable event-to-journal link for every operational transaction
- no guaranteed relation between fee/payroll/expense records and the canonical journal entry they generated
- no stable mapping between `reference_type` / `reference_id` and a single accounting event
- no consistent post-approval or reversal workflow for entries already booked

The system needs a single `source_type` + `source_id` pattern to ensure operational modules always connect back to the canonical journal entry.

## N. Missing RLS

There is no clear repo evidence that the accounting tables have a complete per-school row-level-security policy set in a consistent way across all accounting tables. The codebase relies heavily on application-layer filtering (`school_id` equality checks), but foundation-level RLS is still the safer model for a multi-school SaaS.

Required protections:

- `accounts` must be school-scoped
- `journal_entries` and `journal_lines` must be school-scoped
- `opening_balances` must be school-scoped
- `transactions` and `transaction_entries` must be school-scoped or archived/compatibly restricted

## O. Missing audit trail

The visible accounting schema does not show a strong audit trail baseline. For an accounting system, the following are essential:

- created_by / created_at
- updated_by / updated_at
- approved_by / approved_at
- reversed_by / reversed_at
- reason / notes / source
- immutable journal status (draft / posted / reversed / closed)

There is no clear evidence of a centralized audit log or immutable history across the accounting tables.

## P. Missing year-end functionality

The repo does not show a complete year-end accounting process. Missing pieces include:

- fiscal year closure
- opening balances carry-forward
- lock period logic for closed dates
- reversal or adjustment workflow
- final trial balance before fiscal year close
- separate `closed` / `locked` state for accounting periods

This is a major gap for a universal accounting system that needs to behave like a professional ledger, not just a transactional dashboard.

## Recommended target architecture

The correct target state for SchoolFlow is:

1. All operational modules create posted canonical `journal_entries` and `journal_lines`.
2. Reports only read from the canonical accounting engine.
3. `transactions` and `transaction_entries` remain as compatibility or legacy reference data only.
4. `opening_balances` is the only formal opening-balance source.
5. `accounts.opening_balance` should be eliminated or treated as a deprecated compatibility field.
6. `cash_book` and `bank_book` should be generated only from canonical journal data, with legacy data mapped through a one-time migration.
7. School-level RLS and audit metadata must be enforced at the database layer.
8. Year-end close and fiscal-period locking must be added before the system is treated as a production-grade accounting platform.

## Conclusion

The repository contains a workable accounting foundation, but the app is not yet in a single-source-of-truth state. The right strategy is to keep a compatibility layer for the legacy transaction tables while making the canonical journal model the only reporting source. The next engineering work should focus on deduplication, DB-level RLS, audit metadata, and year-end close support.

## Implementation status

The repository now includes a canonical accounting foundation that adds the required accounting engine tables, default school account setup, an idempotent posting service, and the mapping layer required for fee, payroll, salary payment, expense, contra, and opening-balance posting.

This foundation is intentionally additive and does not remove the legacy transaction tables. It establishes the correct architecture without destructive migration.

The next-pass source-event integrations are also in place for expense creation,
student fee payment, payroll accrual, salary payment, and contra creation.
Legacy rows remain for compatibility, while each new event receives a canonical
posting and an accounting-event linkage. Report migration and live Supabase
verification remain outstanding.
