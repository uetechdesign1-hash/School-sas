-- Update a split-collection receipt: payment + allocations + splits + bill.
-- Enables Receipt-page editing of split receipts. Idempotent: safe to re-run.
CREATE OR REPLACE FUNCTION public.update_fee_payment_collection_split(
  p_payment_id uuid, p_amount numeric, p_payment_date date, p_receipt_number text,
  p_reference_number text DEFAULT NULL, p_remarks text DEFAULT NULL,
  p_allocations jsonb DEFAULT '[]'::jsonb, p_splits jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_school_id uuid := public.get_my_school_id();
  v_payment public.fee_payments%rowtype; v_bill public.fee_bills%rowtype;
  v_delta numeric(18,2); v_new_paid numeric(18,2);
  v_split record; v_split_total numeric(18,2) := 0;
  v_cash_total numeric(18,2) := 0; v_bank_total numeric(18,2) := 0;
  v_alloc jsonb; v_alloc_total numeric(18,2) := 0;
BEGIN
  IF v_school_id IS NULL
     OR NOT public.has_school_role(ARRAY['owner','admin','accountant']) THEN
    RAISE EXCEPTION 'User is not authorized to update payments';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF NULLIF(btrim(COALESCE(p_receipt_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Manual receipt number is required';
  END IF;
  IF jsonb_typeof(COALESCE(p_splits, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_splits, '[]'::jsonb)) < 2 THEN
    RAISE EXCEPTION 'Split collection requires at least Cash and Bank amounts';
  END IF;
  SELECT * INTO v_payment FROM public.fee_payments
   WHERE id = p_payment_id AND school_id = v_school_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee payment was not found'; END IF;
  IF v_payment.bill_id IS NULL THEN
    RAISE EXCEPTION 'This receipt has no linked bill to update';
  END IF;
  SELECT * INTO v_bill FROM public.fee_bills
   WHERE id = v_payment.bill_id AND school_id = v_school_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The fee bill linked to this payment was not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.fee_payments WHERE school_id = v_school_id
      AND id <> p_payment_id
      AND lower(trim(receipt_number)) = lower(trim(p_receipt_number))) THEN
    RAISE EXCEPTION 'Receipt number already used in this school';
  END IF;
  IF round(p_amount, 2) > round(
      coalesce(v_bill.balance_amount, 0) + coalesce(v_payment.amount, 0), 2) + 0.005 THEN
    RAISE EXCEPTION 'Payment exceeds the available bill balance';
  END IF;
  FOR v_split IN SELECT account_id, payment_mode, amount
      FROM jsonb_to_recordset(p_splits) AS x(account_id uuid, payment_mode text, amount numeric)
  LOOP
    IF v_split.account_id IS NULL OR v_split.amount IS NULL OR v_split.amount <= 0 THEN
      RAISE EXCEPTION 'Every split needs a valid account and amount';
    END IF;
    IF lower(trim(v_split.payment_mode)) = 'cash' THEN
      v_cash_total := v_cash_total + v_split.amount;
    ELSE
      v_bank_total := v_bank_total + v_split.amount;
    END IF;
    v_split_total := v_split_total + v_split.amount;
  END LOOP;
  IF abs(round(v_split_total, 2) - round(p_amount, 2)) > 0.005 THEN
    RAISE EXCEPTION 'Cash + Bank total does not match payment total';
  END IF;
  IF jsonb_typeof(COALESCE(p_allocations, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_allocations, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Select at least one fee category and enter an amount';
  END IF;
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_alloc_total := v_alloc_total + COALESCE((v_alloc->>'amount')::numeric, 0);
  END LOOP;
  IF abs(round(v_alloc_total, 2) - round(p_amount, 2)) > 0.005 THEN
    RAISE EXCEPTION 'Allocation total does not match payment total';
  END IF;
  UPDATE public.fee_payments SET amount = round(p_amount, 2),
    payment_method = 'other'::payment_method, account_id = NULL,
    payment_date = p_payment_date, receipt_number = btrim(p_receipt_number),
    reference_number = nullif(btrim(COALESCE(p_reference_number, '')), ''),
    notes = nullif(btrim(COALESCE(p_remarks, '')), '')
   WHERE id = p_payment_id AND school_id = v_school_id;
  DELETE FROM public.fee_payment_allocations WHERE payment_id = p_payment_id;
  INSERT INTO public.fee_payment_allocations (school_id, bill_id, payment_id, amount, fee_bill_item_id)
  SELECT v_school_id, v_bill.id, p_payment_id,
         round((x.amount)::numeric, 2), x.fee_bill_item_id
    FROM jsonb_to_recordset(p_allocations) AS x(fee_bill_item_id uuid, amount numeric);
  DELETE FROM public.fee_payment_splits WHERE payment_id = p_payment_id;
  INSERT INTO public.fee_payment_splits
    (school_id, payment_id, account_id, payment_mode, amount, reference_number)
  SELECT v_school_id, p_payment_id, x.account_id, lower(trim(x.payment_mode)),
         round(x.amount, 2), NULLIF(trim(COALESCE(p_reference_number, '')), '')
    FROM jsonb_to_recordset(p_splits) AS x(account_id uuid, payment_mode text, amount numeric);
  v_delta := round(p_amount, 2) - coalesce(v_payment.amount, 0);
  v_new_paid := greatest(coalesce(v_bill.paid_amount, 0) + v_delta, 0);
  UPDATE public.fee_bills SET paid_amount = v_new_paid,
    balance_amount = greatest(coalesce(total_amount, 0) - v_new_paid, 0),
    updated_at = now() WHERE id = v_bill.id AND school_id = v_school_id;
  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id,
    'bill_id', v_bill.id, 'amount', round(p_amount, 2));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_fee_payment_collection_split(
  uuid, numeric, date, text, text, text, jsonb, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
