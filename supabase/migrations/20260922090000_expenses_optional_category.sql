-- ============================================================
-- Expenses: category is optional
-- ------------------------------------------------------------
-- The Expense page no longer manages expense categories. New
-- expense rows are written without expense_category_id, so the
-- column must accept NULL on every database. Existing values are
-- left untouched.
-- ============================================================

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'expenses'
      and column_name = 'expense_category_id'
      and is_nullable = 'NO'
  ) then
    alter table public.expenses
      alter column expense_category_id drop not null;
  end if;
end $$;

-- Refresh the PostgREST schema cache so the relaxed column is visible.
notify pgrst, 'reload schema';
