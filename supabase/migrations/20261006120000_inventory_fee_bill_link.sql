-- Link issued resale inventory to the student bill line that carries its charge.
ALTER TABLE public.fee_bill_items
  ADD COLUMN IF NOT EXISTS inventory_sale_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.fee_bill_items'::regclass
      AND conname = 'fee_bill_items_inventory_sale_id_fkey'
  ) THEN
    ALTER TABLE public.fee_bill_items
      ADD CONSTRAINT fee_bill_items_inventory_sale_id_fkey
      FOREIGN KEY (inventory_sale_id)
      REFERENCES public.student_book_sales(id)
      ON DELETE SET NULL;
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS fee_bill_items_inventory_sale_id_idx
  ON public.fee_bill_items (inventory_sale_id)
  WHERE inventory_sale_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.fee_payment_inventory_reclassifications (
  payment_id uuid PRIMARY KEY REFERENCES public.fee_payments(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  amount numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fee_payment_inventory_reclassifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.reclassify_inventory_fee_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_school_id uuid := public.get_my_school_id();
  v_payment public.fee_payments%ROWTYPE;
  v_inventory_amount numeric(18,2);
  v_journal_id uuid;
  v_fee_account_id uuid;
  v_receivable_account_id uuid;
  v_fee_credit numeric(18,2);
  v_other_credit numeric(18,2);
BEGIN
  IF v_school_id IS NULL OR NOT public.has_school_role(ARRAY['owner','admin','accountant']) THEN
    RAISE EXCEPTION 'User is not authorized to reclassify inventory payments';
  END IF;

  SELECT * INTO v_payment
  FROM public.fee_payments
  WHERE id = p_payment_id AND school_id = v_school_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee payment was not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.fee_payment_inventory_reclassifications
    WHERE payment_id = p_payment_id AND school_id = v_school_id
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_reclassified', true);
  END IF;

  SELECT round(coalesce(sum(a.amount), 0), 2) INTO v_inventory_amount
  FROM public.fee_payment_allocations a
  JOIN public.fee_bill_items i
    ON i.id = a.fee_bill_item_id AND i.school_id = a.school_id
  WHERE a.payment_id = p_payment_id
    AND a.school_id = v_school_id
    AND i.inventory_sale_id IS NOT NULL;

  IF v_inventory_amount <= 0 THEN
    RETURN jsonb_build_object('success', true, 'reclassified_amount', 0);
  END IF;

  SELECT id INTO v_journal_id
  FROM public.journal_entries
  WHERE school_id = v_school_id
    AND reference_type = 'fee_payment'
    AND reference_id = p_payment_id::text
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_journal_id IS NULL THEN RAISE EXCEPTION 'Fee payment journal was not found'; END IF;

  SELECT id INTO v_fee_account_id FROM public.accounts
  WHERE school_id = v_school_id AND code = 'STUDENT_FEES'
    AND lower(account_type::text) = 'income' LIMIT 1;
  SELECT id INTO v_receivable_account_id FROM public.accounts
  WHERE school_id = v_school_id AND code = 'OTHER_RECEIVABLES'
    AND lower(account_type::text) = 'receivable' AND is_active = true LIMIT 1;
  IF v_fee_account_id IS NULL OR v_receivable_account_id IS NULL THEN
    RAISE EXCEPTION 'Student Fees or Other Receivables account is not configured';
  END IF;

  SELECT coalesce(sum(credit), 0) INTO v_fee_credit
  FROM public.journal_lines
  WHERE school_id = v_school_id AND journal_entry_id = v_journal_id
    AND account_id = v_fee_account_id AND debit = 0;
  IF v_fee_credit + 0.005 < v_inventory_amount THEN
    RAISE EXCEPTION 'Inventory payment exceeds the Student Fees credit available to reclassify';
  END IF;

  IF v_fee_credit - v_inventory_amount <= 0.005 THEN
    DELETE FROM public.journal_lines
    WHERE school_id = v_school_id AND journal_entry_id = v_journal_id
      AND account_id = v_fee_account_id AND debit = 0;
  ELSE
    UPDATE public.journal_lines
    SET credit = round(v_fee_credit - v_inventory_amount, 2)
    WHERE school_id = v_school_id AND journal_entry_id = v_journal_id
      AND account_id = v_fee_account_id AND debit = 0;
  END IF;

  SELECT coalesce(sum(credit), 0) INTO v_other_credit
  FROM public.journal_lines
  WHERE school_id = v_school_id AND journal_entry_id = v_journal_id
    AND account_id = v_receivable_account_id AND debit = 0;
  IF v_other_credit > 0 THEN
    UPDATE public.journal_lines
    SET credit = round(v_other_credit + v_inventory_amount, 2),
        description = 'Inventory sale balance collected'
    WHERE school_id = v_school_id AND journal_entry_id = v_journal_id
      AND account_id = v_receivable_account_id AND debit = 0;
  ELSE
    INSERT INTO public.journal_lines (
      school_id, journal_entry_id, account_id, debit, credit, description
    ) VALUES (
      v_school_id, v_journal_id, v_receivable_account_id, 0,
      v_inventory_amount, 'Inventory sale balance collected'
    );
  END IF;

  PERFORM public.validate_journal_entry_balance(v_journal_id);
  INSERT INTO public.fee_payment_inventory_reclassifications(payment_id, school_id, amount)
  VALUES (p_payment_id, v_school_id, v_inventory_amount);
  RETURN jsonb_build_object('success', true, 'reclassified_amount', v_inventory_amount);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reclassify_inventory_fee_payment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
