-- PHASE 2 - STEP 2 OF 2: complete Business Management schema
-- Supabase Dashboard > SQL Editor > New query > paste > Run.
--
-- Prerequisite: docs/phase-2-step-1-sales-rep-enum.sql has already succeeded.
-- The whole script runs in one transaction: any failed preflight or statement
-- rolls everything back and leaves the database unchanged.
-- Run it once. After it succeeds, run docs/phase-2-verification.sql.
-- Generated from supabase/migrations/ - do not edit by hand; re-run
-- `node scripts/build-phase2-sql.mjs` after changing a migration.

BEGIN;

-- ============================================================================
-- 20261116100000_phase2_foundation.sql
-- ============================================================================

-- Phase 2 / 02 - Foundation: preflight, Phase 1 agreement prerequisites,
-- platform-company tenant protections, privilege guards, shared helpers,
-- numbering and the append-only business audit log.
--
-- Requires: 20261116090000_phase2_sales_rep_enum.sql committed beforehand.

-- ---------------------------------------------------------------------------
-- Preflight: stop with a precise message if the live schema is not what the
-- Phase 2 SQL was written against. Nothing below guesses at a schema.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_item record;
BEGIN
  FOR v_item IN
    SELECT t AS table_name
    FROM unnest(ARRAY[
      'schools', 'school_subscriptions', 'user_profiles', 'school_users',
      'audit_logs', 'accounts', 'journal_entries', 'journal_lines',
      'accounting_events', 'accounting_audit_log', 'fiscal_years', 'students'
    ]) AS t
  LOOP
    IF to_regclass('public.' || v_item.table_name) IS NULL THEN
      v_missing := array_append(v_missing, 'table public.' || v_item.table_name);
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT * FROM (VALUES
      ('schools', 'id'), ('schools', 'name'), ('schools', 'code'),
      ('schools', 'school_code'), ('schools', 'status'),
      ('schools', 'enabled_modules'), ('schools', 'student_limit'),
      ('schools', 'plan_code'), ('schools', 'starts_on'),
      ('schools', 'expires_on'), ('schools', 'created_by'),
      ('schools', 'email'), ('schools', 'phone'), ('schools', 'address'),
      ('schools', 'city'), ('schools', 'state'), ('schools', 'postal_code'),
      ('schools', 'contact_phone'), ('schools', 'contact_email'),
      ('school_subscriptions', 'id'), ('school_subscriptions', 'school_id'),
      ('school_subscriptions', 'plan_code'), ('school_subscriptions', 'status'),
      ('school_subscriptions', 'amount'), ('school_subscriptions', 'started_on'),
      ('school_subscriptions', 'expires_on'),
      ('school_subscriptions', 'student_limit'),
      ('school_subscriptions', 'created_by'),
      ('user_profiles', 'id'), ('user_profiles', 'platform_role'),
      ('user_profiles', 'is_active'), ('user_profiles', 'full_name'),
      ('user_profiles', 'login_id'), ('user_profiles', 'phone'),
      ('user_profiles', 'email'),
      ('school_users', 'user_id'), ('school_users', 'school_id'),
      ('school_users', 'role'), ('school_users', 'is_active'),
      ('accounts', 'school_id'), ('accounts', 'code'), ('accounts', 'name'),
      ('accounts', 'account_type'), ('accounts', 'is_active'),
      ('accounts', 'is_system'),
      ('journal_entries', 'school_id'), ('journal_entries', 'fiscal_year_id'),
      ('journal_entries', 'entry_number'), ('journal_entries', 'entry_type'),
      ('journal_entries', 'status'), ('journal_entries', 'source_module'),
      ('journal_entries', 'source_table'), ('journal_entries', 'source_record_id'),
      ('journal_entries', 'reference_type'), ('journal_entries', 'reference_id'),
      ('journal_entries', 'posted_by'), ('journal_entries', 'posted_at'),
      ('journal_lines', 'school_id'), ('journal_lines', 'journal_entry_id'),
      ('journal_lines', 'account_id'), ('journal_lines', 'debit'),
      ('journal_lines', 'credit'), ('journal_lines', 'fiscal_year_id'),
      ('accounting_events', 'school_id'), ('accounting_events', 'source_module'),
      ('accounting_events', 'source_table'),
      ('accounting_events', 'source_record_id'),
      ('accounting_events', 'journal_entry_id'), ('accounting_events', 'status'),
      ('accounting_audit_log', 'school_id'),
      ('accounting_audit_log', 'entity_type'),
      ('accounting_audit_log', 'entity_id'), ('accounting_audit_log', 'action'),
      ('accounting_audit_log', 'actor_id'), ('accounting_audit_log', 'payload'),
      ('fiscal_years', 'school_id'), ('fiscal_years', 'name'),
      ('fiscal_years', 'start_date'), ('fiscal_years', 'end_date'),
      ('fiscal_years', 'is_closed'),
      ('students', 'school_id'), ('students', 'status')
    ) AS c(table_name, column_name)
  LOOP
    IF to_regclass('public.' || v_item.table_name) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = v_item.table_name
           AND c.column_name = v_item.column_name
       )
    THEN
      v_missing := array_append(v_missing,
        'column public.' || v_item.table_name || '.' || v_item.column_name);
    END IF;
  END LOOP;

  IF to_regtype('public.platform_role') IS NULL THEN
    v_missing := array_append(v_missing, 'type public.platform_role'::text);
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    WHERE e.enumtypid = 'public.platform_role'::regtype
      AND e.enumlabel = 'sales_rep'
  ) THEN
    v_missing := array_append(v_missing,
      'enum value platform_role.sales_rep (run 20261116090000_phase2_sales_rep_enum.sql first and let it commit)'::text);
  END IF;

  IF to_regtype('public.account_type') IS NULL THEN
    v_missing := array_append(v_missing, 'type public.account_type'::text);
  END IF;

  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    v_missing := array_append(v_missing, 'function public.is_super_admin()'::text);
  END IF;
  IF to_regprocedure('public.set_updated_at()') IS NULL THEN
    v_missing := array_append(v_missing, 'function public.set_updated_at()'::text);
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    v_missing := array_append(v_missing, 'function auth.uid()'::text);
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    v_missing := array_append(v_missing, 'table auth.users'::text);
  END IF;

  -- Exactly-once accounting posting relies on this unique index.
  IF to_regclass('public.accounting_events') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.oid = 'public.accounting_events'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND (
        SELECT array_agg(a.attname::text ORDER BY k.ord)
        FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      ) = ARRAY['school_id', 'source_module', 'source_table', 'source_record_id']
  ) THEN
    v_missing := array_append(v_missing,
      'unique index on accounting_events(school_id, source_module, source_table, source_record_id)'::text);
  END IF;

  -- Posted entries use the entry types 'receipt' and 'refund'.
  IF to_regclass('public.journal_entries') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.journal_entries'::regclass
      AND c.conname = 'journal_entries_entry_type_check'
      AND pg_get_constraintdef(c.oid) LIKE '%''receipt''%'
      AND pg_get_constraintdef(c.oid) LIKE '%''refund''%'
  ) THEN
    v_missing := array_append(v_missing,
      'journal_entries_entry_type_check allowing receipt and refund'::text);
  END IF;

  IF to_regclass('public.accounts') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'accounts'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%(school_id, code)%'
  ) THEN
    v_missing := array_append(v_missing, 'unique index on accounts(school_id, code)'::text);
  END IF;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'Phase 2 preflight failed. Missing or incompatible dependencies: %',
      array_to_string(v_missing, '; ');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Phase 1 agreement prerequisites (identical to
-- 20261115210000_retire_transport_plan_entitlement.sql, so re-applying that
-- file later is a no-op). Compared against the live schema: these columns and
-- guards are absent today and Phase 2 depends on them.
-- ---------------------------------------------------------------------------

-- The guard trigger lists subscription_amount, so it is dropped before any
-- column type change and recreated below.
DROP TRIGGER IF EXISTS schools_guard_enabled_modules ON public.schools;
DROP TRIGGER IF EXISTS schools_guard_enabled_modules_change ON public.schools;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS subscription_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS subscription_payment_terms text,
  ADD COLUMN IF NOT EXISTS sales_discussion_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_discussion_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_discussion_confirmed_by uuid;

ALTER TABLE public.school_subscriptions
  ADD COLUMN IF NOT EXISTS payment_terms text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schools'
      AND column_name = 'subscription_amount'
      AND NOT (numeric_precision = 18 AND numeric_scale = 2)
  ) THEN
    ALTER TABLE public.schools
      ALTER COLUMN subscription_amount TYPE numeric(18,2);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'school_subscriptions'
      AND column_name = 'amount'
      AND NOT (numeric_precision = 18 AND numeric_scale = 2)
  ) THEN
    ALTER TABLE public.school_subscriptions
      ALTER COLUMN amount TYPE numeric(18,2);
  END IF;
END;
$$;

-- Additional school details collected during sales onboarding.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS principal_name text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS branch_count integer,
  ADD COLUMN IF NOT EXISTS staff_strength integer,
  ADD COLUMN IF NOT EXISTS is_platform_internal boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.schools'::regclass
      AND conname = 'schools_branch_count_check'
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_branch_count_check
      CHECK (branch_count IS NULL OR branch_count >= 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.schools'::regclass
      AND conname = 'schools_staff_strength_check'
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_staff_strength_check
      CHECK (staff_strength IS NULL OR staff_strength >= 0);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS schools_single_platform_internal
  ON public.schools ((true))
  WHERE is_platform_internal;

CREATE OR REPLACE FUNCTION public.is_school_creator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.platform_role::text IN ('super_admin', 'sales_rep')
        AND up.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.is_school_creator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_school_creator() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_school_modules_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_modules_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.role() IS DISTINCT FROM 'authenticated'
       OR v_actor_id IS NULL
       OR NEW.created_by IS DISTINCT FROM v_actor_id
       OR NOT public.is_school_creator()
    THEN
      RAISE EXCEPTION
        'Only an authenticated, active Super Admin or Sales Representative may create a school.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.enabled_modules IS NULL
       OR cardinality(NEW.enabled_modules) = 0
       OR array_position(NEW.enabled_modules, NULL::text) IS NOT NULL
       OR NOT (
         NEW.enabled_modules <@ ARRAY['fees', 'payroll']::text[]
       )
       OR cardinality(NEW.enabled_modules) <>
         (CASE WHEN 'fees' = ANY(NEW.enabled_modules) THEN 1 ELSE 0 END) +
         (CASE WHEN 'payroll' = ANY(NEW.enabled_modules) THEN 1 ELSE 0 END)
    THEN
      RAISE EXCEPTION
        'Select at least one valid subscription plan before creating a school.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.student_limit IS NULL OR NEW.student_limit < 1 THEN
      RAISE EXCEPTION
        'Student strength must be explicitly supplied and at least 1.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.subscription_amount IS NULL OR NEW.subscription_amount < 0 THEN
      RAISE EXCEPTION
        'An explicitly agreed subscription price is required.'
        USING ERRCODE = '23514';
    END IF;

    IF NULLIF(btrim(NEW.subscription_payment_terms), '') IS NULL THEN
      RAISE EXCEPTION
        'Agreed payment terms are required before creating a school.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.sales_discussion_confirmed IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'Confirm that the plans, pricing, student strength, and payment terms were discussed and agreed.'
        USING ERRCODE = '23514';
    END IF;

    NEW.sales_discussion_confirmed_at := clock_timestamp();
    NEW.sales_discussion_confirmed_by := v_actor_id;
    RETURN NEW;
  END IF;

  IF NEW.subscription_amount IS DISTINCT FROM OLD.subscription_amount
     OR NEW.subscription_payment_terms IS DISTINCT FROM OLD.subscription_payment_terms
     OR NEW.sales_discussion_confirmed IS DISTINCT FROM OLD.sales_discussion_confirmed
     OR NEW.sales_discussion_confirmed_at IS DISTINCT FROM OLD.sales_discussion_confirmed_at
     OR NEW.sales_discussion_confirmed_by IS DISTINCT FROM OLD.sales_discussion_confirmed_by
  THEN
    RAISE EXCEPTION
      'The original school subscription agreement is immutable after creation.'
      USING ERRCODE = '42501';
  END IF;

  v_modules_changed :=
    NEW.enabled_modules IS DISTINCT FROM OLD.enabled_modules;

  IF v_modules_changed
     AND (
       NEW.enabled_modules IS NULL
       OR cardinality(NEW.enabled_modules) = 0
     )
  THEN
    RAISE EXCEPTION
      'A school plan update must retain at least one valid subscription plan.'
      USING ERRCODE = '23514';
  END IF;

  IF v_modules_changed
     AND (
       auth.role() IS DISTINCT FROM 'authenticated'
       OR v_actor_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.user_profiles up
         WHERE up.id = v_actor_id
           AND up.platform_role::text = 'super_admin'
           AND up.is_active = true
       )
     )
  THEN
    RAISE EXCEPTION 'Only an active Super Admin may change enabled_modules.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_school_modules_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schools_guard_enabled_modules ON public.schools;
DROP TRIGGER IF EXISTS schools_guard_enabled_modules_change ON public.schools;
CREATE TRIGGER schools_guard_enabled_modules
  BEFORE INSERT OR UPDATE OF
    enabled_modules,
    subscription_amount,
    subscription_payment_terms,
    sales_discussion_confirmed,
    sales_discussion_confirmed_at,
    sales_discussion_confirmed_by
  ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_school_modules_change();

DROP POLICY IF EXISTS schools_authorized_creator_insert ON public.schools;
CREATE POLICY schools_authorized_creator_insert
  ON public.schools
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_school_creator());

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- True only for an operator session (SQL Editor / migration runner) and never
-- for an API caller, whose session user is the PostgREST authenticator role.
CREATE OR REPLACE FUNCTION public.business_is_system_session()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NULL
    AND session_user IN ('postgres', 'supabase_admin');
$$;

REVOKE ALL ON FUNCTION public.business_is_system_session()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.business_set_updated_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.business_set_updated_by()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Platform-company tenant protections
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_internal_school(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = p_school_id AND s.is_platform_internal
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_internal_school(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_internal_school(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_platform_internal_school()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_platform_internal AND NOT public.business_is_system_session() THEN
      RAISE EXCEPTION 'The platform-company tenant can only be created by a migration.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_platform_internal IS DISTINCT FROM OLD.is_platform_internal THEN
      RAISE EXCEPTION 'The platform-company flag cannot be changed.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.is_platform_internal THEN
    RAISE EXCEPTION 'The platform-company tenant cannot be deleted.'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_platform_internal_school()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schools_protect_platform_internal ON public.schools;
CREATE TRIGGER schools_protect_platform_internal
  BEFORE INSERT OR UPDATE OR DELETE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_platform_internal_school();

-- The tenant can never hold school members.
CREATE OR REPLACE FUNCTION public.reject_platform_internal_school()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.is_platform_internal_school(NEW.school_id) THEN
    RAISE EXCEPTION
      'The internal platform-company tenant cannot be used for % records.',
      TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_platform_internal_school()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_users_reject_platform_internal ON public.school_users;
CREATE TRIGGER school_users_reject_platform_internal
  BEFORE INSERT OR UPDATE OF school_id ON public.school_users
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_subscriptions_reject_platform_internal
  ON public.school_subscriptions;
CREATE TRIGGER school_subscriptions_reject_platform_internal
  BEFORE INSERT OR UPDATE OF school_id ON public.school_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_platform_internal_school();

-- ---------------------------------------------------------------------------
-- Privilege guard on user_profiles. Role and activation changes are limited
-- to an active Super Admin, an operator session or the service role; the
-- sales_rep role can additionally never be granted or removed by the service
-- role alone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_user_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_super boolean := public.is_super_admin();
  v_system boolean := public.business_is_system_session();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.platform_role::text = 'sales_rep' AND NOT (v_super OR v_system) THEN
      RAISE EXCEPTION 'Only a Super Admin may create a sales representative profile.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.platform_role IS DISTINCT FROM OLD.platform_role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
  THEN
    IF NOT (v_super OR v_system OR auth.role() = 'service_role') THEN
      RAISE EXCEPTION 'Only a Super Admin may change a platform role or activation status.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.platform_role IS DISTINCT FROM OLD.platform_role
       AND (NEW.platform_role::text = 'sales_rep'
            OR OLD.platform_role::text = 'sales_rep')
       AND NOT (v_super OR v_system)
    THEN
      RAISE EXCEPTION 'Only a Super Admin may assign or remove the sales representative role.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_user_profile_privileges()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_profiles_guard_privileges ON public.user_profiles;
CREATE TRIGGER user_profiles_guard_privileges
  BEFORE INSERT OR UPDATE OF platform_role, is_active ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_user_profile_privileges();

-- ---------------------------------------------------------------------------
-- Business audit log (append-only, Super Admin read only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  school_id uuid,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS business_audit_logs_entity_idx
  ON public.business_audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS business_audit_logs_school_idx
  ON public.business_audit_logs (school_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS business_audit_logs_actor_idx
  ON public.business_audit_logs (actor_id, occurred_at DESC);

ALTER TABLE public.business_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.business_audit_logs TO authenticated;

DROP POLICY IF EXISTS business_audit_logs_super_admin_select
  ON public.business_audit_logs;
CREATE POLICY business_audit_logs_super_admin_select
  ON public.business_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.business_audit_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'business_audit_logs is append-only.'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.business_audit_logs_append_only()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS business_audit_logs_no_change ON public.business_audit_logs;
CREATE TRIGGER business_audit_logs_no_change
  BEFORE UPDATE OR DELETE ON public.business_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.business_audit_logs_append_only();

CREATE OR REPLACE FUNCTION public.business_audit_write(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_school_id uuid,
  p_old jsonb,
  p_new jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.business_audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, school_id,
    old_value, new_value, metadata
  )
  VALUES (
    auth.uid(),
    (SELECT up.platform_role::text FROM public.user_profiles up
     WHERE up.id = auth.uid()),
    p_action, p_entity_type, p_entity_id, p_school_id,
    p_old, p_new, COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.business_audit_write(
  text, text, uuid, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

-- Generic row-level audit trigger. Attach with:
--   CREATE TRIGGER ... AFTER INSERT OR UPDATE OR DELETE ON t
--   FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();
CREATE OR REPLACE FUNCTION public.business_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_school text;
  v_id text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;
  v_row := COALESCE(v_new, v_old);
  v_school := v_row ->> 'school_id';
  v_id := v_row ->> 'id';

  PERFORM public.business_audit_write(
    TG_TABLE_NAME || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    CASE WHEN v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         THEN v_id::uuid END,
    CASE WHEN v_school ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         THEN v_school::uuid END,
    v_old,
    v_new,
    '{}'::jsonb
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.business_audit_row()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Document / receipt numbering (gap-tolerant, race-free)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_number_sequences (
  kind text NOT NULL,
  period text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (kind, period)
);

ALTER TABLE public.business_number_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_number_sequences FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_business_number(p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prefix text;
  v_period text := to_char(current_date, 'YYYY');
  v_value bigint;
BEGIN
  v_prefix := CASE p_kind
    WHEN 'invoice' THEN 'INV'
    WHEN 'receipt' THEN 'RCT'
    WHEN 'refund' THEN 'RFD'
    WHEN 'mou' THEN 'MOU'
    WHEN 'journal' THEN 'SUB-JV'
    ELSE NULL
  END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unknown business number kind: %', p_kind;
  END IF;

  INSERT INTO public.business_number_sequences AS s (kind, period, last_value)
  VALUES (p_kind, v_period, 1)
  ON CONFLICT (kind, period)
  DO UPDATE SET last_value = s.last_value + 1
  RETURNING s.last_value INTO v_value;

  RETURN v_prefix || '-' || v_period || '-' || lpad(v_value::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_business_number(text)
  FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 20261116110000_phase2_company_documents_plans.sql
-- ============================================================================

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

-- ============================================================================
-- 20261116120000_phase2_sales_crm.sql
-- ============================================================================

-- Phase 2 / 04 - Sales team, school ownership with permanent original
-- attribution, leads/CRM, activity log and the safe provisioning job ledger
-- used for Supabase Auth invitations.

-- ---------------------------------------------------------------------------
-- Sales representatives (profile extension of user_profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users (id),
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  mobile text NOT NULL CHECK (btrim(mobile) <> ''),
  address text,
  employee_id text,
  joining_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'pending_account'
    CHECK (status IN ('pending_account', 'active', 'inactive')),
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_representatives_linked_when_active CHECK (
    status = 'pending_account' OR user_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_representatives_email_key
  ON public.sales_representatives (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS sales_representatives_employee_id_key
  ON public.sales_representatives (lower(employee_id))
  WHERE employee_id IS NOT NULL;

DROP TRIGGER IF EXISTS sales_representatives_updated_at ON public.sales_representatives;
CREATE TRIGGER sales_representatives_updated_at
  BEFORE UPDATE ON public.sales_representatives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS sales_representatives_audit ON public.sales_representatives;
CREATE TRIGGER sales_representatives_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_representatives
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- Link, status and identity columns change only through the RPCs.
CREATE OR REPLACE FUNCTION public.sales_representatives_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sales representatives are deactivated, never deleted.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.created_by IS DISTINCT FROM OLD.created_by)
     AND current_setting('app.sales_rep_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Representative status, login link and email are managed through dedicated functions.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_representatives_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_representatives_guard ON public.sales_representatives;
CREATE TRIGGER sales_representatives_guard
  BEFORE UPDATE OR DELETE ON public.sales_representatives
  FOR EACH ROW EXECUTE FUNCTION public.sales_representatives_guard();

CREATE OR REPLACE FUNCTION public.is_active_sales_rep()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      JOIN public.sales_representatives sr ON sr.user_id = up.id
      WHERE up.id = auth.uid()
        AND up.platform_role::text = 'sales_rep'
        AND up.is_active = true
        AND sr.status = 'active'
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_sales_rep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_sales_rep() TO authenticated;

-- A representative's school always carries an agreement, an owner record and
-- an owner-provisioning job; those are created together by create_school_sale,
-- so a direct INSERT by a representative is refused.
CREATE OR REPLACE FUNCTION public.schools_require_sale_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_super_admin()
     AND public.is_active_sales_rep()
     AND current_setting('app.school_sale_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Sales representatives create schools only through the sales workflow.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.schools_require_sale_workflow()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schools_require_sale_workflow ON public.schools;
CREATE TRIGGER schools_require_sale_workflow
  BEFORE INSERT ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.schools_require_sale_workflow();

-- ---------------------------------------------------------------------------
-- Provisioning jobs: durable, resumable Auth account workflow
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('sales_rep', 'school_owner')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'auth_created', 'completed', 'failed', 'cancelled')),
  subject_id uuid NOT NULL,
  target_email text NOT NULL CHECK (target_email = lower(btrim(target_email))),
  display_name text,
  auth_user_id uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  last_error text,
  locked_until timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT business_provisioning_jobs_idem_key UNIQUE (idempotency_key),
  CONSTRAINT business_provisioning_jobs_auth_link CHECK (
    status NOT IN ('auth_created', 'completed') OR auth_user_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_provisioning_jobs_one_open
  ON public.business_provisioning_jobs (job_type, subject_id)
  WHERE status IN ('pending', 'auth_created', 'failed');

CREATE INDEX IF NOT EXISTS business_provisioning_jobs_status_idx
  ON public.business_provisioning_jobs (status, updated_at);

DROP TRIGGER IF EXISTS business_provisioning_jobs_updated_at
  ON public.business_provisioning_jobs;
CREATE TRIGGER business_provisioning_jobs_updated_at
  BEFORE UPDATE ON public.business_provisioning_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS business_provisioning_jobs_audit
  ON public.business_provisioning_jobs;
CREATE TRIGGER business_provisioning_jobs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.business_provisioning_jobs
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- ---------------------------------------------------------------------------
-- School ownership: original attribution is permanent, current owner moves
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_sales_ownership (
  school_id uuid PRIMARY KEY REFERENCES public.schools (id) ON DELETE RESTRICT,
  original_acquisition_rep_id uuid REFERENCES public.sales_representatives (user_id),
  current_rep_id uuid REFERENCES public.sales_representatives (user_id),
  acquired_by uuid NOT NULL REFERENCES auth.users (id),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_sales_ownership_current_idx
  ON public.school_sales_ownership (current_rep_id);
CREATE INDEX IF NOT EXISTS school_sales_ownership_original_idx
  ON public.school_sales_ownership (original_acquisition_rep_id);

CREATE TABLE IF NOT EXISTS public.school_sales_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  rep_user_id uuid REFERENCES public.sales_representatives (user_id),
  previous_rep_user_id uuid REFERENCES public.sales_representatives (user_id),
  assignment_type text NOT NULL
    CHECK (assignment_type IN ('original_acquisition', 'reassignment', 'unassignment')),
  reason text,
  assigned_by uuid NOT NULL REFERENCES auth.users (id),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  CONSTRAINT school_sales_assignments_period CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS school_sales_assignments_one_open
  ON public.school_sales_assignments (school_id)
  WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS school_sales_assignments_school_idx
  ON public.school_sales_assignments (school_id, effective_from DESC);

CREATE OR REPLACE FUNCTION public.school_sales_ownership_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'School ownership history cannot be deleted.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.original_acquisition_rep_id IS DISTINCT FROM OLD.original_acquisition_rep_id
     OR NEW.acquired_by IS DISTINCT FROM OLD.acquired_by
     OR NEW.acquired_at IS DISTINCT FROM OLD.acquired_at
  THEN
    RAISE EXCEPTION 'The original acquisition attribution is permanent.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.current_rep_id IS DISTINCT FROM OLD.current_rep_id
     AND current_setting('app.ownership_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Use the reassignment function to change school ownership.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_sales_ownership_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_sales_ownership_guard ON public.school_sales_ownership;
CREATE TRIGGER school_sales_ownership_guard
  BEFORE UPDATE OR DELETE ON public.school_sales_ownership
  FOR EACH ROW EXECUTE FUNCTION public.school_sales_ownership_guard();

DROP TRIGGER IF EXISTS school_sales_ownership_updated_at ON public.school_sales_ownership;
CREATE TRIGGER school_sales_ownership_updated_at
  BEFORE UPDATE ON public.school_sales_ownership
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS school_sales_ownership_reject_internal
  ON public.school_sales_ownership;
CREATE TRIGGER school_sales_ownership_reject_internal
  BEFORE INSERT OR UPDATE OF school_id ON public.school_sales_ownership
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_sales_ownership_audit ON public.school_sales_ownership;
CREATE TRIGGER school_sales_ownership_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_sales_ownership
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

CREATE OR REPLACE FUNCTION public.school_sales_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['effective_to'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assignment history cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to)
  THEN
    RAISE EXCEPTION 'Assignment history is immutable except for closing the open period.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_sales_assignments_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_sales_assignments_guard ON public.school_sales_assignments;
CREATE TRIGGER school_sales_assignments_guard
  BEFORE UPDATE OR DELETE ON public.school_sales_assignments
  FOR EACH ROW EXECUTE FUNCTION public.school_sales_assignments_guard();

DROP TRIGGER IF EXISTS school_sales_assignments_reject_internal
  ON public.school_sales_assignments;
CREATE TRIGGER school_sales_assignments_reject_internal
  BEFORE INSERT OR UPDATE OF school_id ON public.school_sales_assignments
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_sales_assignments_audit ON public.school_sales_assignments;
CREATE TRIGGER school_sales_assignments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_sales_assignments
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

CREATE OR REPLACE FUNCTION public.rep_owns_school(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.is_active_sales_rep()
    AND EXISTS (
      SELECT 1
      FROM public.school_sales_ownership o
      WHERE o.school_id = p_school_id
        AND o.current_rep_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.rep_owns_school(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_owns_school(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Leads / CRM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name text NOT NULL CHECK (btrim(school_name) <> ''),
  contact_person text,
  mobile text,
  email text,
  address text,
  district text,
  state text,
  estimated_student_strength integer CHECK (estimated_student_strength IS NULL OR estimated_student_strength >= 0),
  estimated_staff_strength integer CHECK (estimated_staff_strength IS NULL OR estimated_staff_strength >= 0),
  notes text,
  next_follow_up_date date,
  assigned_rep_id uuid NOT NULL REFERENCES public.sales_representatives (user_id),
  status text NOT NULL DEFAULT 'new_lead'
    CHECK (status IN (
      'new_lead', 'contacted', 'meeting_scheduled', 'negotiation',
      'proposal_sent', 'initial_mou', 'converted', 'not_interested'
    )),
  converted_school_id uuid UNIQUE REFERENCES public.schools (id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_leads_converted_has_school CHECK (
    (status = 'converted') = (converted_school_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS school_leads_rep_idx
  ON public.school_leads (assigned_rep_id, status);
CREATE INDEX IF NOT EXISTS school_leads_follow_up_idx
  ON public.school_leads (next_follow_up_date)
  WHERE next_follow_up_date IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_leads_open_duplicate_key
  ON public.school_leads (assigned_rep_id, lower(btrim(school_name)), lower(COALESCE(btrim(district), '')))
  WHERE status NOT IN ('converted', 'not_interested');

DROP TRIGGER IF EXISTS school_leads_updated_at ON public.school_leads;
CREATE TRIGGER school_leads_updated_at
  BEFORE UPDATE ON public.school_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS school_leads_audit ON public.school_leads;
CREATE TRIGGER school_leads_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_leads
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- A representative can only create leads for themselves; only Super Admin may
-- assign a lead to somebody else. Conversion is performed by the sale RPC.
CREATE OR REPLACE FUNCTION public.school_leads_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_super_admin() THEN
      NEW.assigned_rep_id := auth.uid();
    END IF;
    NEW.created_by := auth.uid();
    NEW.status := CASE WHEN NEW.status = 'converted' THEN 'new_lead' ELSE NEW.status END;
    NEW.converted_school_id := NULL;
    IF NOT EXISTS (
      SELECT 1 FROM public.sales_representatives sr
      WHERE sr.user_id = NEW.assigned_rep_id AND sr.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Leads can only be assigned to an active sales representative.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'converted' THEN
    RAISE EXCEPTION 'A converted lead is read-only.' USING ERRCODE = '42501';
  END IF;

  IF (NEW.assigned_rep_id IS DISTINCT FROM OLD.assigned_rep_id
      OR NEW.converted_school_id IS DISTINCT FROM OLD.converted_school_id
      OR NEW.status = 'converted')
     AND current_setting('app.lead_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Lead assignment and conversion are managed through dedicated functions.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_leads_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_leads_guard ON public.school_leads;
CREATE TRIGGER school_leads_guard
  BEFORE INSERT OR UPDATE ON public.school_leads
  FOR EACH ROW EXECUTE FUNCTION public.school_leads_guard();

CREATE TABLE IF NOT EXISTS public.sales_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_user_id uuid NOT NULL REFERENCES public.sales_representatives (user_id),
  lead_id uuid REFERENCES public.school_leads (id) ON DELETE RESTRICT,
  school_id uuid REFERENCES public.schools (id) ON DELETE RESTRICT,
  activity_type text NOT NULL
    CHECK (activity_type IN ('visit', 'call', 'meeting', 'email', 'proposal', 'follow_up', 'other')),
  notes text,
  activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_activity_logs_subject CHECK (lead_id IS NOT NULL OR school_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS sales_activity_logs_rep_idx
  ON public.sales_activity_logs (rep_user_id, activity_at DESC);

CREATE OR REPLACE FUNCTION public.sales_activity_logs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Activity logs are append-only.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin() THEN
    NEW.rep_user_id := auth.uid();
    IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.school_leads l
      WHERE l.id = NEW.lead_id AND l.assigned_rep_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'You can only log activity for your own leads.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.school_id IS NOT NULL AND NOT public.rep_owns_school(NEW.school_id) THEN
      RAISE EXCEPTION 'You can only log activity for your own schools.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_activity_logs_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_activity_logs_guard ON public.sales_activity_logs;
CREATE TRIGGER sales_activity_logs_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.sales_activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.sales_activity_logs_guard();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_provisioning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_sales_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_sales_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sales_representatives, public.business_provisioning_jobs,
  public.school_sales_ownership, public.school_sales_assignments,
  public.school_leads, public.sales_activity_logs
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.sales_representatives TO authenticated;
GRANT UPDATE (full_name, mobile, address, employee_id, joining_date)
  ON public.sales_representatives TO authenticated;
GRANT SELECT ON public.business_provisioning_jobs TO authenticated;
GRANT SELECT ON public.school_sales_ownership TO authenticated;
GRANT SELECT ON public.school_sales_assignments TO authenticated;

GRANT SELECT ON public.school_leads TO authenticated;
GRANT INSERT (
  school_name, contact_person, mobile, email, address, district, state,
  estimated_student_strength, estimated_staff_strength, notes,
  next_follow_up_date, assigned_rep_id, status
) ON public.school_leads TO authenticated;
GRANT UPDATE (
  school_name, contact_person, mobile, email, address, district, state,
  estimated_student_strength, estimated_staff_strength, notes,
  next_follow_up_date, status
) ON public.school_leads TO authenticated;

GRANT SELECT ON public.sales_activity_logs TO authenticated;
GRANT INSERT (rep_user_id, lead_id, school_id, activity_type, notes, activity_at)
  ON public.sales_activity_logs TO authenticated;

DROP POLICY IF EXISTS sales_representatives_select ON public.sales_representatives;
CREATE POLICY sales_representatives_select ON public.sales_representatives
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS sales_representatives_super_admin_update
  ON public.sales_representatives;
CREATE POLICY sales_representatives_super_admin_update ON public.sales_representatives
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS business_provisioning_jobs_select
  ON public.business_provisioning_jobs;
CREATE POLICY business_provisioning_jobs_select ON public.business_provisioning_jobs
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (job_type = 'school_owner' AND created_by = auth.uid()
        AND public.rep_owns_school(subject_id))
  );

DROP POLICY IF EXISTS school_sales_ownership_select ON public.school_sales_ownership;
CREATE POLICY school_sales_ownership_select ON public.school_sales_ownership
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (current_rep_id = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS school_sales_assignments_select ON public.school_sales_assignments;
CREATE POLICY school_sales_assignments_select ON public.school_sales_assignments
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));

DROP POLICY IF EXISTS school_leads_select ON public.school_leads;
CREATE POLICY school_leads_select ON public.school_leads
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (assigned_rep_id = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS school_leads_insert ON public.school_leads;
CREATE POLICY school_leads_insert ON public.school_leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.is_active_sales_rep() AND assigned_rep_id = auth.uid())
  );

DROP POLICY IF EXISTS school_leads_update ON public.school_leads;
CREATE POLICY school_leads_update ON public.school_leads
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (assigned_rep_id = auth.uid() AND public.is_active_sales_rep())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (assigned_rep_id = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS sales_activity_logs_select ON public.sales_activity_logs;
CREATE POLICY sales_activity_logs_select ON public.sales_activity_logs
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (rep_user_id = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS sales_activity_logs_insert ON public.sales_activity_logs;
CREATE POLICY sales_activity_logs_insert ON public.sales_activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_active_sales_rep());

-- A sales representative can see the schools they currently own. Combined with
-- the existing schools policies this is purely additive read access.
DROP POLICY IF EXISTS schools_sales_rep_select ON public.schools;
CREATE POLICY schools_sales_rep_select ON public.schools
  FOR SELECT TO authenticated
  USING (public.rep_owns_school(id));

-- Hide the internal platform-company tenant from every API reader. The
-- accounting functions reach it through SECURITY DEFINER code only.
DROP POLICY IF EXISTS schools_hide_platform_internal ON public.schools;
CREATE POLICY schools_hide_platform_internal ON public.schools
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (NOT is_platform_internal);

DROP POLICY IF EXISTS schools_hide_platform_internal_anon ON public.schools;
CREATE POLICY schools_hide_platform_internal_anon ON public.schools
  AS RESTRICTIVE
  FOR SELECT TO anon
  USING (NOT is_platform_internal);

-- ============================================================================
-- 20261116130000_phase2_contracts.sql
-- ============================================================================

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

-- ============================================================================
-- 20261116140000_phase2_billing.sql
-- ============================================================================

-- Phase 2 / 06 - Billing: invoices, payments, verification history and
-- partial refunds / reversals. Money columns are numeric(18,2). Verified
-- payments are immutable; every state change is recorded.

-- ---------------------------------------------------------------------------
-- Invoices (memo-only: an invoice never creates an accounting entry)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.school_subscriptions (id) ON DELETE RESTRICT,
  period_sequence integer NOT NULL CHECK (period_sequence >= 1),
  period_start date NOT NULL,
  period_end date NOT NULL,
  invoice_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(18,2) NOT NULL CHECK (total_amount > 0),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  snapshot jsonb NOT NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users (id),
  cancel_reason text,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_invoices_period CHECK (period_end >= period_start),
  CONSTRAINT school_invoices_total CHECK (total_amount = amount + tax_amount),
  CONSTRAINT school_invoices_cancel CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
  )
);

-- One live invoice per subscription billing period; a cancelled invoice frees
-- the period for re-issue.
CREATE UNIQUE INDEX IF NOT EXISTS school_invoices_one_per_period
  ON public.school_invoices (subscription_id, period_start)
  WHERE status = 'issued';
CREATE UNIQUE INDEX IF NOT EXISTS school_invoices_one_per_sequence
  ON public.school_invoices (subscription_id, period_sequence)
  WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS school_invoices_school_idx
  ON public.school_invoices (school_id, due_date);

CREATE OR REPLACE FUNCTION public.school_invoices_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoices cannot be deleted; cancel them instead.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'cancelled'
     OR (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR current_setting('app.invoice_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Invoices are immutable; use the cancel function.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_invoices_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_invoices_guard ON public.school_invoices;
CREATE TRIGGER school_invoices_guard
  BEFORE UPDATE OR DELETE ON public.school_invoices
  FOR EACH ROW EXECUTE FUNCTION public.school_invoices_guard();

DROP TRIGGER IF EXISTS school_invoices_reject_internal ON public.school_invoices;
CREATE TRIGGER school_invoices_reject_internal
  BEFORE INSERT ON public.school_invoices
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_invoices_audit ON public.school_invoices;
CREATE TRIGGER school_invoices_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_invoices
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.school_invoices (id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  payment_mode text NOT NULL
    CHECK (payment_mode IN ('cash', 'upi', 'bank_transfer', 'cheque', 'other')),
  transaction_reference text NOT NULL
    CHECK (btrim(transaction_reference) <> '' AND length(transaction_reference) <= 120),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  remarks text,
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified', 'rejected', 'reversed', 'refunded')),
  submitted_by uuid NOT NULL REFERENCES auth.users (id),
  collected_by_rep_id uuid REFERENCES public.sales_representatives (user_id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES auth.users (id),
  verified_at timestamptz,
  verification_note text,
  receipt_number text,
  receipt_snapshot jsonb,
  rejected_by uuid REFERENCES auth.users (id),
  rejected_at timestamptz,
  rejection_reason text,
  accounting_journal_entry_id uuid REFERENCES public.journal_entries (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_payments_idempotency_key UNIQUE (submitted_by, idempotency_key),
  CONSTRAINT school_payments_receipt_unique UNIQUE (receipt_number),
  CONSTRAINT school_payments_journal_unique UNIQUE (accounting_journal_entry_id),
  CONSTRAINT school_payments_verified_fields CHECK (
    status NOT IN ('verified', 'reversed', 'refunded')
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL
        AND receipt_number IS NOT NULL AND receipt_snapshot IS NOT NULL
        AND accounting_journal_entry_id IS NOT NULL)
  ),
  CONSTRAINT school_payments_rejected_fields CHECK (
    status <> 'rejected'
    OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL
        AND NULLIF(btrim(rejection_reason), '') IS NOT NULL)
  ),
  CONSTRAINT school_payments_pending_clean CHECK (
    status <> 'pending_verification'
    OR (verified_by IS NULL AND receipt_number IS NULL
        AND accounting_journal_entry_id IS NULL AND rejected_by IS NULL)
  )
);

-- A transaction reference can be used once across all live payments,
-- whatever the mode. Normalised so spacing and case variants collide. A
-- rejected payment releases its reference so the collection can be re-entered.
-- Cheque references should include the bank, e.g. HDFC-000123.
CREATE UNIQUE INDEX IF NOT EXISTS school_payments_reference_key
  ON public.school_payments (lower(btrim(transaction_reference)))
  WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS school_payments_invoice_idx
  ON public.school_payments (invoice_id);
CREATE INDEX IF NOT EXISTS school_payments_school_idx
  ON public.school_payments (school_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS school_payments_status_idx
  ON public.school_payments (status, submitted_at);
CREATE INDEX IF NOT EXISTS school_payments_rep_idx
  ON public.school_payments (collected_by_rep_id, status);

CREATE TABLE IF NOT EXISTS public.payment_verification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.school_payments (id) ON DELETE RESTRICT,
  action text NOT NULL
    CHECK (action IN ('submitted', 'verified', 'rejected', 'partial_refund', 'reversed', 'refunded')),
  from_status text,
  to_status text NOT NULL,
  actor_id uuid REFERENCES auth.users (id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_verification_logs_payment_idx
  ON public.payment_verification_logs (payment_id, created_at);

-- Partial refunds and full reversals. The sum of all rows for a payment can
-- never exceed the payment amount (enforced under a row lock by the RPC and
-- re-checked by the trigger below).
CREATE TABLE IF NOT EXISTS public.payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.school_payments (id) ON DELETE RESTRICT,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  reversal_type text NOT NULL CHECK (reversal_type IN ('reversal', 'refund')),
  reversal_number text NOT NULL UNIQUE,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reversal_date date NOT NULL DEFAULT current_date,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  accounting_journal_entry_id uuid NOT NULL UNIQUE
    REFERENCES public.journal_entries (id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_reversals_idempotency_key UNIQUE (payment_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_reversals_payment_idx
  ON public.payment_reversals (payment_id);

CREATE OR REPLACE FUNCTION public.payment_reversals_total_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment_amount numeric(18,2);
  v_total numeric(18,2);
BEGIN
  SELECT amount INTO v_payment_amount
  FROM public.school_payments WHERE id = NEW.payment_id FOR UPDATE;

  SELECT COALESCE(sum(amount), 0) INTO v_total
  FROM public.payment_reversals WHERE payment_id = NEW.payment_id;

  IF v_total + NEW.amount > v_payment_amount THEN
    RAISE EXCEPTION 'Refunds and reversals cannot exceed the verified payment amount.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reversal_type = 'reversal'
     AND (v_total <> 0 OR NEW.amount <> v_payment_amount)
  THEN
    RAISE EXCEPTION 'A reversal must cancel the whole payment; use a refund for part of it.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_reversals_total_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_reversals_total_guard ON public.payment_reversals;
CREATE TRIGGER payment_reversals_total_guard
  BEFORE INSERT ON public.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.payment_reversals_total_guard();

DROP TRIGGER IF EXISTS payment_reversals_immutable ON public.payment_reversals;
CREATE TRIGGER payment_reversals_immutable
  BEFORE UPDATE OR DELETE ON public.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.business_immutable_row();

DROP TRIGGER IF EXISTS payment_verification_logs_immutable
  ON public.payment_verification_logs;
CREATE TRIGGER payment_verification_logs_immutable
  BEFORE UPDATE OR DELETE ON public.payment_verification_logs
  FOR EACH ROW EXECUTE FUNCTION public.business_immutable_row();

-- Payment state machine. All writes come through the RPCs, which set
-- app.payment_rpc; verified-payment facts are frozen regardless.
CREATE OR REPLACE FUNCTION public.school_payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_frozen text[] := ARRAY[
    'school_id', 'invoice_id', 'amount', 'payment_date', 'payment_mode',
    'transaction_reference', 'idempotency_key', 'remarks', 'submitted_by',
    'collected_by_rep_id', 'submitted_at', 'created_at'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted. Use rejection, reversal or refund.'
      USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['updated_at']) = (to_jsonb(OLD) - ARRAY['updated_at']) THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.payment_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Payments change only through the payment functions.'
      USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'verified_by', 'verified_at',
        'verification_note', 'receipt_number', 'receipt_snapshot', 'rejected_by',
        'rejected_at', 'rejection_reason', 'accounting_journal_entry_id'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'verified_by', 'verified_at',
        'verification_note', 'receipt_number', 'receipt_snapshot', 'rejected_by',
        'rejected_at', 'rejection_reason', 'accounting_journal_entry_id'])
  THEN
    RAISE EXCEPTION 'Core payment details are immutable (%).', array_to_string(v_frozen, ', ')
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected'))
    OR (OLD.status = 'verified' AND NEW.status IN ('reversed', 'refunded'))
  ) THEN
    RAISE EXCEPTION 'Illegal payment status change % -> %.', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status <> 'pending_verification'
     AND (NEW.verified_by IS DISTINCT FROM OLD.verified_by
          OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
          OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
          OR NEW.accounting_journal_entry_id IS DISTINCT FROM OLD.accounting_journal_entry_id
          OR NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot)
  THEN
    RAISE EXCEPTION 'Verification facts of a payment are immutable.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_payments_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_payments_guard ON public.school_payments;
CREATE TRIGGER school_payments_guard
  BEFORE UPDATE OR DELETE ON public.school_payments
  FOR EACH ROW EXECUTE FUNCTION public.school_payments_guard();

DROP TRIGGER IF EXISTS school_payments_updated_at ON public.school_payments;
CREATE TRIGGER school_payments_updated_at
  BEFORE UPDATE ON public.school_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS school_payments_reject_internal ON public.school_payments;
CREATE TRIGGER school_payments_reject_internal
  BEFORE INSERT ON public.school_payments
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_payments_audit ON public.school_payments;
CREATE TRIGGER school_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_payments
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

DROP TRIGGER IF EXISTS payment_reversals_audit ON public.payment_reversals;
CREATE TRIGGER payment_reversals_audit
  AFTER INSERT ON public.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security (read-only API; writes via RPCs)
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_verification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reversals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_invoices, public.school_payments,
  public.payment_verification_logs, public.payment_reversals
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.school_invoices TO authenticated;
GRANT SELECT ON public.school_payments TO authenticated;
GRANT SELECT ON public.payment_verification_logs TO authenticated;
GRANT SELECT ON public.payment_reversals TO authenticated;

DROP POLICY IF EXISTS school_invoices_select ON public.school_invoices;
CREATE POLICY school_invoices_select ON public.school_invoices
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));

-- A representative sees payments for schools they currently own, plus every
-- payment they personally collected (even if the school was later reassigned).
DROP POLICY IF EXISTS school_payments_select ON public.school_payments;
CREATE POLICY school_payments_select ON public.school_payments
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.rep_owns_school(school_id)
    OR (submitted_by = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS payment_verification_logs_select
  ON public.payment_verification_logs;
CREATE POLICY payment_verification_logs_select
  ON public.payment_verification_logs
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.school_payments p
      WHERE p.id = payment_verification_logs.payment_id
        AND (public.rep_owns_school(p.school_id)
             OR (p.submitted_by = auth.uid() AND public.is_active_sales_rep()))
    )
  );

DROP POLICY IF EXISTS payment_reversals_select ON public.payment_reversals;
CREATE POLICY payment_reversals_select ON public.payment_reversals
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));

-- ============================================================================
-- 20261116150000_phase2_accounting_integration.sql
-- ============================================================================

-- Phase 2 / 07 - Accounting integration. Subscription collections are posted
-- to the existing canonical ledger (accounts, journal_entries, journal_lines,
-- accounting_events, accounting_audit_log) under a reserved, hidden
-- platform-company tenant. Policy: contracts and invoices are memo-only,
-- pending payments post nothing, a verified payment posts exactly once
-- (Dr Cash/Bank, Cr Subscription Income) and a reversal/refund posts one
-- reversing entry.
--
-- Why the entries are written here instead of through public.create_journal_entry:
--   * the live create_journal_entry is the pre-hardening version (no caller
--     authorisation, executable by anon);
--   * the hardened version in 20261109140000 requires the caller to be an
--     owner/admin/accountant member of the target school, and the platform
--     tenant intentionally has no members.
-- The functions below write to the same canonical tables with the same
-- balance, fiscal-year, account-ownership and accounting_events idempotency
-- rules, and are executable only from the SECURITY DEFINER business RPCs.

-- ---------------------------------------------------------------------------
-- Reserved platform-company tenant (hidden from all API readers by the
-- RESTRICTIVE policies created in 20261116120000_phase2_sales_crm.sql)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_school_id uuid;
BEGIN
  SELECT s.id INTO v_school_id
  FROM public.schools s
  WHERE s.is_platform_internal;

  IF v_school_id IS NULL THEN
    IF NOT public.business_is_system_session() THEN
      RAISE EXCEPTION
        'The platform-company tenant must be created from an operator session (SQL Editor or migration runner).';
    END IF;

    -- The creation guard (Phase 1) only admits authenticated sales creators,
    -- so it is suspended for this one operator-run insert inside the
    -- migration transaction.
    ALTER TABLE public.schools DISABLE TRIGGER schools_guard_enabled_modules;

    INSERT INTO public.schools (
      name, code, school_code, status, enabled_modules, is_platform_internal
    )
    VALUES (
      'Platform Company Ledger (internal)',
      'PLATFORM-COMPANY',
      'PLATFORM-COMPANY',
      'archived',
      ARRAY['fees']::text[],
      true
    )
    RETURNING id INTO v_school_id;

    ALTER TABLE public.schools ENABLE TRIGGER schools_guard_enabled_modules;
  END IF;

  INSERT INTO public.accounts (school_id, code, name, account_type, is_system, is_active)
  VALUES
    (v_school_id, 'CASH', 'Cash', 'cash'::public.account_type, true, true),
    (v_school_id, 'BANK', 'Bank', 'bank'::public.account_type, true, true),
    (v_school_id, 'SUBSCRIPTION_INCOME', 'Subscription Income',
     'income'::public.account_type, true, true)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.business_platform_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT s.id INTO v_id FROM public.schools s WHERE s.is_platform_internal;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'The platform-company accounting tenant is missing.';
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_platform_tenant_id()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.business_account_id(p_code text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
  FROM public.accounts a
  WHERE a.school_id = public.business_platform_tenant_id()
    AND a.code = p_code
    AND a.is_active;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Platform-company account % is missing or inactive.', p_code;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_account_id(text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.business_cash_account_code(p_payment_mode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN p_payment_mode = 'cash' THEN 'CASH' ELSE 'BANK' END;
$$;

REVOKE ALL ON FUNCTION public.business_cash_account_code(text)
  FROM PUBLIC, anon, authenticated;

-- Indian financial year (1 April - 31 March), created on demand. A closed
-- year is never posted into.
CREATE OR REPLACE FUNCTION public.business_ensure_fiscal_year(p_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant uuid := public.business_platform_tenant_id();
  v_fy record;
  v_start date;
  v_end date;
BEGIN
  SELECT f.id, f.is_closed INTO v_fy
  FROM public.fiscal_years f
  WHERE f.school_id = v_tenant AND p_date BETWEEN f.start_date AND f.end_date
  ORDER BY f.start_date
  LIMIT 1;

  IF FOUND THEN
    IF v_fy.is_closed THEN
      RAISE EXCEPTION 'The fiscal year covering % is closed.', p_date;
    END IF;
    RETURN v_fy.id;
  END IF;

  v_start := make_date(
    CASE WHEN extract(month FROM p_date) >= 4
         THEN extract(year FROM p_date)::int
         ELSE extract(year FROM p_date)::int - 1 END,
    4, 1);
  v_end := (v_start + interval '1 year' - interval '1 day')::date;

  INSERT INTO public.fiscal_years (school_id, name, start_date, end_date, is_closed)
  VALUES (
    v_tenant,
    to_char(v_start, 'YYYY') || '-' || to_char(v_start + interval '1 year', 'YY'),
    v_start, v_end, false
  )
  ON CONFLICT (school_id, name) DO NOTHING;

  SELECT f.id, f.is_closed INTO v_fy
  FROM public.fiscal_years f
  WHERE f.school_id = v_tenant AND p_date BETWEEN f.start_date AND f.end_date
  ORDER BY f.start_date
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No fiscal year could be resolved for %.', p_date;
  END IF;
  IF v_fy.is_closed THEN
    RAISE EXCEPTION 'The fiscal year covering % is closed.', p_date;
  END IF;
  RETURN v_fy.id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_ensure_fiscal_year(date)
  FROM PUBLIC, anon, authenticated;

-- Idempotent journal posting keyed by (tenant, 'business_subscription',
-- source_table, source_record_id) on the existing accounting_events unique
-- index. p_lines: [{"account_code": text, "debit": n, "credit": n, "description": text}]
CREATE OR REPLACE FUNCTION public.business_post_journal(
  p_entry_date date,
  p_description text,
  p_entry_type text,
  p_source_table text,
  p_source_record_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_module constant text := 'business_subscription';
  v_tenant uuid := public.business_platform_tenant_id();
  v_existing uuid;
  v_fy uuid;
  v_entry uuid;
  v_line jsonb;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_debit_total numeric(18,2) := 0;
  v_credit_total numeric(18,2) := 0;
BEGIN
  IF p_source_table IS NULL OR p_source_record_id IS NULL THEN
    RAISE EXCEPTION 'A source record is required for idempotent posting.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal needs at least two lines.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_tenant::text || ':' || c_module || ':' || p_source_table
                     || ':' || p_source_record_id::text, 0));

  SELECT e.journal_entry_id INTO v_existing
  FROM public.accounting_events e
  WHERE e.school_id = v_tenant
    AND e.source_module = c_module
    AND e.source_table = p_source_table
    AND e.source_record_id = p_source_record_id;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('journal_entry_id', v_existing, 'idempotent', true);
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_debit := COALESCE((v_line ->> 'debit')::numeric, 0);
    v_credit := COALESCE((v_line ->> 'credit')::numeric, 0);
    IF v_debit < 0 OR v_credit < 0 OR (v_debit > 0 AND v_credit > 0)
       OR (v_debit = 0 AND v_credit = 0)
    THEN
      RAISE EXCEPTION 'Each journal line needs exactly one positive debit or credit.';
    END IF;
    PERFORM public.business_account_id(v_line ->> 'account_code');
    v_debit_total := v_debit_total + v_debit;
    v_credit_total := v_credit_total + v_credit;
  END LOOP;

  IF v_debit_total <> v_credit_total THEN
    RAISE EXCEPTION 'Journal entry is not balanced.';
  END IF;

  v_fy := public.business_ensure_fiscal_year(p_entry_date);

  INSERT INTO public.journal_entries (
    school_id, fiscal_year_id, entry_date, description, entry_type,
    source_module, source_table, source_record_id, reference_type,
    reference_id, status, entry_number, posted_by, posted_at, created_by
  )
  VALUES (
    v_tenant, v_fy, p_entry_date, p_description, p_entry_type,
    c_module, p_source_table, p_source_record_id, p_reference_type,
    p_reference_id, 'posted', public.next_business_number('journal'),
    auth.uid(), now(), auth.uid()
  )
  RETURNING id INTO v_entry;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.journal_lines (
      school_id, fiscal_year_id, journal_entry_id, account_id, debit, credit, description
    )
    VALUES (
      v_tenant, v_fy, v_entry,
      public.business_account_id(v_line ->> 'account_code'),
      COALESCE((v_line ->> 'debit')::numeric, 0),
      COALESCE((v_line ->> 'credit')::numeric, 0),
      v_line ->> 'description'
    );
  END LOOP;

  INSERT INTO public.accounting_events (
    school_id, source_module, source_table, source_record_id, journal_entry_id, status
  )
  VALUES (v_tenant, c_module, p_source_table, p_source_record_id, v_entry, 'posted');

  INSERT INTO public.accounting_audit_log (
    school_id, entity_type, entity_id, action, actor_id, payload
  )
  VALUES (
    v_tenant, 'journal_entry', v_entry, 'posted', auth.uid(),
    jsonb_build_object(
      'source_table', p_source_table,
      'source_record_id', p_source_record_id,
      'entry_type', p_entry_type,
      'amount', v_debit_total
    )
  );

  RETURN jsonb_build_object('journal_entry_id', v_entry, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.business_post_journal(
  date, text, text, text, uuid, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;

-- Verified collection: Dr Cash/Bank, Cr Subscription Income.
CREATE OR REPLACE FUNCTION public.business_post_payment_receipt(
  p_payment_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_mode text,
  p_receipt_number text,
  p_school_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_desc text := 'Subscription collection ' || p_receipt_number || ' - ' || p_school_name;
BEGIN
  v_result := public.business_post_journal(
    p_payment_date, v_desc, 'receipt', 'school_payments', p_payment_id,
    'school_payment', p_payment_id,
    jsonb_build_array(
      jsonb_build_object('account_code', public.business_cash_account_code(p_payment_mode),
                         'debit', p_amount, 'credit', 0, 'description', v_desc),
      jsonb_build_object('account_code', 'SUBSCRIPTION_INCOME',
                         'debit', 0, 'credit', p_amount, 'description', v_desc)
    )
  );
  RETURN (v_result ->> 'journal_entry_id')::uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.business_post_payment_receipt(
  uuid, numeric, date, text, text, text
) FROM PUBLIC, anon, authenticated;

-- Refund / reversal: Dr Subscription Income, Cr Cash/Bank.
CREATE OR REPLACE FUNCTION public.business_post_payment_refund(
  p_reversal_id uuid,
  p_amount numeric,
  p_reversal_date date,
  p_payment_mode text,
  p_reversal_number text,
  p_receipt_number text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_desc text := 'Subscription refund ' || p_reversal_number || ' of receipt '
                 || p_receipt_number || ' - ' || p_reason;
BEGIN
  v_result := public.business_post_journal(
    p_reversal_date, v_desc, 'refund', 'payment_reversals', p_reversal_id,
    'payment_reversal', p_reversal_id,
    jsonb_build_array(
      jsonb_build_object('account_code', 'SUBSCRIPTION_INCOME',
                         'debit', p_amount, 'credit', 0, 'description', v_desc),
      jsonb_build_object('account_code', public.business_cash_account_code(p_payment_mode),
                         'debit', 0, 'credit', p_amount, 'description', v_desc)
    )
  );
  RETURN (v_result ->> 'journal_entry_id')::uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.business_post_payment_refund(
  uuid, numeric, date, text, text, text, text
) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 20261116160000_phase2_business_rpcs.sql
-- ============================================================================

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

-- ============================================================================
-- 20261116170000_phase2_reporting_storage.sql
-- ============================================================================

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

-- ============================================================================
-- 20261116180000_super_admin_school_cleanup.sql
-- ============================================================================

-- Allow the server-side Super Admin school cleanup to remove this school's
-- immutable Phase 2 billing and sales history in one transaction.
CREATE OR REPLACE FUNCTION public.business_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable and cannot be % .', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_count_confirmations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['status', 'decided_by', 'decided_at', 'decision_note', 'mou_id'];
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION public.school_invoices_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason'];
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoices cannot be deleted; cancel them instead.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'cancelled'
     OR (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR current_setting('app.invoice_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Invoices are immutable; use the cancel function.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_frozen text[] := ARRAY[
    'school_id', 'invoice_id', 'amount', 'payment_date', 'payment_mode',
    'transaction_reference', 'idempotency_key', 'remarks', 'submitted_by',
    'collected_by_rep_id', 'submitted_at', 'created_at'
  ];
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted. Use rejection, reversal or refund.'
      USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['updated_at']) = (to_jsonb(OLD) - ARRAY['updated_at']) THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.payment_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Payments change only through the payment functions.' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'verified_by', 'verified_at',
        'verification_note', 'receipt_number', 'receipt_snapshot', 'rejected_by',
        'rejected_at', 'rejection_reason', 'accounting_journal_entry_id'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'verified_by', 'verified_at',
        'verification_note', 'receipt_number', 'receipt_snapshot', 'rejected_by',
        'rejected_at', 'rejection_reason', 'accounting_journal_entry_id'])
  THEN
    RAISE EXCEPTION 'Core payment details are immutable (%).', array_to_string(v_frozen, ', ')
      USING ERRCODE = '42501';
  END IF;
  IF NOT (
    (OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected'))
    OR (OLD.status = 'verified' AND NEW.status IN ('reversed', 'refunded'))
  ) THEN
    RAISE EXCEPTION 'Illegal payment status change % -> %.', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'pending_verification'
     AND (NEW.verified_by IS DISTINCT FROM OLD.verified_by
          OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
          OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
          OR NEW.accounting_journal_entry_id IS DISTINCT FROM OLD.accounting_journal_entry_id
          OR NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot)
  THEN
    RAISE EXCEPTION 'Verification facts of a payment are immutable.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_sales_ownership_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'School ownership history cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  IF NEW.original_acquisition_rep_id IS DISTINCT FROM OLD.original_acquisition_rep_id
     OR NEW.acquired_by IS DISTINCT FROM OLD.acquired_by
     OR NEW.acquired_at IS DISTINCT FROM OLD.acquired_at
  THEN
    RAISE EXCEPTION 'The original acquisition attribution is permanent.' USING ERRCODE = '42501';
  END IF;
  IF NEW.current_rep_id IS DISTINCT FROM OLD.current_rep_id
     AND current_setting('app.ownership_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Use the reassignment function to change school ownership.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_sales_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['effective_to'];
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assignment history cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to)
  THEN
    RAISE EXCEPTION 'Assignment history is immutable except for closing the open period.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_activity_logs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Activity logs are append-only.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin() THEN
    NEW.rep_user_id := auth.uid();
    IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.school_leads l
      WHERE l.id = NEW.lead_id AND l.assigned_rep_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'You can only log activity for your own leads.' USING ERRCODE = '42501';
    END IF;
    IF NEW.school_id IS NOT NULL AND NOT public.rep_owns_school(NEW.school_id) THEN
      RAISE EXCEPTION 'You can only log activity for your own schools.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_leads_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.school_cleanup', true) = 'on'
     AND TG_OP = 'UPDATE'
     AND NEW.converted_school_id IS NULL
     AND (to_jsonb(NEW) - ARRAY['converted_school_id', 'updated_at'])
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['converted_school_id', 'updated_at'])
  THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_super_admin() THEN
      NEW.assigned_rep_id := auth.uid();
    END IF;
    NEW.created_by := auth.uid();
    NEW.status := CASE WHEN NEW.status = 'converted' THEN 'new_lead' ELSE NEW.status END;
    NEW.converted_school_id := NULL;
    IF NOT EXISTS (
      SELECT 1 FROM public.sales_representatives sr
      WHERE sr.user_id = NEW.assigned_rep_id AND sr.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Leads can only be assigned to an active sales representative.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'converted' THEN
    RAISE EXCEPTION 'A converted lead is read-only.' USING ERRCODE = '42501';
  END IF;
  IF (NEW.assigned_rep_id IS DISTINCT FROM OLD.assigned_rep_id
      OR NEW.converted_school_id IS DISTINCT FROM OLD.converted_school_id
      OR NEW.status = 'converted')
     AND current_setting('app.lead_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Lead assignment and conversion are managed through dedicated functions.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- MOU and confirmation rows reference each other. A school cleanup is the
-- only operation that needs to remove both; make this same-school dependency
-- cascade from the MOU while retaining the normal immutable guards.
ALTER TABLE public.billing_count_confirmations
  DROP CONSTRAINT IF EXISTS billing_count_confirmations_mou_fk;
ALTER TABLE public.billing_count_confirmations
  ADD CONSTRAINT billing_count_confirmations_mou_fk
  FOREIGN KEY (mou_id) REFERENCES public.school_mous (id) ON DELETE CASCADE;

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

-- ============================================================================
-- 20261116181000_school_cleanup_audit_scope.sql
-- ============================================================================

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

COMMIT;

-- Make PostgREST pick up the new tables, views and functions.
NOTIFY pgrst, 'reload schema';
