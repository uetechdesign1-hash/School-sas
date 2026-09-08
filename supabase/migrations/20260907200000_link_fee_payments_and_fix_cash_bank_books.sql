-- Keep every fee payment attached to its student's current fee bill so Receipt
-- History can always show the bill number entered in the Student Fee screen.
create or replace function public.assign_fee_payment_bill_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.bill_id is null then
    select b.id into new.bill_id
    from public.fee_bills b
    where b.school_id = new.school_id
      and b.student_id = new.student_id
    order by b.bill_date desc, b.created_at desc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists set_fee_payment_bill_id on public.fee_payments;
create trigger set_fee_payment_bill_id
before insert or update of school_id, student_id, bill_id on public.fee_payments
for each row execute function public.assign_fee_payment_bill_id();

update public.fee_payments fp
set bill_id = (
  select b.id
  from public.fee_bills b
  where b.school_id = fp.school_id
    and b.student_id = fp.student_id
  order by b.bill_date desc, b.created_at desc
  limit 1
)
where fp.bill_id is null
  and exists (
    select 1
    from public.fee_bills b
    where b.school_id = fp.school_id
      and b.student_id = fp.student_id
  );

-- Unified books include both canonical journals and older transaction entries.
drop view if exists public.cash_book;
drop view if exists public.bank_book;

create or replace view public.cash_book as
select
  je.id as journal_entry_id, je.school_id, je.id as entry_id,
  je.entry_date, je.entry_type, je.reference_type, je.reference_id,
  je.description as entry_description, jl.id as journal_line_id,
  a.id as account_id, a.code as account_code, a.name as account_name,
  jl.debit::numeric, jl.credit::numeric, jl.debit::numeric as cash_in, jl.credit::numeric as cash_out,
  null::numeric as bank_in, null::numeric as bank_out,
  jl.description as line_description, jl.created_at
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id and jl.school_id = je.school_id
join public.accounts a on a.id = jl.account_id and a.school_id = je.school_id
where a.account_type = 'cash' and a.is_active = true
union all
select
  t.id, t.school_id, t.id,
  t.transaction_date, t.transaction_type::text, t.reference_type, t.reference_id,
  t.description, te.id, a.id, a.code, a.name,
  te.debit::numeric, te.credit::numeric, te.debit::numeric, te.credit::numeric,
  null::numeric, null::numeric, te.description, te.created_at
from public.transactions t
join public.transaction_entries te on te.transaction_id = t.id and te.school_id = t.school_id
join public.accounts a on a.id = te.account_id and a.school_id = t.school_id
where a.account_type = 'cash' and a.is_active = true;

create or replace view public.bank_book as
select
  je.id as journal_entry_id, je.school_id, je.id as entry_id,
  je.entry_date, je.entry_type, je.reference_type, je.reference_id,
  je.description as entry_description, jl.id as journal_line_id,
  a.id as account_id, a.code as account_code, a.name as account_name,
  jl.debit::numeric, jl.credit::numeric, null::numeric as cash_in, null::numeric as cash_out,
  jl.debit::numeric as bank_in, jl.credit::numeric as bank_out,
  jl.description as line_description, jl.created_at
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id and jl.school_id = je.school_id
join public.accounts a on a.id = jl.account_id and a.school_id = je.school_id
where a.account_type = 'bank' and a.is_active = true
union all
select
  t.id, t.school_id, t.id,
  t.transaction_date, t.transaction_type::text, t.reference_type, t.reference_id,
  t.description, te.id, a.id, a.code, a.name,
  te.debit::numeric, te.credit::numeric, null::numeric, null::numeric,
  te.debit::numeric, te.credit::numeric, te.description, te.created_at
from public.transactions t
join public.transaction_entries te on te.transaction_id = t.id and te.school_id = t.school_id
join public.accounts a on a.id = te.account_id and a.school_id = t.school_id
where a.account_type = 'bank' and a.is_active = true;

grant select on public.cash_book, public.bank_book to authenticated;

create or replace function public.get_bank_book_summary(
  p_from_date date default null,
  p_to_date date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_school_id();
  v_opening numeric := 0;
  v_before_in numeric := 0;
  v_before_out numeric := 0;
  v_period_in numeric := 0;
  v_period_out numeric := 0;
begin
  if v_school_id is null then raise exception 'No school associated with current user'; end if;
  select coalesce(sum(opening_balance), 0) into v_opening
  from public.accounts where school_id = v_school_id and account_type = 'bank' and is_active = true;
  select coalesce(sum(bank_in),0), coalesce(sum(bank_out),0) into v_before_in, v_before_out
  from public.bank_book where school_id = v_school_id and (p_from_date is not null and entry_date < p_from_date);
  select coalesce(sum(bank_in),0), coalesce(sum(bank_out),0) into v_period_in, v_period_out
  from public.bank_book where school_id = v_school_id
    and (p_from_date is null or entry_date >= p_from_date)
    and (p_to_date is null or entry_date <= p_to_date);
  return json_build_object(
    'opening_balance', v_opening + v_before_in - v_before_out,
    'bank_in', v_period_in,
    'bank_out', v_period_out,
    'closing_balance', v_opening + v_before_in - v_before_out + v_period_in - v_period_out
  );
end;
$$;

grant execute on function public.get_bank_book_summary(date, date) to authenticated;
