-- ============================================================
-- Inventory / Purchase Returns / Student Book Sales
-- Additive migration on top of the canonical accounting schema and the
-- vendor-purchases schema. No existing table is dropped or reset.
--
-- Accounting model:
--   purchase_bills.purchase_type = 'inventory'  -> Dr Inventory / Cr Vendor Payables
--   purchase_bills.purchase_type = 'expense'    -> Dr Expense  / Cr Vendor Payables (existing behaviour)
--   purchase_bills.purchase_type = 'service'    -> Dr Expense  / Cr Vendor Payables (existing behaviour)
--   purchase return                             -> Dr Vendor Payables / Cr Inventory
--   vendor refund of a returned purchase        -> Dr Cash/Bank / Cr Vendor Payables
--   student book sale                           -> Dr Cash/Bank/Other Receivables / Cr Sales revenue
--   COGS on sale                                -> Dr COGS expense / Cr Inventory
--
-- Tax extension point: no GST engine exists in this project. Amounts are
-- stored gross per line. A future tax implementation should add per-line
-- tax columns and split the inventory/input-tax debit here.
-- ============================================================

-- 1) Purchase type on purchase bills -------------------------------
alter table public.purchase_bills
  add column if not exists purchase_type text not null default 'expense';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchase_bills_purchase_type_check'
      and conrelid = 'public.purchase_bills'::regclass
  ) then
    alter table public.purchase_bills
      add constraint purchase_bills_purchase_type_check
      check (purchase_type in ('inventory', 'expense', 'service'));
  end if;
end $$;

-- 2) Inventory item master ----------------------------------------
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  category text not null default 'other'
    check (category in ('books', 'uniform', 'other')),
  unit text not null default 'pcs',
  opening_quantity numeric(18,3) not null default 0,
  opening_unit_cost numeric(18,4) not null default 0,
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create index if not exists inventory_items_school_idx
  on public.inventory_items (school_id);

-- 2b) Link purchase bill lines to inventory items ------------------
-- A line on an 'inventory' purchase bill points at the resale item it
-- increased. Expense/service lines leave this null and keep using
-- expense_account_id, so the legacy expense path is unchanged.
alter table public.purchase_bill_items
  add column if not exists inventory_item_id uuid
    references public.inventory_items(id) on delete set null;

create index if not exists purchase_bill_items_inventory_idx
  on public.purchase_bill_items (school_id, inventory_item_id);

-- 3) Stock movement ledger (signed quantity, weighted-average cost) --
-- movement_type: purchase (+), purchase_return (-), sale (-),
-- sale_return (+), adjustment (+/-)
create table if not exists public.inventory_stock_movements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_date date not null,
  movement_type text not null
    check (movement_type in ('purchase', 'purchase_return', 'sale', 'sale_return', 'adjustment')),
  quantity numeric(18,3) not null,          -- signed; +in / -out
  unit_cost numeric(18,4) not null default 0,
  total_cost numeric(18,2) not null default 0, -- abs(quantity) * unit_cost
  balance_quantity numeric(18,3) not null default 0, -- running qty after movement
  balance_unit_cost numeric(18,4) not null default 0, -- running weighted avg after movement
  ref_table text,
  ref_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists inventory_stock_movements_item_idx
  on public.inventory_stock_movements (school_id, inventory_item_id, movement_date, created_at);

-- 4) Purchase returns (linked to the original purchase bill) --------
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  bill_id uuid not null references public.purchase_bills(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  return_number text,
  return_date date not null,
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  reason text,
  reference text,
  -- 'credit' keeps the amount against the vendor (reduces payable);
  -- 'refund' also settles it back to a cash/bank account.
  settlement_type text not null default 'credit'
    check (settlement_type in ('credit', 'refund')),
  refund_account_id uuid references public.accounts(id) on delete set null,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  refund_journal_entry_id uuid references public.journal_entries(id) on delete set null,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_returns_bill_idx
  on public.purchase_returns (school_id, bill_id);

-- One business return per return number (duplicate submission guard).
create unique index if not exists purchase_returns_number_unique
  on public.purchase_returns (school_id, bill_id, return_number)
  where return_number is not null;

create table if not exists public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  return_id uuid not null references public.purchase_returns(id) on delete cascade,
  bill_item_id uuid references public.purchase_bill_items(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  description text,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_cost numeric(18,4) not null default 0,
  amount numeric(18,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists purchase_return_items_return_idx
  on public.purchase_return_items (school_id, return_id);

-- 5) Student book sales ----------------------------------------------
create table if not exists public.student_book_sales (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid,
  sale_number text,
  sale_date date not null,
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  cogs_amount numeric(18,2) not null default 0,
  payment_mode text not null default 'cash'
    check (payment_mode in ('cash', 'bank', 'receivable')),
  payment_account_id uuid references public.accounts(id) on delete set null,
  receivable_account_id uuid references public.accounts(id) on delete set null,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  cogs_journal_entry_id uuid references public.journal_entries(id) on delete set null,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_book_sales_school_idx
  on public.student_book_sales (school_id);

create unique index if not exists student_book_sales_number_unique
  on public.student_book_sales (school_id, sale_number)
  where sale_number is not null;

create table if not exists public.student_book_sale_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  sale_id uuid not null references public.student_book_sales(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price numeric(18,2) not null default 0,
  unit_cost numeric(18,4) not null default 0, -- weighted avg cost at sale time
  line_total numeric(18,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists student_book_sale_items_sale_idx
  on public.student_book_sale_items (school_id, sale_id);

-- 6) RLS (same pattern as the vendor-purchases tables) ----------------

alter table public.inventory_items enable row level security;
alter table public.inventory_stock_movements enable row level security;
alter table public.purchase_returns enable row level security;
alter table public.purchase_return_items enable row level security;
alter table public.student_book_sales enable row level security;
alter table public.student_book_sale_items enable row level security;

-- Manage policy for each new table (owner/admin of the same school).
do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory_items',
    'inventory_stock_movements',
    'purchase_returns',
    'purchase_return_items',
    'student_book_sales',
    'student_book_sale_items'
  ]
  loop
    execute format($f$
      drop policy if exists "School admins manage %1$s" on public.%1$I;
      create policy "School admins manage %1$s"
      on public.%1$I
      for all
      using (
        exists (
          select 1 from public.school_users
          where school_users.school_id = %1$I.school_id
            and school_users.user_id = auth.uid()
            and school_users.is_active = true
            and school_users.role in ('owner', 'admin')
        )
      )
      with check (
        exists (
          select 1 from public.school_users
          where school_users.school_id = %1$I.school_id
            and school_users.user_id = auth.uid()
            and school_users.is_active = true
            and school_users.role in ('owner', 'admin')
        )
      );
    $f$, t);
  end loop;
end $$;

-- View policy for each new table (any active member of the same school).
do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory_items',
    'inventory_stock_movements',
    'purchase_returns',
    'purchase_return_items',
    'student_book_sales',
    'student_book_sale_items'
  ]
  loop
    execute format($f$
      drop policy if exists "School members view %1$s" on public.%1$I;
      create policy "School members view %1$s"
      on public.%1$I
      for select
      using (
        exists (
          select 1 from public.school_users
          where school_users.school_id = %1$I.school_id
            and school_users.user_id = auth.uid()
            and school_users.is_active = true
        )
      );
    $f$, t);
  end loop;
end $$;

-- 7) Audit metadata (created_by already present; updated_at triggers) --
drop trigger if exists inventory_items_updated_at on public.inventory_items;
create trigger inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.touch_vendor_purchase_row_updated_at();

drop trigger if exists purchase_returns_updated_at on public.purchase_returns;
create trigger purchase_returns_updated_at
before update on public.purchase_returns
for each row execute function public.touch_vendor_purchase_row_updated_at();

drop trigger if exists student_book_sales_updated_at on public.student_book_sales;
create trigger student_book_sales_updated_at
before update on public.student_book_sales
for each row execute function public.touch_vendor_purchase_row_updated_at();

comment on column public.purchase_bills.purchase_type is
  'inventory = goods bought for resale (Dr Inventory); expense/service = school consumption (Dr Expense).';
comment on table public.inventory_items is
  'Resale inventory master (books, uniforms, other) per school.';
comment on table public.inventory_stock_movements is
  'Signed stock ledger with running weighted-average cost per inventory item.';
comment on table public.purchase_returns is
  'Purchase returns linked to the original purchase bill. Credit settlement reduces Vendor Payables; refund settlement also Dr Cash/Bank / Cr Vendor Payables.';
comment on table public.student_book_sales is
  'Sales of resale items to students. Revenue posted on sale; COGS posted at weighted-average cost.';

notify pgrst, 'reload schema';
