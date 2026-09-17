-- ============================================================
-- Vendor purchases / inventory: align pre-existing tables with the columns
-- and nullability this module actually writes.
-- ------------------------------------------------------------
-- The vendor-purchases (20260915120000), inventory / purchase-return
-- (20260916120000) and post-purchase-return (20260917120000 /
-- 20260918120000) migrations all use "create table if not exists", so on a
-- database where those tables already exist (they were created by the older
-- expenses module) the CREATE is a no-op and the columns the new code writes
-- are never added.
--
-- Two concrete failures this migration closes:
--
--   1. public.vendors has no notes column, so every vendor save fails with
--        "Could not find the 'notes' column of 'vendors' in the schema cache"
--      and record_purchase_return() cannot build the vendor particulars it
--      writes into every purchase-return journal description.
--
--   2. purchase_bills.bill_number, purchase_bill_items.description and
--      purchase_bill_items.expense_account_id are NOT NULL on those legacy
--      tables, but the module legitimately leaves them empty: a bill is
--      allowed to have no vendor invoice number, a bill line is allowed to
--      have no description, and an inventory (resale) line has no expense
--      account at all because it debits an inventory asset account instead.
--
-- Additive only: one column is added and three legacy NOT NULL constraints are
-- relaxed. No row is deleted and no posted journal entry is touched.
-- ============================================================

alter table public.vendors
  add column if not exists notes text;

comment on column public.vendors.notes is
  'Free-text description captured while adding the vendor; repeated in purchase-return accounting particulars (20260918120000).';

-- "table.column" pairs the application may write as null. Guarded so the
-- migration is safe to run repeatedly and on schemas that are already relaxed.
do $$
declare
  v_target text;
  v_table text;
  v_col text;
begin
  foreach v_target in array array[
    'purchase_bills.bill_number',
    'purchase_bills.status',
    'purchase_bills.invoice_number',
    'purchase_bill_items.description',
    'purchase_bill_items.expense_account_id',
    'vendor_payments.paid_from_account_id'
  ]
  loop
    v_table := split_part(v_target, '.', 1);
    v_col := split_part(v_target, '.', 2);

    if to_regclass('public.' || v_table) is not null and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table
        and column_name = v_col
        and is_nullable = 'NO'
    ) then
      execute format(
        'alter table public.%I alter column %I drop not null',
        v_table,
        v_col
      );
    end if;
  end loop;
end $$;

-- Refresh the PostgREST schema cache so the new column is exposed immediately
-- (and the dropped NOT NULL constraints are picked up by the API layer).
notify pgrst, 'reload schema';
