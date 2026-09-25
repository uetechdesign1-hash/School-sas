-- ============================================================
-- FEE COLLECTION POSTS INCOME (not receivable)
-- ------------------------------------------------------------
-- Background
--   Every fee-collection path (record_fee_payment canonical overload,
--   record_fee_payment_collection_split and the client posting helper)
--   credited "Student Fee Receivable" when a fee was received, while
--   fee billing never debits the receivable. Result: the receivable
--   drifted negative (a credit balance) and the Student Fees income
--   account stayed empty, so P&L income and the Balance Sheet were
--   both wrong.
--
--   Fee money received from students is INCOME. This migration makes
--   every fee collection post:
--
--     Cash / Bank     DR
--     Student Fees    CR   (income)
--
--   The STUDENT_FEES income account is self-created per school if it
--   is missing. Existing fee-payment journals are reclassified from
--   the receivable to the income account so reports become correct
--   without any re-entry by the school.
-- ============================================================

-- Canonical 10-parameter record_fee_payment (used by the Receipt page
-- and the fee collection RPCs):
CREATE OR REPLACE FUNCTION public.record_fee_payment(p_student_id uuid, p_bill_id uuid, p_amount numeric, p_payment_mode text, p_account_id uuid, p_receipt_number text, p_payment_date date, p_reference_number text DEFAULT NULL::text, p_remarks text DEFAULT NULL::text, p_fee_bill_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

DECLARE
  v_school_id uuid;
  v_bill public.fee_bills%rowtype;
  v_payment_id uuid;
  v_fiscal_year_id uuid;
  v_fy_start date;
  v_fy_end date;
  v_fiscal_year_name text;
  v_fee_income_account_id uuid;
  v_remaining numeric(18,2);
  v_paid numeric(18,2);

BEGIN

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT school_id
  INTO v_school_id
  FROM public.students
  WHERE id = p_student_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Student was not found';
  END IF;

  SELECT *
  INTO v_bill
  FROM public.fee_bills
  WHERE id = p_bill_id
    AND school_id = v_school_id
    AND student_id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fee bill was not found for this student';
  END IF;

  IF p_account_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.accounts
    WHERE id = p_account_id
      AND school_id = v_school_id
      AND is_active = true
      AND lower(account_type::text) IN ('cash', 'bank')
  ) THEN
    RAISE EXCEPTION 'The selected payment account is invalid';
  END IF;

  IF p_fee_bill_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.fee_bill_items
    WHERE id = p_fee_bill_item_id
      AND bill_id = p_bill_id
      AND school_id = v_school_id
  ) THEN
    RAISE EXCEPTION 'The selected fee item does not belong to this bill';
  END IF;

  v_remaining := greatest(coalesce(v_bill.balance_amount, 0), 0);

  IF p_amount > v_remaining + 0.005 THEN
    RAISE EXCEPTION
      'Payment exceeds the remaining bill balance';
  END IF;

  SELECT id
  INTO v_fiscal_year_id
  FROM public.fiscal_years
  WHERE school_id = v_school_id
    AND p_payment_date BETWEEN start_date AND end_date
  ORDER BY start_date DESC
  LIMIT 1;

  IF v_fiscal_year_id IS NULL THEN

    v_fy_start :=
      (date_trunc('year', p_payment_date) + interval '3 months')::date;

    IF p_payment_date < v_fy_start THEN
      v_fy_start := v_fy_start - interval '1 year';
    END IF;

    v_fy_end :=
      v_fy_start + interval '1 year' - interval '1 day';

    SELECT id
    INTO v_fiscal_year_id
    FROM public.fiscal_years
    WHERE school_id = v_school_id
      AND start_date = v_fy_start
      AND end_date = v_fy_end
    LIMIT 1;

    IF v_fiscal_year_id IS NULL THEN

      v_fiscal_year_name :=
        to_char(v_fy_start, 'YYYY') || '-' ||
        to_char(v_fy_end, 'YY');

      IF EXISTS (
        SELECT 1
        FROM public.fiscal_years
        WHERE school_id = v_school_id
          AND name = v_fiscal_year_name
          AND (
            start_date <> v_fy_start
            OR end_date <> v_fy_end
          )
      ) THEN
        v_fiscal_year_name :=
          v_fiscal_year_name || ' (' ||
          to_char(v_fy_start, 'YYYY-MM-DD') || ')';
      END IF;

      INSERT INTO public.fiscal_years (
        school_id,
        name,
        start_date,
        end_date,
        is_closed
      )
      VALUES (
        v_school_id,
        v_fiscal_year_name,
        v_fy_start,
        v_fy_end,
        false
      )
      RETURNING id INTO v_fiscal_year_id;

    END IF;
  END IF;

  SELECT id
  INTO v_fee_income_account_id
  FROM public.accounts
  WHERE school_id = v_school_id
    AND code = 'STUDENT_FEES'
    AND lower(account_type::text) = 'income'
    AND is_active = true
  LIMIT 1;

  IF v_fee_income_account_id IS NULL THEN
    INSERT INTO public.accounts (
      school_id, code, name, account_type, is_system, is_active
    )
    VALUES (
      v_school_id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true, true
    )
    ON CONFLICT (school_id, code) DO NOTHING
    RETURNING id INTO v_fee_income_account_id;
  END IF;

  IF v_fee_income_account_id IS NULL THEN
    SELECT id
    INTO v_fee_income_account_id
    FROM public.accounts
    WHERE school_id = v_school_id
      AND code = 'STUDENT_FEES'
      AND lower(account_type::text) = 'income'
    LIMIT 1;
  END IF;

  IF v_fee_income_account_id IS NULL THEN
    RAISE EXCEPTION 'Student Fees income account is not configured';
  END IF;

  INSERT INTO public.fee_payments (
    school_id,
    student_id,
    bill_id,
    receipt_number,
    payment_date,
    amount,
    payment_method,
    account_id,
    reference_number,
    notes,
    received_by
  )
  VALUES (
    v_school_id,
    p_student_id,
    p_bill_id,
    p_receipt_number,
    p_payment_date,
    p_amount,
    lower(p_payment_mode)::payment_method,
    p_account_id,
    nullif(btrim(p_reference_number), ''),
    nullif(btrim(p_remarks), ''),
    auth.uid()
  )
  RETURNING id INTO v_payment_id;

  IF p_fee_bill_item_id IS NOT NULL THEN

    INSERT INTO public.fee_payment_allocations (
      school_id,
      bill_id,
      payment_id,
      amount,
      fee_bill_item_id
    )
    VALUES (
      v_school_id,
      p_bill_id,
      v_payment_id,
      p_amount,
      p_fee_bill_item_id
    );

  END IF;

  v_paid :=
    coalesce(v_bill.paid_amount, 0) + p_amount;

  UPDATE public.fee_bills
  SET
    paid_amount = v_paid,
    balance_amount =
      greatest(coalesce(total_amount, 0) - v_paid, 0),
    status =
      CASE
        WHEN greatest(coalesce(total_amount, 0) - v_paid, 0) <= 0.005
          THEN 'paid'
        WHEN v_paid > 0
          THEN 'partial'
        ELSE 'unpaid'
      END,
    updated_at = now()
  WHERE id = p_bill_id
    AND school_id = v_school_id;

  /*
   * ACCOUNTING
   *
   * Student fee payment:
   *
   * Cash / Bank     DR
   * Student Fees    CR  (income - money received from students)
   *
   * The selected fee_bill_item_id remains attached
   * through fee_payment_allocations.
   */
  PERFORM public.create_journal_entry(
    v_school_id,
    v_fiscal_year_id,
    p_payment_date,
    'Student fee payment ' ||
      coalesce(p_receipt_number, v_payment_id::text),
    'fee_collection',
    'fees',
    'fee_payments',
    v_payment_id,
    'fee_payment',
    v_payment_id::text,
    auth.uid(),
    jsonb_build_array(
      jsonb_build_object(
        'accountId', p_account_id,
        'debit', p_amount,
        'credit', 0,
        'description',
          'Fee payment received - ' ||
          coalesce(p_receipt_number, v_payment_id::text)
      ),
      jsonb_build_object(
        'accountId', v_fee_income_account_id,
        'debit', 0,
        'credit', p_amount,
        'description',
          'Student fee income earned'
      )
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'bill_id', p_bill_id,
    'remaining_balance',
      greatest(
        coalesce(v_bill.total_amount, 0) - v_paid,
        0
      ),
    'fee_bill_item_id', p_fee_bill_item_id
  );

END;

$function$;

-- Split-collection variant (rewrites the journal lines):
CREATE OR REPLACE FUNCTION public.record_fee_payment_collection_split(p_student_id uuid, p_bill_id uuid, p_amount numeric, p_receipt_number text, p_payment_date date, p_reference_number text DEFAULT NULL::text, p_remarks text DEFAULT NULL::text, p_allocations jsonb DEFAULT '[]'::jsonb, p_splits jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_school_id uuid;
    v_bill public.fee_bills%ROWTYPE;
    v_result jsonb;
    v_payment_id uuid;
    v_journal_id uuid;
    v_fee_income_id uuid;
    v_split record;
    v_split_total numeric(18,2) := 0;
    v_cash_total numeric(18,2) := 0;
    v_bank_total numeric(18,2) := 0;
BEGIN
    v_school_id := public.get_my_school_id();

    IF v_school_id IS NULL OR NOT public.has_school_role(ARRAY['owner','admin','accountant']) THEN
        RAISE EXCEPTION 'User is not authorized to record payments';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero';
    END IF;

    IF NULLIF(btrim(COALESCE(p_receipt_number, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Manual receipt number is required';
    END IF;

    IF jsonb_typeof(p_splits) <> 'array' OR jsonb_array_length(p_splits) < 2 THEN
        RAISE EXCEPTION 'Split collection requires at least Cash and Bank/Online amounts';
    END IF;

    SELECT * INTO v_bill
    FROM public.fee_bills
    WHERE id = p_bill_id
      AND school_id = v_school_id
      AND student_id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fee bill was not found for this student';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.fee_payments
        WHERE school_id = v_school_id
          AND lower(trim(receipt_number)) = lower(trim(p_receipt_number))
    ) THEN
        RAISE EXCEPTION 'Receipt number % has already been used in this school', p_receipt_number;
    END IF;

    -- Validate and total the money-source split.
    FOR v_split IN
        SELECT account_id, payment_mode, amount
        FROM jsonb_to_recordset(p_splits)
             AS x(account_id uuid, payment_mode text, amount numeric)
    LOOP
        IF v_split.account_id IS NULL OR v_split.amount IS NULL OR v_split.amount <= 0 THEN
            RAISE EXCEPTION 'Every collection split needs a valid account and amount';
        END IF;

        IF lower(trim(v_split.payment_mode)) = 'cash' THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.accounts a
                WHERE a.id = v_split.account_id
                  AND a.school_id = v_school_id
                  AND a.is_active = true
                  AND lower(a.account_type::text) = 'cash'
            ) THEN
                RAISE EXCEPTION 'The Cash split must use an active Cash account';
            END IF;
            v_cash_total := v_cash_total + v_split.amount;
        ELSIF lower(trim(v_split.payment_mode)) IN ('online','bank_transfer','upi','cheque','card') THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.accounts a
                WHERE a.id = v_split.account_id
                  AND a.school_id = v_school_id
                  AND a.is_active = true
                  AND lower(a.account_type::text) = 'bank'
            ) THEN
                RAISE EXCEPTION 'The Bank/Online split must use an active Bank account';
            END IF;
            v_bank_total := v_bank_total + v_split.amount;
        ELSE
            RAISE EXCEPTION 'Unsupported split payment mode: %', v_split.payment_mode;
        END IF;

        v_split_total := v_split_total + v_split.amount;
    END LOOP;

    v_split_total := round(v_split_total, 2);

    IF abs(v_split_total - round(p_amount, 2)) > 0.005 THEN
        RAISE EXCEPTION 'Cash + Bank/Online total % does not match payment total %',
            v_split_total, round(p_amount, 2);
    END IF;

    -- Reuse the already validated multi-category payment workflow.
    -- Cash is used only as the temporary primary account; its journal is
    -- replaced immediately below with the exact split debit lines.
    v_result := public.record_fee_payment_collection(
        p_student_id,
        p_bill_id,
        round(p_amount, 2),
        'cash',
        (SELECT account_id::uuid
         FROM jsonb_to_recordset(p_splits)
              AS x(account_id uuid, payment_mode text, amount numeric)
         WHERE lower(trim(payment_mode)) = 'cash'
         ORDER BY amount DESC
         LIMIT 1),
        p_receipt_number,
        p_payment_date,
        p_reference_number,
        p_remarks,
        p_allocations
    );

    v_payment_id := NULLIF(v_result->>'payment_id', '')::uuid;

    IF v_payment_id IS NULL THEN
        RAISE EXCEPTION 'Payment was created but no payment ID was returned';
    END IF;

    -- Store the exact Cash/Bank split for reporting, receipt editing and audit.
    DELETE FROM public.fee_payment_splits WHERE payment_id = v_payment_id;

    INSERT INTO public.fee_payment_splits (
        school_id, payment_id, account_id, payment_mode, amount, reference_number
    )
    SELECT
        v_school_id,
        v_payment_id,
        x.account_id,
        lower(trim(x.payment_mode)),
        round(x.amount, 2),
        NULLIF(trim(COALESCE(p_reference_number, '')), '')
    FROM jsonb_to_recordset(p_splits)
         AS x(account_id uuid, payment_mode text, amount numeric);

    -- Mark the payment as a split collection. account_id is intentionally NULL
    -- because the real receiving accounts are stored in fee_payment_splits.
    UPDATE public.fee_payments
    SET payment_method = 'other'::payment_method,
        account_id = NULL,
        notes = CASE
            WHEN NULLIF(trim(COALESCE(p_remarks, '')), '') IS NULL
                THEN format('Split collection: Cash %s + Bank/Online %s', round(v_cash_total,2), round(v_bank_total,2))
            ELSE trim(p_remarks) || format(' | Split collection: Cash %s + Bank/Online %s', round(v_cash_total,2), round(v_bank_total,2))
        END
    WHERE id = v_payment_id
      AND school_id = v_school_id;

    -- Replace the temporary single-account journal debit with one debit per
    -- receiving account. The credit is Student Fees income.
    SELECT id INTO v_journal_id
    FROM public.journal_entries
    WHERE school_id = v_school_id
      AND reference_type = 'fee_payment'
      AND reference_id = v_payment_id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_journal_id IS NULL THEN
        RAISE EXCEPTION 'Fee payment journal entry not found';
    END IF;

    SELECT id INTO v_fee_income_id
    FROM public.accounts
    WHERE school_id = v_school_id
      AND code = 'STUDENT_FEES'
      AND lower(account_type::text) = 'income'
      AND is_active = true
    LIMIT 1;

    IF v_fee_income_id IS NULL THEN
        INSERT INTO public.accounts (
            school_id, code, name, account_type, is_system, is_active
        )
        VALUES (
            v_school_id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true, true
        )
        ON CONFLICT (school_id, code) DO NOTHING
        RETURNING id INTO v_fee_income_id;
    END IF;

    IF v_fee_income_id IS NULL THEN
        SELECT id INTO v_fee_income_id
        FROM public.accounts
        WHERE school_id = v_school_id
          AND code = 'STUDENT_FEES'
          AND lower(account_type::text) = 'income'
        LIMIT 1;
    END IF;

    IF v_fee_income_id IS NULL THEN
        RAISE EXCEPTION 'Student Fees income account is not configured';
    END IF;

    UPDATE public.journal_entries
    SET description = 'Split student fee collection ' || trim(p_receipt_number),
        entry_date = p_payment_date
    WHERE id = v_journal_id
      AND school_id = v_school_id;

    DELETE FROM public.journal_lines
    WHERE journal_entry_id = v_journal_id
      AND school_id = v_school_id;

    INSERT INTO public.journal_lines (
        school_id, journal_entry_id, account_id, debit, credit, description
    )
    SELECT
        v_school_id,
        v_journal_id,
        s.account_id,
        round(s.amount, 2),
        0,
        initcap(s.payment_mode) || ' fee collection received'
    FROM public.fee_payment_splits s
    WHERE s.payment_id = v_payment_id
      AND s.school_id = v_school_id;

    INSERT INTO public.journal_lines (
        school_id, journal_entry_id, account_id, debit, credit, description
    ) VALUES (
        v_school_id,
        v_journal_id,
        v_fee_income_id,
        0,
        round(p_amount, 2),
        'Student fee income earned'
    );

    PERFORM public.validate_journal_entry_balance(v_journal_id);

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'bill_id', p_bill_id,
        'receipt_number', p_receipt_number,
        'amount', round(p_amount, 2),
        'cash_amount', round(v_cash_total, 2),
        'bank_amount', round(v_bank_total, 2),
        'remaining_balance', (SELECT balance_amount FROM public.fee_bills WHERE id = p_bill_id),
        'journal_entry_id', v_journal_id
    );
END;
$function$;

-- ------------------------------------------------------------
-- 1) Reclassify existing fee-payment journals
--    (credit moves from Student Fee Receivable to Student Fees income)
-- ------------------------------------------------------------
update public.journal_lines jl
set
  account_id = fee_income.id,
  description = 'Student fee income earned'
from public.journal_entries je,
     public.accounts old_receivable,
     public.accounts fee_income
where jl.journal_entry_id = je.id
  and old_receivable.id = jl.account_id
  and old_receivable.code = 'STUDENT_FEE_RECEIVABLE'
  and fee_income.school_id = je.school_id
  and fee_income.code = 'STUDENT_FEES'
  and lower(fee_income.account_type::text) = 'income'
  and je.reference_type = 'fee_payment'
  and coalesce(jl.credit, 0) > 0
  and coalesce(jl.debit, 0) = 0;

-- ------------------------------------------------------------
-- 2) Make sure every school actually has the income account
--    (the RPCs self-create it too; this covers schools that have
--    never collected a fee yet)
-- ------------------------------------------------------------
insert into public.accounts (
  school_id, code, name, account_type, is_system, is_active
)
select
  s.id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true, true
from public.schools s
where not exists (
  select 1
  from public.accounts a
  where a.school_id = s.id
    and a.code = 'STUDENT_FEES'
    and lower(a.account_type::text) = 'income'
)
on conflict (school_id, code) do nothing;

-- ------------------------------------------------------------
-- 3) Keep the API grants consistent after the function rewrites
-- ------------------------------------------------------------
grant execute on function public.record_fee_payment(
  uuid, uuid, numeric, text, uuid, date, text, text
) to authenticated;
grant execute on function public.record_fee_payment(
  uuid, uuid, numeric, text, uuid, text, date, text, text, uuid
) to authenticated;
grant execute on function public.record_fee_payment(
  uuid, uuid, numeric, text, uuid, date, text, text, uuid
) to authenticated;
grant execute on function public.record_fee_payment_collection(
  uuid, uuid, numeric, text, uuid, text, date, text, text, jsonb
) to authenticated;
grant execute on function public.record_fee_payment_collection_split(
  uuid, uuid, numeric, text, date, text, text, jsonb, jsonb
) to authenticated;

-- Refresh the PostgREST schema cache.
notify pgrst, 'reload schema';
