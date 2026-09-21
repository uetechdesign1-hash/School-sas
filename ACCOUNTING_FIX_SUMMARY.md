# Accounting Fix Summary

## Root Cause of Duplicate Cash/Bank Payments

**TWO separate issues caused the duplication:**

### Issue 1: Payment Page Created TWO Accounting Events
In `src/app/accounting/payment/page.tsx`:
1. Created legacy transaction in `transactions` + entries in `transaction_entries`
2. Called `postExpenseJournal()` / `postSalaryPaymentJournal()` creating `journal_entries` + `journal_lines`

### Issue 2: Cash Book / Bank Book UNIONed Both Paths
In `supabase/migrations/20260918120000_purchase_returns_history_particulars.sql`:
- `cash_book` and `bank_book` views used `UNION ALL` combining both sources
- Each payment appeared **twice**

---

## Files Changed

### 1. src/app/accounting/payment/page.tsx
- Removed legacy transaction + transaction_entries creation
- Now creates ONLY the canonical journal entry
- Expense record still created for dashboard display (no transaction_id)
- Updated error handling

### 2. src/lib/accounting/canonical-accounting.ts
- Made `sourceRecordId` optional in `postSalaryPaymentJournal()` and `postExpenseJournal()`
- Updated `JournalEntryPostInput` type

### 3. supabase/migrations/20260921120000_fix_cash_bank_books_single_source.sql (NEW)
- Removed UNION ALL from cash_book and bank_book views
- Views now ONLY use journal_entries/journal_lines

---

## Accounting Flow After Fix

**Expense Payment:**
```
Payment → expense record (dashboard only) → canonical journal → ONE cash/bank effect
```

**Salary Payment:**
```
Salary Payment → expense record (dashboard only) → canonical journal (Dr Salary Payable, Cr Cash/Bank)
```

**Vendor Payment:** Already correct (uses record_vendor_payment RPC)

**Fee Payment:** Already correct (uses record_fee_payment RPC)

---

## Key Principle
ONE financial event = ONE canonical journal entry = ONE cash/bank effect

No duplicate accounting. No hiding duplicate rows in UI. Fixed at the source.

---

## Build Status
- Accounting files compile: ✅
- Pre-existing error in fees/assign/page.tsx (unrelated): ⚠️
