-- Redeploy: Other Fee edit/remove RPCs (Admin Entry amount adjust + linked pages)
-- Reason: the 20261014150000 edit was made after that migration had already
-- been applied, so Supabase never picked it up -> PostgREST schema cache
-- "Could not find the function public.remove_fee_items_from_bill(...)".
-- This new dated file re-declares both functions + reloads the schema cache.

CREATE OR REPLACE FUNCTION public.remove_fee_items_from_bill(
  p_bill_id uuid,
  p_fee_bill_item_ids uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_school_id uuid := public.get_my_school_id();
  v_bill public.fee_bills%rowtype;
  v_item public.fee_bill_items%rowtype;
  v_removed_count integer := 0;
  v_total_removed_amount numeric(18,2) := 0;
  v_paid_amount numeric(18,2);
BEGIN
  IF v_school_id IS NULL
     OR NOT public.has_school_role(ARRAY['owner','admin','accountant']) THEN
    RAISE EXCEPTION 'User is not authorized to remove fee items';
  END IF;
  SELECT * INTO v_bill FROM public.fee_bills
   WHERE id = p_bill_id AND school_id = v_school_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fee bill not found';
  END IF;
  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot remove items from a cancelled bill';
  END IF;
  FOR v_item IN SELECT * FROM public.fee_bill_items
    WHERE id = ANY(p_fee_bill_item_ids) AND bill_id = p_bill_id AND school_id = v_school_id
  LOOP
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_amount
    FROM public.fee_payment_allocations
    WHERE fee_bill_item_id = v_item.id AND school_id = v_school_id;
    IF v_paid_amount > 0.005 THEN
      RAISE EXCEPTION 'Cannot remove fee entry "%" - it has payments allocated (%)', v_item.description, v_paid_amount;
    END IF;
    v_total_removed_amount := v_total_removed_amount + COALESCE(v_item.net_amount, v_item.amount, 0);
    v_removed_count := v_removed_count + 1;
  END LOOP;
  IF v_removed_count = 0 THEN
    RAISE EXCEPTION 'No valid fee items found to remove';
  END IF;
  DELETE FROM public.fee_bill_items
  WHERE id = ANY(p_fee_bill_item_ids) AND bill_id = p_bill_id AND school_id = v_school_id;
  PERFORM public.recalculate_fee_bill(p_bill_id);
  RETURN jsonb_build_object(
    'success', true,
    'removed_count', v_removed_count,
    'removed_amount', v_total_removed_amount,
    'bill_id', p_bill_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.remove_fee_items_from_bill(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_other_fee_item(
  p_fee_bill_item_id uuid,
  p_description text DEFAULT NULL,
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_school_id uuid := public.get_my_school_id();
  v_item public.fee_bill_items%rowtype;
  v_paid numeric(18,2);
  v_new_description text;
  v_new_amount numeric(18,2);
BEGIN
  IF v_school_id IS NULL
     OR NOT public.has_school_role(ARRAY['owner','admin','accountant']) THEN
    RAISE EXCEPTION 'User is not authorized to edit Other Fee entries';
  END IF;
  SELECT * INTO v_item FROM public.fee_bill_items
   WHERE id = p_fee_bill_item_id AND school_id = v_school_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fee entry not found';
  END IF;
  IF v_item.fee_category_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only Other Fee (Admin Entry) lines can be edited here.';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.fee_payment_allocations
  WHERE fee_bill_item_id = v_item.id AND school_id = v_school_id;
  v_new_description := COALESCE(NULLIF(btrim(COALESCE(p_description, '')), ''), v_item.description);
  IF NULLIF(btrim(v_new_description), '') IS NULL THEN
    RAISE EXCEPTION 'Fee description is required';
  END IF;
  v_new_amount := COALESCE(p_amount, v_item.amount);
  IF v_new_amount IS NULL OR v_new_amount <= 0 THEN
    RAISE EXCEPTION 'Fee amount must be greater than zero';
  END IF;
  IF round(v_new_amount, 2) < round(COALESCE(v_paid, 0), 2) - 0.005 THEN
    RAISE EXCEPTION 'Cannot reduce Other Fee below already-paid amount (%)', v_paid;
  END IF;
  UPDATE public.fee_bill_items SET
    description = v_new_description,
    amount = round(v_new_amount, 2),
    discount = LEAST(COALESCE(discount, 0), round(v_new_amount, 2)),
    net_amount = greatest(round(v_new_amount, 2) - LEAST(COALESCE(discount, 0), round(v_new_amount, 2)), 0),
    updated_at = now()
  WHERE id = v_item.id AND school_id = v_school_id;
  PERFORM public.recalculate_fee_bill(v_item.bill_id);
  RETURN jsonb_build_object(
    'success', true,
    'fee_bill_item_id', v_item.id,
    'bill_id', v_item.bill_id,
    'paid_amount', round(COALESCE(v_paid, 0), 2)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_other_fee_item(uuid, text, numeric) TO authenticated;
NOTIFY pgrst, 'reload schema';
