-- ============================================================
-- Cash Book / Bank Book: vendor payment detail + cash summary RPC
-- ------------------------------------------------------------
-- A vendor payment is a PAYMENT, not an expense: it debits Vendor Payables
-- and credits the selected Cash/Bank account. The books must therefore show
-- it as an outgoing payment together with the vendor and the invoice it
-- settled.
--
-- The previous view definitions carried no vendor columns, so a vendor
-- payment appeared as a bare journal line with no vendor, invoice or
-- reference. This migration recreates both views with the identical base
-- columns plus five vendor columns appended at the end.
--
-- vendor_payments has no bill_number column. The invoice number is derived
-- from the purchase bill(s) the payment was allocated to via
-- bill_payment_allocations, which is the canonical payment -> invoice link.
--
-- Both objects are views, so no posted accounting data is destroyed.
-- ============================================================

drop view if exists public.cash_book;
drop view if exists public.bank_book;

create view public.cash_book as
select
  je.id as journal_entry_id,
  je.school_id,
  je.id as entry_id,
  je.entry_date,
  je.entry_type,
  je.reference_type,
  je.reference_id,
  je.description as entry_description,
  jl.id as journal_line_id,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  jl.debit::numeric as debit,
  jl.credit::numeric as credit,
  jl.debit::numeric as cash_in,
  jl.credit::numeric as cash_out,
  null::numeric as bank_in,
  null::numeric as bank_out,
  jl.description as line_description,
  jl.created_at,
  vp.id as vendor_payment_id,
  bp.bill_number as vendor_bill_number,
  vp.reference_number as vendor_payment_ref,
  v.name as vendor_name,
  v.id as vendor_id
from public.journal_entries je
join public.journal_lines jl
  on jl.journal_entry_id = je.id
 and jl.school_id = je.school_id
join public.accounts a
  on a.id = jl.account_id
 and a.school_id = je.school_id
left join public.vendor_payments vp
  on vp.id = je.reference_id
 and vp.school_id = je.school_id
 and je.reference_type = 'vendor_payment'
left join lateral (
  select pb.bill_number
  from public.bill_payment_allocations al
  join public.purchase_bills pb
    on pb.id = al.bill_id
   and pb.school_id = al.school_id
  where al.payment_id = vp.id
    and al.school_id = vp.school_id
  order by pb.bill_date, pb.created_at
  limit 1
) bp on true
left join public.vendors v
  on v.id = vp.vendor_id
 and v.school_id = je.school_id
where a.account_type = 'cash'
  and a.is_active = true
union all
select
  t.id,
  t.school_id,
  t.id,
  t.transaction_date,
  t.transaction_type::text,
  t.reference_type,
  t.reference_id,
  t.description,
  te.id,
  a.id,
  a.code,
  a.name,
  te.debit::numeric,
  te.credit::numeric,
  te.debit::numeric,
  te.credit::numeric,
  null::numeric,
  null::numeric,
  te.description,
  te.created_at,
  null::uuid,
  null::text,
  null::text,
  null::text,
  null::uuid
from public.transactions t
join public.transaction_entries te
  on te.transaction_id = t.id
 and te.school_id = t.school_id
join public.accounts a
  on a.id = te.account_id
 and a.school_id = t.school_id
where a.account_type = 'cash'
  and a.is_active = true;

create view public.bank_book as
select
  je.id as journal_entry_id,
  je.school_id,
  je.id as entry_id,
  je.entry_date,
  je.entry_type,
  je.reference_type,
  je.reference_id,
  je.description as entry_description,
  jl.id as journal_line_id,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  jl.debit::numeric as debit,
  jl.credit::numeric as credit,
  null::numeric as cash_in,
  null::numeric as cash_out,
  jl.debit::numeric as bank_in,
  jl.credit::numeric as bank_out,
  jl.description as line_description,
  jl.created_at,
  vp.id as vendor_payment_id,
  bp.bill_number as vendor_bill_number,
  vp.reference_number as vendor_payment_ref,
  v.name as vendor_name,
  v.id as vendor_id
from public.journal_entries je
join public.journal_lines jl
  on jl.journal_entry_id = je.id
 and jl.school_id = je.school_id
join public.accounts a
  on a.id = jl.account_id
 and a.school_id = je.school_id
left join public.vendor_payments vp
  on vp.id = je.reference_id
 and vp.school_id = je.school_id
 and je.reference_type = 'vendor_payment'
left join lateral (
  select pb.bill_number
  from public.bill_payment_allocations al
  join public.purchase_bills pb
    on pb.id = al.bill_id
   and pb.school_id = al.school_id
  where al.payment_id = vp.id
    and al.school_id = vp.school_id
  order by pb.bill_date, pb.created_at
  limit 1
) bp on true
left join public.vendors v
  on v.id = vp.vendor_id
 and v.school_id = je.school_id
where a.account_type = 'bank'
  and a.is_active = true
union all
select
  t.id,
  t.school_id,
  t.id,
  t.transaction_date,
  t.transaction_type::text,
  t.reference_type,
  t.reference_id,
  t.description,
  te.id,
  a.id,
  a.code,
  a.name,
  te.debit::numeric,
  te.credit::numeric,
  null::numeric,
  null::numeric,
  te.debit::numeric,
  te.credit::numeric,
  te.description,
  te.created_at,
  null::uuid,
  null::text,
  null::text,
  null::text,
  null::uuid
from public.transactions t
join public.transaction_entries te
  on te.transaction_id = t.id
 and te.school_id = t.school_id
join public.accounts a
  on a.id = te.account_id
 and a.school_id = t.school_id
where a.account_type = 'bank'
  and a.is_active = true;

-- The views are read through the Data API by authenticated school members.
-- RLS on the underlying tables still scopes every row to the caller's
-- school, so no school can read another school's book.
grant select on public.cash_book, public.bank_book to authenticated;
grant select on public.cash_book, public.bank_book to service_role;

comment on view public.cash_book is
  'Cash book: one row per cash-account journal line. Vendor payments carry vendor_payment_id, vendor_name and the allocated purchase bill number so a payment is shown as a payment to a vendor, never as an expense.';
comment on view public.bank_book is
  'Bank book: one row per bank-account journal line, with the same vendor payment linkage as cash_book.';
do $guard$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_cash_book_summary'
  ) then
    execute $ddl$
      create function public.get_cash_book_summary(
        p_from_date date default null,
        p_to_date date default null
      )
      returns json
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      declare
        v_school_id uuid := public.current_school_id();
        v_opening numeric := 0;
        v_before_in numeric := 0;
        v_before_out numeric := 0;
        v_period_in numeric := 0;
        v_period_out numeric := 0;
      begin
        if v_school_id is null then
          raise exception 'No school associated with current user';
        end if;

        select coalesce(sum(opening_balance), 0)
          into v_opening
        from public.accounts
        where school_id = v_school_id
          and account_type = 'cash'
          and is_active = true;

        select coalesce(sum(cash_in), 0), coalesce(sum(cash_out), 0)
          into v_before_in, v_before_out
        from public.cash_book
        where school_id = v_school_id
          and p_from_date is not null
          and entry_date < p_from_date;

        select coalesce(sum(cash_in), 0), coalesce(sum(cash_out), 0)
          into v_period_in, v_period_out
        from public.cash_book
        where school_id = v_school_id
          and (p_from_date is null or entry_date >= p_from_date)
          and (p_to_date is null or entry_date <= p_to_date);

        return json_build_object(
          'opening_balance', v_opening + v_before_in - v_before_out,
          'cash_in', v_period_in,
          'cash_out', v_period_out,
          'closing_balance',
            v_opening + v_before_in - v_before_out + v_period_in - v_period_out
        );
      end;
      $fn$;
    $ddl$;
  end if;
end
$guard$;

grant execute on function public.get_cash_book_summary(date, date)
  to authenticated;

notify pgrst, 'reload schema';
