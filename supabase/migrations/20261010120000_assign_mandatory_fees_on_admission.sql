CREATE OR REPLACE FUNCTION public.assign_student_mandatory_fees(
  p_student_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_student public.students%ROWTYPE;
  v_structure public.fee_structures%ROWTYPE;
  v_item record;
  v_bill_id uuid;
  v_bill_number text;
  v_bill_date date := current_date;
  v_item_id uuid;
  v_added_count integer := 0;
  v_amount numeric(18, 2);
  v_multiplier numeric(4, 1);
BEGIN
  IF p_student_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Student and actor are required.';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_user_id THEN
    RAISE EXCEPTION 'The requested actor does not match the signed-in user.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_student
    FROM public.students
   WHERE id = p_student_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found.';
  END IF;

  IF v_student.status <> 'active' THEN
    RETURN jsonb_build_object('bill_id', NULL, 'added_count', 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.school_users
     WHERE school_id = v_student.school_id
       AND user_id = p_actor_user_id
       AND is_active = true
       AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'You do not have permission to assign student fees.'
      USING ERRCODE = '42501';
  END IF;

  IF v_student.academic_year_id IS NULL OR v_student.class_id IS NULL THEN
    RETURN jsonb_build_object('bill_id', NULL, 'added_count', 0);
  END IF;

  SELECT *
    INTO v_structure
    FROM public.fee_structures
   WHERE school_id = v_student.school_id
     AND academic_year_id = v_student.academic_year_id
     AND class_id = v_student.class_id
     AND active = true
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    SELECT *
      INTO v_structure
      FROM public.fee_structures
     WHERE school_id = v_student.school_id
       AND academic_year_id = v_student.academic_year_id
       AND class_id IS NULL
       AND active = true
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('bill_id', NULL, 'added_count', 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.fee_structure_items
     WHERE school_id = v_student.school_id
       AND fee_structure_id = v_structure.id
       AND mandatory = true
       AND amount > 0
  ) THEN
    RETURN jsonb_build_object('bill_id', NULL, 'added_count', 0);
  END IF;

  SELECT id
    INTO v_bill_id
    FROM public.fee_bills
   WHERE school_id = v_student.school_id
     AND student_id = v_student.id
     AND academic_year_id = v_student.academic_year_id
     AND status <> 'cancelled'
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;

  IF v_bill_id IS NULL THEN
    v_bill_number := 'BILL-' ||
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
      v_student.school_id,
      v_student.id,
      v_student.academic_year_id,
      v_bill_number,
      v_bill_date,
      NULL,
      'unpaid',
      0,
      0,
      0,
      0,
      0,
      0,
      'Mandatory fees from ' || v_structure.name,
      p_actor_user_id
    )
    RETURNING id INTO v_bill_id;
  END IF;

  FOR v_item IN
    SELECT fsi.id,
           fsi.fee_category_id,
           fsi.amount,
           fsi.frequency,
           fc.name AS category_name
      FROM public.fee_structure_items AS fsi
      JOIN public.fee_categories AS fc
        ON fc.id = fsi.fee_category_id
       AND fc.school_id = fsi.school_id
     WHERE fsi.school_id = v_student.school_id
       AND fsi.fee_structure_id = v_structure.id
       AND fsi.mandatory = true
       AND fsi.amount > 0
  LOOP
    SELECT id
      INTO v_item_id
      FROM public.fee_bill_items
     WHERE school_id = v_student.school_id
       AND bill_id = v_bill_id
       AND (
         fee_structure_item_id = v_item.id
         OR (
           fee_structure_id = v_structure.id
           AND fee_category_id = v_item.fee_category_id
         )
       )
     ORDER BY (fee_structure_item_id = v_item.id) DESC NULLS LAST, created_at
     LIMIT 1
     FOR UPDATE;

    IF v_item_id IS NOT NULL THEN
      UPDATE public.fee_bill_items
         SET fee_structure_item_id = v_item.id
       WHERE id = v_item_id
         AND fee_structure_item_id IS NULL;
      v_item_id := NULL;
      CONTINUE;
    END IF;

    v_multiplier := CASE v_item.frequency
      WHEN 'monthly' THEN 12
      WHEN 'quarterly' THEN 4
      WHEN 'half_yearly' THEN 2
      ELSE 1
    END;
    v_amount := round(v_item.amount * v_multiplier, 2);

    INSERT INTO public.fee_bill_items (
      school_id,
      bill_id,
      fee_structure_id,
      fee_structure_item_id,
      fee_category_id,
      description,
      fee_type,
      amount,
      discount,
      net_amount
    )
    VALUES (
      v_student.school_id,
      v_bill_id,
      v_structure.id,
      v_item.id,
      v_item.fee_category_id,
      v_item.category_name,
      v_item.frequency,
      v_amount,
      0,
      v_amount
    );

    v_added_count := v_added_count + 1;
  END LOOP;

  IF v_added_count > 0 THEN
    PERFORM public.recalculate_fee_bill(v_bill_id);
  END IF;

  RETURN jsonb_build_object(
    'bill_id', v_bill_id,
    'added_count', v_added_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_student_mandatory_fees(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_student_mandatory_fees(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
