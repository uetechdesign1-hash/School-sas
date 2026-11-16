-- Renew an existing one-year school agreement as a separate subscription.
-- Old subscriptions, invoices and MOUs remain immutable historical records.
CREATE OR REPLACE FUNCTION public.renew_school_subscription(
  p_school_id uuid,
  p_place text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.school_subscriptions%ROWTYPE;
  v_renewed public.school_subscriptions%ROWTYPE;
  v_mou public.school_mous%ROWTYPE;
  v_school_status text;
  v_start date;
  v_end date;
  v_amount numeric(18,2);
  v_version integer;
BEGIN
  PERFORM public.business_require_school_access(p_school_id);

  SELECT status INTO v_school_status
  FROM public.schools
  WHERE id = p_school_id AND NOT is_platform_internal
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'School not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_school_status = 'suspended' THEN
    RAISE EXCEPTION 'Unsuspend this school before renewing its agreement.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_current
  FROM public.school_subscriptions
  WHERE school_id = p_school_id
    AND status = 'active'
    AND subscription_plan_id IS NOT NULL
  ORDER BY started_on DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active Phase 2 agreement was found for this school.' USING ERRCODE = '23514';
  END IF;
  IF v_current.contract_term_months <> 12 THEN
    RAISE EXCEPTION 'The one-year renewal action is only available for a 12-month agreement.' USING ERRCODE = '23514';
  END IF;

  v_amount := public.business_contract_amount(
    v_current.pricing_unit,
    v_current.billing_student_count,
    v_current.negotiated_unit_price,
    12,
    v_current.discount_amount
  );
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'The current price and discount cannot be applied to a one-year renewal.' USING ERRCODE = '23514';
  END IF;

  v_start := greatest(current_date, COALESCE(v_current.expires_on, current_date - 1) + 1);
  v_end := (v_start + interval '12 months')::date - 1;

  SELECT GREATEST(v_current.agreement_version, COALESCE(max(agreement_version), 0)) + 1
  INTO v_version
  FROM public.school_subscription_history
  WHERE school_id = p_school_id;

  INSERT INTO public.school_subscription_history (
    school_id, subscription_id, agreement_version, change_type, snapshot, reason
  )
  VALUES (
    p_school_id, v_current.id, v_current.agreement_version, 'status_change',
    jsonb_build_object('subscription', to_jsonb(v_current), 'new_status', 'inactive'),
    'Replaced by a one-year renewal agreement'
  );

  UPDATE public.school_subscriptions
  SET status = 'inactive'
  WHERE id = v_current.id;

  INSERT INTO public.school_subscriptions (
    school_id, plan_code, status, amount, started_on, expires_on, student_limit,
    created_by, payment_terms, subscription_plan_id, enabled_modules, pricing_unit,
    estimated_student_count, billing_student_count, default_unit_price,
    negotiated_unit_price, discount_amount, contract_term_months, billing_frequency,
    monthly_instalments_allowed, special_conditions, price_outside_recommended_range,
    pricing_snapshot, agreement_version
  )
  VALUES (
    v_current.school_id, v_current.plan_code, 'active', v_amount, v_start, v_end,
    v_current.student_limit, auth.uid(), v_current.payment_terms,
    v_current.subscription_plan_id, v_current.enabled_modules, v_current.pricing_unit,
    v_current.estimated_student_count, v_current.billing_student_count,
    v_current.default_unit_price, v_current.negotiated_unit_price,
    v_current.discount_amount, 12, v_current.billing_frequency,
    v_current.monthly_instalments_allowed, v_current.special_conditions,
    v_current.price_outside_recommended_range,
    COALESCE(v_current.pricing_snapshot, '{}'::jsonb) || jsonb_build_object(
      'renewal', true,
      'renewed_from_subscription_id', v_current.id,
      'renewal_start_date', v_start,
      'renewal_end_date', v_end,
      'renewal_amount', v_amount
    ),
    v_version
  )
  RETURNING * INTO v_renewed;

  INSERT INTO public.school_subscription_history (
    school_id, subscription_id, agreement_version, change_type, snapshot, reason
  )
  VALUES (
    p_school_id, v_renewed.id, v_version, 'created',
    jsonb_build_object(
      'renewal', true,
      'renewed_from_subscription_id', v_current.id,
      'subscription', to_jsonb(v_renewed)
    ),
    'One-year renewal agreement created'
  );

  UPDATE public.schools
  SET expires_on = v_end,
      status = 'active'
  WHERE id = p_school_id;

  v_mou := public.business_insert_mou(
    'initial', v_renewed, v_renewed.estimated_student_count, v_amount, NULL,
    p_place,
    jsonb_build_object(
      'renewal', true,
      'renewed_from_subscription_id', v_current.id,
      'previous_end_date', v_current.expires_on
    )
  );

  RETURN jsonb_build_object(
    'subscription_id', v_renewed.id,
    'mou_id', v_mou.id,
    'mou_number', v_mou.mou_number,
    'version', v_mou.version,
    'total_amount', v_mou.total_amount,
    'starts_on', v_start,
    'expires_on', v_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.renew_school_subscription(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_school_subscription(uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
