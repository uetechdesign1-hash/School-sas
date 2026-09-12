-- Manual offline receipt numbers are school-scoped and may be non-sequential.
-- Historical data may already contain duplicates, so preserve those rows and
-- enforce uniqueness for new or changed payments with a trigger.
create index if not exists fee_payments_manual_bill_number_idx
  on public.fee_payments (school_id, manual_bill_number);

create or replace function public.validate_fee_payment_manual_bill_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.manual_bill_number is not null
     and btrim(new.manual_bill_number) <> ''
     and exists (
       select 1
       from public.fee_payments existing
       where existing.school_id = new.school_id
         and btrim(existing.manual_bill_number) = btrim(new.manual_bill_number)
         and existing.id <> new.id
     ) then
    raise exception 'Manual bill number % is already used in this school',
      new.manual_bill_number;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_fee_payment_manual_bill_number
  on public.fee_payments;

create trigger validate_fee_payment_manual_bill_number
before insert or update of school_id, manual_bill_number
on public.fee_payments
for each row
execute function public.validate_fee_payment_manual_bill_number();
