-- Add restrictive entitlement checks without replacing school/role policies.
-- SECURITY DEFINER RPCs still need an explicit school_has_module check.
DO $$
DECLARE
  v_table text;
  v_module text;
BEGIN
  IF to_regprocedure('public.school_has_module(uuid,text)') IS NULL THEN
    RAISE EXCEPTION
      'Expected public.school_has_module(uuid,text); reconcile the deployed module schema before applying this migration.';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'fee_bill_items',
    'fee_bills',
    'fee_carry_forwards',
    'fee_categories',
    'fee_concessions',
    'fee_invoice_items',
    'fee_invoices',
    'fee_payment_allocations',
    'fee_payment_inventory_reclassifications',
    'fee_payment_splits',
    'fee_payments',
    'fee_structure_items',
    'fee_structures',
    'student_fee_bills'
  ]
  LOOP
    v_module := 'fees';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND a.attname = 'school_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION
        'Expected public.% with RLS and a school_id column before applying module access policies.',
        v_table;
    END IF;

    EXECUTE format(
      'CREATE POLICY school_module_entitlement_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.school_has_module(school_id, %L)) WITH CHECK (public.school_has_module(school_id, %L))',
      v_table,
      v_module,
      v_module
    );
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'payroll_items',
    'payroll_runs',
    'salary_payment_records',
    'staff_attendance',
    'staff_attendance_offline_syncs',
    'staff_attendance_overrides',
    'staff_attendance_settings',
    'staff_attendance_timings',
    'staff_salary_structures'
  ]
  LOOP
    v_module := 'payroll';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND a.attname = 'school_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION
        'Expected public.% with RLS and a school_id column before applying module access policies.',
        v_table;
    END IF;

    EXECUTE format(
      'CREATE POLICY school_module_entitlement_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.school_has_module(school_id, %L)) WITH CHECK (public.school_has_module(school_id, %L))',
      v_table,
      v_module,
      v_module
    );
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['student_transport']
  LOOP
    v_module := 'transport';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND a.attname = 'school_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION
        'Expected public.% with RLS and a school_id column before applying module access policies.',
        v_table;
    END IF;

    EXECUTE format(
      'CREATE POLICY school_module_entitlement_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.school_has_module(school_id, %L)) WITH CHECK (public.school_has_module(school_id, %L))',
      v_table,
      v_module,
      v_module
    );
  END LOOP;
END;
$$;
