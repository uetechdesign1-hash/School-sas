alter table public.fee_payments
  add column if not exists manual_bill_number text;

update public.fee_payments payment
set manual_bill_number = bill.bill_number
from public.fee_bills bill
where payment.bill_id = bill.id
  and payment.manual_bill_number is null;

create index if not exists fee_payments_manual_bill_number_idx
  on public.fee_payments (school_id, manual_bill_number);
