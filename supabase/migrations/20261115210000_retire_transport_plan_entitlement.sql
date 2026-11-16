DO $$
DECLARE
  v_unexpected_constraint text;
BEGIN
  IF to_regclass('public.schools') IS NULL THEN
    RAISE EXCEPTION
      'Expected public.schools before retiring the transport entitlement.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.schools'::regclass
      AND attname = 'enabled_modules'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION
      'Expected public.schools.enabled_modules before retiring the transport entitlement.';
  END IF;

  IF to_regprocedure('public.school_has_module(uuid,text)') IS NULL THEN
    RAISE EXCEPTION
      'Expected public.school_has_module(uuid,text) before retiring the transport entitlement.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.schools'::regclass
      AND tgname = 'schools_audit_enabled_modules_change'
      AND tgenabled <> 'D'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Expected the school module audit trigger so entitlement changes remain auditable.';
  END IF;

  SELECT conname
  INTO v_unexpected_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.schools'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%enabled_modules%'
    AND conname <> 'schools_enabled_modules_check'
  LIMIT 1;

  IF v_unexpected_constraint IS NOT NULL THEN
    RAISE EXCEPTION
      'Unexpected schools constraint % references enabled_modules; review it before migration.',
      v_unexpected_constraint;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.schools
    WHERE enabled_modules IS NULL
       OR array_position(enabled_modules, NULL::text) IS NOT NULL
       OR NOT (
         enabled_modules <@ ARRAY['fees', 'payroll', 'transport']::text[]
       )
       OR cardinality(enabled_modules) <>
         (CASE WHEN 'fees' = ANY(enabled_modules) THEN 1 ELSE 0 END) +
         (CASE WHEN 'payroll' = ANY(enabled_modules) THEN 1 ELSE 0 END) +
         (CASE WHEN 'transport' = ANY(enabled_modules) THEN 1 ELSE 0 END)
  ) THEN
    RAISE EXCEPTION
      'Unexpected or duplicate school module values exist; inspect public.schools.enabled_modules before migration.';
  END IF;
END;
$$;

ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_enabled_modules_check;

UPDATE public.schools
SET enabled_modules = array_remove(enabled_modules, 'transport')
WHERE 'transport' = ANY(enabled_modules);

ALTER TABLE public.schools
  ADD CONSTRAINT schools_enabled_modules_check
  CHECK (
    array_position(enabled_modules, NULL::text) IS NULL
    AND enabled_modules <@ ARRAY['fees', 'payroll']::text[]
    AND cardinality(enabled_modules) =
      (CASE WHEN 'fees' = ANY(enabled_modules) THEN 1 ELSE 0 END) +
      (CASE WHEN 'payroll' = ANY(enabled_modules) THEN 1 ELSE 0 END)
  );

CREATE OR REPLACE FUNCTION public.school_has_any_module(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.school_has_module(p_school_id, 'fees')
      OR public.school_has_module(p_school_id, 'payroll');
$$;

REVOKE ALL ON FUNCTION public.school_has_any_module(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_has_any_module(uuid) TO authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND c.relname NOT IN (
        'schools',
        'school_users',
        'audit_logs',
        'buses',
        'routes',
        'stops',
        'student_transport'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'school_id'
          AND a.atttypid = 'uuid'::regtype
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS school_any_module_required ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY school_any_module_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.school_has_any_module(school_id)) WITH CHECK (public.school_has_any_module(school_id))',
      v_table
    );
  END LOOP;

END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.schools
    WHERE 'transport' = ANY(enabled_modules)
       OR enabled_modules IS NULL
       OR array_position(enabled_modules, NULL::text) IS NOT NULL
       OR NOT (enabled_modules <@ ARRAY['fees', 'payroll']::text[])
       OR cardinality(enabled_modules) <>
         (CASE WHEN 'fees' = ANY(enabled_modules) THEN 1 ELSE 0 END) +
         (CASE WHEN 'payroll' = ANY(enabled_modules) THEN 1 ELSE 0 END)
  ) THEN
    RAISE EXCEPTION
      'Unexpected entitlement values remain after transport retirement.';
  END IF;
END;
$$;

-- Post-migration verification: review each entitlement cohort.
SELECT id, name, enabled_modules
FROM public.schools
WHERE 'fees' = ANY(enabled_modules)
ORDER BY name, id;

SELECT id, name, enabled_modules
FROM public.schools
WHERE 'payroll' = ANY(enabled_modules)
ORDER BY name, id;

SELECT id, name, enabled_modules
FROM public.schools
WHERE 'fees' = ANY(enabled_modules)
  AND 'payroll' = ANY(enabled_modules)
ORDER BY name, id;

SELECT id, name, enabled_modules
FROM public.schools
WHERE cardinality(enabled_modules) = 0
ORDER BY name, id;

-- Any returned row indicates an unexpected entitlement change in the audit trail.
SELECT school_id, old_value, new_value, created_at
FROM public.audit_logs
WHERE action = 'enabled_modules_changed'
  AND old_value ? 'transport'
  AND new_value IS DISTINCT FROM (
    SELECT COALESCE(jsonb_agg(module ORDER BY ordinal), '[]'::jsonb)
    FROM jsonb_array_elements_text(old_value) WITH ORDINALITY AS old_modules(module, ordinal)
    WHERE module <> 'transport'
  )
ORDER BY created_at DESC;

-- This should return no rows after the migration.
SELECT id, name, enabled_modules
FROM public.schools
WHERE enabled_modules IS NULL
   OR 'transport' = ANY(enabled_modules)
   OR array_position(enabled_modules, NULL::text) IS NOT NULL
   OR NOT (enabled_modules <@ ARRAY['fees', 'payroll']::text[])
   OR cardinality(enabled_modules) <>
     (CASE WHEN 'fees' = ANY(enabled_modules) THEN 1 ELSE 0 END) +
     (CASE WHEN 'payroll' = ANY(enabled_modules) THEN 1 ELSE 0 END);

-- Review any RLS-enabled school table not covered by the no-plan gate.
SELECT n.nspname AS schema_name, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relrowsecurity
  AND c.relname NOT IN (
    'schools',
    'school_users',
    'audit_logs',
    'buses',
    'routes',
    'stops',
    'student_transport'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = c.oid
      AND a.attname = 'school_id'
      AND a.atttypid = 'uuid'::regtype
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    WHERE p.polrelid = c.oid
      AND p.polname = 'school_any_module_required'
  )
ORDER BY c.relname;

-- School creation requires an authenticated, authorized creator and an
-- explicitly recorded plan and commercial agreement.
DO $$
BEGIN
  IF to_regclass('public.school_subscriptions') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
  THEN
    RAISE EXCEPTION
      'Expected school subscription, profile, and audit tables before enforcing school creation policy.';
  END IF;

  IF to_regprocedure('public.create_school_with_owner(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION
      'Expected the inspected four-argument create_school_with_owner RPC before disabling client execution.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.schools'::regclass
      AND t.tgfoid = to_regprocedure('public.guard_school_modules_change()')
      AND t.tgenabled <> 'D'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Expected the enabled school-module guard trigger before replacing its creation checks.';
  END IF;
END;
$$;

ALTER TYPE public.platform_role ADD VALUE IF NOT EXISTS 'sales_rep';

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS subscription_amount numeric,
  ADD COLUMN IF NOT EXISTS subscription_payment_terms text,
  ADD COLUMN IF NOT EXISTS sales_discussion_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_discussion_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_discussion_confirmed_by uuid,
  ALTER COLUMN enabled_modules DROP DEFAULT,
  ALTER COLUMN student_limit DROP DEFAULT,
  ALTER COLUMN plan_code DROP DEFAULT;

ALTER TABLE public.school_subscriptions
  ADD COLUMN IF NOT EXISTS payment_terms text;

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

CREATE OR REPLACE FUNCTION public.audit_school_creation_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    school_id,
    user_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.sales_discussion_confirmed_by,
    'school_creation_agreement_recorded',
    'school',
    NEW.id,
    NULL,
    jsonb_build_object(
      'enabled_modules', to_jsonb(NEW.enabled_modules),
      'student_limit', NEW.student_limit,
      'subscription_amount', NEW.subscription_amount,
      'payment_terms', NEW.subscription_payment_terms,
      'confirmed_at', NEW.sales_discussion_confirmed_at
    ),
    now()
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_school_creation_agreement()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schools_audit_creation_agreement ON public.schools;
CREATE TRIGGER schools_audit_creation_agreement
  AFTER INSERT ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_school_creation_agreement();

REVOKE EXECUTE ON FUNCTION public.create_school_with_owner(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_default_accounts(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.accounts (
    school_id,
    name,
    code,
    account_type,
    opening_balance,
    is_active,
    is_system
  )
  VALUES
    (p_school_id, 'Cash in Hand', '1000', 'asset', 0, true, true),
    (p_school_id, 'Bank Account', '1100', 'asset', 0, true, true),
    (p_school_id, 'UPI Collections', '1200', 'asset', 0, true, true),
    (p_school_id, 'Tuition Fees', '4000', 'income', 0, true, true),
    (p_school_id, 'Admission Fees', '4100', 'income', 0, true, true),
    (p_school_id, 'Salaries', '5000', 'expense', 0, true, true),
    (p_school_id, 'Fuel', '5100', 'expense', 0, true, true),
    (p_school_id, 'Building EMI', '5200', 'expense', 0, true, true),
    (p_school_id, 'Electricity', '5400', 'expense', 0, true, true),
    (p_school_id, 'Stationery', '5500', 'expense', 0, true, true)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_school_accounting_setup(
  p_school_id uuid,
  p_fiscal_year_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_fiscal_year_name text;
  v_fiscal_year_id uuid;
  v_fy_start date;
  v_fy_end date;
  v_account_count int;
  v_authorized boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required to run school accounting setup.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.school_users
    WHERE school_id = p_school_id
      AND user_id = auth.uid()
      AND is_active = true
      AND lower(coalesce(role, '')) IN ('owner', 'admin', 'accountant')
  )
  INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION
      'Only active school owners, admins and accountants may run school accounting setup.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'School not found';
  END IF;

  v_fiscal_year_name := coalesce(
    p_fiscal_year_name,
    to_char(current_date, 'YYYY') || '-' ||
      to_char(current_date + interval '1 year', 'YY')
  );
  v_fy_start := make_date(extract(year FROM current_date)::int, 4, 1);
  v_fy_end := v_fy_start + interval '1 year' - interval '1 day';

  IF NOT EXISTS (
    SELECT 1
    FROM public.fiscal_years
    WHERE school_id = p_school_id
      AND name = v_fiscal_year_name
  ) THEN
    INSERT INTO public.fiscal_years (
      school_id,
      name,
      start_date,
      end_date,
      is_closed
    )
    VALUES (
      p_school_id,
      v_fiscal_year_name,
      v_fy_start,
      v_fy_end,
      false
    )
    RETURNING id INTO v_fiscal_year_id;
  ELSE
    SELECT id INTO v_fiscal_year_id
    FROM public.fiscal_years
    WHERE school_id = p_school_id
      AND name = v_fiscal_year_name
    LIMIT 1;
  END IF;

  INSERT INTO public.accounts (
    school_id,
    code,
    name,
    account_type,
    is_system,
    is_active
  )
  VALUES
    (p_school_id, 'CASH', 'Cash', 'CASH', true, true),
    (p_school_id, 'BANK', 'Bank', 'BANK', true, true),
    (p_school_id, 'STUDENT_FEE_RECEIVABLE', 'Student Fee Receivable', 'RECEIVABLE', true, true),
    (p_school_id, 'OTHER_RECEIVABLES', 'Other Receivables', 'RECEIVABLE', true, true),
    (p_school_id, 'FIXED_ASSETS', 'Fixed Assets', 'ASSET', true, true),
    (p_school_id, 'SALARY_PAYABLE', 'Salary Payable', 'PAYABLE', true, true),
    (p_school_id, 'OTHER_PAYABLES', 'Other Payables', 'PAYABLE', true, true),
    (p_school_id, 'VENDOR_PAYABLES', 'Vendor Payables', 'PAYABLE', true, true),
    (p_school_id, 'LOAN_PAYABLES', 'Loan Payables', 'PAYABLE', true, true),
    (p_school_id, 'CAPITAL', 'Capital / Owner Equity', 'EQUITY', true, true),
    (p_school_id, 'RETAINED_EARNINGS', 'Retained Earnings', 'EQUITY', true, true),
    (p_school_id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true, true),
    (p_school_id, 'OTHER_INCOME', 'Other Income', 'INCOME', true, true),
    (p_school_id, 'INTEREST_INCOME', 'Interest Income', 'INCOME', true, true),
    (p_school_id, 'SALARY_EXPENSE', 'Salary Expense', 'EXPENSE', true, true),
    (p_school_id, 'PAYROLL_EXPENSE', 'Payroll Expense', 'EXPENSE', true, true),
    (p_school_id, 'MAINTENANCE', 'Maintenance', 'EXPENSE', true, true),
    (p_school_id, 'UTILITIES', 'Utilities', 'EXPENSE', true, true),
    (p_school_id, 'BUILDING_MAINTENANCE', 'Building Maintenance', 'EXPENSE', true, true),
    (p_school_id, 'OFFICE_EXPENSE', 'Office Expenses', 'EXPENSE', true, true),
    (p_school_id, 'ACADEMIC_EXPENSE', 'Academic Expenses', 'EXPENSE', true, true)
  ON CONFLICT (school_id, code) DO NOTHING;

  SELECT count(*) INTO v_account_count
  FROM public.accounts
  WHERE school_id = p_school_id;

  RETURN jsonb_build_object(
    'school_id', p_school_id,
    'fiscal_year_id', v_fiscal_year_id,
    'fiscal_year_name', v_fiscal_year_name,
    'account_count', v_account_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_school_accounting_setup(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_school_accounting_setup(uuid, text)
  TO authenticated;

-- Export and verify an encrypted external backup before applying this
-- migration. These guards refuse to discard any transport or payroll data
-- that appeared after the read-only inventory.
DO $$
DECLARE
  v_table text;
  v_relation regclass;
  v_has_rows boolean;
  v_fk record;
  v_has_reference boolean;
  v_account_filter constant text :=
    '(target.code IN (''TRANSPORT_FEES'', ''TRANSPORT_FUEL'')'
    || ' OR (target.code = ''4200'' AND lower(target.name) = ''transport fees'')'
    || ' OR (target.code = ''5300'' AND lower(target.name) = ''bus emi''))';
BEGIN
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'Expected public.accounts before removing retired default accounts.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND (c.relname ILIKE '%transport%' OR c.relname ILIKE '%bus%')
      AND c.relname NOT IN (
        'buses',
        'routes',
        'stops',
        'student_transport'
      )
  ) THEN
    RAISE EXCEPTION
      'An additional transport-named database object exists; inventory its dependencies before retirement.';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'accounts',
    'buses',
    'payroll_items',
    'routes',
    'staff_salary_structures',
    'stops',
    'student_transport'
  ]
  LOOP
    v_relation := to_regclass(format('public.%I', v_table));
    IF v_relation IS NOT NULL THEN
      EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', v_relation);
      IF v_table = ANY(ARRAY[
        'buses',
        'routes',
        'stops',
        'student_transport'
      ]) THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', v_relation)
          INTO v_has_rows;
        IF v_has_rows THEN
          RAISE EXCEPTION
            'public.% contains rows; export and verify its backup, then review the data before retrying.',
            v_table;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid IN (
        to_regclass('public.buses'),
        to_regclass('public.routes'),
        to_regclass('public.stops'),
        to_regclass('public.student_transport')
      )
      AND con.conrelid NOT IN (
        to_regclass('public.buses'),
        to_regclass('public.routes'),
        to_regclass('public.stops'),
        to_regclass('public.student_transport')
      )
  ) THEN
    RAISE EXCEPTION
      'An external foreign key depends on a retired transport table; review it before removal.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.staff_salary_structures')
      AND a.attname = 'transport_allowance'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.staff_salary_structures WHERE coalesce(transport_allowance, 0) <> 0)'
      INTO v_has_rows;
    IF v_has_rows THEN
      RAISE EXCEPTION
        'Non-zero salary transport allowances exist; export and review them before dropping the field.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.payroll_items')
      AND a.attname = 'transport_allowance'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.payroll_items WHERE coalesce(transport_allowance, 0) <> 0)'
      INTO v_has_rows;
    IF v_has_rows THEN
      RAISE EXCEPTION
        'Non-zero payroll transport allowances exist; export and review them before dropping the field.';
    END IF;
  END IF;

  FOR v_fk IN
    SELECT
      source_ns.nspname AS source_schema,
      source.relname AS source_table,
      source_column.attname AS source_column,
      target_column.attname AS target_column,
      cardinality(con.conkey) AS source_key_count,
      cardinality(con.confkey) AS target_key_count
    FROM pg_constraint con
    JOIN pg_class source ON source.oid = con.conrelid
    JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
    JOIN pg_attribute source_column
      ON source_column.attrelid = con.conrelid
     AND source_column.attnum = con.conkey[1]
    JOIN pg_attribute target_column
      ON target_column.attrelid = con.confrelid
     AND target_column.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.accounts'::regclass
  LOOP
    IF v_fk.source_key_count <> 1 OR v_fk.target_key_count <> 1 THEN
      RAISE EXCEPTION
        'Unexpected composite foreign key % on account records; review it before removing default accounts.',
        v_fk.source_table;
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I source JOIN public.accounts target ON source.%I = target.%I WHERE %s)',
      v_fk.source_schema,
      v_fk.source_table,
      v_fk.source_column,
      v_fk.target_column,
      v_account_filter
    )
    INTO v_has_reference;

    IF v_has_reference THEN
      RAISE EXCEPTION
        'A transport-specific account is referenced by %. Preserve the accounting data and review before retrying.',
        v_fk.source_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.staff_salary_structures')
      AND a.attname = 'transport_allowance'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    ALTER TABLE public.staff_salary_structures
      DROP COLUMN transport_allowance RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.payroll_items')
      AND a.attname = 'transport_allowance'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    ALTER TABLE public.payroll_items
      DROP COLUMN transport_allowance RESTRICT;
  END IF;

  DELETE FROM public.accounts target
  WHERE target.code IN ('TRANSPORT_FEES', 'TRANSPORT_FUEL')
     OR (target.code = '4200' AND lower(target.name) = 'transport fees')
     OR (target.code = '5300' AND lower(target.name) = 'bus emi');

  DROP TABLE IF EXISTS
    public.student_transport,
    public.stops,
    public.routes,
    public.buses
  RESTRICT;
END;
$$;

-- Post-migration checks: defaulted insert fields and client RPC access must be absent.
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'schools'
  AND column_name IN ('enabled_modules', 'student_limit')
  AND column_default IS NOT NULL;

SELECT
  has_function_privilege(
    'anon',
    'public.create_school_with_owner(text,text,text,text)',
    'EXECUTE'
  ) AS anon_can_execute,
  has_function_privilege(
    'authenticated',
    'public.create_school_with_owner(text,text,text,text)',
    'EXECUTE'
  ) AS authenticated_can_execute,
  has_function_privilege(
    'service_role',
    'public.create_school_with_owner(text,text,text,text)',
    'EXECUTE'
  ) AS service_role_can_execute;

SELECT policyname, roles, cmd, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'schools'
  AND policyname = 'schools_authorized_creator_insert';
