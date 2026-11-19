-- Track Final MOU confirmations against the academic year whose enrollment
-- strength was confirmed. Historical confirmations remain unassigned.
ALTER TABLE public.billing_count_confirmations
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id),
  ADD COLUMN IF NOT EXISTS academic_year_name text;

CREATE OR REPLACE FUNCTION public.request_year_billing_count_confirmation(
  p_school_id uuid,
  p_academic_year_id uuid,
  p_confirmed_student_count integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_year public.academic_years%ROWTYPE;
  v_sub public.school_subscriptions%ROWTYPE;
  v_observed integer;
  v_revised numeric(18,2);
  v_id uuid;
BEGIN
  PERFORM public.business_require_school_access(p_school_id);
  SELECT * INTO v_year FROM public.academic_years
    WHERE id = p_academic_year_id AND school_id = p_school_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a valid academic year for this school.' USING ERRCODE = '23514';
  END IF;
  IF p_confirmed_student_count IS NULL OR p_confirmed_student_count < 1 THEN
    RAISE EXCEPTION 'The confirmed student count must be at least 1.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_sub FROM public.school_subscriptions
    WHERE school_id = p_school_id AND status = 'active' AND subscription_plan_id IS NOT NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active agreement was found for this school.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.school_mous WHERE school_id = p_school_id AND mou_type = 'initial') THEN
    RAISE EXCEPTION 'Generate the Initial MOU before confirming the billing count.' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_observed
  FROM public.student_enrollments e JOIN public.students st ON st.id = e.student_id
  WHERE e.school_id = p_school_id AND e.academic_year_id = p_academic_year_id
    AND st.status::text = 'active';
  IF v_observed < 1 THEN
    RAISE EXCEPTION 'No active students are enrolled in the selected academic year.' USING ERRCODE = '23514';
  END IF;
  v_revised := public.business_contract_amount(v_sub.pricing_unit,
    p_confirmed_student_count, v_sub.negotiated_unit_price,
    v_sub.contract_term_months, v_sub.discount_amount);
  IF v_revised IS NULL THEN
    RAISE EXCEPTION 'The revised amount cannot be calculated.' USING ERRCODE = '23514';
  END IF;
  BEGIN
    INSERT INTO public.billing_count_confirmations (
      school_id, subscription_id, initial_student_count, previous_billing_student_count,
      observed_student_count, confirmed_student_count, previous_amount, revised_amount,
      requested_by, request_note, academic_year_id, academic_year_name
    ) VALUES (
      p_school_id, v_sub.id, v_sub.estimated_student_count, v_sub.billing_student_count,
      v_observed, p_confirmed_student_count, v_sub.amount, v_revised, auth.uid(),
      NULLIF(btrim(p_note), ''), p_academic_year_id, v_year.name
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A billing count confirmation is already awaiting approval.' USING ERRCODE = '23505';
  END;
  RETURN jsonb_build_object('confirmation_id', v_id, 'academic_year_id', p_academic_year_id,
    'academic_year_name', v_year.name, 'initial_student_count', v_sub.estimated_student_count,
    'observed_student_count', v_observed, 'confirmed_student_count', p_confirmed_student_count,
    'previous_amount', v_sub.amount, 'revised_amount', v_revised);
END;
$$;

REVOKE ALL ON FUNCTION public.request_year_billing_count_confirmation(uuid,uuid,integer,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_year_billing_count_confirmation(uuid,uuid,integer,text)
  TO authenticated;
