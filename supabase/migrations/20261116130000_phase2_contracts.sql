-- Phase 2 / 05 - Contracts: the school subscription agreement (extension of
-- the existing school_subscriptions table), its history, versioned MOU
-- snapshots and auditable billing-student-count confirmations.

-- ---------------------------------------------------------------------------
-- Contract amount formula shared by the table constraint and the RPCs.
-- Prices are per 12-month contract year; terms are whole years.
--   per_student     : students x unit price x years - discount
--   per_school_year : 1 x unit price x years - discount
-- Returns NULL when inputs are invalid or the result would be negative.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_contract_amount(
  p_pricing_unit text,
  p_billing_student_count integer,
  p_unit_price numeric,
  p_term_months integer,
  p_discount numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_unit_price IS NULL OR p_unit_price < 0
      OR p_discount IS NULL OR p_discount < 0
      OR p_term_months IS NULL OR p_term_months < 12 OR p_term_months % 12 <> 0
      OR p_pricing_unit NOT IN ('per_student', 'per_school_year')
      OR (p_pricing_unit = 'per_student'
          AND (p_billing_student_count IS NULL OR p_billing_student_count < 1))
    THEN NULL
    WHEN round(
           (CASE WHEN p_pricing_unit = 'per_student'
                 THEN p_billing_student_count ELSE 1 END)::numeric
           * p_unit_price * (p_term_months / 12) - p_discount, 2) < 0
    THEN NULL
    ELSE round(
           (CASE WHEN p_pricing_unit = 'per_student'
                 THEN p_billing_student_count ELSE 1 END)::numeric
           * p_unit_price * (p_term_months / 12) - p_discount, 2)
  END;
$$;

REVOKE ALL ON FUNCTION public.business_contract_amount(text, integer, numeric, integer, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_contract_amount(text, integer, numeric, integer, numeric)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- school_subscriptions: commercial terms. "amount" is the current final agreed
-- contract amount; the original agreed amount stays on schools.subscription_amount.
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_subscriptions
  ADD COLUMN IF NOT EXISTS subscription_plan_id uuid REFERENCES public.subscription_plans (id),
  ADD COLUMN IF NOT EXISTS enabled_modules text[],
  ADD COLUMN IF NOT EXISTS pricing_unit text,
  ADD COLUMN IF NOT EXISTS estimated_student_count integer,
  ADD COLUMN IF NOT EXISTS billing_student_count integer,
  ADD COLUMN IF NOT EXISTS default_unit_price numeric(18,2),
  ADD COLUMN IF NOT EXISTS negotiated_unit_price numeric(18,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_term_months integer,
  ADD COLUMN IF NOT EXISTS billing_frequency text,
  ADD COLUMN IF NOT EXISTS monthly_instalments_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS special_conditions text,
  ADD COLUMN IF NOT EXISTS price_outside_recommended_range boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS agreement_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.school_subscriptions'::regclass
      AND conname = 'school_subscriptions_commercial_terms'
  ) THEN
    -- Rows created through the Phase 2 sale workflow always carry a plan id
    -- and then must carry the complete, internally consistent terms.
    ALTER TABLE public.school_subscriptions
      ADD CONSTRAINT school_subscriptions_commercial_terms CHECK (
        subscription_plan_id IS NULL
        OR (
          enabled_modules IS NOT NULL
          AND cardinality(enabled_modules) >= 1
          AND pricing_unit IN ('per_student', 'per_school_year')
          AND estimated_student_count >= 1
          AND billing_student_count >= 1
          AND default_unit_price >= 0
          AND negotiated_unit_price >= 0
          AND discount_amount >= 0
          AND contract_term_months >= 12 AND contract_term_months % 12 = 0
          AND billing_frequency IN ('monthly', 'yearly')
          AND (billing_frequency = 'yearly' OR monthly_instalments_allowed)
          AND NULLIF(btrim(payment_terms), '') IS NOT NULL
          AND amount = public.business_contract_amount(
                pricing_unit, billing_student_count, negotiated_unit_price,
                contract_term_months, discount_amount)
        )
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS school_subscriptions_one_active_per_school
  ON public.school_subscriptions (school_id)
  WHERE status = 'active' AND subscription_plan_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.school_subscriptions_commercial_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.subscription_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.subscription_plan_id IS DISTINCT FROM OLD.subscription_plan_id
      OR NEW.enabled_modules IS DISTINCT FROM OLD.enabled_modules
      OR NEW.pricing_unit IS DISTINCT FROM OLD.pricing_unit
      OR NEW.estimated_student_count IS DISTINCT FROM OLD.estimated_student_count
      OR NEW.billing_student_count IS DISTINCT FROM OLD.billing_student_count
      OR NEW.default_unit_price IS DISTINCT FROM OLD.default_unit_price
      OR NEW.negotiated_unit_price IS DISTINCT FROM OLD.negotiated_unit_price
      OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.contract_term_months IS DISTINCT FROM OLD.contract_term_months
      OR NEW.billing_frequency IS DISTINCT FROM OLD.billing_frequency
      OR NEW.monthly_instalments_allowed IS DISTINCT FROM OLD.monthly_instalments_allowed
      OR NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
      OR NEW.started_on IS DISTINCT FROM OLD.started_on
      OR NEW.expires_on IS DISTINCT FROM OLD.expires_on
      OR NEW.agreement_version IS DISTINCT FROM OLD.agreement_version)
     AND current_setting('app.subscription_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Agreed commercial terms change only through an approved revision.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_subscriptions_commercial_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_subscriptions_commercial_guard
  ON public.school_subscriptions;
CREATE TRIGGER school_subscriptions_commercial_guard
  BEFORE UPDATE ON public.school_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.school_subscriptions_commercial_guard();

DROP TRIGGER IF EXISTS school_subscriptions_audit ON public.school_subscriptions;
CREATE TRIGGER school_subscriptions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

CREATE TABLE IF NOT EXISTS public.school_subscription_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.school_subscriptions (id) ON DELETE RESTRICT,
  agreement_version integer NOT NULL CHECK (agreement_version >= 1),
  change_type text NOT NULL
    CHECK (change_type IN ('created', 'final_billing_revision', 'status_change')),
  snapshot jsonb NOT NULL,
  reason text,
  changed_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_subscription_history_version_key
    UNIQUE (subscription_id, agreement_version, change_type)
);

CREATE INDEX IF NOT EXISTS school_subscription_history_school_idx
  ON public.school_subscription_history (school_id, changed_at DESC);

-- ---------------------------------------------------------------------------
-- Generic immutable-row guard (no UPDATE, no DELETE)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable and cannot be % .', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.business_immutable_row()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_subscription_history_immutable
  ON public.school_subscription_history;
CREATE TRIGGER school_subscription_history_immutable
  BEFORE UPDATE OR DELETE ON public.school_subscription_history
  FOR EACH ROW EXECUTE FUNCTION public.business_immutable_row();

DROP TRIGGER IF EXISTS school_subscription_history_reject_internal
  ON public.school_subscription_history;
CREATE TRIGGER school_subscription_history_reject_internal
  BEFORE INSERT ON public.school_subscription_history
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

-- ---------------------------------------------------------------------------
-- Billing student count confirmations (Final MOU workflow)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_count_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.school_subscriptions (id) ON DELETE RESTRICT,
  initial_student_count integer NOT NULL CHECK (initial_student_count >= 1),
  previous_billing_student_count integer NOT NULL CHECK (previous_billing_student_count >= 1),
  observed_student_count integer NOT NULL CHECK (observed_student_count >= 0),
  confirmed_student_count integer NOT NULL CHECK (confirmed_student_count >= 1),
  previous_amount numeric(18,2) NOT NULL CHECK (previous_amount >= 0),
  revised_amount numeric(18,2) NOT NULL CHECK (revised_amount >= 0),
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'rejected', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES auth.users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  request_note text,
  decided_by uuid REFERENCES auth.users (id),
  decided_at timestamptz,
  decision_note text,
  mou_id uuid,
  CONSTRAINT billing_count_confirmations_decision CHECK (
    (status = 'pending_approval' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending_approval' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT billing_count_confirmations_approved_mou CHECK (
    (status = 'approved') = (mou_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_count_confirmations_one_pending
  ON public.billing_count_confirmations (subscription_id)
  WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS billing_count_confirmations_school_idx
  ON public.billing_count_confirmations (school_id, requested_at DESC);

DROP TRIGGER IF EXISTS billing_count_confirmations_reject_internal
  ON public.billing_count_confirmations;
CREATE TRIGGER billing_count_confirmations_reject_internal
  BEFORE INSERT ON public.billing_count_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

CREATE OR REPLACE FUNCTION public.billing_count_confirmations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['status', 'decided_by', 'decided_at', 'decision_note', 'mou_id'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Billing confirmations are audit records and cannot be deleted.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'pending_approval'
     OR (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR current_setting('app.confirmation_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'A billing confirmation can only be decided once, through the approval function.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_count_confirmations_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS billing_count_confirmations_guard
  ON public.billing_count_confirmations;
CREATE TRIGGER billing_count_confirmations_guard
  BEFORE UPDATE OR DELETE ON public.billing_count_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.billing_count_confirmations_guard();

DROP TRIGGER IF EXISTS billing_count_confirmations_audit
  ON public.billing_count_confirmations;
CREATE TRIGGER billing_count_confirmations_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.billing_count_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- ---------------------------------------------------------------------------
-- school_mous: every generated document is a permanent snapshot version
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_mous (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.school_subscriptions (id) ON DELETE RESTRICT,
  mou_type text NOT NULL CHECK (mou_type IN ('initial', 'final')),
  version integer NOT NULL CHECK (version >= 1),
  mou_number text NOT NULL UNIQUE,
  terms_version_id uuid NOT NULL REFERENCES public.mou_terms_versions (id),
  terms_version integer NOT NULL CHECK (terms_version >= 1),
  student_count integer NOT NULL CHECK (student_count >= 1),
  total_amount numeric(18,2) NOT NULL CHECK (total_amount >= 0),
  confirmation_id uuid REFERENCES public.billing_count_confirmations (id),
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  generated_by uuid NOT NULL REFERENCES auth.users (id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_mous_version_key UNIQUE (school_id, mou_type, version),
  CONSTRAINT school_mous_final_requires_confirmation CHECK (
    (mou_type = 'final') = (confirmation_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS school_mous_school_idx
  ON public.school_mous (school_id, mou_type, version DESC);

DROP TRIGGER IF EXISTS school_mous_immutable ON public.school_mous;
CREATE TRIGGER school_mous_immutable
  BEFORE UPDATE OR DELETE ON public.school_mous
  FOR EACH ROW EXECUTE FUNCTION public.business_immutable_row();

DROP TRIGGER IF EXISTS school_mous_reject_internal ON public.school_mous;
CREATE TRIGGER school_mous_reject_internal
  BEFORE INSERT ON public.school_mous
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_mous_audit ON public.school_mous;
CREATE TRIGGER school_mous_audit
  AFTER INSERT ON public.school_mous
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billing_count_confirmations'::regclass
      AND conname = 'billing_count_confirmations_mou_fk'
  ) THEN
    ALTER TABLE public.billing_count_confirmations
      ADD CONSTRAINT billing_count_confirmations_mou_fk
      FOREIGN KEY (mou_id) REFERENCES public.school_mous (id);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_count_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_mous ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_subscription_history,
  public.billing_count_confirmations, public.school_mous
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.school_subscription_history TO authenticated;
GRANT SELECT ON public.billing_count_confirmations TO authenticated;
GRANT SELECT ON public.school_mous TO authenticated;

DROP POLICY IF EXISTS school_subscription_history_select
  ON public.school_subscription_history;
CREATE POLICY school_subscription_history_select
  ON public.school_subscription_history
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));

DROP POLICY IF EXISTS billing_count_confirmations_select
  ON public.billing_count_confirmations;
CREATE POLICY billing_count_confirmations_select
  ON public.billing_count_confirmations
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));

DROP POLICY IF EXISTS school_mous_select ON public.school_mous;
CREATE POLICY school_mous_select ON public.school_mous
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));

-- Sales representatives can read the agreement of schools they currently own.
-- This is additive to the existing school_subscriptions policies.
DROP POLICY IF EXISTS school_subscriptions_sales_rep_select
  ON public.school_subscriptions;
CREATE POLICY school_subscriptions_sales_rep_select
  ON public.school_subscriptions
  FOR SELECT TO authenticated
  USING (public.rep_owns_school(school_id));
