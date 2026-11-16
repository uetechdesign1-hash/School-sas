-- Let the privileged cleanup RPC remove only the audit rows belonging to
-- the school it is deleting. Normal audit-log writes remain append-only.
CREATE OR REPLACE FUNCTION public.business_audit_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on'
     AND OLD.school_id = NULLIF(
       current_setting('app.school_cleanup_school_id', true), ''
     )::uuid
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'business_audit_logs is append-only.'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_school_business_records(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'This cleanup operation is restricted to the server.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'School not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.school_cleanup', 'on', true);
  PERFORM set_config('app.school_cleanup_school_id', p_school_id::text, true);

  DELETE FROM public.school_mous WHERE school_id = p_school_id;
  DELETE FROM public.billing_count_confirmations WHERE school_id = p_school_id;
  DELETE FROM public.school_subscription_history WHERE school_id = p_school_id;
  DELETE FROM public.payment_verification_logs l
   WHERE EXISTS (SELECT 1 FROM public.school_payments p
                 WHERE p.id = l.payment_id AND p.school_id = p_school_id);
  DELETE FROM public.payment_reversals WHERE school_id = p_school_id;
  DELETE FROM public.school_payments WHERE school_id = p_school_id;
  DELETE FROM public.school_invoices WHERE school_id = p_school_id;
  DELETE FROM public.sales_activity_logs WHERE school_id = p_school_id;
  DELETE FROM public.school_sales_assignments WHERE school_id = p_school_id;
  DELETE FROM public.school_sales_ownership WHERE school_id = p_school_id;
  PERFORM set_config('app.lead_rpc', 'on', true);
  UPDATE public.school_leads SET converted_school_id = NULL
   WHERE converted_school_id = p_school_id;
  PERFORM set_config('app.lead_rpc', 'off', true);
  DELETE FROM public.school_subscriptions WHERE school_id = p_school_id;
  DELETE FROM public.business_audit_logs WHERE school_id = p_school_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_school_business_records(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_school_business_records(uuid) TO service_role;
