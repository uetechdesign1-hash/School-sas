-- Phase 2 / 08 - Business RPCs. Every function is SECURITY DEFINER with a
-- fixed search_path, verifies the caller itself, and is executable only by
-- the authenticated role. All business writes go through these functions:
-- the API roles have no INSERT/UPDATE/DELETE privilege on the financial tables.

-- ---------------------------------------------------------------------------
-- Authorisation and snapshot helpers (internal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_require_super_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super Admin access required.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.business_require_super_admin()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.business_require_creator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_school_creator() THEN
    RAISE EXCEPTION 'An active Super Admin or Sales Representative is required.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.business_require_creator()
  FROM PUBLIC, anon, authenticated;

-- The caller must be Super Admin, or the active representative who currently
-- owns the school.
CREATE OR REPLACE FUNCTION public.business_require_school_access(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.is_super_admin() OR public.rep_owns_school(p_school_id))
  THEN
    RAISE EXCEPTION 'You do not have access to this school.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.business_require_school_access(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.business_company_snapshot(p_for_agreement boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c public.company_settings%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.company_settings WHERE id;
  IF NOT FOUND OR NULLIF(btrim(c.legal_company_name), '') IS NULL THEN
    RAISE EXCEPTION 'Complete Company Settings (legal company name) before issuing documents.'
      USING ERRCODE = '23514';
  END IF;
  IF p_for_agreement AND (
       NULLIF(btrim(c.registered_address), '') IS NULL
       OR NULLIF(btrim(c.authorized_signatory_name), '') IS NULL
     )
  THEN
    RAISE EXCEPTION 'Complete Company Settings (registered address and authorised signatory) before generating an MOU.'
      USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object(
    'legal_company_name', c.legal_company_name,
    'brand_name', c.brand_name,
    'registered_address', c.registered_address,
    'email', c.email,
    'mobile', c.mobile,
    'website', c.website,
    'gstin', c.gstin,
    'authorized_signatory_name', c.authorized_signatory_name,
    'authorized_signatory_designation', c.authorized_signatory_designation,
    'logo_path', c.logo_path,
    'signature_path', c.signature_path,
    'default_gst_rate', c.default_gst_rate,
    'signature_notice',
      'The signature image is a visual signature only and is not a legally verified electronic signature.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.business_company_snapshot(boolean)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Publishing documents (independent histories)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_website_policy(p_policy_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_type text;
BEGIN
  PERFORM public.business_require_super_admin();

  SELECT policy_type INTO v_type
  FROM public.website_policies
  WHERE id = p_policy_id AND status = 'draft'
  FOR UPDATE;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Only a draft policy version can be published.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.document_publish', 'on', true);
  UPDATE public.website_policies SET status = 'archived'
  WHERE policy_type = v_type AND status = 'published';
  UPDATE public.website_policies
  SET status = 'published',
      published_at = now(),
      published_by = auth.uid(),
      effective_date = COALESCE(effective_date, current_date)
  WHERE id = p_policy_id;
  PERFORM set_config('app.document_publish', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_mou_terms(p_terms_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_found boolean;
BEGIN
  PERFORM public.business_require_super_admin();

  SELECT true INTO v_found
  FROM public.mou_terms_versions
  WHERE id = p_terms_id AND status = 'draft'
  FOR UPDATE;
  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'Only a draft MOU terms version can be published.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.document_publish', 'on', true);
  UPDATE public.mou_terms_versions SET status = 'archived' WHERE status = 'published';
  UPDATE public.mou_terms_versions
  SET status = 'published',
      published_at = now(),
      published_by = auth.uid(),
      effective_date = COALESCE(effective_date, current_date)
  WHERE id = p_terms_id;
  PERFORM set_config('app.document_publish', 'off', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Pricing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_subscription_plan_price(
  p_plan_code text,
  p_default_price numeric,
  p_recommended_min numeric DEFAULT NULL,
  p_recommended_max numeric DEFAULT NULL,
  p_effective_from date DEFAULT current_date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_plan_id uuid;
  v_current record;
  v_new uuid;
BEGIN
  PERFORM public.business_require_super_admin();

  SELECT id INTO v_plan_id FROM public.subscription_plans WHERE code = p_plan_code FOR UPDATE;
  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Unknown subscription plan %.', p_plan_code;
  END IF;

  SELECT id, effective_from INTO v_current
  FROM public.subscription_plan_prices
  WHERE plan_id = v_plan_id AND effective_to IS NULL;

  IF v_current.id IS NOT NULL THEN
    IF p_effective_from <= v_current.effective_from THEN
      RAISE EXCEPTION 'The new price must take effect after %.', v_current.effective_from;
    END IF;
    UPDATE public.subscription_plan_prices
    SET effective_to = p_effective_from - 1
    WHERE id = v_current.id;
  END IF;

  INSERT INTO public.subscription_plan_prices (
    plan_id, default_price, recommended_min_price, recommended_max_price, effective_from
  )
  VALUES (
    v_plan_id, round(p_default_price, 2), round(p_recommended_min, 2),
    round(p_recommended_max, 2), p_effective_from
  )
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$$;

-- Server-side price calculation used by the wizard preview and by the sale RPC,
-- so prices are never hardcoded in the frontend or API.
CREATE OR REPLACE FUNCTION public.quote_subscription(
  p_plan_code text,
  p_student_count integer,
  p_unit_price numeric DEFAULT NULL,
  p_discount numeric DEFAULT 0,
  p_term_months integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_price public.subscription_plan_prices%ROWTYPE;
  v_unit numeric(18,2);
  v_discount numeric(18,2) := round(COALESCE(p_discount, 0), 2);
  v_units integer;
  v_gross numeric(18,2);
  v_total numeric(18,2);
BEGIN
  PERFORM public.business_require_creator();

  SELECT * INTO v_plan FROM public.subscription_plans WHERE code = p_plan_code AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a valid, active subscription plan.' USING ERRCODE = '23514';
  END IF;
  IF p_student_count IS NULL OR p_student_count < 1 THEN
    RAISE EXCEPTION 'Student strength must be at least 1.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_price
  FROM public.subscription_plan_prices
  WHERE plan_id = v_plan.id AND effective_from <= current_date
    AND (effective_to IS NULL OR effective_to >= current_date)
  ORDER BY effective_from DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No price is configured for plan %.', p_plan_code;
  END IF;

  v_unit := round(COALESCE(p_unit_price, v_price.default_price), 2);
  v_units := CASE WHEN v_plan.pricing_unit = 'per_student' THEN p_student_count ELSE 1 END;
  v_total := public.business_contract_amount(
    v_plan.pricing_unit, p_student_count, v_unit, p_term_months, v_discount);
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'The price, discount or term is invalid (terms are whole years and the discount cannot exceed the gross amount).'
      USING ERRCODE = '23514';
  END IF;
  v_gross := round(v_units::numeric * v_unit * (p_term_months / 12), 2);

  RETURN jsonb_build_object(
    'plan_id', v_plan.id,
    'plan_code', v_plan.code,
    'plan_name', v_plan.name,
    'enabled_modules', to_jsonb(v_plan.enabled_modules),
    'pricing_unit', v_plan.pricing_unit,
    'price_id', v_price.id,
    'default_unit_price', v_price.default_price,
    'recommended_min_price', v_price.recommended_min_price,
    'recommended_max_price', v_price.recommended_max_price,
    'negotiated_unit_price', v_unit,
    'billing_units', v_units,
    'term_months', p_term_months,
    'contract_years', p_term_months / 12,
    'gross_amount', v_gross,
    'discount_amount', v_discount,
    'total_amount', v_total,
    'price_outside_recommended_range',
      (v_price.recommended_min_price IS NOT NULL AND v_unit < v_price.recommended_min_price)
      OR (v_price.recommended_max_price IS NOT NULL AND v_unit > v_price.recommended_max_price)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Sales representative provisioning (safe, resumable Auth invitation flow)
--
-- Sequence used by the API server:
--   1. start_sales_rep_provisioning      (DB transaction: rep row + job)
--   2. claim_provisioning_job            (lease + attempt counter)
--   3. Auth Admin: invite / create user  (outside the DB; idempotent per job)
--   4. record_provisioned_auth_user      (durable link before anything else)
--   5. complete_provisioning_job         (DB transaction: role, profile, status)
-- A failure after step 3 never orphans the Auth user: its id is stored in the
-- job and every retry resumes from the stored state instead of creating a new
-- account. Step 5 is idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_job_access(p_job public.business_provisioning_jobs)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF public.is_super_admin() THEN
    RETURN;
  END IF;
  IF p_job.job_type = 'school_owner'
     AND p_job.created_by = auth.uid()
     AND public.rep_owns_school(p_job.subject_id)
  THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'You do not have access to this provisioning job.' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.business_job_access(public.business_provisioning_jobs)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_sales_rep_provisioning(
  p_full_name text,
  p_email text,
  p_mobile text,
  p_address text,
  p_employee_id text,
  p_joining_date date,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_job public.business_provisioning_jobs%ROWTYPE;
  v_rep public.sales_representatives%ROWTYPE;
BEGIN
  PERFORM public.business_require_super_admin();

  SELECT * INTO v_job FROM public.business_provisioning_jobs
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('job_id', v_job.id, 'rep_id', v_job.subject_id,
                              'status', v_job.status, 'idempotent', true);
  END IF;

  IF NULLIF(btrim(COALESCE(p_full_name, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_mobile, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'Name and mobile number are required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_rep FROM public.sales_representatives WHERE lower(email) = v_email;
  IF FOUND THEN
    RAISE EXCEPTION 'A representative with this email already exists.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION
      'A login with this email already exists. Remove the unused login first or use a different email.'
      USING ERRCODE = '23505';
  END IF;

  PERFORM set_config('app.sales_rep_rpc', 'on', true);
  INSERT INTO public.sales_representatives (
    full_name, email, mobile, address, employee_id, joining_date, status, created_by
  )
  VALUES (
    btrim(p_full_name), v_email, btrim(p_mobile), NULLIF(btrim(p_address), ''),
    NULLIF(btrim(p_employee_id), ''), COALESCE(p_joining_date, current_date),
    'pending_account', auth.uid()
  )
  RETURNING * INTO v_rep;
  PERFORM set_config('app.sales_rep_rpc', 'off', true);

  INSERT INTO public.business_provisioning_jobs (
    job_type, idempotency_key, subject_id, target_email, display_name, payload
  )
  VALUES (
    'sales_rep', p_idempotency_key, v_rep.id, v_email, v_rep.full_name,
    jsonb_build_object('phone', v_rep.mobile)
  )
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('job_id', v_job.id, 'rep_id', v_rep.id,
                            'status', v_job.status, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_school_owner_provisioning(
  p_school_id uuid,
  p_owner_name text,
  p_owner_email text,
  p_owner_phone text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(p_owner_email, '')));
  v_job public.business_provisioning_jobs%ROWTYPE;
  v_code text;
BEGIN
  PERFORM public.business_require_school_access(p_school_id);

  SELECT * INTO v_job FROM public.business_provisioning_jobs
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'idempotent', true);
  END IF;

  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR NULLIF(btrim(COALESCE(p_owner_name, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'A valid owner name and email are required.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.school_users su
    WHERE su.school_id = p_school_id AND su.role = 'owner' AND su.is_active
  ) THEN
    RAISE EXCEPTION 'This school already has an active owner.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(school_code, code) INTO v_code FROM public.schools WHERE id = p_school_id;

  INSERT INTO public.business_provisioning_jobs (
    job_type, idempotency_key, subject_id, target_email, display_name, payload
  )
  VALUES (
    'school_owner', p_idempotency_key, p_school_id, v_email, btrim(p_owner_name),
    jsonb_build_object('phone', NULLIF(btrim(p_owner_phone), ''), 'login_id', upper(v_code))
  )
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_provisioning_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.business_provisioning_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.business_provisioning_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisioning job not found.';
  END IF;
  PERFORM public.business_job_access(v_job);

  IF v_job.status = 'completed' THEN
    RETURN to_jsonb(v_job) - 'created_by';
  END IF;
  IF v_job.status = 'cancelled' THEN
    RAISE EXCEPTION 'This provisioning job was cancelled.' USING ERRCODE = '23514';
  END IF;
  IF v_job.locked_until IS NOT NULL AND v_job.locked_until > now() THEN
    RAISE EXCEPTION 'This provisioning job is already being processed. Retry in a few minutes.'
      USING ERRCODE = '55P03';
  END IF;
  IF v_job.attempts >= v_job.max_attempts THEN
    RAISE EXCEPTION 'This provisioning job exhausted its retries; a Super Admin must reset it.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.business_provisioning_jobs
  SET attempts = attempts + 1,
      locked_until = now() + interval '5 minutes',
      status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN to_jsonb(v_job) - 'created_by';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_provisioned_auth_user(
  p_job_id uuid,
  p_auth_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.business_provisioning_jobs%ROWTYPE;
  v_email text;
  v_role text;
BEGIN
  SELECT * INTO v_job FROM public.business_provisioning_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisioning job not found.';
  END IF;
  PERFORM public.business_job_access(v_job);

  IF v_job.status NOT IN ('pending', 'auth_created') THEN
    RAISE EXCEPTION 'The job is % and cannot record an account.', v_job.status
      USING ERRCODE = '23514';
  END IF;
  IF v_job.auth_user_id IS NOT NULL AND v_job.auth_user_id <> p_auth_user_id THEN
    RAISE EXCEPTION 'This job is already linked to a different login.' USING ERRCODE = '23505';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = p_auth_user_id;
  IF v_email IS NULL OR v_email <> v_job.target_email THEN
    RAISE EXCEPTION 'The login does not exist or its email does not match the job.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_provisioning_jobs j
    WHERE j.auth_user_id = p_auth_user_id AND j.id <> p_job_id
      AND j.status IN ('auth_created', 'completed')
  ) THEN
    RAISE EXCEPTION 'This login is already linked to another provisioning job.'
      USING ERRCODE = '23505';
  END IF;

  SELECT up.platform_role::text INTO v_role FROM public.user_profiles up WHERE up.id = p_auth_user_id;
  IF v_role = 'super_admin'
     OR (v_job.job_type = 'school_owner' AND v_role = 'sales_rep')
     OR (v_job.job_type = 'sales_rep' AND v_role IS NOT NULL
         AND v_role NOT IN ('user', 'sales_rep'))
     OR (v_job.job_type = 'sales_rep' AND EXISTS (
          SELECT 1 FROM public.school_users su WHERE su.user_id = p_auth_user_id))
  THEN
    RAISE EXCEPTION 'This login already belongs to another kind of account.'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.business_provisioning_jobs
  SET status = 'auth_created', auth_user_id = p_auth_user_id, last_error = NULL
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('job_id', v_job.id, 'status', v_job.status,
                            'auth_user_id', v_job.auth_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_provisioning_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.business_provisioning_jobs%ROWTYPE;
  v_rep public.sales_representatives%ROWTYPE;
  v_login text;
BEGIN
  SELECT * INTO v_job FROM public.business_provisioning_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisioning job not found.';
  END IF;
  PERFORM public.business_job_access(v_job);

  IF v_job.status = 'completed' THEN
    RETURN jsonb_build_object('job_id', v_job.id, 'status', 'completed', 'idempotent', true);
  END IF;
  IF v_job.status <> 'auth_created' OR v_job.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'The login must be created and recorded before completing the job.'
      USING ERRCODE = '23514';
  END IF;

  IF v_job.job_type = 'sales_rep' THEN
    PERFORM public.business_require_super_admin();
    SELECT * INTO v_rep FROM public.sales_representatives WHERE id = v_job.subject_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The representative record is missing.';
    END IF;

    INSERT INTO public.user_profiles (id, full_name, phone, platform_role, is_active)
    VALUES (v_job.auth_user_id, v_rep.full_name, v_rep.mobile, 'sales_rep'::public.platform_role, true)
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          phone = EXCLUDED.phone,
          platform_role = 'sales_rep'::public.platform_role,
          is_active = true;

    PERFORM set_config('app.sales_rep_rpc', 'on', true);
    UPDATE public.sales_representatives
    SET user_id = v_job.auth_user_id, status = 'active'
    WHERE id = v_rep.id;
    PERFORM set_config('app.sales_rep_rpc', 'off', true);
  ELSE
    v_login := v_job.payload ->> 'login_id';
    IF v_login IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE lower(up.login_id) = lower(v_login) AND up.id <> v_job.auth_user_id
    ) THEN
      RAISE EXCEPTION 'The School ID % is already used as a login by another account.', v_login
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.user_profiles (id, full_name, login_id, phone, platform_role)
    VALUES (v_job.auth_user_id, v_job.display_name, v_login, v_job.payload ->> 'phone',
            'user'::public.platform_role)
    ON CONFLICT (id) DO UPDATE
      SET full_name = COALESCE(public.user_profiles.full_name, EXCLUDED.full_name),
          login_id = COALESCE(public.user_profiles.login_id, EXCLUDED.login_id),
          phone = COALESCE(public.user_profiles.phone, EXCLUDED.phone);

    INSERT INTO public.school_users (user_id, school_id, role, is_active)
    VALUES (v_job.auth_user_id, v_job.subject_id, 'owner', true)
    ON CONFLICT (user_id, school_id) DO UPDATE SET role = 'owner', is_active = true;
  END IF;

  UPDATE public.business_provisioning_jobs
  SET status = 'completed', completed_at = now(), locked_until = NULL, last_error = NULL
  WHERE id = p_job_id;

  RETURN jsonb_build_object('job_id', p_job_id, 'status', 'completed', 'idempotent', false,
                            'auth_user_id', v_job.auth_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_provisioning_job(p_job_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.business_provisioning_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.business_provisioning_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisioning job not found.';
  END IF;
  PERFORM public.business_job_access(v_job);
  IF v_job.status IN ('completed', 'cancelled') THEN
    RETURN;
  END IF;

  UPDATE public.business_provisioning_jobs
  SET status = CASE WHEN status = 'auth_created' THEN 'auth_created' ELSE 'failed' END,
      last_error = left(COALESCE(p_error, 'Unknown error'), 500),
      locked_until = NULL
  WHERE id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_provisioning_job(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.business_require_super_admin();
  UPDATE public.business_provisioning_jobs
  SET attempts = 0, locked_until = NULL,
      status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END
  WHERE id = p_job_id AND status IN ('pending', 'failed', 'auth_created');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an unfinished provisioning job can be reset.' USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Cancelling never deletes anything itself. It reports whether the stored
-- login can be removed from Supabase Auth without touching real access.
CREATE OR REPLACE FUNCTION public.cancel_provisioning_job(p_job_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.business_provisioning_jobs%ROWTYPE;
  v_safe boolean := false;
BEGIN
  PERFORM public.business_require_super_admin();
  SELECT * INTO v_job FROM public.business_provisioning_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provisioning job not found.';
  END IF;
  IF v_job.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'A % job cannot be cancelled.', v_job.status USING ERRCODE = '23514';
  END IF;

  IF v_job.auth_user_id IS NOT NULL THEN
    v_safe := NOT EXISTS (SELECT 1 FROM public.school_users su WHERE su.user_id = v_job.auth_user_id)
      AND NOT EXISTS (SELECT 1 FROM public.user_profiles up
                      WHERE up.id = v_job.auth_user_id
                        AND up.platform_role::text IN ('super_admin', 'sales_rep'))
      AND NOT EXISTS (SELECT 1 FROM public.business_provisioning_jobs j
                      WHERE j.auth_user_id = v_job.auth_user_id AND j.id <> v_job.id
                        AND j.status IN ('auth_created', 'completed'));
  END IF;

  UPDATE public.business_provisioning_jobs
  SET status = 'cancelled', locked_until = NULL,
      last_error = left('Cancelled: ' || COALESCE(p_reason, ''), 500)
  WHERE id = p_job_id;

  RETURN jsonb_build_object('job_id', p_job_id, 'auth_user_id', v_job.auth_user_id,
                            'safe_to_delete_auth_user', v_safe);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_orphan_auth_accounts()
RETURNS TABLE (user_id uuid, email text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.business_require_super_admin();
  RETURN QUERY
  SELECT u.id, u.email::text, u.created_at
  FROM auth.users u
  WHERE u.created_at < now() - interval '15 minutes'
    AND NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.school_users su WHERE su.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM public.business_provisioning_jobs j
                    WHERE j.auth_user_id = u.id AND j.status <> 'cancelled')
  ORDER BY u.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_sales_rep_active(
  p_rep_id uuid,
  p_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rep public.sales_representatives%ROWTYPE;
BEGIN
  PERFORM public.business_require_super_admin();
  SELECT * INTO v_rep FROM public.sales_representatives WHERE id = p_rep_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Representative not found.';
  END IF;
  IF v_rep.user_id IS NULL THEN
    RAISE EXCEPTION 'The representative login has not been created yet.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.user_profiles SET is_active = p_active WHERE id = v_rep.user_id;
  PERFORM set_config('app.sales_rep_rpc', 'on', true);
  UPDATE public.sales_representatives
  SET status = CASE WHEN p_active THEN 'active' ELSE 'inactive' END
  WHERE id = p_rep_id;
  PERFORM set_config('app.sales_rep_rpc', 'off', true);

  PERFORM public.business_audit_write(
    CASE WHEN p_active THEN 'sales_rep.activated' ELSE 'sales_rep.deactivated' END,
    'sales_representatives', p_rep_id, NULL, NULL, NULL,
    jsonb_build_object('reason', p_reason));
END;
$$;

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_school_rep(
  p_school_id uuid,
  p_new_rep_user_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner public.school_sales_ownership%ROWTYPE;
BEGIN
  PERFORM public.business_require_super_admin();
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to reassign a school.' USING ERRCODE = '23514';
  END IF;
  IF public.is_platform_internal_school(p_school_id)
     OR NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school_id)
  THEN
    RAISE EXCEPTION 'School not found.';
  END IF;
  IF p_new_rep_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_representatives sr
    WHERE sr.user_id = p_new_rep_user_id AND sr.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The new owner must be an active sales representative.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_owner FROM public.school_sales_ownership WHERE school_id = p_school_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Schools created before Phase 2 have no recorded acquirer; that stays NULL.
    INSERT INTO public.school_sales_ownership (
      school_id, original_acquisition_rep_id, current_rep_id, acquired_by
    )
    VALUES (p_school_id, NULL, NULL, auth.uid())
    RETURNING * INTO v_owner;
  END IF;

  IF v_owner.current_rep_id IS NOT DISTINCT FROM p_new_rep_user_id THEN
    RAISE EXCEPTION 'The school is already assigned to this representative.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.school_sales_assignments
  SET effective_to = now()
  WHERE school_id = p_school_id AND effective_to IS NULL;

  INSERT INTO public.school_sales_assignments (
    school_id, rep_user_id, previous_rep_user_id, assignment_type, reason, assigned_by
  )
  VALUES (
    p_school_id, p_new_rep_user_id, v_owner.current_rep_id,
    CASE WHEN p_new_rep_user_id IS NULL THEN 'unassignment' ELSE 'reassignment' END,
    btrim(p_reason), auth.uid()
  );

  PERFORM set_config('app.ownership_rpc', 'on', true);
  UPDATE public.school_sales_ownership
  SET current_rep_id = p_new_rep_user_id
  WHERE school_id = p_school_id;
  PERFORM set_config('app.ownership_rpc', 'off', true);

  PERFORM public.business_audit_write(
    'school.reassigned', 'school_sales_ownership', NULL, p_school_id,
    jsonb_build_object('current_rep_id', v_owner.current_rep_id),
    jsonb_build_object('current_rep_id', p_new_rep_user_id),
    jsonb_build_object('reason', btrim(p_reason),
                       'original_acquisition_rep_id', v_owner.original_acquisition_rep_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_lead(p_lead_id uuid, p_new_rep_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.business_require_super_admin();
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_representatives sr
    WHERE sr.user_id = p_new_rep_user_id AND sr.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The new owner must be an active sales representative.'
      USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('app.lead_rpc', 'on', true);
  UPDATE public.school_leads SET assigned_rep_id = p_new_rep_user_id
  WHERE id = p_lead_id AND status <> 'converted';
  PERFORM set_config('app.lead_rpc', 'off', true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found or already converted.' USING ERRCODE = '23514';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Invoice scheduling (memo-only; no accounting entries)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_period_count(p_subscription public.school_subscriptions)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE p_subscription.billing_frequency
           WHEN 'monthly' THEN p_subscription.contract_term_months
           ELSE p_subscription.contract_term_months / 12
         END;
$$;

-- p_adjustment issues a supplementary invoice for an approved increase of the
-- contract amount once every scheduled period has already been invoiced.
CREATE OR REPLACE FUNCTION public.business_issue_invoice(
  p_subscription_id uuid,
  p_sequence integer,
  p_adjustment boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sub public.school_subscriptions%ROWTYPE;
  v_n integer;
  v_start date;
  v_end date;
  v_existing uuid;
  v_remaining numeric(18,2);
  v_missing integer;
  v_amount numeric(18,2);
  v_rate numeric(5,2);
  v_due_days integer;
  v_tax numeric(18,2);
  v_id uuid;
  v_school record;
BEGIN
  SELECT * INTO v_sub FROM public.school_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR v_sub.subscription_plan_id IS NULL THEN
    RAISE EXCEPTION 'Subscription not found.';
  END IF;
  v_n := public.business_period_count(v_sub);
  IF NOT p_adjustment AND (p_sequence < 1 OR p_sequence > v_n) THEN
    RAISE EXCEPTION 'Billing period % is outside the % periods of this contract.', p_sequence, v_n;
  END IF;

  -- Spread what is still uninvoiced evenly over the scheduled periods still
  -- missing, so the contract is never invoiced twice and a revised amount is
  -- honoured.
  SELECT v_sub.amount - COALESCE(sum(i.amount), 0) INTO v_remaining
  FROM public.school_invoices i
  WHERE i.subscription_id = p_subscription_id AND i.status = 'issued';

  SELECT v_n - count(*) INTO v_missing
  FROM public.school_invoices i
  WHERE i.subscription_id = p_subscription_id AND i.status = 'issued'
    AND i.period_sequence <= v_n;

  IF p_adjustment THEN
    IF v_missing > 0 OR v_remaining <= 0 THEN
      RAISE EXCEPTION 'No supplementary amount is awaiting an invoice.' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(max(i.period_sequence), v_n) + 1 INTO p_sequence
    FROM public.school_invoices i WHERE i.subscription_id = p_subscription_id;
    v_start := current_date;
    v_end := current_date;
    v_amount := v_remaining;
  ELSE
    SELECT i.id INTO v_existing FROM public.school_invoices i
    WHERE i.subscription_id = p_subscription_id AND i.period_sequence = p_sequence
      AND i.status = 'issued';
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;

    IF v_sub.billing_frequency = 'monthly' THEN
      v_start := (v_sub.started_on + make_interval(months => p_sequence - 1))::date;
      v_end := (v_sub.started_on + make_interval(months => p_sequence))::date - 1;
    ELSE
      v_start := (v_sub.started_on + make_interval(years => p_sequence - 1))::date;
      v_end := (v_sub.started_on + make_interval(years => p_sequence))::date - 1;
    END IF;

    IF v_remaining <= 0 OR v_missing < 1 THEN
      RAISE EXCEPTION 'The contract amount has already been fully invoiced.' USING ERRCODE = '23514';
    END IF;
    v_amount := CASE WHEN v_missing = 1 THEN v_remaining ELSE round(v_remaining / v_missing, 2) END;
  END IF;

  SELECT default_gst_rate, invoice_due_days INTO v_rate, v_due_days
  FROM public.company_settings WHERE id;
  v_tax := round(v_amount * COALESCE(v_rate, 0) / 100, 2);

  SELECT s.id, s.name, s.code, s.address, s.city, s.district, s.state, s.postal_code,
         s.contact_person, s.contact_phone, s.email
  INTO v_school FROM public.schools s WHERE s.id = v_sub.school_id;

  INSERT INTO public.school_invoices (
    invoice_number, school_id, subscription_id, period_sequence, period_start, period_end,
    invoice_date, due_date, amount, tax_rate, tax_amount, total_amount, snapshot, created_by
  )
  VALUES (
    public.next_business_number('invoice'), v_sub.school_id, p_subscription_id, p_sequence,
    v_start, v_end, current_date, current_date + COALESCE(v_due_days, 15),
    v_amount, COALESCE(v_rate, 0), v_tax, v_amount + v_tax,
    jsonb_build_object(
      'company', public.business_company_snapshot(false),
      'school', to_jsonb(v_school),
      'subscription', jsonb_build_object(
        'subscription_id', v_sub.id,
        'plan_code', (SELECT code FROM public.subscription_plans WHERE id = v_sub.subscription_plan_id),
        'contract_amount', v_sub.amount,
        'billing_frequency', v_sub.billing_frequency,
        'billing_student_count', v_sub.billing_student_count,
        'agreement_version', v_sub.agreement_version),
      'period', jsonb_build_object('sequence', p_sequence, 'of', v_n,
                                   'start', v_start, 'end', v_end,
                                   'adjustment', p_adjustment)),
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_issue_invoice(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_period_count(public.school_subscriptions)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_school_invoices(
  p_subscription_id uuid,
  p_through date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sub public.school_subscriptions%ROWTYPE;
  v_n integer;
  v_seq integer;
  v_start date;
  v_created integer := 0;
BEGIN
  PERFORM public.business_require_super_admin();
  SELECT * INTO v_sub FROM public.school_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND OR v_sub.subscription_plan_id IS NULL OR v_sub.status <> 'active' THEN
    RAISE EXCEPTION 'Active subscription not found.';
  END IF;

  v_n := public.business_period_count(v_sub);
  FOR v_seq IN 1..v_n LOOP
    IF v_sub.billing_frequency = 'monthly' THEN
      v_start := (v_sub.started_on + make_interval(months => v_seq - 1))::date;
    ELSE
      v_start := (v_sub.started_on + make_interval(years => v_seq - 1))::date;
    END IF;
    EXIT WHEN v_start > p_through;

    IF NOT EXISTS (
      SELECT 1 FROM public.school_invoices i
      WHERE i.subscription_id = p_subscription_id AND i.period_sequence = v_seq
        AND i.status = 'issued'
    ) THEN
      PERFORM public.business_issue_invoice(p_subscription_id, v_seq);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  -- An approved increase after every scheduled period was invoiced becomes one
  -- supplementary invoice for the difference.
  IF (SELECT count(*) FROM public.school_invoices i
      WHERE i.subscription_id = p_subscription_id AND i.status = 'issued'
        AND i.period_sequence <= v_n) = v_n
     AND v_sub.amount > (SELECT COALESCE(sum(i.amount), 0) FROM public.school_invoices i
                         WHERE i.subscription_id = p_subscription_id AND i.status = 'issued')
  THEN
    PERFORM public.business_issue_invoice(p_subscription_id, 0, true);
    v_created := v_created + 1;
  END IF;
  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_due_invoices(p_as_of date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sub record;
  v_total integer := 0;
BEGIN
  PERFORM public.business_require_super_admin();
  FOR v_sub IN
    SELECT s.id FROM public.school_subscriptions s
    WHERE s.subscription_plan_id IS NOT NULL AND s.status = 'active'
    ORDER BY s.started_on
  LOOP
    v_total := v_total + public.generate_school_invoices(v_sub.id, p_as_of);
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_school_invoice(p_invoice_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.business_require_super_admin();
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.school_invoices WHERE id = p_invoice_id AND status = 'issued' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Issued invoice not found.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.school_payments p
    WHERE p.invoice_id = p_invoice_id AND p.status <> 'rejected'
  ) THEN
    RAISE EXCEPTION 'An invoice with payments cannot be cancelled; reverse the payments first.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.invoice_rpc', 'on', true);
  UPDATE public.school_invoices
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
      cancel_reason = btrim(p_reason)
  WHERE id = p_invoice_id;
  PERFORM set_config('app.invoice_rpc', 'off', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Sale creation: school + agreement + ownership + lead conversion + first
-- invoice + owner provisioning job, all in one transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_school_sale(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_super boolean;
  v_key text := NULLIF(btrim(p ->> 'idempotency_key'), '');
  v_job public.business_provisioning_jobs%ROWTYPE;
  v_rep uuid;
  v_lead public.school_leads%ROWTYPE;
  v_lead_id uuid := NULLIF(p ->> 'lead_id', '')::uuid;
  v_name text := NULLIF(btrim(p ->> 'school_name'), '');
  v_code text := upper(NULLIF(btrim(p ->> 'school_code'), ''));
  v_students integer := NULLIF(p ->> 'student_strength', '')::integer;
  v_staff integer := NULLIF(p ->> 'staff_strength', '')::integer;
  v_term integer := COALESCE(NULLIF(p ->> 'term_months', '')::integer, 12);
  v_start date := NULLIF(p ->> 'start_date', '')::date;
  v_end date;
  v_frequency text := p ->> 'billing_frequency';
  v_monthly_ok boolean := COALESCE((p ->> 'monthly_instalments_allowed')::boolean, false);
  v_terms text := NULLIF(btrim(p ->> 'payment_terms'), '');
  v_owner_email text := lower(btrim(COALESCE(p #>> '{owner,email}', '')));
  v_owner_name text := NULLIF(btrim(p #>> '{owner,name}'), '');
  v_owner_phone text := NULLIF(btrim(p #>> '{owner,phone}'), '');
  v_quote jsonb;
  v_school_id uuid;
  v_sub_id uuid;
  v_invoice_id uuid;
BEGIN
  PERFORM public.business_require_creator();
  v_super := public.is_super_admin();

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_job FROM public.business_provisioning_jobs WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('school_id', v_job.subject_id, 'job_id', v_job.id,
                              'idempotent', true);
  END IF;

  -- Ownership: a representative always owns what they create; only Super
  -- Admin may name another representative or leave the school company-direct.
  IF v_super THEN
    v_rep := NULLIF(p ->> 'representative_id', '')::uuid;
  ELSE
    IF NOT public.is_active_sales_rep() THEN
      RAISE EXCEPTION 'Your representative account is not active.' USING ERRCODE = '42501';
    END IF;
    v_rep := v_actor;
  END IF;

  IF v_lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.school_leads WHERE id = v_lead_id FOR UPDATE;
    IF NOT FOUND OR v_lead.status IN ('converted', 'not_interested')
       OR (NOT v_super AND v_lead.assigned_rep_id <> v_actor)
    THEN
      RAISE EXCEPTION 'The lead is not available for conversion.' USING ERRCODE = '42501';
    END IF;
    IF v_rep IS NULL THEN
      v_rep := v_lead.assigned_rep_id;
    ELSIF v_rep <> v_lead.assigned_rep_id THEN
      RAISE EXCEPTION 'The lead belongs to a different representative.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_rep IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sales_representatives sr WHERE sr.user_id = v_rep AND sr.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The owning representative must be active.' USING ERRCODE = '23514';
  END IF;

  IF v_name IS NULL OR v_code IS NULL OR v_code !~ '^[A-Z0-9_-]{3,30}$' THEN
    RAISE EXCEPTION 'School name and a School ID (3-30 letters, numbers, - or _) are required.'
      USING ERRCODE = '23514';
  END IF;
  IF v_owner_name IS NULL
     OR v_owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN
    RAISE EXCEPTION 'A valid owner name and email are required.' USING ERRCODE = '23514';
  END IF;
  IF v_students IS NULL OR v_students < 1 OR v_staff IS NULL OR v_staff < 0 THEN
    RAISE EXCEPTION 'Student strength (at least 1) and staff strength are required.'
      USING ERRCODE = '23514';
  END IF;
  IF v_start IS NULL OR v_terms IS NULL OR v_frequency NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'Start date, payment terms and a billing frequency are required.'
      USING ERRCODE = '23514';
  END IF;
  IF v_frequency = 'monthly' AND NOT v_monthly_ok THEN
    RAISE EXCEPTION 'Monthly billing requires the agreement to permit equal monthly instalments.'
      USING ERRCODE = '23514';
  END IF;
  IF COALESCE((p ->> 'sales_discussion_confirmed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Confirm that the plans, pricing, student strength and payment terms were discussed and agreed.'
      USING ERRCODE = '23514';
  END IF;
  IF p ->> 'negotiated_unit_price' IS NULL THEN
    RAISE EXCEPTION 'The agreed price must be entered explicitly.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.schools s
    WHERE lower(s.code) = lower(v_code) OR lower(s.school_code) = lower(v_code)
  ) THEN
    RAISE EXCEPTION 'This School ID already exists.' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.business_provisioning_jobs j
    WHERE j.job_type = 'sales_rep' AND j.target_email = v_owner_email
      AND j.status IN ('pending', 'auth_created', 'failed')
  ) OR EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.email IS NOT NULL AND lower(up.email) = v_owner_email
      AND up.platform_role::text IN ('super_admin', 'sales_rep')
  ) THEN
    RAISE EXCEPTION 'This email already belongs to a platform account and cannot own a school.'
      USING ERRCODE = '23505';
  END IF;

  v_quote := public.quote_subscription(
    p ->> 'plan_code', v_students, (p ->> 'negotiated_unit_price')::numeric,
    COALESCE(NULLIF(p ->> 'discount_amount', '')::numeric, 0), v_term);
  v_end := (v_start + make_interval(months => v_term))::date - 1;

  PERFORM set_config('app.school_sale_rpc', 'on', true);
  INSERT INTO public.schools (
    name, code, school_code, email, phone, address, city, district, state, postal_code,
    contact_person, contact_phone, contact_email, principal_name, branch_count,
    staff_strength, plan_code, enabled_modules, student_limit, subscription_amount,
    subscription_payment_terms, sales_discussion_confirmed, starts_on, expires_on,
    status, created_by
  )
  VALUES (
    v_name, v_code, v_code,
    NULLIF(btrim(p ->> 'email'), ''), NULLIF(btrim(p ->> 'phone'), ''),
    NULLIF(btrim(p ->> 'address'), ''), NULLIF(btrim(p ->> 'city'), ''),
    NULLIF(btrim(p ->> 'district'), ''), NULLIF(btrim(p ->> 'state'), ''),
    NULLIF(btrim(p ->> 'postal_code'), ''), NULLIF(btrim(p ->> 'contact_person'), ''),
    NULLIF(btrim(p ->> 'contact_phone'), ''), NULLIF(btrim(p ->> 'email'), ''),
    NULLIF(btrim(p ->> 'principal_name'), ''), NULLIF(p ->> 'branch_count', '')::integer,
    v_staff, 'starter',
    ARRAY(SELECT jsonb_array_elements_text(v_quote -> 'enabled_modules')),
    v_students, (v_quote ->> 'total_amount')::numeric, v_terms, true, v_start, v_end,
    'active', v_actor
  )
  RETURNING id INTO v_school_id;
  PERFORM set_config('app.school_sale_rpc', 'off', true);

  INSERT INTO public.school_subscriptions (
    school_id, plan_code, status, amount, started_on, expires_on, student_limit,
    created_by, payment_terms, subscription_plan_id, enabled_modules, pricing_unit,
    estimated_student_count, billing_student_count, default_unit_price,
    negotiated_unit_price, discount_amount, contract_term_months, billing_frequency,
    monthly_instalments_allowed, special_conditions, price_outside_recommended_range,
    pricing_snapshot, agreement_version
  )
  VALUES (
    v_school_id, 'starter', 'active', (v_quote ->> 'total_amount')::numeric, v_start, v_end,
    v_students, v_actor, v_terms, (v_quote ->> 'plan_id')::uuid,
    ARRAY(SELECT jsonb_array_elements_text(v_quote -> 'enabled_modules')),
    v_quote ->> 'pricing_unit', v_students, v_students,
    (v_quote ->> 'default_unit_price')::numeric, (v_quote ->> 'negotiated_unit_price')::numeric,
    (v_quote ->> 'discount_amount')::numeric, v_term, v_frequency, v_monthly_ok,
    NULLIF(btrim(p ->> 'special_conditions'), ''),
    (v_quote ->> 'price_outside_recommended_range')::boolean, v_quote, 1
  )
  RETURNING id INTO v_sub_id;

  INSERT INTO public.school_subscription_history (
    school_id, subscription_id, agreement_version, change_type, snapshot, reason
  )
  VALUES (v_school_id, v_sub_id, 1, 'created',
          jsonb_build_object('quote', v_quote, 'payment_terms', v_terms,
                             'billing_frequency', v_frequency,
                             'start_date', v_start, 'end_date', v_end),
          'School created through the sales workflow');

  INSERT INTO public.school_sales_ownership (
    school_id, original_acquisition_rep_id, current_rep_id, acquired_by
  )
  VALUES (v_school_id, v_rep, v_rep, v_actor);

  INSERT INTO public.school_sales_assignments (
    school_id, rep_user_id, previous_rep_user_id, assignment_type, reason, assigned_by
  )
  VALUES (v_school_id, v_rep, NULL, 'original_acquisition',
          CASE WHEN v_rep IS NULL THEN 'Acquired directly by the company' ELSE 'School created' END,
          v_actor);

  IF v_lead_id IS NOT NULL THEN
    PERFORM set_config('app.lead_rpc', 'on', true);
    UPDATE public.school_leads
    SET status = 'converted', converted_school_id = v_school_id
    WHERE id = v_lead_id;
    PERFORM set_config('app.lead_rpc', 'off', true);
  END IF;

  INSERT INTO public.business_provisioning_jobs (
    job_type, idempotency_key, subject_id, target_email, display_name, payload
  )
  VALUES (
    'school_owner', v_key, v_school_id, v_owner_email, v_owner_name,
    jsonb_build_object('phone', v_owner_phone, 'login_id', v_code)
  )
  RETURNING * INTO v_job;

  v_invoice_id := public.business_issue_invoice(v_sub_id, 1);

  PERFORM public.business_audit_write(
    'school_sale.created', 'schools', v_school_id, v_school_id, NULL,
    jsonb_build_object('subscription_id', v_sub_id, 'quote', v_quote,
                       'representative_id', v_rep, 'lead_id', v_lead_id),
    jsonb_build_object('idempotency_key', v_key));

  RETURN jsonb_build_object(
    'school_id', v_school_id, 'subscription_id', v_sub_id, 'invoice_id', v_invoice_id,
    'job_id', v_job.id, 'quote', v_quote, 'idempotent', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- MOUs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_payment_schedule(
  p_subscription public.school_subscriptions,
  p_total numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_n integer := public.business_period_count(p_subscription);
  v_base numeric(18,2) := round(p_total / v_n, 2);
  v_paid numeric(18,2) := 0;
  v_out jsonb := '[]'::jsonb;
  v_start date;
  v_end date;
  v_amount numeric(18,2);
  i integer;
BEGIN
  FOR i IN 1..v_n LOOP
    IF p_subscription.billing_frequency = 'monthly' THEN
      v_start := (p_subscription.started_on + make_interval(months => i - 1))::date;
      v_end := (p_subscription.started_on + make_interval(months => i))::date - 1;
    ELSE
      v_start := (p_subscription.started_on + make_interval(years => i - 1))::date;
      v_end := (p_subscription.started_on + make_interval(years => i))::date - 1;
    END IF;
    v_amount := CASE WHEN i = v_n THEN p_total - v_paid ELSE v_base END;
    v_paid := v_paid + v_amount;
    v_out := v_out || jsonb_build_object('sequence', i, 'period_start', v_start,
                                         'period_end', v_end, 'amount', v_amount);
  END LOOP;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.business_payment_schedule(public.school_subscriptions, numeric)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.business_insert_mou(
  p_doc_type text,
  p_sub public.school_subscriptions,
  p_student_count integer,
  p_total numeric,
  p_confirmation_id uuid,
  p_place text,
  p_extra jsonb
)
RETURNS public.school_mous
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_terms public.mou_terms_versions%ROWTYPE;
  v_school record;
  v_plan public.subscription_plans%ROWTYPE;
  v_rep record;
  v_version integer;
  v_snapshot jsonb;
  v_row public.school_mous%ROWTYPE;
BEGIN
  SELECT * INTO v_terms FROM public.mou_terms_versions WHERE status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publish MOU terms before generating an MOU.' USING ERRCODE = '23514';
  END IF;

  SELECT s.id, s.name, s.code, s.address, s.city, s.district, s.state, s.postal_code,
         s.contact_person, s.contact_phone, s.email, s.principal_name, s.branch_count
  INTO v_school FROM public.schools s WHERE s.id = p_sub.school_id;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = p_sub.subscription_plan_id;
  SELECT sr.user_id, sr.full_name INTO v_rep
  FROM public.school_sales_ownership o
  JOIN public.sales_representatives sr ON sr.user_id = o.current_rep_id
  WHERE o.school_id = p_sub.school_id;

  SELECT COALESCE(max(version), 0) + 1 INTO v_version
  FROM public.school_mous
  WHERE school_id = p_sub.school_id AND mou_type = p_doc_type;

  v_snapshot := jsonb_build_object(
    'schema_version', 1,
    'document_label', CASE WHEN p_doc_type = 'initial'
                           THEN 'INITIAL MOU / PROVISIONAL AGREEMENT'
                           ELSE 'FINAL MOU' END,
    'mou_type', p_doc_type,
    'version', v_version,
    'generated_at', now(),
    'place', COALESCE(NULLIF(btrim(p_place), ''), v_school.city),
    'company', public.business_company_snapshot(true),
    'school', to_jsonb(v_school),
    'representative', CASE WHEN v_rep.user_id IS NULL THEN NULL
                           ELSE jsonb_build_object('user_id', v_rep.user_id, 'name', v_rep.full_name) END,
    'commercial', jsonb_build_object(
      'plan_code', v_plan.code,
      'plan_name', v_plan.name,
      'enabled_modules', to_jsonb(p_sub.enabled_modules),
      'pricing_unit', p_sub.pricing_unit,
      'student_count', p_student_count,
      'estimated_student_count', p_sub.estimated_student_count,
      'default_unit_price', p_sub.default_unit_price,
      'negotiated_unit_price', p_sub.negotiated_unit_price,
      'discount_amount', p_sub.discount_amount,
      'total_amount', p_total,
      'term_months', p_sub.contract_term_months,
      'billing_frequency', p_sub.billing_frequency,
      'monthly_instalments_allowed', p_sub.monthly_instalments_allowed,
      'payment_terms', p_sub.payment_terms,
      'special_conditions', p_sub.special_conditions,
      'start_date', p_sub.started_on,
      'end_date', p_sub.expires_on,
      'price_outside_recommended_range', p_sub.price_outside_recommended_range),
    'payment_schedule', public.business_payment_schedule(p_sub, p_total),
    'terms', jsonb_build_object('terms_version_id', v_terms.id, 'version', v_terms.version,
                                'title', v_terms.title, 'content', v_terms.content),
    'extra', COALESCE(p_extra, '{}'::jsonb));

  INSERT INTO public.school_mous (
    school_id, subscription_id, mou_type, version, mou_number, terms_version_id,
    terms_version, student_count, total_amount, confirmation_id, snapshot,
    content_hash, generated_by
  )
  VALUES (
    p_sub.school_id, p_sub.id, p_doc_type, v_version, public.next_business_number('mou'),
    v_terms.id, v_terms.version, p_student_count, p_total, p_confirmation_id, v_snapshot,
    encode(sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex'), auth.uid()
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.business_insert_mou(
  text, public.school_subscriptions, integer, numeric, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;

-- Initial MOU: uses the estimated strength; every regeneration is a new version.
CREATE OR REPLACE FUNCTION public.generate_initial_mou(
  p_school_id uuid,
  p_place text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sub public.school_subscriptions%ROWTYPE;
  v_total numeric(18,2);
  v_mou public.school_mous%ROWTYPE;
BEGIN
  PERFORM public.business_require_school_access(p_school_id);

  SELECT * INTO v_sub FROM public.school_subscriptions
  WHERE school_id = p_school_id AND status = 'active' AND subscription_plan_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active agreement was found for this school.' USING ERRCODE = '23514';
  END IF;

  v_total := public.business_contract_amount(
    v_sub.pricing_unit, v_sub.estimated_student_count, v_sub.negotiated_unit_price,
    v_sub.contract_term_months, v_sub.discount_amount);

  v_mou := public.business_insert_mou('initial', v_sub, v_sub.estimated_student_count,
                                      v_total, NULL, p_place, NULL);
  RETURN jsonb_build_object('mou_id', v_mou.id, 'mou_number', v_mou.mou_number,
                            'version', v_mou.version, 'total_amount', v_mou.total_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_billing_count_confirmation(
  p_school_id uuid,
  p_confirmed_student_count integer,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sub public.school_subscriptions%ROWTYPE;
  v_revised numeric(18,2);
  v_observed integer;
  v_id uuid;
BEGIN
  PERFORM public.business_require_school_access(p_school_id);
  IF p_confirmed_student_count IS NULL OR p_confirmed_student_count < 1 THEN
    RAISE EXCEPTION 'The confirmed student count must be at least 1.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_sub FROM public.school_subscriptions
  WHERE school_id = p_school_id AND status = 'active' AND subscription_plan_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active agreement was found for this school.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.school_mous WHERE school_id = p_school_id AND mou_type = 'initial'
  ) THEN
    RAISE EXCEPTION 'Generate the Initial MOU before confirming the billing count.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_observed FROM public.students st
  WHERE st.school_id = p_school_id AND st.status::text = 'active';

  v_revised := public.business_contract_amount(
    v_sub.pricing_unit, p_confirmed_student_count, v_sub.negotiated_unit_price,
    v_sub.contract_term_months, v_sub.discount_amount);
  IF v_revised IS NULL THEN
    RAISE EXCEPTION 'The revised amount cannot be calculated (discount exceeds the gross amount).'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    INSERT INTO public.billing_count_confirmations (
      school_id, subscription_id, initial_student_count, previous_billing_student_count,
      observed_student_count, confirmed_student_count, previous_amount, revised_amount,
      requested_by, request_note
    )
    VALUES (
      p_school_id, v_sub.id, v_sub.estimated_student_count, v_sub.billing_student_count,
      v_observed, p_confirmed_student_count, v_sub.amount, v_revised, auth.uid(),
      NULLIF(btrim(p_note), '')
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A billing count confirmation is already awaiting approval.'
      USING ERRCODE = '23505';
  END;

  RETURN jsonb_build_object('confirmation_id', v_id, 'initial_student_count',
    v_sub.estimated_student_count, 'observed_student_count', v_observed,
    'confirmed_student_count', p_confirmed_student_count, 'previous_amount', v_sub.amount,
    'revised_amount', v_revised);
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_billing_count_confirmation(
  p_confirmation_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_conf public.billing_count_confirmations%ROWTYPE;
  v_sub public.school_subscriptions%ROWTYPE;
  v_mou public.school_mous%ROWTYPE;
BEGIN
  PERFORM public.business_require_super_admin();

  SELECT * INTO v_conf FROM public.billing_count_confirmations
  WHERE id = p_confirmation_id FOR UPDATE;
  IF NOT FOUND OR v_conf.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'No pending confirmation found.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.confirmation_rpc', 'on', true);

  IF NOT p_approve THEN
    UPDATE public.billing_count_confirmations
    SET status = 'rejected', decided_by = auth.uid(), decided_at = now(),
        decision_note = NULLIF(btrim(p_note), '')
    WHERE id = p_confirmation_id;
    PERFORM set_config('app.confirmation_rpc', 'off', true);
    RETURN jsonb_build_object('confirmation_id', p_confirmation_id, 'status', 'rejected');
  END IF;

  SELECT * INTO v_sub FROM public.school_subscriptions WHERE id = v_conf.subscription_id FOR UPDATE;
  IF v_sub.billing_student_count <> v_conf.previous_billing_student_count
     OR v_sub.amount <> v_conf.previous_amount
  THEN
    RAISE EXCEPTION 'The agreement changed after this request; submit a new confirmation.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.subscription_rpc', 'on', true);
  UPDATE public.school_subscriptions
  SET billing_student_count = v_conf.confirmed_student_count,
      amount = v_conf.revised_amount,
      agreement_version = agreement_version + 1
  WHERE id = v_sub.id
  RETURNING * INTO v_sub;
  PERFORM set_config('app.subscription_rpc', 'off', true);

  INSERT INTO public.school_subscription_history (
    school_id, subscription_id, agreement_version, change_type, snapshot, reason
  )
  VALUES (
    v_sub.school_id, v_sub.id, v_sub.agreement_version, 'final_billing_revision',
    jsonb_build_object(
      'confirmation_id', v_conf.id,
      'initial_student_count', v_conf.initial_student_count,
      'previous_billing_student_count', v_conf.previous_billing_student_count,
      'observed_student_count', v_conf.observed_student_count,
      'confirmed_student_count', v_conf.confirmed_student_count,
      'previous_amount', v_conf.previous_amount,
      'revised_amount', v_conf.revised_amount),
    NULLIF(btrim(p_note), ''));

  v_mou := public.business_insert_mou(
    'final', v_sub, v_conf.confirmed_student_count, v_conf.revised_amount, v_conf.id, NULL,
    jsonb_build_object('initial_student_count', v_conf.initial_student_count,
                       'observed_student_count', v_conf.observed_student_count,
                       'previous_amount', v_conf.previous_amount));

  UPDATE public.billing_count_confirmations
  SET status = 'approved', decided_by = auth.uid(), decided_at = now(),
      decision_note = NULLIF(btrim(p_note), ''), mou_id = v_mou.id
  WHERE id = p_confirmation_id;
  PERFORM set_config('app.confirmation_rpc', 'off', true);

  RETURN jsonb_build_object('confirmation_id', p_confirmation_id, 'status', 'approved',
    'mou_id', v_mou.id, 'mou_number', v_mou.mou_number, 'revised_amount', v_conf.revised_amount);
END;
$$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_invoice_exposure(p_invoice_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(sum(
           CASE WHEN p.status = 'pending_verification' THEN p.amount
                WHEN p.status IN ('verified', 'reversed', 'refunded')
                  THEN p.amount - COALESCE(
                         (SELECT sum(r.amount) FROM public.payment_reversals r
                          WHERE r.payment_id = p.id), 0)
                ELSE 0 END), 0)::numeric(18,2)
  FROM public.school_payments p
  WHERE p.invoice_id = p_invoice_id;
$$;

REVOKE ALL ON FUNCTION public.business_invoice_exposure(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_school_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_mode text,
  p_transaction_reference text,
  p_idempotency_key text,
  p_remarks text DEFAULT NULL,
  p_acknowledge_possible_duplicate boolean DEFAULT false,
  p_collected_by_rep_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_super boolean;
  v_inv public.school_invoices%ROWTYPE;
  v_amount numeric(18,2) := round(p_amount, 2);
  v_ref text := NULLIF(btrim(COALESCE(p_transaction_reference, '')), '');
  v_rep uuid;
  v_existing public.school_payments%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.business_require_creator();
  v_super := public.is_super_admin();

  IF NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing FROM public.school_payments
  WHERE submitted_by = v_actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.invoice_id <> p_invoice_id OR v_existing.amount <> v_amount THEN
      RAISE EXCEPTION 'This idempotency key was already used for a different payment.'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('payment_id', v_existing.id, 'status', v_existing.status,
                              'receipt_number', v_existing.receipt_number, 'idempotent', true);
  END IF;

  SELECT * INTO v_inv FROM public.school_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status <> 'issued' THEN
    RAISE EXCEPTION 'Issued invoice not found.' USING ERRCODE = '23514';
  END IF;
  PERFORM public.business_require_school_access(v_inv.school_id);

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter a payment amount greater than zero.' USING ERRCODE = '23514';
  END IF;
  IF p_payment_mode NOT IN ('cash', 'upi', 'bank_transfer', 'cheque', 'other') THEN
    RAISE EXCEPTION 'Select a valid payment mode.' USING ERRCODE = '23514';
  END IF;
  IF p_payment_date IS NULL OR p_payment_date > current_date THEN
    RAISE EXCEPTION 'The payment date cannot be in the future.' USING ERRCODE = '23514';
  END IF;
  IF p_payment_mode <> 'cash' AND v_ref IS NULL THEN
    RAISE EXCEPTION 'A transaction reference is required for this payment mode.'
      USING ERRCODE = '23514';
  END IF;
  IF v_ref IS NULL THEN
    v_ref := 'CASH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  END IF;

  IF v_amount > v_inv.total_amount - public.business_invoice_exposure(p_invoice_id) THEN
    RAISE EXCEPTION 'The amount exceeds the balance still open on this invoice.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT p_acknowledge_possible_duplicate AND EXISTS (
    SELECT 1 FROM public.school_payments p
    WHERE p.invoice_id = p_invoice_id AND p.amount = v_amount
      AND p.payment_date = p_payment_date AND p.payment_mode = p_payment_mode
      AND p.status IN ('pending_verification', 'verified')
  ) THEN
    RAISE EXCEPTION 'A payment with the same invoice, amount, date and mode already exists. Confirm to record it again.'
      USING ERRCODE = '23505';
  END IF;

  IF v_super THEN
    v_rep := p_collected_by_rep_id;
    IF v_rep IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.sales_representatives sr WHERE sr.user_id = v_rep AND sr.status = 'active'
    ) THEN
      RAISE EXCEPTION 'The collecting representative must be active.' USING ERRCODE = '23514';
    END IF;
  ELSE
    v_rep := v_actor;
  END IF;

  BEGIN
    INSERT INTO public.school_payments (
      school_id, invoice_id, amount, payment_date, payment_mode, transaction_reference,
      idempotency_key, remarks, submitted_by, collected_by_rep_id
    )
    VALUES (
      v_inv.school_id, p_invoice_id, v_amount, p_payment_date, p_payment_mode, v_ref,
      p_idempotency_key, NULLIF(btrim(p_remarks), ''), v_actor, v_rep
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This transaction reference has already been recorded.'
      USING ERRCODE = '23505';
  END;

  INSERT INTO public.payment_verification_logs (payment_id, action, from_status, to_status, actor_id, note)
  VALUES (v_id, 'submitted', NULL, 'pending_verification', v_actor, NULLIF(btrim(p_remarks), ''));

  RETURN jsonb_build_object('payment_id', v_id, 'status', 'pending_verification',
                            'transaction_reference', v_ref, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_school_payment(
  p_payment_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pay public.school_payments%ROWTYPE;
  v_inv public.school_invoices%ROWTYPE;
  v_school_name text;
  v_receipt text;
  v_journal uuid;
  v_snapshot jsonb;
BEGIN
  PERFORM public.business_require_super_admin();

  SELECT * INTO v_pay FROM public.school_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;
  IF v_pay.status IN ('verified', 'reversed', 'refunded') THEN
    RETURN jsonb_build_object('payment_id', v_pay.id, 'status', v_pay.status,
      'receipt_number', v_pay.receipt_number,
      'journal_entry_id', v_pay.accounting_journal_entry_id, 'idempotent', true);
  END IF;
  IF v_pay.status <> 'pending_verification' THEN
    RAISE EXCEPTION 'Only a pending payment can be verified.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_inv FROM public.school_invoices WHERE id = v_pay.invoice_id FOR UPDATE;
  IF v_inv.status <> 'issued' THEN
    RAISE EXCEPTION 'The invoice for this payment was cancelled.' USING ERRCODE = '23514';
  END IF;
  IF public.business_invoice_exposure(v_pay.invoice_id) > v_inv.total_amount THEN
    RAISE EXCEPTION 'Verifying this payment would exceed the invoice total.'
      USING ERRCODE = '23514';
  END IF;

  SELECT name INTO v_school_name FROM public.schools WHERE id = v_pay.school_id;
  v_receipt := public.next_business_number('receipt');

  v_journal := public.business_post_payment_receipt(
    v_pay.id, v_pay.amount, v_pay.payment_date, v_pay.payment_mode, v_receipt, v_school_name);

  v_snapshot := jsonb_build_object(
    'receipt_number', v_receipt,
    'company', public.business_company_snapshot(false),
    'school', (SELECT to_jsonb(s) FROM (
        SELECT id, name, code, address, city, district, state, postal_code, contact_person,
               contact_phone, email FROM public.schools WHERE id = v_pay.school_id) s),
    'invoice', jsonb_build_object('invoice_number', v_inv.invoice_number,
                                  'total_amount', v_inv.total_amount,
                                  'period_start', v_inv.period_start,
                                  'period_end', v_inv.period_end),
    'payment', jsonb_build_object('amount', v_pay.amount, 'payment_date', v_pay.payment_date,
                                  'payment_mode', v_pay.payment_mode,
                                  'transaction_reference', v_pay.transaction_reference),
    'verified_at', now());

  PERFORM set_config('app.payment_rpc', 'on', true);
  UPDATE public.school_payments
  SET status = 'verified', verified_by = auth.uid(), verified_at = now(),
      verification_note = NULLIF(btrim(p_note), ''), receipt_number = v_receipt,
      receipt_snapshot = v_snapshot, accounting_journal_entry_id = v_journal
  WHERE id = p_payment_id;
  PERFORM set_config('app.payment_rpc', 'off', true);

  INSERT INTO public.payment_verification_logs (payment_id, action, from_status, to_status, actor_id, note)
  VALUES (p_payment_id, 'verified', 'pending_verification', 'verified', auth.uid(),
          NULLIF(btrim(p_note), ''));

  RETURN jsonb_build_object('payment_id', p_payment_id, 'status', 'verified',
    'receipt_number', v_receipt, 'journal_entry_id', v_journal, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_school_payment(p_payment_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.business_require_super_admin();
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required.' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public.school_payments
  WHERE id = p_payment_id AND status = 'pending_verification' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a pending payment can be rejected.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.payment_rpc', 'on', true);
  UPDATE public.school_payments
  SET status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
      rejection_reason = btrim(p_reason)
  WHERE id = p_payment_id;
  PERFORM set_config('app.payment_rpc', 'off', true);

  INSERT INTO public.payment_verification_logs (payment_id, action, from_status, to_status, actor_id, note)
  VALUES (p_payment_id, 'rejected', 'pending_verification', 'rejected', auth.uid(), btrim(p_reason));
END;
$$;

-- Reversal (whole payment) or refund (whole or partial). Each call posts one
-- reversing journal entry and one payment_reversals row, idempotently.
CREATE OR REPLACE FUNCTION public.refund_school_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_type text,
  p_reason text,
  p_idempotency_key text,
  p_reversal_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pay public.school_payments%ROWTYPE;
  v_amount numeric(18,2) := round(p_amount, 2);
  v_existing public.payment_reversals%ROWTYPE;
  v_reversed numeric(18,2);
  v_rev_id uuid := gen_random_uuid();
  v_number text;
  v_journal uuid;
  v_full boolean;
BEGIN
  PERFORM public.business_require_super_admin();

  IF p_type NOT IN ('reversal', 'refund') THEN
    RAISE EXCEPTION 'The type must be reversal or refund.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'A reason and an idempotency key are required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_pay FROM public.school_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  SELECT * INTO v_existing FROM public.payment_reversals
  WHERE payment_id = p_payment_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('reversal_id', v_existing.id,
      'reversal_number', v_existing.reversal_number,
      'journal_entry_id', v_existing.accounting_journal_entry_id, 'idempotent', true);
  END IF;

  IF v_pay.status <> 'verified' THEN
    RAISE EXCEPTION 'Only a verified payment can be reversed or refunded.' USING ERRCODE = '23514';
  END IF;
  IF p_reversal_date IS NULL OR p_reversal_date > current_date OR p_reversal_date < v_pay.payment_date THEN
    RAISE EXCEPTION 'The reversal date must fall between the payment date and today.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_reversed
  FROM public.payment_reversals WHERE payment_id = p_payment_id;

  IF p_type = 'reversal' AND (v_reversed <> 0 OR v_amount IS DISTINCT FROM v_pay.amount) THEN
    RAISE EXCEPTION 'A reversal must cancel the whole payment; use a refund for part of it.'
      USING ERRCODE = '23514';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 OR v_reversed + v_amount > v_pay.amount THEN
    RAISE EXCEPTION 'The amount must be positive and cannot exceed the unreturned part of the payment.'
      USING ERRCODE = '23514';
  END IF;

  v_number := public.next_business_number('refund');
  v_journal := public.business_post_payment_refund(
    v_rev_id, v_amount, p_reversal_date, v_pay.payment_mode, v_number,
    v_pay.receipt_number, btrim(p_reason));

  INSERT INTO public.payment_reversals (
    id, payment_id, school_id, reversal_type, reversal_number, amount, reversal_date,
    reason, idempotency_key, accounting_journal_entry_id, created_by
  )
  VALUES (
    v_rev_id, p_payment_id, v_pay.school_id, p_type, v_number, v_amount, p_reversal_date,
    btrim(p_reason), p_idempotency_key, v_journal, auth.uid()
  );

  v_full := v_reversed + v_amount = v_pay.amount;
  IF v_full THEN
    PERFORM set_config('app.payment_rpc', 'on', true);
    UPDATE public.school_payments
    SET status = CASE WHEN p_type = 'reversal' THEN 'reversed' ELSE 'refunded' END
    WHERE id = p_payment_id;
    PERFORM set_config('app.payment_rpc', 'off', true);
  END IF;

  INSERT INTO public.payment_verification_logs (payment_id, action, from_status, to_status, actor_id, note)
  VALUES (
    p_payment_id,
    CASE WHEN NOT v_full THEN 'partial_refund'
         WHEN p_type = 'reversal' THEN 'reversed' ELSE 'refunded' END,
    'verified',
    CASE WHEN NOT v_full THEN 'verified'
         WHEN p_type = 'reversal' THEN 'reversed' ELSE 'refunded' END,
    auth.uid(), btrim(p_reason));

  RETURN jsonb_build_object('reversal_id', v_rev_id, 'reversal_number', v_number,
    'journal_entry_id', v_journal, 'amount', v_amount, 'fully_returned', v_full,
    'idempotent', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: authenticated may call the public API surface only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.publish_website_policy(uuid)',
    'public.publish_mou_terms(uuid)',
    'public.set_subscription_plan_price(text,numeric,numeric,numeric,date)',
    'public.quote_subscription(text,integer,numeric,numeric,integer)',
    'public.start_sales_rep_provisioning(text,text,text,text,text,date,text)',
    'public.start_school_owner_provisioning(uuid,text,text,text,text)',
    'public.claim_provisioning_job(uuid)',
    'public.record_provisioned_auth_user(uuid,uuid)',
    'public.complete_provisioning_job(uuid)',
    'public.fail_provisioning_job(uuid,text)',
    'public.reset_provisioning_job(uuid)',
    'public.cancel_provisioning_job(uuid,text)',
    'public.list_orphan_auth_accounts()',
    'public.set_sales_rep_active(uuid,boolean,text)',
    'public.reassign_school_rep(uuid,uuid,text)',
    'public.reassign_lead(uuid,uuid)',
    'public.generate_school_invoices(uuid,date)',
    'public.generate_due_invoices(date)',
    'public.cancel_school_invoice(uuid,text)',
    'public.create_school_sale(jsonb)',
    'public.generate_initial_mou(uuid,text)',
    'public.request_billing_count_confirmation(uuid,integer,text)',
    'public.decide_billing_count_confirmation(uuid,boolean,text)',
    'public.submit_school_payment(uuid,numeric,date,text,text,text,text,boolean,uuid)',
    'public.verify_school_payment(uuid,text)',
    'public.reject_school_payment(uuid,text)',
    'public.refund_school_payment(uuid,numeric,text,text,text,date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.business_job_access(public.business_provisioning_jobs)',
    'public.business_insert_mou(text,public.school_subscriptions,integer,numeric,uuid,text,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  END LOOP;
END;
$$;
