-- Align the canonical accounting schema with pre-existing (legacy) tables.
--
-- On fresh environments the canonical foundation migration created the
-- accounting tables with the expected columns and an uppercase account_type
-- check. On existing databases those tables already existed, so PostgreSQL
-- skipped their CREATE TABLE and only applied the ALTERed columns. Two gaps
-- remained, which made record_fee_payment fail even after the fiscal year
-- self-heal was added:
--
--   1. journal_entries.entry_number did not exist, so create_journal_entry
--      could not insert the entry number.
--   2. accounts.account_type was a legacy lowercase enum, so the canonical
--      uppercase values (CASH, BANK, RECEIVABLE, ...) were rejected with
--      "invalid input value for enum account_type".
--
-- This migration also drops the old record_fee_payment overload that
-- predates the canonical 10-parameter signature, resolving PostgREST's
-- "Could not choose the best candidate function" ambiguity.

-- 1) Ensure journal_entries / journal_lines / accounting_events carry every
--    column the canonical posting engine relies on. Columns that already
--    exist (legacy or previous ALTER) are left untouched.
alter table public.journal_entries
  add column if not exists entry_number text,
  add column if not exists fiscal_year_id uuid,
  add column if not exists source_module text,
  add column if not exists source_table text,
  add column if not exists source_record_id uuid,
  add column if not exists reference_type text,
  add column if not exists reference_id text,
  add column if not exists status text default 'posted',
  add column if not exists posted_by uuid,
  add column if not exists posted_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists updated_at timestamptz default now();

alter table public.journal_lines
  add column if not exists fiscal_year_id uuid,
  add column if not exists debit numeric(18,2) not null default 0,
  add column if not exists credit numeric(18,2) not null default 0,
  add column if not exists updated_at timestamptz default now();

alter table public.accounting_events
  add column if not exists source_module text,
  add column if not exists source_table text,
  add column if not exists source_record_id uuid,
  add column if not exists journal_entry_id uuid,
  add column if not exists status text default 'posted';

-- 2) Drop the pre-canonical record_fee_payment overload. Only the canonical
--    10-parameter signature should remain.
drop function if exists public.record_fee_payment(
  uuid, uuid, numeric, text, uuid, date, text, text, text
);

-- 3) Make accounts.account_type accept the canonical uppercase values on
--    legacy databases. Legacy stores account_type as a lowercase enum; we
--    add the canonical members to that enum (adding members does not change
--    the column type, so the cash_book/bank_book views are unaffected) and
--    enforce a case-insensitive whitelist so both the legacy lowercase rows
--    and the canonical uppercase seed keep working.
do $$
declare
  v_type_name text;
  v_value text;
begin
  select t.typname
  into v_type_name
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'accounts'
    and a.attname = 'account_type'
    and t.typtype = 'e';

  if v_type_name is not null then
    foreach v_value in array array[
      'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE',
      'CASH', 'BANK', 'RECEIVABLE', 'PAYABLE'
    ] loop
      if not exists (
        select 1
        from pg_catalog.pg_enum e
        join pg_catalog.pg_type t on t.oid = e.enumtypid
        where t.typname = v_type_name
          and e.enumlabel = v_value
      ) then
        execute format('alter type %I add value %L', v_type_name, v_value);
      end if;
    end loop;
  end if;
end $$;

alter table public.accounts
  drop constraint if exists accounts_account_type_check;

alter table public.accounts
  add constraint accounts_account_type_check
  check (lower(account_type::text) in (
    'cash', 'bank', 'expense', 'income', 'asset', 'liability', 'equity',
    'receivable', 'payable'
  ));

-- 4) Re-grant the canonical RPC (the old overload may have carried grants).
grant execute on function public.record_fee_payment(
  uuid, uuid, numeric, text, uuid, text, date, text, text, uuid
) to authenticated;