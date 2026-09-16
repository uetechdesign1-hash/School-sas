-- The canonical foundation migration (20260909150000) created
-- trg_accounts_updated_at on public.accounts, whose set_updated_at()
-- trigger assigns NEW.updated_at. On databases where the accounts table
-- predates the canonical schema, the align migration (20260911230000)
-- added updated_at to journal_entries, journal_lines and fiscal_years
-- but missed public.accounts — so every UPDATE on accounts failed with:
--   'record "new" has no field "updated_at"'
-- This migration closes that gap for all four canonical trigger targets.

alter table public.accounts
  add column if not exists updated_at timestamptz not null default now();

alter table public.fiscal_years
  add column if not exists updated_at timestamptz not null default now();

alter table public.journal_entries
  add column if not exists updated_at timestamptz not null default now();

alter table public.journal_lines
  add column if not exists updated_at timestamptz not null default now();

-- Re-assert the canonical trigger (idempotent).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

drop trigger if exists trg_fiscal_years_updated_at on public.fiscal_years;
create trigger trg_fiscal_years_updated_at
before update on public.fiscal_years
for each row execute function public.set_updated_at();

drop trigger if exists trg_journal_entries_updated_at on public.journal_entries;
create trigger trg_journal_entries_updated_at
before update on public.journal_entries
for each row execute function public.set_updated_at();

drop trigger if exists trg_journal_lines_updated_at on public.journal_lines;
create trigger trg_journal_lines_updated_at
before update on public.journal_lines
for each row execute function public.set_updated_at();

-- Refresh PostgREST schema cache so the new column is exposed immediately.
notify pgrst, 'reload schema';
