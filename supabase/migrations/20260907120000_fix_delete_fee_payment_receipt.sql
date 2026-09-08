-- Deleting a student-fee receipt must reverse the entire fee-payment unit:
-- receipt, legacy transaction, canonical journal, allocations and bill balance.
-- This function also works for historical orphaned payments: call it with the
-- remaining fee_payments.id after confirming that the receipt was deleted.

create or replace function public.delete_fee_payment_receipt(
  p_school_id uuid,
  p_payment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.fee_payments%rowtype;
  v_bill public.fee_bills%rowtype;
  v_new_paid numeric;
  v_new_balance numeric;
  v_new_status text;
begin
  select *
  into v_payment
  from public.fee_payments
  where id = p_payment_id
    and school_id = p_school_id
  for update;

  if not found then
    raise exception 'Fee payment % was not found for this school.', p_payment_id;
  end if;

  if v_payment.bill_id is not null then
    select *
    into v_bill
    from public.fee_bills
    where id = v_payment.bill_id
      and school_id = p_school_id
    for update;

    if not found then
      raise exception 'The fee bill linked to payment % was not found.', p_payment_id;
    end if;
  end if;

  -- Remove canonical accounting journals first, while the payment reference
  -- is still available for the lookup.
  delete from public.journal_lines
  where journal_entry_id in (
    select id
    from public.journal_entries
    where school_id = p_school_id
      and reference_type = 'fee_payment'
      and reference_id = p_payment_id
  );

  delete from public.journal_entries
  where school_id = p_school_id
    and reference_type = 'fee_payment'
    and reference_id = p_payment_id;

  -- Some older receipts created legacy transactions instead of journals.
  delete from public.transaction_entries
  where transaction_id in (
    select id
    from public.transactions
    where school_id = p_school_id
      and reference_type = 'fee_payment'
      and reference_id = p_payment_id
  );

  delete from public.transactions
  where school_id = p_school_id
    and reference_type = 'fee_payment'
    and reference_id = p_payment_id;

  delete from public.receipts
  where school_id = p_school_id
    and payment_id = p_payment_id;

  -- Allocation rows exist in the current payment flow. Dynamic SQL keeps this
  -- migration safe for older databases that do not have the table yet.
  if to_regclass('public.fee_payment_allocations') is not null then
    execute 'delete from public.fee_payment_allocations where payment_id = $1'
      using p_payment_id;
  end if;

  delete from public.fee_payments
  where id = p_payment_id
    and school_id = p_school_id;

  if v_payment.bill_id is not null then
    v_new_paid := greatest(coalesce(v_bill.paid_amount, 0) - coalesce(v_payment.amount, 0), 0);
    v_new_balance := greatest(coalesce(v_bill.total_amount, 0) - v_new_paid, 0);
    v_new_status := case
      when v_new_balance <= 0.005 then 'paid'
      when v_new_paid > 0 then 'partial'
      else 'unpaid'
    end;

    update public.fee_bills
    set paid_amount = v_new_paid,
        balance_amount = v_new_balance,
        status = v_new_status,
        updated_at = now()
    where id = v_bill.id
      and school_id = p_school_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'bill_id', v_payment.bill_id,
    'restored_amount', coalesce(v_payment.amount, 0)
  );
end;
$$;

grant execute on function public.delete_fee_payment_receipt(uuid, uuid) to authenticated;
