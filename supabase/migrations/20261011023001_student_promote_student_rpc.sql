-- ============================================================================
-- 20261011023001_student_promote_student_rpc.sql
-- ============================================================================
-- Transactional student promotion + idempotent fee carry-forward creation.
--
-- The Students page already calls:
--   promote_students(p_school_id, p_from_academic_year_id,
--                    p_to_academic_year_id, p_to_class_id,
--                    p_to_section_id, p_student_ids)
--   create_fee_carry_forward(p_school_id, p_student_id, p_source_bill_id,
--                            p_to_academic_year_id, p_amount, p_notes)
--
-- promote_students runs as ONE transaction so a partial promotion can never
-- leave inconsistent data.  Repeating a promotion is idempotent: no
-- duplicate enrollments, fee assignments or carry-forward entries.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- create_fee_carry_forward (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_fee_carry_forward(
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

  IF coalesce(p_amount, 0) <= 0 THEN
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

  -- Idempotency: one carry-forward per (source bill, target year, category).
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
    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'carry_forward_id', v_existing.id,
      'amount', v_existing.amount,
      'status', v_existing.status
    );
  END IF;

  INSERT INTO public.fee_carry_forwards (
    school_id, student_id, source_bill_id, source_academic_year_id,
    to_academic_year_id, amount, status, notes
  )
  VALUES (
    p_school_id, p_student_id, p_source_bill_id, v_bill.academic_year_id,
    p_to_academic_year_id, round(p_amount, 2), 'pending',
    nullif(btrim(p_notes), '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'created', true,
    'carry_forward_id', v_id,
    'amount', round(p_amount, 2),
    'status', 'pending'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_fee_carry_forward(uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_fee_carry_forward(uuid, uuid, uuid, uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- promote_students (transactional, idempotent)
-- ---------------------------------------------------------------------------
-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE.
-- Replace this RPC explicitly; no CASCADE is used so unexpected dependencies
-- stop the migration rather than being removed silently.
DROP FUNCTION IF EXISTS public.promote_students(uuid, uuid, uuid, uuid, uuid, uuid[]);

CREATE FUNCTION public.promote_students(
  p_school_id uuid,
  p_from_academic_year_id uuid,
  p_to_academic_year_id uuid,
  p_to_class_id uuid,
  p_to_section_id uuid,
  p_student_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_from_year public.academic_years%ROWTYPE;
  v_to_year public.academic_years%ROWTYPE;
  v_student_id uuid;
  v_student public.students%ROWTYPE;
  v_old_enrollment public.academic_enrollments%ROWTYPE;
  v_new_enrollment_id uuid;
  v_result jsonb := '[]'::jsonb;
BEGIN
  -- ---- 0. Authorization ----
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to promote students.'
      USING ERRCODE = '42501';
  END IF;

  IF p_school_id IS NULL OR p_from_academic_year_id IS NULL
     OR p_to_academic_year_id IS NULL OR p_to_class_id IS NULL
     OR p_student_ids IS NULL OR array_length(p_student_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'promote_students: school, years, class and student list are required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.school_users su
    WHERE su.school_id = p_school_id
      AND su.user_id = v_actor
      AND su.is_active = true
      AND lower(coalesce(su.role, '')) IN ('owner','admin','principal','school_admin')
  ) THEN
    RAISE EXCEPTION 'Only an active school administrator can promote students.'
      USING ERRCODE = '42501';
  END IF;

  -- ---- 1. Validate academic years ----
  SELECT * INTO v_from_year
  FROM public.academic_years
  WHERE id = p_from_academic_year_id AND school_id = p_school_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source academic year does not exist in this school.';
  END IF;

  SELECT * INTO v_to_year
  FROM public.academic_years
  WHERE id = p_to_academic_year_id AND school_id = p_school_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target academic year does not exist in this school.';
  END IF;

  IF v_from_year.id = v_to_year.id THEN
    RAISE EXCEPTION 'Source and target academic years must be different.';
  END IF;

  IF v_from_year.start_date IS NOT NULL AND v_to_year.start_date IS NOT NULL
     AND v_to_year.start_date <= v_from_year.start_date THEN
    RAISE EXCEPTION 'Target academic year must start after the source academic year.';
  END IF;

  -- ---- 2. Validate target class and section ----
  IF NOT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = p_to_class_id AND c.school_id = p_school_id
  ) THEN
    RAISE EXCEPTION 'Target class does not exist in this school.';
  END IF;

  IF p_to_section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.id = p_to_section_id
      AND s.school_id = p_school_id
      AND s.class_id = p_to_class_id
  ) THEN
    RAISE EXCEPTION 'Target section does not belong to the target class.';
  END IF;

  -- ---- 3. Promote each student ----
  FOREACH v_student_id IN ARRAY p_student_ids LOOP
    SELECT * INTO v_student
    FROM public.students
    WHERE id = v_student_id
      AND school_id = p_school_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'student_id', v_student_id,
        'success', false,
        'error', 'Student not found in this school.'
      ));
      CONTINUE;
    END IF;

    IF coalesce(v_student.status, 'active') <> 'active' THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'student_id', v_student_id,
        'success', false,
        'error', 'Only active students can be promoted.'
      ));
      CONTINUE;
    END IF;

    -- The student must currently be in the source year (already promoted
    -- students are allowed so that re-running is idempotent).
    IF v_student.academic_year_id IS NOT NULL
       AND v_student.academic_year_id <> p_from_academic_year_id
       AND v_student.academic_year_id <> p_to_academic_year_id THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'student_id', v_student_id,
        'success', false,
        'error', 'Student is not enrolled in the source academic year.'
      ));
      CONTINUE;
    END IF;

    -- (a) Mark or repair the source-year enrollment as promoted so the
    --     historical record is never overwritten.
    SELECT * INTO v_old_enrollment
    FROM public.academic_enrollments
    WHERE school_id = p_school_id
      AND student_id = v_student_id
      AND academic_year_id = p_from_academic_year_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_old_enrollment.enrollment_status <> 'promoted' THEN
        UPDATE public.academic_enrollments
        SET enrollment_status = 'promoted',
            updated_at = now(),
            updated_by = v_actor
        WHERE id = v_old_enrollment.id;
      END IF;
    ELSE
      INSERT INTO public.academic_enrollments (
        school_id, student_id, academic_year_id, class_id, section_id,
        enrollment_status, created_by
      )
      VALUES (
        p_school_id, v_student_id, p_from_academic_year_id,
        v_student.class_id, v_student.section_id,
        'promoted', v_actor
      )
      RETURNING * INTO v_old_enrollment;
    END IF;

    -- (b) Idempotently create the target-year enrollment record.
    INSERT INTO public.academic_enrollments (
      school_id, student_id, academic_year_id, class_id, section_id,
      enrollment_status, promotion_from_enrollment_id, created_by
    )
    VALUES (
      p_school_id, v_student_id, p_to_academic_year_id,
      p_to_class_id, p_to_section_id, 'active', v_old_enrollment.id, v_actor
    )
    ON CONFLICT (school_id, student_id, academic_year_id) DO UPDATE
      SET class_id = EXCLUDED.class_id,
          section_id = EXCLUDED.section_id,
          enrollment_status = 'active',
          promotion_from_enrollment_id = coalesce(
            academic_enrollments.promotion_from_enrollment_id,
            EXCLUDED.promotion_from_enrollment_id
          ),
          updated_at = now(),
          updated_by = EXCLUDED.updated_by
    RETURNING id INTO v_new_enrollment_id;

    -- (c) Update the student's current view only.  Permanent identity
    --     (id, admission_no, receipts) is untouched.
    UPDATE public.students
    SET academic_year_id = p_to_academic_year_id,
        class_id = p_to_class_id,
        section_id = p_to_section_id
    WHERE id = v_student_id
      AND school_id = p_school_id;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'student_id', v_student_id,
      'success', true,
      'enrollment_id', v_new_enrollment_id,
      'from_academic_year_id', p_from_academic_year_id,
      'to_academic_year_id', p_to_academic_year_id,
      'to_class_id', p_to_class_id,
      'to_section_id', p_to_section_id
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'promoted', jsonb_array_length(v_result),
    'details', v_result
  );

END;
$function$;

REVOKE ALL ON FUNCTION public.promote_students(uuid, uuid, uuid, uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_students(uuid, uuid, uuid, uuid, uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
