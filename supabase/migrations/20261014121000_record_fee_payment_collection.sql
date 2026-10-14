-- Single-collection record RPC (multi-category allocations variant).
-- The Receipt create page calls record_fee_payment_collection, but only the
-- split variant was ever shipped. Idempotent: safe to re-run.
CREATE OR REPLACE FUNCTION public.record_fee_payment_collection(
  p_student_id uuid, p_bill_id uuid, p_amount numeric, p_payment_mode text,
  p_account_id uuid, p_receipt_number text, p_payment_date date,
  p_reference_number text DEFAULT NULL, p_remarks text DEFAULT NULL,
  p_allocations jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_school_id uuid; v_bill public.fee_bills%rowtype; v_payment_id uuid;
  v_fiscal_year_id uuid; v_fy_start date; v_fy_end date; v_fy_name text;
  v_fee_income uuid; v_remaining numeric(18,2); v_paid numeric(18,2);
  v_alloc jsonb; v_alloc_total numeric(18,2) := 0;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF NULLIF(btrim(COALESCE(p_receipt_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Manual receipt number is required';
  END IF;
  SELECT school_id INTO v_school_id FROM public.students WHERE id = p_student_id;
  IF v_school_id IS NULL THEN RAISE EXCEPTION 'Student was not found'; END IF;
  SELECT * INTO v_bill FROM public.fee_bills
   WHERE id = p_bill_id AND school_id = v_school_id AND student_id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee bill was not found for this student'; END IF;
  IF p_account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND school_id = v_school_id
      AND is_active = true AND lower(account_type::text) IN ('cash', 'bank')) THEN
    RAISE EXCEPTION 'The selected payment account is invalid';
  END IF;

  IF EXISTS (SELECT 1 FROM public.fee_payments WHERE school_id = v_school_id
      AND lower(trim(receipt_number)) = lower(trim(p_receipt_number))) THEN
    RAISE EXCEPTION 'Receipt number % has already been used in this school', p_receipt_number;
  END IF;
  v_remaining := greatest(coalesce(v_bill.balance_amount, 0), 0);
  IF p_amount > v_remaining + 0.005 THEN
    RAISE EXCEPTION 'Payment exceeds the remaining bill balance';
  END IF;
  IF jsonb_typeof(COALESCE(p_allocations, '[]'::jsonb)) = 'array' THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb)) LOOP
      v_alloc_total := v_alloc_total + COALESCE((v_alloc->>'amount')::numeric, 0);
      IF NOT EXISTS (SELECT 1 FROM public.fee_bill_items
           WHERE id = (v_alloc->>'fee_bill_item_id')::uuid
             AND bill_id = p_bill_id AND school_id = v_school_id) THEN
        RAISE EXCEPTION 'The selected fee item does not belong to this bill';
      END IF;
    END LOOP;
    IF abs(round(v_alloc_total, 2) - round(p_amount, 2)) > 0.005 THEN
      RAISE EXCEPTION 'Allocation total does not match payment total';
    END IF;
  END IF;
  SELECT id INTO v_fiscal_year_id FROM public.fiscal_years
   WHERE school_id = v_school_id AND p_payment_date BETWEEN start_date AND end_date
   ORDER BY start_date DESC LIMIT 1;
  IF v_fiscal_year_id IS NULL THEN
    v_fy_start := (date_trunc('year', p_payment_date) + interval '3 months')::date;
    IF p_payment_date < v_fy_start THEN v_fy_start := v_fy_start - interval '1 year'; END IF;
    v_fy_end := v_fy_start + interval '1 year' - interval '1 day';
    SELECT id INTO v_fiscal_year_id FROM public.fiscal_years
     WHERE school_id = v_school_id AND start_date = v_fy_start AND end_date = v_fy_end LIMIT 1;
    IF v_fiscal_year_id IS NULL THEN
      v_fy_name := to_char(v_fy_start, 'YYYY') || '-' || to_char(v_fy_end, 'YY');
      INSERT INTO public.fiscal_years (school_id, name, start_date, end_date)
      VALUES (v_school_id, v_fy_name, v_fy_start, v_fy_end) RETURNING id INTO v_fiscal_year_id;
    END IF;
  END IF;
  SELECT id INTO v_fee_income FROM public.accounts WHERE school_id = v_school_id
    AND code = 'STUDENT_FEES' AND lower(account_type::text) = 'income'
    AND is_active = true LIMIT 1;
  IF v_fee_income IS NULL THEN
    INSERT INTO public.accounts (school_id, code, name, account_type, is_system, is_active)
    VALUES (v_school_id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true, true)
    ON CONFLICT (school_id, code) DO NOTHING RETURNING id INTO v_fee_income;
    IF v_fee_income IS NULL THEN
      SELECT id INTO v_fee_income FROM public.accounts
       WHERE school_id = v_school_id AND code = 'STUDENT_FEES' LIMIT 1;
    END IF;
  END IF;
  IF v_fee_income IS NULL THEN RAISE EXCEPTION 'Student Fees income account is not configured'; END IF;
  INSERT INTO public.fee_payments (
    school_id, student_id, bill_id, receipt_number, payment_date, amount,
    payment_method, account_id, reference_number, notes, received_by
  ) VALUES (
    v_school_id, p_student_id, p_bill_id, btrim(p_receipt_number), p_payment_date,
    round(p_amount, 2), lower(trim(p_payment_mode))::payment_method, p_account_id,
    nullif(btrim(COALESCE(p_reference_number, '')), ''),
    nullif(btrim(COALESCE(p_remarks, '')), ''), auth.uid()
  ) RETURNING id INTO v_payment_id;
  IF jsonb_typeof(COALESCE(p_allocations, '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.fee_payment_allocations (school_id, bill_id, payment_id, amount, fee_bill_item_id)
    SELECT v_school_id, p_bill_id, v_payment_id, round((x.amount)::numeric, 2), x.fee_bill_item_id
      FROM jsonb_to_recordset(COALESCE(p_allocations, '[]'::jsonb))
        AS x(fee_bill_item_id uuid, amount numeric)
     WHERE x.fee_bill_item_id IS NOT NULL;
  END IF;
  v_paid := coalesce(v_bill.paid_amount, 0) + p_amount;
  UPDATE public.fee_bills SET paid_amount = v_paid,
    balance_amount = greatest(coalesce(total_amount, 0) - v_paid, 0),
    status = CASE WHEN greatest(coalesce(total_amount, 0) - v_paid, 0) <= 0.005 THEN 'paid'
      WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END,
    updated_at = now() WHERE id = p_bill_id AND school_id = v_school_id;
  PERFORM public.create_journal_entry(v_school_id, v_fiscal_year_id, p_payment_date,
    'Student fee payment ' || coalesce(btrim(p_receipt_number), v_payment_id::text),
    'fee_collection', 'fees', 'fee_payments', v_payment_id,
    'fee_payment', v_payment_id::text, auth.uid(),
    jsonb_build_array(
      jsonb_build_object('accountId', p_account_id, 'debit', round(p_amount, 2),
        'credit', 0, 'description', 'Fee payment received'),
      jsonb_build_object('accountId', v_fee_income, 'debit', 0,
        'credit', round(p_amount, 2), 'description', 'Student fee income earned')));
  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id,
    'bill_id', p_bill_id, 'amount', round(p_amount, 2));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.record_fee_payment_collection(
  uuid, uuid, numeric, text, uuid, text, date, text, text, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';

