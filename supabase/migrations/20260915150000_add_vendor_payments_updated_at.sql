-- The vendor-purchases migration created vendor_payments_updated_at,
-- a BEFORE UPDATE trigger whose touch_vendor_purchase_row_updated_at()
-- assigns NEW.updated_at. On databases where vendor_payments predates
-- that migration, the legacy table has no updated_at column, so every
-- UPDATE fails with 'record "new" has no field "updated_at"' — e.g.
-- linking journal_entry_id after recording a vendor payment.
-- Ensure all three vendor-purchase tables carry the column and re-assert
-- the triggers (idempotent).

alter table public.vendor_payments
  add column if not exists updated_at timestamptz not null default now();

alter table public.vendors
  add column if not exists updated_at timestamptz not null default now();

alter table public.purchase_bills
  add column if not exists updated_at timestamptz not null default now();

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

notify pgrst, 'reload schema';
