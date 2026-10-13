-- ============================================================================
-- 20261011023101_academic_enrollment_report_rpc.sql
-- ============================================================================
-- Report which historical enrollments still need a class mapping and let an
-- administrator confirm the historical class without touching other years.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_academic_enrollment_backfill_report(
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.school_users su
    WHERE su.school_id = p_school_id
      AND su.user_id = auth.uid()
      AND su.is_active = true
      AND lower(coalesce(su.role, '')) IN ('owner','admin','principal','school_admin')
  ) THEN
    RAISE EXCEPTION 'Only a school administrator can view the backfill report.'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT ae.id AS enrollment_id,
           ae.student_id,
           ae.academic_year_id,
           ay.name AS academic_year_name,
           st.admission_no,
           trim(concat(st.first_name, ' ', st.middle_name, ' ', st.last_name)) AS student_name,
           ae.source
    FROM public.academic_enrollments ae
    JOIN public.academic_years ay ON ay.id = ae.academic_year_id
    JOIN public.students st ON st.id = ae.student_id
    WHERE ae.school_id = p_school_id
      AND ae.class_id IS NULL
    ORDER BY ay.start_date DESC NULLS LAST, st.admission_no
  ) r;

  RETURN jsonb_build_object(
    'needs_class_mapping', v_result,
    'needs_class_mapping_count', jsonb_array_length(v_result)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_academic_enrollment_backfill_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_academic_enrollment_backfill_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_academic_enrollment_class(
  p_school_id uuid,
  p_enrollment_id uuid,
  p_class_id uuid,
  p_section_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_enrollment public.academic_enrollments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.school_users su
    WHERE su.school_id = p_school_id
      AND su.user_id = auth.uid()
      AND su.is_active = true
      AND lower(coalesce(su.role, '')) IN ('owner','admin','principal','school_admin')
  ) THEN
    RAISE EXCEPTION 'Only a school administrator can map historical classes.'
      USING ERRCODE = '42501';
  END IF;

  IF p_class_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = p_class_id AND c.school_id = p_school_id
  ) THEN
    RAISE EXCEPTION 'Class does not exist in this school.';
  END IF;

  IF p_section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.id = p_section_id
      AND s.school_id = p_school_id
      AND s.class_id = p_class_id
  ) THEN
    RAISE EXCEPTION 'Section does not belong to the class.';
  END IF;

  UPDATE public.academic_enrollments
  SET class_id = p_class_id,
      section_id = p_section_id,
      source = 'admin_mapping',
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = p_enrollment_id
    AND school_id = p_school_id
  RETURNING * INTO v_enrollment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment record was not found in this school.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', v_enrollment.id,
    'class_id', v_enrollment.class_id,
    'section_id', v_enrollment.section_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_academic_enrollment_class(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_academic_enrollment_class(uuid, uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
