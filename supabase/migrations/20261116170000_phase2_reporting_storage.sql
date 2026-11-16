-- Phase 2 / 09 - Reporting views, dashboard totals, secure storage and the
-- PostgREST schema reload. Outstanding amounts are never stored: they are
-- derived from invoices and verified payments net of refunds/reversals.

-- ---------------------------------------------------------------------------
-- Invoice balances (RLS of the caller applies: security_invoker)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.school_invoice_balances
WITH (security_invoker = true) AS
SELECT
  i.id AS invoice_id,
  i.invoice_number,
  i.school_id,
  i.subscription_id,
  i.period_sequence,
  i.period_start,
  i.period_end,
  i.invoice_date,
  i.due_date,
  i.amount,
  i.tax_amount,
  i.total_amount,
  i.status AS invoice_status,
  COALESCE(v.paid_amount, 0)::numeric(18,2) AS paid_amount,
  COALESCE(pe.pending_amount, 0)::numeric(18,2) AS pending_verification_amount,
  (CASE WHEN i.status = 'cancelled' THEN 0
        ELSE i.total_amount - COALESCE(v.paid_amount, 0) END)::numeric(18,2) AS balance_amount,
  CASE
    WHEN i.status = 'cancelled' THEN 'cancelled'
    WHEN i.total_amount - COALESCE(v.paid_amount, 0) <= 0 THEN 'paid'
    WHEN COALESCE(v.paid_amount, 0) > 0 AND i.due_date < current_date THEN 'overdue'
    WHEN COALESCE(v.paid_amount, 0) > 0 THEN 'partially_paid'
    WHEN i.due_date < current_date THEN 'overdue'
    ELSE 'unpaid'
  END AS display_status
FROM public.school_invoices i
LEFT JOIN LATERAL (
  SELECT sum(p.amount - COALESCE(
           (SELECT sum(r.amount) FROM public.payment_reversals r WHERE r.payment_id = p.id),
           0)) AS paid_amount
  FROM public.school_payments p
  WHERE p.invoice_id = i.id AND p.status IN ('verified', 'reversed', 'refunded')
) v ON true
LEFT JOIN LATERAL (
  SELECT sum(p.amount) AS pending_amount
  FROM public.school_payments p
  WHERE p.invoice_id = i.id AND p.status = 'pending_verification'
) pe ON true;

-- One row per school with an active agreement.
CREATE OR REPLACE VIEW public.school_billing_summary
WITH (security_invoker = true) AS
SELECT
  s.id AS school_id,
  s.name AS school_name,
  sub.id AS subscription_id,
  pl.code AS plan_code,
  sub.status::text AS subscription_status,
  sub.billing_frequency,
  sub.billing_student_count,
  sub.negotiated_unit_price,
  sub.amount AS contract_amount,
  COALESCE(b.invoiced_amount, 0)::numeric(18,2) AS invoiced_amount,
  COALESCE(b.collected_amount, 0)::numeric(18,2) AS collected_amount,
  COALESCE(b.pending_verification_amount, 0)::numeric(18,2) AS pending_verification_amount,
  COALESCE(b.outstanding_amount, 0)::numeric(18,2) AS outstanding_amount,
  b.next_due_date
FROM public.schools s
JOIN public.school_subscriptions sub
  ON sub.school_id = s.id AND sub.status = 'active' AND sub.subscription_plan_id IS NOT NULL
JOIN public.subscription_plans pl ON pl.id = sub.subscription_plan_id
LEFT JOIN LATERAL (
  SELECT
    sum(ib.total_amount) FILTER (WHERE ib.invoice_status = 'issued') AS invoiced_amount,
    sum(ib.paid_amount) FILTER (WHERE ib.invoice_status = 'issued') AS collected_amount,
    sum(ib.pending_verification_amount) FILTER (WHERE ib.invoice_status = 'issued')
      AS pending_verification_amount,
    sum(ib.balance_amount) FILTER (WHERE ib.invoice_status = 'issued') AS outstanding_amount,
    min(ib.due_date) FILTER (WHERE ib.invoice_status = 'issued' AND ib.balance_amount > 0)
      AS next_due_date
  FROM public.school_invoice_balances ib
  WHERE ib.subscription_id = sub.id
) b ON true
WHERE NOT s.is_platform_internal;

CREATE OR REPLACE VIEW public.business_monthly_collections
WITH (security_invoker = true) AS
SELECT month, sum(collected)::numeric(18,2) AS collected_amount,
       sum(refunded)::numeric(18,2) AS refunded_amount,
       (sum(collected) - sum(refunded))::numeric(18,2) AS net_amount
FROM (
  SELECT date_trunc('month', p.payment_date)::date AS month, p.amount AS collected, 0::numeric AS refunded
  FROM public.school_payments p
  WHERE p.status IN ('verified', 'reversed', 'refunded')
  UNION ALL
  SELECT date_trunc('month', r.reversal_date)::date, 0::numeric, r.amount
  FROM public.payment_reversals r
) t
GROUP BY month;

CREATE OR REPLACE VIEW public.subscription_plan_distribution
WITH (security_invoker = true) AS
SELECT pl.code AS plan_code, pl.name AS plan_name,
       count(*) AS subscription_count,
       COALESCE(sum(sub.amount), 0)::numeric(18,2) AS contract_value
FROM public.school_subscriptions sub
JOIN public.subscription_plans pl ON pl.id = sub.subscription_plan_id
WHERE sub.status = 'active'
GROUP BY pl.code, pl.name;

-- Representative performance counts a school for the representative who
-- originally acquired it, even after it has been reassigned. The view runs
-- with the owner's rights and filters rows itself: Super Admin sees every
-- representative, a representative sees only their own line.
CREATE OR REPLACE VIEW public.sales_rep_performance AS
WITH school_totals AS (
  SELECT
    o.school_id,
    o.original_acquisition_rep_id,
    o.current_rep_id,
    sub.status::text AS subscription_status,
    COALESCE(sub.amount, 0) AS contract_amount,
    COALESCE(inv.invoiced, 0) AS invoiced_amount,
    COALESCE(pay.collected, 0) AS collected_amount,
    COALESCE(pend.pending, 0) AS pending_amount
  FROM public.school_sales_ownership o
  JOIN public.schools s ON s.id = o.school_id AND NOT s.is_platform_internal
  LEFT JOIN public.school_subscriptions sub
    ON sub.school_id = o.school_id AND sub.status = 'active' AND sub.subscription_plan_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT sum(i.total_amount) AS invoiced
    FROM public.school_invoices i WHERE i.school_id = o.school_id AND i.status = 'issued'
  ) inv ON true
  LEFT JOIN LATERAL (
    SELECT sum(p.amount - COALESCE(
             (SELECT sum(r.amount) FROM public.payment_reversals r WHERE r.payment_id = p.id), 0)) AS collected
    FROM public.school_payments p
    JOIN public.school_invoices i ON i.id = p.invoice_id AND i.status = 'issued'
    WHERE p.school_id = o.school_id AND p.status IN ('verified', 'reversed', 'refunded')
  ) pay ON true
  LEFT JOIN LATERAL (
    SELECT sum(p.amount) AS pending
    FROM public.school_payments p
    WHERE p.school_id = o.school_id AND p.status = 'pending_verification'
  ) pend ON true
)
SELECT
  sr.user_id AS rep_user_id,
  sr.full_name AS rep_name,
  sr.status AS rep_status,
  count(st.school_id) FILTER (WHERE st.original_acquisition_rep_id = sr.user_id) AS schools_brought,
  count(st.school_id) FILTER (WHERE st.current_rep_id = sr.user_id) AS schools_currently_owned,
  count(st.school_id) FILTER (
    WHERE st.original_acquisition_rep_id = sr.user_id AND st.subscription_status = 'active') AS active_schools,
  COALESCE(sum(st.contract_amount) FILTER (WHERE st.original_acquisition_rep_id = sr.user_id), 0)::numeric(18,2)
    AS total_contract_value,
  COALESCE(sum(st.invoiced_amount) FILTER (WHERE st.original_acquisition_rep_id = sr.user_id), 0)::numeric(18,2)
    AS total_invoiced,
  COALESCE(sum(st.collected_amount) FILTER (WHERE st.original_acquisition_rep_id = sr.user_id), 0)::numeric(18,2)
    AS total_collected,
  COALESCE(sum(st.pending_amount) FILTER (WHERE st.original_acquisition_rep_id = sr.user_id), 0)::numeric(18,2)
    AS pending_verification,
  COALESCE(sum(st.invoiced_amount - st.collected_amount)
    FILTER (WHERE st.original_acquisition_rep_id = sr.user_id), 0)::numeric(18,2) AS outstanding
FROM public.sales_representatives sr
LEFT JOIN school_totals st
  ON st.original_acquisition_rep_id = sr.user_id OR st.current_rep_id = sr.user_id
WHERE sr.user_id IS NOT NULL
  AND (public.is_super_admin() OR sr.user_id = auth.uid())
GROUP BY sr.user_id, sr.full_name, sr.status;

-- Dashboard headline numbers for the caller's scope (RLS applies).
CREATE OR REPLACE FUNCTION public.business_dashboard_totals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_school_creator() THEN
    RAISE EXCEPTION 'Super Admin or Sales Representative access required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total_schools', (SELECT count(*) FROM public.school_billing_summary),
    'active_schools', (SELECT count(*) FROM public.school_billing_summary
                       WHERE subscription_status = 'active'),
    'total_contract_value', COALESCE((SELECT sum(contract_amount) FROM public.school_billing_summary), 0),
    'total_invoiced', COALESCE((SELECT sum(invoiced_amount) FROM public.school_billing_summary), 0),
    'total_collected', COALESCE((SELECT sum(collected_amount) FROM public.school_billing_summary), 0),
    'pending_verification', COALESCE((SELECT sum(pending_verification_amount) FROM public.school_billing_summary), 0),
    'total_outstanding', COALESCE((SELECT sum(outstanding_amount) FROM public.school_billing_summary), 0),
    'initial_mous', (SELECT count(DISTINCT school_id) FROM public.school_mous WHERE mou_type = 'initial'),
    'final_mous', (SELECT count(DISTINCT school_id) FROM public.school_mous WHERE mou_type = 'final')
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.business_dashboard_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_dashboard_totals() TO authenticated;

REVOKE ALL ON public.school_invoice_balances, public.school_billing_summary,
  public.business_monthly_collections, public.subscription_plan_distribution,
  public.sales_rep_performance
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.school_invoice_balances, public.school_billing_summary,
  public.business_monthly_collections, public.subscription_plan_distribution,
  public.sales_rep_performance
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Secure storage for the company logo and visual signature.
-- Private bucket; only Super Admin writes; representatives may read so the
-- MOU / receipt PDFs they download can embed the branding.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage is not installed (storage.buckets / storage.objects missing).';
  END IF;

  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'company-assets' AND public) THEN
    RAISE EXCEPTION 'Bucket company-assets exists but is public; make it private before continuing.';
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('company-assets', 'company-assets', false, 2097152,
          ARRAY['image/png', 'image/jpeg', 'image/webp']::text[])
  ON CONFLICT (id) DO NOTHING;
END;
$$;

DROP POLICY IF EXISTS company_assets_read ON storage.objects;
CREATE POLICY company_assets_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND (public.is_super_admin() OR public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS company_assets_super_admin_insert ON storage.objects;
CREATE POLICY company_assets_super_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'company-assets' AND name LIKE 'company/%' AND public.is_super_admin()
  );

DROP POLICY IF EXISTS company_assets_super_admin_update ON storage.objects;
CREATE POLICY company_assets_super_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'company-assets' AND public.is_super_admin())
  WITH CHECK (bucket_id = 'company-assets' AND name LIKE 'company/%' AND public.is_super_admin());

DROP POLICY IF EXISTS company_assets_super_admin_delete ON storage.objects;
CREATE POLICY company_assets_super_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'company-assets' AND public.is_super_admin());

NOTIFY pgrst, 'reload schema';
