-- ============================================================
-- Fix cash_book and bank_book to use ONLY canonical journal data
-- ------------------------------------------------------------
-- Why: The payment page was creating BOTH legacy transactions
-- AND canonical journal entries for the same payment. The
-- cash_book/bank_book views used UNION ALL to combine both,
-- causing each payment to appear twice.
--
-- Fix: Remove the UNION ALL with legacy transactions. Only use
-- journal_entries/journal_lines as the canonical source.
-- Legacy transactions/transaction_entries remain for historical
-- compatibility but are no longer used for active accounting.
-- ============================================================

-- Drop and recreate cash_book view without UNION ALL
drop view if exists public.cash_book;

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
  coalesce(bp.bill_number, rb.bill_number) as vendor_bill_number,
  vp.reference_number as vendor_payment_ref,
  v.name as vendor_name,
  v.id as vendor_id,
  pr.id as purchase_return_id,
  pr.return_number as purchase_return_number
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
left join public.purchase_returns pr
  on pr.id = je.reference_id
  and pr.school_id = je.school_id
  and je.reference_type = 'purchase_return_refund'
left join public.purchase_bills rb
  on rb.id = pr.bill_id
  and rb.school_id = pr.school_id
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
  on v.school_id = je.school_id
  and v.id = coalesce(vp.vendor_id, pr.vendor_id)
where a.account_type = 'cash'
  and a.is_active = true;

-- Drop and recreate bank_book view without UNION ALL
drop view if exists public.bank_book;

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
  coalesce(bp.bill_number, rb.bill_number) as vendor_bill_number,
  vp.reference_number as vendor_payment_ref,
  v.name as vendor_name,
  v.id as vendor_id,
  pr.id as purchase_return_id,
  pr.return_number as purchase_return_number
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
left join public.purchase_returns pr
  on pr.id = je.reference_id
  and pr.school_id = je.school_id
  and je.reference_type = 'purchase_return_refund'
left join public.purchase_bills rb
  on rb.id = pr.bill_id
  and rb.school_id = pr.school_id
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
  on v.school_id = je.school_id
  and v.id = coalesce(vp.vendor_id, pr.vendor_id)
where a.account_type = 'bank'
  and a.is_active = true;

-- Refresh the PostgREST schema cache
notify pgrst, 'reload schema';
