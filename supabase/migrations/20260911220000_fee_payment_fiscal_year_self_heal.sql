-- Make record_fee_payment self-heal the fiscal year and the receivable account.
--
-- Background: record_fee_payment requires (a) a fiscal year whose
-- [start_date, end_date] covers p_payment_date and (b) an active
-- STUDENT_FEE_RECEIVABLE account. Fresh environments and schools that have
-- never opened an accounting screen can lack both, which made the old RPC
-- fail every payment with:
--
--   No fiscal year covers the payment date
--
-- This migration keeps the API and all validations identical but, when no
-- fiscal year covers the payment date, creates the April 1 - March 31 fiscal
-- year that contains it (the same convention used by
-- ensure_school_accounting_setup). It also creates the receivable account
-- when the school has never had the canonical accounting setup applied.
create or replace function public.record_fee_payment(
  p_student_id uuid,
  p_bill_id uuid,
  p_amount numeric,
  p_payment_mode text,
  p_account_id uuid,
  p_receipt_number text,
  p_payment_date date,
  p_reference_number text default null,
  p_remarks text default null,
  p_fee_bill_item_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
  v_bill public.fee_bills%rowtype;
  v_payment_id uuid;
  v_fiscal_year_id uuid;
  v_fy_start date;
  v_fy_end date;
  v_fiscal_year_name text;
  v_receivable_account_id uuid;
  v_remaining numeric(18,2);
  v_paid numeric(18,2);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select school_id
  into v_school_id
  from public.students
  where id = p_student_id;

  if v_school_id is null then
    raise exception 'Student was not found';
  end if;

  select *
  into v_bill
  from public.fee_bills
  where id = p_bill_id
    and school_id = v_school_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'Fee bill was not found for this student';
  end if;

  if p_account_id is null or not exists (
    select 1
    from public.accounts
    where id = p_account_id
      and school_id = v_school_id
      and is_active = true
      and lower(account_type::text) in ('cash', 'bank')
  ) then
    raise exception 'The selected payment account is invalid';
  end if;

  if p_fee_bill_item_id is not null and not exists (
    select 1
    from public.fee_bill_items
    where id = p_fee_bill_item_id
      and bill_id = p_bill_id
      and school_id = v_school_id
  ) then
    raise exception 'The selected fee item does not belong to this bill';
  end if;

  v_remaining := greatest(coalesce(v_bill.balance_amount, 0), 0);
  if p_amount > v_remaining + 0.005 then
    raise exception 'Payment exceeds the remaining bill balance';
  end if;

  select id
  into v_fiscal_year_id
  from public.fiscal_years
  where school_id = v_school_id
    and p_payment_date between start_date and end_date
  order by start_date desc
  limit 1;

  if v_fiscal_year_id is null then
    /*
     * Self-heal: no fiscal year covers the payment date. Create the
     * April 1 - March 31 fiscal year that contains it (the convention used
     * by ensure_school_accounting_setup) instead of failing the payment.
     */
    v_fy_start := (date_trunc('year', p_payment_date) + interval '3 months')::date;
    if p_payment_date < v_fy_start then
      v_fy_start := v_fy_start - interval '1 year';
    end if;
    v_fy_end := v_fy_start + interval '1 year' - interval '1 day';

    select id
    into v_fiscal_year_id
    from public.fiscal_years
    where school_id = v_school_id
      and start_date = v_fy_start
      and end_date = v_fy_end
    limit 1;

    if v_fiscal_year_id is null then
      v_fiscal_year_name := to_char(v_fy_start, 'YYYY') || '-' || to_char(v_fy_end, 'YY');

      /*
       * A fiscal year with the same generated name but different dates can
       * exist when an earlier seed created a partial window. Keep the unique
       * (school_id, name) constraint while recording the exact dates.
       */
      if exists (
        select 1
        from public.fiscal_years
        where school_id = v_school_id
          and name = v_fiscal_year_name
          and (start_date <> v_fy_start or end_date <> v_fy_end)
      ) then
        v_fiscal_year_name := v_fiscal_year_name || ' (' || to_char(v_fy_start, 'YYYY-MM-DD') || ')';
      end if;

      insert into public.fiscal_years (school_id, name, start_date, end_date, is_closed)
      values (v_school_id, v_fiscal_year_name, v_fy_start, v_fy_end, false)
      returning id into v_fiscal_year_id;
    end if;
  end if;
/*
   * Self-heal the Student Fee Receivable account when the school has never
   * had the canonical accounting setup run.
   */
  select id
  into v_receivable_account_id
  from public.accounts
  where school_id = v_school_id
    and code = 'STUDENT_FEE_RECEIVABLE'
    and is_active = true
  limit 1;

  if v_receivable_account_id is null then
    insert into public.accounts (school_id, code, name, account_type, is_system, is_active)
    values (v_school_id, 'STUDENT_FEE_RECEIVABLE', 'Student Fee Receivable', 'RECEIVABLE', true, true)
    on conflict (school_id, code) do nothing
    returning id into v_receivable_account_id;

    if v_receivable_account_id is null then
      select id
      into v_receivable_account_id
      from public.accounts
      where school_id = v_school_id
        and code = 'STUDENT_FEE_RECEIVABLE'
        and is_active = true
      limit 1;
    end if;

    if v_receivable_account_id is null then
      raise exception 'Student Fee Receivable account is not configured';
    end if;
  end if;

  insert into public.fee_payments (
    school_id,
    student_id,
    bill_id,
    receipt_number,
    payment_date,
    amount,
    payment_method,
    account_id,
    reference_number,
    notes,
    received_by
  ) values (
    v_school_id,
    p_student_id,
    p_bill_id,
    p_receipt_number,
    p_payment_date,
    p_amount,
    lower(p_payment_mode),
    p_account_id,
    nullif(btrim(p_reference_number), ''),
    nullif(btrim(p_remarks), ''),
    auth.uid()
  )
  returning id into v_payment_id;

  if p_fee_bill_item_id is not null then
    insert into public.fee_payment_allocations (
      school_id,
      bill_id,
      payment_id,
      amount,
      fee_bill_item_id
    ) values (
      v_school_id,
      p_bill_id,
      v_payment_id,
      p_amount,
      p_fee_bill_item_id
    );
  end if;

  v_paid := coalesce(v_bill.paid_amount, 0) + p_amount;

  update public.fee_bills
  set paid_amount = v_paid,
      balance_amount = greatest(coalesce(total_amount, 0) - v_paid, 0),
      status = case
        when greatest(coalesce(total_amount, 0) - v_paid, 0) <= 0.005 then 'paid'
        when v_paid > 0 then 'partial'
        else 'unpaid'
      end,
      updated_at = now()
  where id = p_bill_id
    and school_id = v_school_id;
perform public.create_journal_entry(
    v_school_id,
    v_fiscal_year_id,
    p_payment_date,
    'Student fee payment ' || coalesce(p_receipt_number, v_payment_id::text),
    'RECEIPT',
    'fees',
    'fee_payments',
    v_payment_id,
    'fee_payment',
    v_payment_id::text,
    auth.uid(),
    jsonb_build_array(
      jsonb_build_object(
        'accountId', p_account_id,
        'debit', p_amount,
        'credit', 0,
        'description', 'Fee payment received'
      ),
      jsonb_build_object(
        'accountId', v_receivable_account_id,
        'debit', 0,
        'credit', p_amount,
        'description', 'Student fee receivable cleared'
      )
    )
  );

  return jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'bill_id', p_bill_id,
    'remaining_balance', greatest(coalesce(v_bill.total_amount, 0) - v_paid, 0)
  );
end;
$$;

grant execute on function public.record_fee_payment(
  uuid, uuid, numeric, text, uuid, text, date, text, text, uuid
) to authenticated;