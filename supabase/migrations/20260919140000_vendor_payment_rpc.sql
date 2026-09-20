-- ============================================================
-- Vendor payments: canonical server-side record / delete RPCs
-- ------------------------------------------------------------
-- Builds on:
--   20260915120000_vendor_purchases.sql                  (vendor_payments,
--     bill_payment_allocations; legacy alignment relaxed payment_method)
--   20260909150000_canonical_accounting_foundation.sql   (create_journal_entry)
--   20260919130000_fix_purchase_return_accounting.sql    (enum-safe casts)
--
-- Why: the vendor-purchases page records payments client-side (insert +
-- allocate + postVendorPaymentJournal). This migration adds the same
-- canonical outcome as ONE atomic call for the Payment module:
--
--   vendor_payments row
--   + bill_payment_allocations row (selected bill, or FIFO when no bill)
--   + canonical journal entry  Dr Vendor Payables / Cr Cash-Bank
--     (reference_type 'vendor_payment', reference_id = vendor_payment id)
--
-- so vendor outstanding, the Cash Book / Bank Book, purchase returns,
-- journal/ledger and reports all read exactly the same rows. Vendor
-- payments never touch the expenses table and never post Dr Expense.
--
-- IMPORTANT: accounts.account_type is a legacy ENUM on production. Every
-- account_type comparison here uses lower(account_type::text).
-- ============================================================

-- Idempotency key: the same payment request never posts twice.
alter table public.vendor_payments
  add column if not exists request_id uuid;

create unique index if not exists vendor_payments_request_id_key
  on public.vendor_payments (school_id, request_id)
  where request_id is not null;

-- payment_method: legacy databases already carry the column (NOT NULL was
-- relaxed by 20260915120000); only add it where it is missing. The RPC only
-- writes it when the column is text/varchar so a legacy enum column with
-- different labels can never reject a payment insert.
do $$
begin
  if to_regclass('public.vendor_payments') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vendor_payments'
      and column_name = 'payment_method'
  ) then
    alter table public.vendor_payments add column payment_method text;
  end if;
end $$;

-- ------------------------------------------------------------
-- record_vendor_payment
-- ------------------------------------------------------------
create or replace function public.record_vendor_payment(
  p_school_id uuid,
  p_vendor_id uuid,
  p_request_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_paid_from_account_id uuid,
  p_bill_id uuid,
  p_payment_method text,
  p_reference_number text,
  p_particulars text,
  p_notes text
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_vendor public.vendors%rowtype;
  v_bill public.purchase_bills%rowtype;
  v_existing public.vendor_payments%rowtype;
  v_payment public.vendor_payments%rowtype;
  v_payable_account_id uuid;
  v_fiscal_year_id uuid;
  v_method_type text;
  v_journal jsonb;
  v_amount numeric;
  v_bill_paid numeric;
  v_bill_returned numeric;
  v_bill_outstanding numeric;
  v_vendor_outstanding numeric;
  v_previous_outstanding numeric;
  v_remaining numeric;
  v_take numeric;
  v_vendor_name text;
  v_bill_label text;
  v_particulars text;
  v_payment_id uuid;
  v_has_bill boolean := p_bill_id is not null;
  v_bill_cursor record;
begin
  if auth.uid() is null or not exists (
    select 1 from public.school_users su
    where su.school_id = p_school_id
      and su.user_id = auth.uid()
      and su.is_active
      and su.role in ('owner', 'admin')
  ) then
    raise exception 'Only school owners and admins may record vendor payments';
  end if;

  if p_request_id is null then
    raise exception 'Payment request ID is required';
  end if;

  if p_payment_date is null then
    raise exception 'Select the payment date';
  end if;

  if p_vendor_id is null then
    raise exception 'No vendor selected';
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if not (v_amount > 0) then
    raise exception 'Payment amount must be greater than zero';
  end if;

  -- Serialize payments / returns for this vendor.
  select * into v_vendor
  from public.vendors v
  where v.id = p_vendor_id
    and v.school_id = p_school_id
  for update;
  if not found then
    raise exception 'Vendor not found';
  end if;

  if v_has_bill then
    select * into v_bill
    from public.purchase_bills pb
    where pb.id = p_bill_id
      and pb.school_id = p_school_id
      and pb.vendor_id = p_vendor_id
    for update;
    if not found then
      raise exception 'Purchase bill not found for this vendor';
    end if;
  end if;

  -- Idempotency: the same request id returns the existing payment.
  select * into v_existing
  from public.vendor_payments vp
  where vp.school_id = p_school_id
    and vp.request_id = p_request_id;
  if found then
    if v_existing.vendor_id <> p_vendor_id then
      raise exception 'Payment request belongs to another vendor';
    end if;

    select round(coalesce(sum(pb.total_amount), 0)
      - coalesce((select sum(al.amount) from public.bill_payment_allocations al
          join public.purchase_bills pb2 on pb2.id = al.bill_id
            and pb2.school_id = al.school_id
          where al.school_id = p_school_id
            and pb2.vendor_id = p_vendor_id), 0)
      - coalesce((select sum(pr.total_amount) from public.purchase_returns pr
          where pr.school_id = p_school_id
            and pr.vendor_id = p_vendor_id), 0), 2)
    into v_vendor_outstanding
    from public.purchase_bills pb
    where pb.school_id = p_school_id
      and pb.vendor_id = p_vendor_id;

    return jsonb_build_object(
      'vendor_payment_id', v_existing.id,
      'vendor_id', v_existing.vendor_id,
      'amount', v_existing.amount,
      'remaining_outstanding', v_vendor_outstanding,
      'journal_entry_id', v_existing.journal_entry_id,
      'idempotent', true
    );
  end if;

  -- Pay From must be an active Cash or Bank account (enum-safe comparison).
  if not exists (
    select 1 from public.accounts a
    where a.id = p_paid_from_account_id
      and a.school_id = p_school_id
      and a.is_active
      and lower(a.account_type::text) in ('cash', 'bank')
  ) then
    raise exception 'Pay From must be an active Cash or Bank account';
  end if;

  -- Vendor outstanding across the vendor's bills
  -- (canonical formula: bill total - allocations - purchase returns).
  select round(coalesce(sum(pb.total_amount), 0)
    - coalesce((select sum(al.amount) from public.bill_payment_allocations al
        join public.purchase_bills pb2 on pb2.id = al.bill_id
          and pb2.school_id = al.school_id
        where al.school_id = p_school_id
          and pb2.vendor_id = p_vendor_id), 0)
    - coalesce((select sum(pr.total_amount) from public.purchase_returns pr
        where pr.school_id = p_school_id
          and pr.vendor_id = p_vendor_id), 0), 2)
  into v_vendor_outstanding
  from public.purchase_bills pb
  where pb.school_id = p_school_id
    and pb.vendor_id = p_vendor_id;

  v_previous_outstanding := coalesce(v_vendor_outstanding, 0);

  if v_has_bill then
    select coalesce(sum(al.amount), 0) into v_bill_paid
    from public.bill_payment_allocations al
    where al.bill_id = v_bill.id
      and al.school_id = p_school_id;

    select coalesce(sum(pr.total_amount), 0) into v_bill_returned
    from public.purchase_returns pr
    where pr.bill_id = v_bill.id
      and pr.school_id = p_school_id;

    v_bill_outstanding := round(
      coalesce(v_bill.total_amount, 0) - v_bill_paid - v_bill_returned, 2);

    if v_amount > v_bill_outstanding + 0.009 then
      raise exception 'Payment amount cannot exceed the bill outstanding of ₹%',
        to_char(v_bill_outstanding, 'FM999999999999990.00');
    end if;

    v_previous_outstanding := v_bill_outstanding;
  else
    if v_amount > coalesce(v_vendor_outstanding, 0) + 0.009 then
      raise exception 'Payment amount cannot exceed the vendor outstanding of ₹%',
        to_char(coalesce(v_vendor_outstanding, 0), 'FM999999999999990.00');
    end if;
  end if;

  -- Fiscal year covering the payment date.
  select fy.id into v_fiscal_year_id
  from public.fiscal_years fy
  where fy.school_id = p_school_id
    and not fy.is_closed
    and p_payment_date between fy.start_date and fy.end_date
  order by fy.start_date desc
  limit 1;
  if v_fiscal_year_id is null then
    raise exception 'No open fiscal year covers the payment date';
  end if;

  -- Debit the payable account actually credited by the original bill; fall
  -- back to the canonical VENDOR_PAYABLES account. Never an expense account.
  v_payable_account_id := null;
  if v_has_bill and v_bill.journal_entry_id is not null then
    select jl.account_id into v_payable_account_id
    from public.journal_lines jl
    join public.accounts a on a.id = jl.account_id
      and a.school_id = jl.school_id
    where jl.journal_entry_id = v_bill.journal_entry_id
      and jl.school_id = p_school_id
      and jl.credit > 0
      and lower(a.account_type::text) in ('payable', 'liability')
    order by jl.credit desc
    limit 1;
  end if;

  if v_payable_account_id is null then
    select a.id into v_payable_account_id
    from public.accounts a
    where a.school_id = p_school_id
      and a.code = 'VENDOR_PAYABLES'
      and a.is_active
    order by a.created_at
    limit 1;
  end if;

  if v_payable_account_id is null then
    raise exception 'Vendor Payables account missing; run accounting setup first';
  end if;

  -- Particulars: vendor identification is never lost; custom text survives.
  v_vendor_name := coalesce(nullif(trim(v_vendor.name), ''), 'Vendor');
  v_bill_label := null;
  if v_has_bill then
    v_bill_label := nullif(trim(coalesce(v_bill.bill_number, '')), '');
  end if;

  v_particulars := v_vendor_name;
  if v_bill_label is not null then
    v_particulars := v_particulars || ' • ' || v_bill_label;
  end if;
  v_particulars := v_particulars || ' • Vendor Payment';

  if nullif(trim(coalesce(p_reference_number, '')), '') is not null then
    v_particulars := v_particulars || ' • ' || trim(p_reference_number);
  end if;
  if nullif(trim(coalesce(p_particulars, '')), '') is not null then
    v_particulars := v_particulars || ' | ' || trim(p_particulars);
  end if;
  if nullif(trim(coalesce(p_notes, '')), '') is not null then
    v_particulars := v_particulars || ' | Notes: ' || trim(p_notes);
  end if;

  -- Payment header.
  insert into public.vendor_payments(
    school_id, vendor_id, payment_date, amount, paid_from_account_id,
    reference_number, notes, request_id, created_by
  ) values (
    p_school_id, p_vendor_id, p_payment_date, v_amount, p_paid_from_account_id,
    nullif(trim(coalesce(p_reference_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    p_request_id, auth.uid()
  )
  returning * into v_payment;
  v_payment_id := v_payment.id;

  -- Store the payment method only when the column accepts free text.
  select c.data_type into v_method_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'vendor_payments'
    and c.column_name = 'payment_method';

  if v_method_type in ('text', 'character varying', 'character')
    and nullif(trim(coalesce(p_payment_method, '')), '') is not null
  then
    update public.vendor_payments vp
    set payment_method = trim(p_payment_method)
    where vp.id = v_payment_id
      and vp.school_id = p_school_id;
  end if;

  -- Allocation: whole payment to the selected bill, or FIFO across the
  -- vendor's oldest outstanding bills when no bill was chosen.
  if v_has_bill then
    insert into public.bill_payment_allocations(school_id, payment_id, bill_id, amount)
    values (p_school_id, v_payment_id, v_bill.id, v_amount);
  else
    v_remaining := v_amount;
    for v_bill_cursor in
      select pb.id,
        round(pb.total_amount
          - coalesce(paid.already_paid, 0)
          - coalesce(returned.returned_amount, 0), 2) as bill_outstanding
      from public.purchase_bills pb
      left join lateral (
        select sum(al.amount) as already_paid
        from public.bill_payment_allocations al
        where al.bill_id = pb.id
          and al.school_id = pb.school_id
      ) paid on true
      left join lateral (
        select sum(pr.total_amount) as returned_amount
        from public.purchase_returns pr
        where pr.bill_id = pb.id
          and pr.school_id = pb.school_id
      ) returned on true
      where pb.school_id = p_school_id
        and pb.vendor_id = p_vendor_id
      order by pb.bill_date asc, pb.created_at asc
    loop
      exit when v_remaining <= 0.009;

      v_take := least(v_remaining, greatest(v_bill_cursor.bill_outstanding, 0));
      if not (v_take > 0.009) then
        continue;
      end if;

      insert into public.bill_payment_allocations(school_id, payment_id, bill_id, amount)
      values (p_school_id, v_payment_id, v_bill_cursor.id, round(v_take, 2));

      v_remaining := round(v_remaining - v_take, 2);
    end loop;
  end if;

  -- Canonical accounting: Dr Vendor Payables / Cr Cash-Bank. The Cash and
  -- Bank Book views join vendor_payments by reference_type, so the vendor
  -- name, bill number and reference appear automatically.
  v_journal := public.create_journal_entry(
    p_school_id,
    v_fiscal_year_id,
    p_payment_date,
    v_particulars,
    'PAYMENT',
    'vendor_purchases',
    'vendor_payments',
    v_payment_id,
    'vendor_payment',
    v_payment_id::text,
    auth.uid(),
    jsonb_build_array(
      jsonb_build_object(
        'accountId', v_payable_account_id,
        'debit', v_amount,
        'credit', 0,
        'description', 'Vendor payable settled - ' || v_vendor_name
      ),
      jsonb_build_object(
        'accountId', p_paid_from_account_id,
        'debit', 0,
        'credit', v_amount,
        'description', v_particulars
      )
    )
  );

  update public.vendor_payments vp
  set journal_entry_id = (v_journal->>'journal_entry_id')::uuid
  where vp.id = v_payment_id
    and vp.school_id = p_school_id;

  -- Remaining outstanding after this payment.
  if v_has_bill then
    select round(coalesce(v_bill.total_amount, 0)
      - coalesce(sum(al.amount), 0) - v_bill_returned, 2)
    into v_remaining
    from public.bill_payment_allocations al
    where al.bill_id = v_bill.id
      and al.school_id = p_school_id;
  else
    select round(coalesce(sum(pb.total_amount), 0)
      - coalesce((select sum(al.amount) from public.bill_payment_allocations al
          join public.purchase_bills pb2 on pb2.id = al.bill_id
            and pb2.school_id = al.school_id
          where al.school_id = p_school_id
            and pb2.vendor_id = p_vendor_id), 0)
      - coalesce((select sum(pr.total_amount) from public.purchase_returns pr
          where pr.school_id = p_school_id
            and pr.vendor_id = p_vendor_id), 0), 2)
    into v_remaining
    from public.purchase_bills pb
    where pb.school_id = p_school_id
      and pb.vendor_id = p_vendor_id;
  end if;

  return jsonb_build_object(
    'vendor_payment_id', v_payment_id,
    'vendor_id', p_vendor_id,
    'bill_id', case when v_has_bill then v_bill.id else null end,
    'amount', v_amount,
    'previous_outstanding', v_previous_outstanding,
    'remaining_outstanding', coalesce(v_remaining, 0),
    'journal_entry_id', v_journal->>'journal_entry_id',
    'idempotent', false
  );
end;
$$;
revoke all on function public.record_vendor_payment(
  uuid, uuid, uuid, date, numeric, uuid, uuid, text, text, text, text
) from public;
grant execute on function public.record_vendor_payment(
  uuid, uuid, uuid, date, numeric, uuid, uuid, text, text, text, text
) to authenticated;

-- ------------------------------------------------------------
-- delete_vendor_payment: atomic reversal (journal + allocations + payment)
-- ------------------------------------------------------------
create or replace function public.delete_vendor_payment(
  p_school_id uuid,
  p_vendor_payment_id uuid
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_payment public.vendor_payments%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.school_users su
    where su.school_id = p_school_id
      and su.user_id = auth.uid()
      and su.is_active
      and su.role in ('owner', 'admin')
  ) then
    raise exception 'Only school owners and admins may delete vendor payments';
  end if;

  if p_vendor_payment_id is null then
    raise exception 'Vendor payment ID is required';
  end if;

  select * into v_payment
  from public.vendor_payments vp
  where vp.id = p_vendor_payment_id
    and vp.school_id = p_school_id
  for update;
  if not found then
    raise exception 'Vendor payment not found';
  end if;

  -- Lock the bills this payment allocated to so outstanding recalculations
  -- serialize against new payments / returns.
  perform 1
  from public.bill_payment_allocations al
  join public.purchase_bills pb on pb.id = al.bill_id
    and pb.school_id = al.school_id
  where al.payment_id = v_payment.id
    and al.school_id = p_school_id
  for update of pb;

  -- Remove the accounting entry (journal_lines and the linked
  -- accounting_events row cascade; the explicit event delete protects rows
  -- that were linked without a journal entry).
  delete from public.accounting_events ae
  where ae.school_id = p_school_id
    and ae.source_module = 'vendor_purchases'
    and ae.source_table = 'vendor_payments'
    and ae.source_record_id = v_payment.id;

  if v_payment.journal_entry_id is not null then
    delete from public.journal_entries je
    where je.id = v_payment.journal_entry_id
      and je.school_id = p_school_id;
  end if;

  -- Allocations cascade with the payment; vendor outstanding is restored.
  delete from public.vendor_payments vp
  where vp.id = v_payment.id
    and vp.school_id = p_school_id;

  return jsonb_build_object(
    'deleted', true,
    'vendor_payment_id', v_payment.id,
    'vendor_id', v_payment.vendor_id,
    'amount', v_payment.amount
  );
end;
$$;
revoke all on function public.delete_vendor_payment(uuid, uuid) from public;
grant execute on function public.delete_vendor_payment(uuid, uuid) to authenticated;

-- Refresh the PostgREST schema cache for the new RPCs and columns.
notify pgrst, 'reload schema';
