-- Canonical accounting foundation for SchoolFlow.
-- This migration is additive and does not delete legacy accounting tables.
-- Legacy `transactions` and `transaction_entries` remain as compatibility/history only.

create extension if not exists "pgcrypto";

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  code text,
  name text not null,
  account_type text not null check (
    account_type in (
      'ASSET','LIABILITY','EQUITY','INCOME','EXPENSE',
      'CASH','BANK','RECEIVABLE','PAYABLE'
    )
  ),
  parent_account_id uuid null references public.accounts(id) on delete restrict,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  name text not null,
  start_date date not null,
  end_date date not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
  entry_date date not null,
  entry_number text not null,
  description text,
  entry_type text not null default 'GENERAL' check (
    entry_type in (
      'GENERAL','OPENING','PAYMENT','RECEIPT','CONTRA','ADJUSTMENT','CLOSING'
    )
  ),
  source_module text not null,
  source_table text,
  source_record_id uuid,
  reference_type text,
  reference_id text,
  status text not null default 'posted' check (
    status in ('draft','posted','approved','reversed','closed')
  ),
  posted_by uuid,
  posted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (school_id, entry_number)
);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opening_balances (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  fiscal_year_id uuid not null references public.fiscal_years(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  balance numeric(18,2) not null default 0,
  as_of_date date not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (school_id, fiscal_year_id, account_id, as_of_date)
);

create table if not exists public.accounting_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  source_module text not null,
  source_table text not null,
  source_record_id uuid not null,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  status text not null default 'posted' check (status in ('posted','reversed','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_audit_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_id uuid,
  action_at timestamptz not null default now(),
  payload jsonb
);

-- Existing installations may already have an older journal schema. Keep this
-- migration additive by filling in the canonical source/fiscal metadata that
-- the posting engine requires instead of recreating those tables.
alter table public.journal_entries
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
  add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_accounts_school_code_unique
  on public.accounts(school_id, code);

create index if not exists idx_accounts_school_active
  on public.accounts(school_id, is_active, account_type, name);

create index if not exists idx_accounts_parent
  on public.accounts(parent_account_id);

create index if not exists idx_fiscal_years_school_dates
  on public.fiscal_years(school_id, start_date, end_date);

create index if not exists idx_journal_entries_school_date
  on public.journal_entries(school_id, entry_date);

create index if not exists idx_journal_entries_source
  on public.journal_entries(school_id, source_module, source_table, source_record_id);

create index if not exists idx_journal_lines_school_account
  on public.journal_lines(school_id, account_id, fiscal_year_id);

create index if not exists idx_journal_lines_entry
  on public.journal_lines(journal_entry_id);

create index if not exists idx_accounting_events_source
  on public.accounting_events(school_id, source_module, source_table, source_record_id);

create unique index if not exists idx_accounting_events_source_unique
  on public.accounting_events(school_id, source_module, source_table, source_record_id);

create index if not exists idx_audit_school_entity
  on public.accounting_audit_log(school_id, entity_type, entity_id);

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

create or replace function public.create_journal_entry(
  p_school_id uuid,
  p_fiscal_year_id uuid,
  p_entry_date date,
  p_description text,
  p_entry_type text,
  p_source_module text,
  p_source_table text,
  p_source_record_id uuid,
  p_reference_type text default null,
  p_reference_id text default null,
  p_created_by uuid default null,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_entry_number text;
  v_debit_total numeric(18,2) := 0;
  v_credit_total numeric(18,2) := 0;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_existing_journal_id uuid;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Journal must contain at least one line';
  end if;

  if not exists (
    select 1 from public.fiscal_years
    where id = p_fiscal_year_id and school_id = p_school_id
  ) then
    raise exception 'Fiscal year not found for this school';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_account_id := (v_line->>'accountId')::uuid;
    v_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_credit := coalesce((v_line->>'credit')::numeric, 0);

    if v_debit < 0 or v_credit < 0 then
      raise exception 'Debit and credit must be non-negative';
    end if;

    if not exists (
      select 1 from public.accounts
      where id = v_account_id and school_id = p_school_id and is_active = true
    ) then
      raise exception 'Invalid or inactive account for this school: %', v_account_id;
    end if;

    v_debit_total := v_debit_total + v_debit;
    v_credit_total := v_credit_total + v_credit;
  end loop;

  if v_debit_total <> v_credit_total then
    raise exception 'Journal entry is not balanced';
  end if;

  v_entry_number := 'JE-' || to_char(current_date, 'YYYYMMDD') || '-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.journal_entries (
    school_id,
    fiscal_year_id,
    entry_date,
    entry_number,
    description,
    entry_type,
    source_module,
    source_table,
    source_record_id,
    reference_type,
    reference_id,
    status,
    posted_by,
    posted_at,
    created_by
  ) values (
    p_school_id,
    p_fiscal_year_id,
    p_entry_date,
    v_entry_number,
    p_description,
    p_entry_type,
    p_source_module,
    p_source_table,
    p_source_record_id,
    p_reference_type,
    p_reference_id,
    'posted',
    p_created_by,
    now(),
    p_created_by
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_account_id := (v_line->>'accountId')::uuid;
    v_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_credit := coalesce((v_line->>'credit')::numeric, 0);

    insert into public.journal_lines (
      school_id,
      fiscal_year_id,
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    ) values (
      p_school_id,
      p_fiscal_year_id,
      v_entry_id,
      v_account_id,
      v_debit,
      v_credit,
      v_line->>'description'
    );
  end loop;

  if p_source_table is not null and p_source_record_id is not null then
    insert into public.accounting_events (
      school_id,
      source_module,
      source_table,
      source_record_id,
      journal_entry_id,
      status
    ) values (
      p_school_id,
      p_source_module,
      p_source_table,
      p_source_record_id,
      v_entry_id,
      'posted'
    )
    on conflict (school_id, source_module, source_table, source_record_id)
    do nothing
    returning journal_entry_id into v_existing_journal_id;

    if v_existing_journal_id is null then
      select journal_entry_id
      into v_existing_journal_id
      from public.accounting_events
      where school_id = p_school_id
        and source_module = p_source_module
        and source_table = p_source_table
        and source_record_id = p_source_record_id;

      delete from public.journal_entries
      where id = v_entry_id;

      return jsonb_build_object(
        'journal_entry_id', v_existing_journal_id,
        'debit_total', v_debit_total,
        'credit_total', v_credit_total,
        'idempotent', true
      );
    end if;
  end if;

  return jsonb_build_object(
    'journal_entry_id', v_entry_id,
    'entry_number', v_entry_number,
    'debit_total', v_debit_total,
    'credit_total', v_credit_total,
    'idempotent', false
  );
end;
$$;

create or replace function public.ensure_school_accounting_setup(
  p_school_id uuid,
  p_fiscal_year_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiscal_year_name text;
  v_fiscal_year_id uuid;
  v_fy_start date;
  v_fy_end date;
  v_account_count int;
begin
  if not exists (select 1 from public.schools where id = p_school_id) then
    raise exception 'School not found';
  end if;

  v_fiscal_year_name := coalesce(
    p_fiscal_year_name,
    to_char(current_date, 'YYYY') || '-' || to_char(current_date + interval '1 year', 'YY')
  );

  v_fy_start := make_date(extract(year from current_date)::int, 4, 1);
  v_fy_end := v_fy_start + interval '1 year' - interval '1 day';

  if not exists (
    select 1 from public.fiscal_years
    where school_id = p_school_id
      and name = v_fiscal_year_name
  ) then
    insert into public.fiscal_years (school_id, name, start_date, end_date, is_closed)
    values (p_school_id, v_fiscal_year_name, v_fy_start, v_fy_end, false)
    returning id into v_fiscal_year_id;
  else
    select id into v_fiscal_year_id
    from public.fiscal_years
    where school_id = p_school_id and name = v_fiscal_year_name
    limit 1;
  end if;

  insert into public.accounts (school_id, code, name, account_type, is_system, is_active)
  values
    (p_school_id, 'CASH', 'Cash', 'CASH', true, true),
    (p_school_id, 'BANK', 'Bank', 'BANK', true, true),
    (p_school_id, 'STUDENT_FEE_RECEIVABLE', 'Student Fee Receivable', 'RECEIVABLE', true, true),
    (p_school_id, 'OTHER_RECEIVABLES', 'Other Receivables', 'RECEIVABLE', true, true),
    (p_school_id, 'FIXED_ASSETS', 'Fixed Assets', 'ASSET', true, true),
    (p_school_id, 'SALARY_PAYABLE', 'Salary Payable', 'PAYABLE', true, true),
    (p_school_id, 'OTHER_PAYABLES', 'Other Payables', 'PAYABLE', true, true),
    (p_school_id, 'VENDOR_PAYABLES', 'Vendor Payables', 'PAYABLE', true, true),
    (p_school_id, 'LOAN_PAYABLES', 'Loan Payables', 'PAYABLE', true, true),
    (p_school_id, 'CAPITAL', 'Capital / Owner Equity', 'EQUITY', true, true),
    (p_school_id, 'RETAINED_EARNINGS', 'Retained Earnings', 'EQUITY', true, true),
    (p_school_id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true, true),
    (p_school_id, 'OTHER_INCOME', 'Other Income', 'INCOME', true, true),
    (p_school_id, 'TRANSPORT_FEES', 'Transport Fees', 'INCOME', true, true),
    (p_school_id, 'INTEREST_INCOME', 'Interest Income', 'INCOME', true, true),
    (p_school_id, 'SALARY_EXPENSE', 'Salary Expense', 'EXPENSE', true, true),
    (p_school_id, 'PAYROLL_EXPENSE', 'Payroll Expense', 'EXPENSE', true, true),
    (p_school_id, 'MAINTENANCE', 'Maintenance', 'EXPENSE', true, true),
    (p_school_id, 'UTILITIES', 'Utilities', 'EXPENSE', true, true),
    (p_school_id, 'TRANSPORT_FUEL', 'Transport / Fuel', 'EXPENSE', true, true),
    (p_school_id, 'BUILDING_MAINTENANCE', 'Building Maintenance', 'EXPENSE', true, true),
    (p_school_id, 'OFFICE_EXPENSE', 'Office Expenses', 'EXPENSE', true, true),
    (p_school_id, 'ACADEMIC_EXPENSE', 'Academic Expenses', 'EXPENSE', true, true)
  on conflict (school_id, code) do nothing;

  select count(*) into v_account_count
  from public.accounts
  where school_id = p_school_id;

  return jsonb_build_object(
    'school_id', p_school_id,
    'fiscal_year_id', v_fiscal_year_id,
    'fiscal_year_name', v_fiscal_year_name,
    'account_count', v_account_count
  );
end;
$$;

grant execute on function public.create_journal_entry(uuid, uuid, date, text, text, text, text, uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function public.ensure_school_accounting_setup(uuid, text) to authenticated;

-- RLS Policies (school scoped)
alter table public.accounts enable row level security;
alter table public.fiscal_years enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.opening_balances enable row level security;
alter table public.accounting_events enable row level security;
alter table public.accounting_audit_log enable row level security;

drop policy if exists accounts_school_policy on public.accounts;
create policy accounts_school_policy
on public.accounts
for all
using (school_id = public.current_school_id())
with check (school_id = public.current_school_id());

drop policy if exists fiscal_years_school_policy on public.fiscal_years;
create policy fiscal_years_school_policy
on public.fiscal_years
for all
using (school_id = public.current_school_id())
with check (school_id = public.current_school_id());

drop policy if exists journal_entries_school_policy on public.journal_entries;
create policy journal_entries_school_policy
on public.journal_entries
for all
using (school_id = public.current_school_id())
with check (school_id = public.current_school_id());

drop policy if exists journal_lines_school_policy on public.journal_lines;
create policy journal_lines_school_policy
on public.journal_lines
for all
using (school_id = public.current_school_id())
with check (school_id = public.current_school_id());

drop policy if exists opening_balances_school_policy on public.opening_balances;
create policy opening_balances_school_policy
on public.opening_balances
for all
using (school_id = public.current_school_id())
with check (school_id = public.current_school_id());

drop policy if exists accounting_events_school_policy on public.accounting_events;
create policy accounting_events_school_policy
on public.accounting_events
for all
using (school_id = public.current_school_id())
with check (school_id = public.current_school_id());

drop policy if exists accounting_audit_school_policy on public.accounting_audit_log;
create policy accounting_audit_school_policy
on public.accounting_audit_log
for all
using (school_id = public.current_school_id())
with check (school_id = public.current_school_id());
