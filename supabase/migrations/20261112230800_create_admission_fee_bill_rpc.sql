CREATE OR REPLACE FUNCTION public.create_admission_fee_bill(
  p_student_id uuid,
  p_amount numeric,
  p_bill_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_school_id uuid;
  v_academic_year_id uuid;
  v_bill_id uuid;
  v_bill_number text;
  v_bill_date date := coalesce(p_bill_date, current_date);
  v_amount numeric(18, 2);
  v_existing record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required to create an admission fee bill.';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Student is required to create an admission fee bill.';
  END IF;

  v_amount := round(coalesce(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Admission fee amount must be greater than zero.';
  END IF;

  SELECT school_id, academic_year_id
    INTO v_school_id, v_academic_year_id
    FROM public.students
   WHERE id = p_student_id
   FOR UPDATE;

  IF NOT FOUND OR v_school_id IS NULL THEN
    RAISE EXCEPTION 'Student was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.school_users
     WHERE school_id = v_school_id
       AND user_id = auth.uid()
       AND is_active = true
       AND lower(coalesce(role, '')) IN (
         'owner', 'admin', 'principal', 'school_admin', 'accountant'
       )
  ) THEN
    RAISE EXCEPTION 'You do not have permission to create an admission fee bill.';
  END IF;

  SELECT b.id, b.bill_number, b.total_amount, b.balance_amount
    INTO v_existing
    FROM public.fee_bills b
   WHERE b.school_id = v_school_id
     AND b.student_id = p_student_id
     AND b.notes = 'Admission Fee'
     AND b.status <> 'cancelled'
   ORDER BY b.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF round(coalesce(v_existing.total_amount, 0), 2) <> v_amount THEN
      RAISE EXCEPTION 'An admission fee bill already exists with a different amount.';
    END IF;

    RETURN jsonb_build_object(
      'id', v_existing.id,
      'bill_number', v_existing.bill_number,
      'balance_amount', v_existing.balance_amount
    );
  END IF;

  v_bill_number := 'ADM-' ||
    to_char(v_bill_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.fee_bills (
    school_id,
    student_id,
    academic_year_id,
    bill_number,
    bill_date,
    due_date,
    status,
    subtotal,
    discount,
    late_fee,
    total_amount,
    paid_amount,
    balance_amount,
    notes,
    created_by
  )
  VALUES (
    v_school_id,
    p_student_id,
    v_academic_year_id,
    v_bill_number,
    v_bill_date,
    NULL,
    'unpaid',
    v_amount,
    0,
    0,
    v_amount,
    0,
    v_amount,
    'Admission Fee',
    auth.uid()
  )
  RETURNING id INTO v_bill_id;

  INSERT INTO public.fee_bill_items (
    school_id,
    bill_id,
    description,
    fee_type,
    amount,
    discount,
    net_amount
  )
  VALUES (
    v_school_id,
    v_bill_id,
    'Admission Fee',
    'one_time',
    v_amount,
    0,
    v_amount
  );

  RETURN jsonb_build_object(
    'id', v_bill_id,
    'bill_number', v_bill_number,
    'balance_amount', v_amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_admission_fee_bill(uuid, numeric, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admission_fee_bill(uuid, numeric, date)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
