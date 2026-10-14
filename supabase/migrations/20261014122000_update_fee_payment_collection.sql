-- Update a single-collection receipt: payment + allocations + bill + journal.
-- The Receipt edit page calls update_fee_payment_collection, which was never
-- shipped. Idempotent: safe to re-run.
CREATE OR REPLACE FUNCTION public.update_fee_payment_collection(
  p_payment_id uuid, p_amount numeric, p_payment_mode text, p_account_id uuid,
  p_payment_date date, p_receipt_number text, p_reference_number text DEFAULT NULL,
  p_remarks text DEFAULT NULL, p_allocations jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_school_id uuid := public.get_my_school_id();
  v_payment public.fee_payments%rowtype; v_bill public.fee_bills%rowtype;
  v_delta numeric(18,2); v_new_paid numeric(18,2);
  v_journal_id uuid; v_fee_income uuid;
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
  SELECT * INTO v_payment FROM public.fee_payments
   WHERE id = p_payment_id AND school_id = v_school_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee payment was not found'; END IF;
  IF v_payment.bill_id IS NULL THEN
    RAISE EXCEPTION 'This receipt has no linked bill to update';
  END IF;
  SELECT * INTO v_bill FROM public.fee_bills
   WHERE id = v_payment.bill_id AND school_id = v_school_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The fee bill linked to this payment was not found'; END IF;
  IF p_account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND school_id = v_school_id
      AND is_active = true AND lower(account_type::text) IN ('cash', 'bank')) THEN
    RAISE EXCEPTION 'The selected payment account is invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fee_payments WHERE school_id = v_school_id
      AND id <> p_payment_id
      AND lower(trim(receipt_number)) = lower(trim(p_receipt_number))) THEN
    RAISE EXCEPTION 'Receipt number % has already been used in this school', p_receipt_number;
  END IF;

  IF round(p_amount, 2) > round(
      coalesce(v_bill.balance_amount, 0) + coalesce(v_payment.amount, 0), 2) + 0.005 THEN
    RAISE EXCEPTION 'Payment exceeds the available bill balance';
  END IF;
  IF jsonb_typeof(COALESCE(p_allocations, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_allocations, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Select at least one fee category and enter an amount';
  END IF;
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_alloc_total := v_alloc_total + COALESCE((v_alloc->>'amount')::numeric, 0);
    IF NOT EXISTS (SELECT 1 FROM public.fee_bill_items
         WHERE id = (v_alloc->>'fee_bill_item_id')::uuid
           AND bill_id = v_bill.id AND school_id = v_school_id) THEN
      RAISE EXCEPTION 'The selected fee item does not belong to this bill';
    END IF;
  END LOOP;
  IF abs(round(v_alloc_total, 2) - round(p_amount, 2)) > 0.005 THEN
    RAISE EXCEPTION 'Allocation total does not match payment total';
  END IF;
  UPDATE public.fee_payments SET amount = round(p_amount, 2),
    payment_method = lower(trim(p_payment_mode))::payment_method,
    account_id = p_account_id, payment_date = p_payment_date,
    receipt_number = btrim(p_receipt_number),
    reference_number = nullif(btrim(COALESCE(p_reference_number, '')), ''),
    notes = nullif(btrim(COALESCE(p_remarks, '')), '')
   WHERE id = p_payment_id AND school_id = v_school_id;
  DELETE FROM public.fee_payment_allocations WHERE payment_id = p_payment_id;
  INSERT INTO public.fee_payment_allocations (school_id, bill_id, payment_id, amount, fee_bill_item_id)
  SELECT v_school_id, v_bill.id, p_payment_id,
         round((x.amount)::numeric, 2), x.fee_bill_item_id
    FROM jsonb_to_recordset(p_allocations) AS x(fee_bill_item_id uuid, amount numeric);
  DELETE FROM public.fee_payment_splits WHERE payment_id = p_payment_id;
  v_delta := round(p_amount, 2) - coalesce(v_payment.amount, 0);
  v_new_paid := greatest(coalesce(v_bill.paid_amount, 0) + v_delta, 0);
  UPDATE public.fee_bills SET paid_amount = v_new_paid,
    balance_amount = greatest(coalesce(total_amount, 0) - v_new_paid, 0),
    status = CASE WHEN greatest(coalesce(total_amount, 0) - v_new_paid, 0) <= 0.005 THEN 'paid'
      WHEN v_new_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    updated_at = now() WHERE id = v_bill.id AND school_id = v_school_id;
  SELECT id INTO v_journal_id FROM public.journal_entries
   WHERE school_id = v_school_id AND reference_type = 'fee_payment'
     AND reference_id::text = p_payment_id::text
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_journal_id IS NOT NULL THEN
    SELECT id INTO v_fee_income FROM public.accounts
     WHERE school_id = v_school_id AND code = 'STUDENT_FEES'
       AND lower(account_type::text) = 'income' AND is_active = true LIMIT 1;
    IF v_fee_income IS NULL THEN
      RAISE EXCEPTION 'Student Fees income account is not configured';
    END IF;
    UPDATE public.journal_entries SET
      description = 'Student fee payment ' || btrim(p_receipt_number),
      entry_date = p_payment_date
     WHERE id = v_journal_id AND school_id = v_school_id;
    DELETE FROM public.journal_lines WHERE journal_entry_id = v_journal_id AND school_id = v_school_id;
    INSERT INTO public.journal_lines (school_id, journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_school_id, v_journal_id, p_account_id, round(p_amount, 2), 0, 'Fee payment received'),
      (v_school_id, v_journal_id, v_fee_income, 0, round(p_amount, 2), 'Student fee income earned');
    PERFORM public.validate_journal_entry_balance(v_journal_id);
  END IF;
  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id,
    'bill_id', v_bill.id, 'amount', round(p_amount, 2));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_fee_payment_collection(
  uuid, numeric, text, uuid, date, text, text, text, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
