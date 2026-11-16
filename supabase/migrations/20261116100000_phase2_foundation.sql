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
