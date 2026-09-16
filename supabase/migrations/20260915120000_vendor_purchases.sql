-- Vendor purchases: vendors, purchase bills, bill items,
-- vendor payments and payment-to-bill allocations.
-- This migration is additive and follows the canonical accounting schema.
--
-- IMPORTANT: some databases already contain a legacy vendor-purchases
-- schema with different table/column names (created outside the migration
-- history). Because every CREATE below is `if not exists`, those legacy
-- tables would silently skip creation and then break the indexes below.
-- Before creating anything, we align legacy tables to the canonical names
-- used by the app:
--
--   purchase_bill_items.purchase_bill_id      -> bill_id
--   purchase_bill_items (missing)             -> + line_order
--   vendor_payments.from_account_id           -> paid_from_account_id
--   vendor_payment_allocations (table)        -> bill_payment_allocations
--   bill_payment_allocations.purchase_bill_id -> bill_id
--   bill_payment_allocations.allocated_amount -> amount
--
-- Columns the app never supplies but legacy tables may require are relaxed
-- (drop not null) so inserts work. Column/table renames keep existing views
-- (vendor_purchase_bill_summary, vendor_ledger) valid because views bind to
-- column OIDs, not names.
-- ============================================================
-- Align legacy vendor-purchases schema (idempotent)
-- ============================================================

do $$
declare
  v_col text;
begin
  -- purchase_bill_items: rename legacy FK column and add line_order
  if to_regclass('public.purchase_bill_items') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'purchase_bill_items'
        and column_name = 'purchase_bill_id'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'purchase_bill_items'
        and column_name = 'bill_id'
    ) then
      alter table public.purchase_bill_items
        rename column purchase_bill_id to bill_id;
    end if;

    alter table public.purchase_bill_items
      add column if not exists line_order integer not null default 0;
  end if;

  -- vendor_payments: rename legacy account column, relax payment_method
  if to_regclass('public.vendor_payments') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vendor_payments'
        and column_name = 'from_account_id'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vendor_payments'
        and column_name = 'paid_from_account_id'
    ) then
      alter table public.vendor_payments
        rename column from_account_id to paid_from_account_id;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vendor_payments'
        and column_name = 'payment_method'
        and is_nullable = 'NO'
    ) then
      alter table public.vendor_payments
        alter column payment_method drop not null;
    end if;
  end if;

  -- vendor_payment_allocations -> bill_payment_allocations
  if to_regclass('public.vendor_payment_allocations') is not null
     and to_regclass('public.bill_payment_allocations') is null then
    alter table public.vendor_payment_allocations
      rename to bill_payment_allocations;
  end if;

  if to_regclass('public.bill_payment_allocations') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'bill_payment_allocations'
        and column_name = 'purchase_bill_id'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'bill_payment_allocations'
        and column_name = 'bill_id'
    ) then
      alter table public.bill_payment_allocations
        rename column purchase_bill_id to bill_id;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'bill_payment_allocations'
        and column_name = 'allocated_amount'
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'bill_payment_allocations'
        and column_name = 'amount'
    ) then
      alter table public.bill_payment_allocations
        rename column allocated_amount to amount;
    end if;
  end if;

  -- Relax legacy required columns the app never supplies.
  if to_regclass('public.vendors') is not null then
    foreach v_col in array array['vendor_code', 'pan', 'payment_terms_days', 'opening_balance']
    loop
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'vendors'
          and column_name = v_col
          and is_nullable = 'NO'
      ) then
        execute format(
          'alter table public.vendors alter column %I drop not null',
          v_col
        );
      end if;
    end loop;
  end if;

  if to_regclass('public.purchase_bills') is not null then
    foreach v_col in array array['status', 'invoice_number']
    loop
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'purchase_bills'
          and column_name = v_col
          and is_nullable = 'NO'
      ) then
        execute format(
          'alter table public.purchase_bills alter column %I drop not null',
          v_col
        );
      end if;
    end loop;
  end if;
end $$;

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  gstin text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create index if not exists vendors_school_idx
  on public.vendors (school_id);

create table if not exists public.purchase_bills (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  bill_number text,
  bill_date date not null,
  due_date date,
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  notes text,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_bills_school_idx
  on public.purchase_bills (school_id, vendor_id);

create index if not exists purchase_bills_date_idx
  on public.purchase_bills (school_id, bill_date);

-- One vendor cannot reuse the same bill/invoice number twice.
create unique index if not exists purchase_bills_bill_number_key
  on public.purchase_bills (school_id, vendor_id, bill_number)
  where bill_number is not null;

create table if not exists public.purchase_bill_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  bill_id uuid not null references public.purchase_bills(id) on delete cascade,
  description text,
  expense_account_id uuid references public.accounts(id) on delete set null,
  quantity numeric(18,3) not null default 1 check (quantity > 0),
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  amount numeric(18,2) not null default 0 check (amount >= 0),
  line_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists purchase_bill_items_bill_idx
  on public.purchase_bill_items (bill_id);

create table if not exists public.vendor_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  payment_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  paid_from_account_id uuid references public.accounts(id) on delete set null,
  reference_number text,
  notes text,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_payments_school_idx
  on public.vendor_payments (school_id, vendor_id);

create index if not exists vendor_payments_date_idx
  on public.vendor_payments (school_id, payment_date);

create table if not exists public.bill_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  payment_id uuid not null references public.vendor_payments(id) on delete cascade,
  bill_id uuid not null references public.purchase_bills(id) on delete cascade,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists bill_payment_allocations_bill_idx
  on public.bill_payment_allocations (bill_id);

create index if not exists bill_payment_allocations_payment_idx
  on public.bill_payment_allocations (payment_id);
-- ============================================================
-- Row Level Security
-- Owner/admin of the school can manage every vendor purchase
-- record; any active member of the school can read them.
-- ============================================================

alter table public.vendors enable row level security;
alter table public.purchase_bills enable row level security;
alter table public.purchase_bill_items enable row level security;
alter table public.vendor_payments enable row level security;
alter table public.bill_payment_allocations enable row level security;

drop policy if exists "School admins manage vendors" on public.vendors;
create policy "School admins manage vendors"
on public.vendors
for all
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = vendors.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.school_users
    where school_users.school_id = vendors.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
);

drop policy if exists "School members view vendors" on public.vendors;
create policy "School members view vendors"
on public.vendors
for select
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = vendors.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
  )
);

drop policy if exists "School admins manage purchase bills" on public.purchase_bills;
create policy "School admins manage purchase bills"
on public.purchase_bills
for all
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = purchase_bills.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.school_users
    where school_users.school_id = purchase_bills.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
);

drop policy if exists "School members view purchase bills" on public.purchase_bills;
create policy "School members view purchase bills"
on public.purchase_bills
for select
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = purchase_bills.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
  )
);

drop policy if exists "School admins manage purchase bill items" on public.purchase_bill_items;
create policy "School admins manage purchase bill items"
on public.purchase_bill_items
for all
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = purchase_bill_items.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.school_users
    where school_users.school_id = purchase_bill_items.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
);

drop policy if exists "School members view purchase bill items" on public.purchase_bill_items;
create policy "School members view purchase bill items"
on public.purchase_bill_items
for select
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = purchase_bill_items.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
  )
);

drop policy if exists "School admins manage vendor payments" on public.vendor_payments;
create policy "School admins manage vendor payments"
on public.vendor_payments
for all
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = vendor_payments.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.school_users
    where school_users.school_id = vendor_payments.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
);

drop policy if exists "School members view vendor payments" on public.vendor_payments;
create policy "School members view vendor payments"
on public.vendor_payments
for select
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = vendor_payments.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
  )
);

drop policy if exists "School admins manage bill payment allocations" on public.bill_payment_allocations;
create policy "School admins manage bill payment allocations"
on public.bill_payment_allocations
for all
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = bill_payment_allocations.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.school_users
    where school_users.school_id = bill_payment_allocations.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
);

drop policy if exists "School members view bill payment allocations" on public.bill_payment_allocations;
create policy "School members view bill payment allocations"
on public.bill_payment_allocations
for select
using (
  exists (
    select 1 from public.school_users
    where school_users.school_id = bill_payment_allocations.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
  )
);

-- ============================================================
-- updated_at triggers
-- ============================================================

create or replace function public.touch_vendor_purchase_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vendors_updated_at on public.vendors;
create trigger vendors_updated_at
before update on public.vendors
for each row execute function public.touch_vendor_purchase_row_updated_at();

drop trigger if exists purchase_bills_updated_at on public.purchase_bills;
create trigger purchase_bills_updated_at
before update on public.purchase_bills
for each row execute function public.touch_vendor_purchase_row_updated_at();

drop trigger if exists vendor_payments_updated_at on public.vendor_payments;
create trigger vendor_payments_updated_at
before update on public.vendor_payments
for each row execute function public.touch_vendor_purchase_row_updated_at();

comment on table public.vendors is
  'Supplier/vendor master per school.';
comment on table public.purchase_bills is
  'Purchase bills raised by vendors. total_amount is posted as Dr Expense / Cr Vendor Payables.';
comment on table public.purchase_bill_items is
  'Expense line items of a purchase bill (quantity x unit price).';
comment on table public.vendor_payments is
  'Payments made to vendors. Posted as Dr Vendor Payables / Cr Cash or Bank.';
comment on table public.bill_payment_allocations is
  'Automatic allocation of a vendor payment across outstanding purchase bills.';