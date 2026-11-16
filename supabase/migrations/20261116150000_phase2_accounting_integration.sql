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
