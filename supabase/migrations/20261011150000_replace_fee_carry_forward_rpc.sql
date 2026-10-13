-- PostgreSQL cannot remove existing parameter defaults with CREATE OR REPLACE.
-- Recreate this RPC explicitly so databases with a prior default on p_amount
-- can apply the current argument contract without dropping dependent objects.
DROP FUNCTION IF EXISTS public.create_fee_carry_forward(
  uuid, uuid, uuid, uuid, numeric, text
);

CREATE FUNCTION public.create_fee_carry_forward(
  p_school_id uuid,
  p_student_id uuid,
  p_source_bill_id uuid,
  p_to_academic_year_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_bill public.fee_bills%ROWTYPE;
  v_existing public.fee_carry_forwards%ROWTYPE;
  v_target_year public.academic_years%ROWTYPE;
  v_id uuid;
  v_source_balance numeric(18, 2);
  v_carry_amount numeric(18, 2);
BEGIN
  IF p_school_id IS NULL OR p_student_id IS NULL OR p_source_bill_id IS NULL
     OR p_to_academic_year_id IS NULL THEN
    RAISE EXCEPTION 'create_fee_carry_forward: school, student, source bill and target year are required.';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.school_users su
    WHERE su.school_id = p_school_id
      AND su.user_id = auth.uid()
      AND su.is_active = true
  ) THEN
    RAISE EXCEPTION 'You are not an active member of this school.'
      USING ERRCODE = '42501';
  END IF;

  v_carry_amount := round(coalesce(p_amount, 0), 2);
  IF v_carry_amount <= 0 THEN
    RAISE EXCEPTION 'Carry-forward amount must be greater than zero.';
  END IF;

  SELECT * INTO v_target_year
  FROM public.academic_years
  WHERE id = p_to_academic_year_id AND school_id = p_school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target academic year does not exist in this school.';
  END IF;

  SELECT * INTO v_bill
  FROM public.fee_bills
  WHERE id = p_source_bill_id
    AND school_id = p_school_id
    AND student_id = p_student_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source fee bill was not found for this student.';
  END IF;

  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled bill cannot be carried forward.';
  END IF;

  IF v_bill.academic_year_id = p_to_academic_year_id THEN
    RAISE EXCEPTION 'The source bill already belongs to the target academic year.';
  END IF;

  v_source_balance := greatest(round(coalesce(v_bill.balance_amount, 0), 2), 0);

  SELECT * INTO v_existing
  FROM public.fee_carry_forwards
  WHERE school_id = p_school_id
    AND student_id = p_student_id
    AND source_bill_id = p_source_bill_id
    AND to_academic_year_id = p_to_academic_year_id
    AND fee_category_id IS NULL
    AND status <> 'void'
  FOR UPDATE;

  IF FOUND THEN
    IF abs(round(v_existing.amount, 2) - v_source_balance) > 0.005 THEN
      RAISE EXCEPTION 'Existing carry-forward amount does not match the source bill balance; reconcile the carry-forward before retrying.';
    END IF;

    UPDATE public.fee_bills
    SET status = 'carried_forward'
    WHERE id = p_source_bill_id
      AND school_id = p_school_id
      AND status <> 'carried_forward';

    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'carry_forward_id', v_existing.id,
      'amount', v_existing.amount,
      'status', v_existing.status
    );
  END IF;

  IF v_bill.status = 'carried_forward' THEN
    RAISE EXCEPTION 'This source bill has already been carried forward to another academic year.';
  END IF;

  IF abs(v_carry_amount - v_source_balance) > 0.005 THEN
    RAISE EXCEPTION 'Carry-forward amount must equal the source bill outstanding balance.';
  END IF;

  INSERT INTO public.fee_carry_forwards (
    school_id, student_id, source_bill_id, source_academic_year_id,
    to_academic_year_id, amount, status, notes
  )
  VALUES (
    p_school_id, p_student_id, p_source_bill_id, v_bill.academic_year_id,
    p_to_academic_year_id, v_carry_amount, 'pending',
    nullif(btrim(p_notes), '')
  )
  RETURNING id INTO v_id;

  UPDATE public.fee_bills
  SET status = 'carried_forward'
  WHERE id = p_source_bill_id
    AND school_id = p_school_id;

  RETURN jsonb_build_object(
    'success', true,
    'created', true,
    'carry_forward_id', v_id,
    'amount', v_carry_amount,
    'status', 'pending'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_fee_carry_forward(
  uuid, uuid, uuid, uuid, numeric, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_fee_carry_forward(
  uuid, uuid, uuid, uuid, numeric, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
