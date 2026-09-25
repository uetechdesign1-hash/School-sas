-- ============================================================
-- Payroll salary accounting: journal_entries.entry_type fix
--
-- Incident: Dashboard -> Payroll -> Prepare Salary Payment failed with
--
--   new row for relation "journal_entries" violates check constraint
--   "journal_entries_entry_type_check"
--
-- journal_entries.entry_type has shipped in TWO incompatible forms in this
-- repository:
--
--   1. legacy table check: only
--      ('fee_collection','emi','adjustment','salary')
--   2. canonical foundation check (20260909150000): only the UPPERCASE
--      canonical types
--      ('GENERAL','OPENING','PAYMENT','RECEIPT','CONTRA','ADJUSTMENT','CLOSING')
--
-- 20260915160000 replaced the constraint with a case-insensitive union, but a
-- database created before that migration (or restored from an older dump) can
-- still carry either older variant. Payroll writes values from both families
-- in a single flow - GENERAL for the salary accrual, PAYMENT for the individual
-- staff payment, and the legacy 'salary' rows already stored in the table - so
-- the wrong variant breaks salary accounting.
--
-- Re-create the constraint from scratch:
--   * drop EVERY check constraint on journal_entries that mentions
--     entry_type (so a renamed or older variant cannot survive),
--   * allow the union of legacy values, canonical posting types and the
--     payroll/salary types this application writes,
--   * stay case-insensitive and trimmed so a writer choosing a different
--     letter case can never break Payroll again.
--
-- The whitelist is validated against existing rows when the constraint is
-- added; the union below is a superset of both historical whitelists, so it
-- is satisfied by every row either variant could have accepted.
-- ============================================================

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
      from pg_constraint
     where conrelid = 'public.journal_entries'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%entry_type%'
  loop
    execute format(
      'alter table public.journal_entries drop constraint %I',
      v_constraint.conname
    );
  end loop;
end $$;

alter table public.journal_entries
  add constraint journal_entries_entry_type_check
  check (
    entry_type is null
    or (
      btrim(entry_type) <> ''
      and length(btrim(entry_type)) <= 48
      and lower(btrim(entry_type)) in (
        -- canonical types written by create_journal_entry
        'general', 'opening', 'payment', 'receipt',
        'contra', 'adjustment', 'closing',
        -- payroll / salary accounting (accrual + individual staff payment)
        'payroll', 'payroll_accrual', 'payroll_payment',
        'salary', 'salary_accrual', 'salary_payment',
        -- legacy rows already stored in journal_entries
        'fee_collection', 'emi',
        -- other types written by the accounting pages
        'expense', 'purchase', 'purchase_bill',
        'purchase_return', 'vendor_payment', 'refund'
      )
    )
  );

notify pgrst, 'reload schema';
