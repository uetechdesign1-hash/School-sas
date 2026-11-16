-- Phase 2 / 03 - Company settings, independent document version histories
-- (website policies and MOU terms) and the subscription pricing catalogue.

-- ---------------------------------------------------------------------------
-- company_settings (single row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  legal_company_name text,
  brand_name text,
  registered_address text,
  email text,
  mobile text,
  website text,
  gstin text,
  authorized_signatory_name text,
  authorized_signatory_designation text,
  logo_path text,
  signature_path text,
  default_gst_rate numeric(5,2) NOT NULL DEFAULT 0
    CHECK (default_gst_rate >= 0 AND default_gst_rate <= 100),
  invoice_due_days integer NOT NULL DEFAULT 15
    CHECK (invoice_due_days BETWEEN 0 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id),
  CONSTRAINT company_settings_gstin_format CHECK (
    gstin IS NULL
    OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  ),
  CONSTRAINT company_settings_asset_paths CHECK (
    (logo_path IS NULL OR logo_path ~ '^company/[A-Za-z0-9._-]+$')
    AND (signature_path IS NULL OR signature_path ~ '^company/[A-Za-z0-9._-]+$')
  )
);

INSERT INTO public.company_settings (id, brand_name)
VALUES (true, 'SCB')
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS company_settings_updated_at ON public.company_settings;
CREATE TRIGGER company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS company_settings_updated_by ON public.company_settings;
CREATE TRIGGER company_settings_updated_by
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.business_set_updated_by();

DROP TRIGGER IF EXISTS company_settings_audit ON public.company_settings;
CREATE TRIGGER company_settings_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

CREATE OR REPLACE FUNCTION public.company_settings_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'company_settings is a single configuration row and cannot be deleted.'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.company_settings_no_delete()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS company_settings_no_delete ON public.company_settings;
CREATE TRIGGER company_settings_no_delete
  BEFORE DELETE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.company_settings_no_delete();

-- ---------------------------------------------------------------------------
-- Versioned documents. website_policies and mou_terms_versions are separate
-- tables with independent version histories.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.website_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type text NOT NULL
    CHECK (policy_type IN ('privacy_policy', 'terms_and_conditions')),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (btrim(title) <> ''),
  content text NOT NULL CHECK (btrim(content) <> ''),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  effective_date date,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users (id),
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_policies_type_version_key UNIQUE (policy_type, version),
  CONSTRAINT website_policies_published_fields CHECK (
    status = 'draft'
    OR (published_at IS NOT NULL AND effective_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS website_policies_one_published
  ON public.website_policies (policy_type)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.mou_terms_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE CHECK (version > 0),
  title text NOT NULL CHECK (btrim(title) <> ''),
  content text NOT NULL CHECK (btrim(content) <> ''),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  effective_date date,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users (id),
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mou_terms_versions_published_fields CHECK (
    status = 'draft'
    OR (published_at IS NOT NULL AND effective_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mou_terms_versions_one_published
  ON public.mou_terms_versions ((true))
  WHERE status = 'published';

CREATE OR REPLACE FUNCTION public.website_policies_assign_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('website_policies:' || NEW.policy_type));
  SELECT COALESCE(max(version), 0) + 1 INTO NEW.version
  FROM public.website_policies
  WHERE policy_type = NEW.policy_type;
  NEW.status := 'draft';
  NEW.published_at := NULL;
  NEW.published_by := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mou_terms_versions_assign_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('mou_terms_versions'));
  SELECT COALESCE(max(version), 0) + 1 INTO NEW.version
  FROM public.mou_terms_versions;
  NEW.status := 'draft';
  NEW.published_at := NULL;
  NEW.published_by := NULL;
  RETURN NEW;
END;
$$;

-- Published and archived versions are immutable; a published version may only
-- be archived, and a draft may only be published through the publish RPC.
CREATE OR REPLACE FUNCTION public.versioned_document_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_strip text[] := ARRAY['status', 'updated_at', 'published_at', 'published_by', 'effective_date'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Published or archived % versions cannot be deleted.', TG_TABLE_NAME
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status = 'published'
       AND current_setting('app.document_publish', true) IS DISTINCT FROM 'on'
    THEN
      RAISE EXCEPTION 'Use the publish function to publish a document version.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'archived' THEN
      RAISE EXCEPTION 'A draft cannot be archived; delete it instead.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.version IS DISTINCT FROM OLD.version THEN
      RAISE EXCEPTION 'The version number is assigned automatically.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published' AND NEW.status = 'archived'
     AND (to_jsonb(NEW) - v_strip) = (to_jsonb(OLD) - v_strip)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% version % is immutable once published.', TG_TABLE_NAME, OLD.version
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.website_policies_assign_version()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mou_terms_versions_assign_version()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.versioned_document_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS website_policies_assign_version ON public.website_policies;
CREATE TRIGGER website_policies_assign_version
  BEFORE INSERT ON public.website_policies
  FOR EACH ROW EXECUTE FUNCTION public.website_policies_assign_version();

DROP TRIGGER IF EXISTS website_policies_guard ON public.website_policies;
CREATE TRIGGER website_policies_guard
  BEFORE UPDATE OR DELETE ON public.website_policies
  FOR EACH ROW EXECUTE FUNCTION public.versioned_document_guard();

DROP TRIGGER IF EXISTS website_policies_updated_at ON public.website_policies;
CREATE TRIGGER website_policies_updated_at
  BEFORE UPDATE ON public.website_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS website_policies_audit ON public.website_policies;
CREATE TRIGGER website_policies_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.website_policies
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

DROP TRIGGER IF EXISTS mou_terms_versions_assign_version ON public.mou_terms_versions;
CREATE TRIGGER mou_terms_versions_assign_version
  BEFORE INSERT ON public.mou_terms_versions
  FOR EACH ROW EXECUTE FUNCTION public.mou_terms_versions_assign_version();

DROP TRIGGER IF EXISTS mou_terms_versions_guard ON public.mou_terms_versions;
CREATE TRIGGER mou_terms_versions_guard
  BEFORE UPDATE OR DELETE ON public.mou_terms_versions
  FOR EACH ROW EXECUTE FUNCTION public.versioned_document_guard();

DROP TRIGGER IF EXISTS mou_terms_versions_updated_at ON public.mou_terms_versions;
CREATE TRIGGER mou_terms_versions_updated_at
  BEFORE UPDATE ON public.mou_terms_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS mou_terms_versions_audit ON public.mou_terms_versions;
CREATE TRIGGER mou_terms_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.mou_terms_versions
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- Starter documents. The version trigger assigns version 1; they are published
-- immediately so the public pages and the first MOU have content, and Super
-- Admin can publish revised versions at any time.
DO $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.website_policies WHERE policy_type = 'privacy_policy'
  ) THEN
    INSERT INTO public.website_policies (policy_type, version, title, content)
    VALUES (
      'privacy_policy', 1, 'Privacy Policy',
      $doc$This Privacy Policy explains how we collect, use and protect information when you use our school management platform.

1. Information we collect
We collect school details, staff and student records entered by authorised school users, account information such as names, email addresses and phone numbers, and technical information such as log-in activity.

2. How we use information
Information is used to provide and secure the platform, support schools, process subscriptions and payments, and meet legal obligations.

3. Sharing
We do not sell personal information. Information is shared only with service providers that help us run the platform, or where the law requires it.

4. Security and retention
Access is restricted by role and by school. Records are retained for as long as the school subscription is active and as required by law.

5. Your choices
Contact your school administrator or us to access, correct or request deletion of personal information.

6. Contact
Questions about this policy can be sent to the contact details published on our website.$doc$
    )
    RETURNING id INTO v_id;
    PERFORM set_config('app.document_publish', 'on', true);
    UPDATE public.website_policies
    SET status = 'published', effective_date = current_date, published_at = now()
    WHERE id = v_id;
    PERFORM set_config('app.document_publish', 'off', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.website_policies
    WHERE policy_type = 'terms_and_conditions'
  ) THEN
    INSERT INTO public.website_policies (policy_type, version, title, content)
    VALUES (
      'terms_and_conditions', 1, 'Terms & Conditions',
      $doc$These Terms & Conditions govern your use of our website and platform.

1. Acceptance
By using the website or platform you agree to these terms.

2. Accounts
You are responsible for keeping your credentials confidential and for all activity under your account.

3. Acceptable use
You must not misuse the platform, attempt to access data you are not authorised to see, or interfere with its operation.

4. Subscriptions
School subscriptions, pricing and payment terms are set out in the agreement signed between the school and the company. These website terms do not replace that agreement.

5. Availability
We aim for reliable service but do not guarantee uninterrupted availability.

6. Changes
We may update these terms. The version in force is the one published on this page.$doc$
    )
    RETURNING id INTO v_id;
    PERFORM set_config('app.document_publish', 'on', true);
    UPDATE public.website_policies
    SET status = 'published', effective_date = current_date, published_at = now()
    WHERE id = v_id;
    PERFORM set_config('app.document_publish', 'off', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.mou_terms_versions) THEN
    INSERT INTO public.mou_terms_versions (version, title, content)
    VALUES (
      1, 'Standard School Subscription Agreement Terms',
      $doc$1. Scope
The company grants the school access to the subscribed modules of its school management platform for the contract period.

2. Fees
The contract amount, pricing basis, discount and payment frequency are as stated in this agreement. Fees are payable by the due dates shown on each invoice.

3. Student strength
Fees that depend on student strength are based on the strength stated in this agreement. A revised amount applies only after a Final MOU is approved by the company.

4. Payment verification
A payment is treated as received only after the company has verified it. Receipts are issued after verification.

5. Data
The school remains the owner of its data. The company processes it only to provide the service and as described in its Privacy Policy.

6. Term and renewal
The agreement runs from the start date to the end date stated above unless ended earlier in writing by both parties.

7. Governing law
This agreement is governed by the laws of India.$doc$
    )
    RETURNING id INTO v_id;
    PERFORM set_config('app.document_publish', 'on', true);
    UPDATE public.mou_terms_versions
    SET status = 'published', effective_date = current_date, published_at = now()
    WHERE id = v_id;
    PERFORM set_config('app.document_publish', 'off', true);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Subscription pricing catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code IN ('plan1', 'plan2', 'both')),
  name text NOT NULL,
  description text,
  enabled_modules text[] NOT NULL
    CHECK (cardinality(enabled_modules) >= 1
           AND enabled_modules <@ ARRAY['fees', 'payroll']::text[]),
  pricing_unit text NOT NULL CHECK (pricing_unit IN ('per_student', 'per_school_year')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscription_plans
  (code, name, description, enabled_modules, pricing_unit, sort_order)
VALUES
  ('plan1', 'Plan 1 - School Management + Accounting',
   'Students, classes, fees, attendance, expenses, reports and the Accounting Control Center.',
   ARRAY['fees']::text[], 'per_student', 1),
  ('plan2', 'Plan 2 - Staff Management',
   'Staff records and logins, staff attendance, salary, payroll processing and payslips.',
   ARRAY['payroll']::text[], 'per_school_year', 2),
  ('both', 'Both Plans',
   'Plan 1 and Plan 2 together.',
   ARRAY['fees', 'payroll']::text[], 'per_student', 3)
ON CONFLICT (code) DO NOTHING;

DROP TRIGGER IF EXISTS subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS subscription_plans_audit ON public.subscription_plans;
CREATE TRIGGER subscription_plans_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- default_price is the list price. recommended_min/max are advisory guardrails
-- (Plan 2: 2,000-5,000 per school per year); a negotiated price outside them
-- is allowed but is flagged on the agreement for Super Admin visibility.
CREATE TABLE IF NOT EXISTS public.subscription_plan_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.subscription_plans (id),
  default_price numeric(18,2) NOT NULL CHECK (default_price >= 0),
  recommended_min_price numeric(18,2) CHECK (recommended_min_price >= 0),
  recommended_max_price numeric(18,2) CHECK (recommended_max_price >= 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_plan_prices_period CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT subscription_plan_prices_range CHECK (
    recommended_min_price IS NULL OR recommended_max_price IS NULL
    OR recommended_min_price <= recommended_max_price
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plan_prices_one_current
  ON public.subscription_plan_prices (plan_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS subscription_plan_prices_lookup
  ON public.subscription_plan_prices (plan_id, effective_from DESC);

CREATE OR REPLACE FUNCTION public.subscription_plan_prices_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['effective_to'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Price history cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  IF OLD.effective_to IS NOT NULL
     OR (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
  THEN
    RAISE EXCEPTION 'Price rows are immutable; publish a new price instead.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_plan_prices_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS subscription_plan_prices_guard
  ON public.subscription_plan_prices;
CREATE TRIGGER subscription_plan_prices_guard
  BEFORE UPDATE OR DELETE ON public.subscription_plan_prices
  FOR EACH ROW EXECUTE FUNCTION public.subscription_plan_prices_guard();

DROP TRIGGER IF EXISTS subscription_plan_prices_audit
  ON public.subscription_plan_prices;
CREATE TRIGGER subscription_plan_prices_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.subscription_plan_prices
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- Seed the approved default prices once.
INSERT INTO public.subscription_plan_prices
  (plan_id, default_price, recommended_min_price, recommended_max_price, effective_from)
SELECT p.id, v.price, v.min_price, v.max_price, DATE '2026-01-01'
FROM public.subscription_plans p
JOIN (VALUES
  ('plan1', 100.00::numeric, NULL::numeric, NULL::numeric),
  ('plan2', 5000.00::numeric, 2000.00::numeric, 5000.00::numeric),
  ('both', 150.00::numeric, NULL::numeric, NULL::numeric)
) AS v(code, price, min_price, max_price) ON v.code = p.code
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscription_plan_prices x WHERE x.plan_id = p.id
);

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mou_terms_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plan_prices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.company_settings, public.website_policies,
  public.mou_terms_versions, public.subscription_plans,
  public.subscription_plan_prices
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.company_settings TO authenticated;
GRANT UPDATE (
  legal_company_name, brand_name, registered_address, email, mobile, website,
  gstin, authorized_signatory_name, authorized_signatory_designation,
  logo_path, signature_path, default_gst_rate, invoice_due_days
) ON public.company_settings TO authenticated;

GRANT SELECT (id, policy_type, version, title, content, status, effective_date, published_at)
  ON public.website_policies TO anon;
GRANT SELECT ON public.website_policies TO authenticated;
GRANT INSERT (policy_type, title, content, effective_date)
  ON public.website_policies TO authenticated;
GRANT UPDATE (title, content, effective_date)
  ON public.website_policies TO authenticated;
GRANT DELETE ON public.website_policies TO authenticated;

GRANT SELECT ON public.mou_terms_versions TO authenticated;
GRANT INSERT (title, content, effective_date)
  ON public.mou_terms_versions TO authenticated;
GRANT UPDATE (title, content, effective_date)
  ON public.mou_terms_versions TO authenticated;
GRANT DELETE ON public.mou_terms_versions TO authenticated;

GRANT SELECT ON public.subscription_plans TO authenticated;
GRANT SELECT ON public.subscription_plan_prices TO authenticated;

DROP POLICY IF EXISTS company_settings_select ON public.company_settings;
CREATE POLICY company_settings_select ON public.company_settings
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_school_creator());

DROP POLICY IF EXISTS company_settings_super_admin_update ON public.company_settings;
CREATE POLICY company_settings_super_admin_update ON public.company_settings
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS website_policies_public_read ON public.website_policies;
CREATE POLICY website_policies_public_read ON public.website_policies
  FOR SELECT TO anon, authenticated
  USING (status = 'published' OR public.is_super_admin());

DROP POLICY IF EXISTS website_policies_super_admin_insert ON public.website_policies;
CREATE POLICY website_policies_super_admin_insert ON public.website_policies
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS website_policies_super_admin_update ON public.website_policies;
CREATE POLICY website_policies_super_admin_update ON public.website_policies
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS website_policies_super_admin_delete ON public.website_policies;
CREATE POLICY website_policies_super_admin_delete ON public.website_policies
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS mou_terms_versions_select ON public.mou_terms_versions;
CREATE POLICY mou_terms_versions_select ON public.mou_terms_versions
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.is_school_creator() AND status = 'published')
  );

DROP POLICY IF EXISTS mou_terms_versions_super_admin_insert ON public.mou_terms_versions;
CREATE POLICY mou_terms_versions_super_admin_insert ON public.mou_terms_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS mou_terms_versions_super_admin_update ON public.mou_terms_versions;
CREATE POLICY mou_terms_versions_super_admin_update ON public.mou_terms_versions
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS mou_terms_versions_super_admin_delete ON public.mou_terms_versions;
CREATE POLICY mou_terms_versions_super_admin_delete ON public.mou_terms_versions
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS subscription_plans_select ON public.subscription_plans;
CREATE POLICY subscription_plans_select ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (public.is_school_creator() AND is_active));

DROP POLICY IF EXISTS subscription_plan_prices_select ON public.subscription_plan_prices;
CREATE POLICY subscription_plan_prices_select ON public.subscription_plan_prices
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_school_creator());
