-- Remove fee items from a bill (unlock/uncheck assigned fees)
-- This allows removing fee categories that were assigned by mistake
-- The outstanding amount will be reduced accordingly

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
  v_new_paid numeric(18,2);
  v_journal_id uuid;
  v_fee_income uuid;
BEGIN
  -- Authorization check
  IF v_school_id IS NULL
     OR NOT public.has_school_role(ARRAY['owner','admin','accountant']) THEN
    RAISE EXCEPTION 'User is not authorized to remove fee items';
  END IF;

  -- Validate bill exists and belongs to school
  SELECT * INTO v_bill FROM public.fee_bills
   WHERE id = p_bill_id AND school_id = v_school_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fee bill not found';
  END IF;

  -- Cannot remove items from cancelled bills
  IF v_bill.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot remove items from a cancelled bill';
  END IF;

  -- Validate all items belong to this bill and check for payments
  FOR v_item IN SELECT * FROM public.fee_bill_items
    WHERE id = ANY(p_fee_bill_item_ids) AND bill_id = p_bill_id AND school_id = v_school_id
  LOOP
    -- Check if there are any payments allocated to this item
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_amount
    FROM public.fee_payment_allocations
    WHERE fee_bill_item_id = v_item.id AND school_id = v_school_id;

    IF v_paid_amount > 0 THEN
      RAISE EXCEPTION 'Cannot remove fee category "%" - it has payments allocated (₹%)', v_item.description, v_paid_amount;
    END IF;

    v_total_removed_amount := v_total_removed_amount + COALESCE(v_item.net_amount, v_item.amount, 0);
    v_removed_count := v_removed_count + 1;
  END LOOP;

  IF v_removed_count = 0 THEN
    RAISE EXCEPTION 'No valid fee items found to remove';
  END IF;

  -- Delete the fee bill items
  DELETE FROM public.fee_bill_items
  WHERE id = ANY(p_fee_bill_item_ids) AND bill_id = p_bill_id AND school_id = v_school_id;

  -- Recalculate bill totals
  v_new_paid := GREATEST(COALESCE(v_bill.paid_amount, 0) - v_total_removed_amount, 0);
  UPDATE public.fee_bills SET
    total_amount = GREATEST(COALESCE(total_amount, 0) - v_total_removed_amount, 0),
    paid_amount = v_new_paid,
    balance_amount = GREATEST(COALESCE(total_amount, 0) - v_new_paid, 0),
    status = CASE 
      WHEN GREATEST(COALESCE(total_amount, 0) - v_new_paid, 0) <= 0.005 THEN 'paid'
      WHEN v_new_paid > 0 THEN 'partial' 
      ELSE 'unpaid' 
    END,
    updated_at = now()
  WHERE id = p_bill_id AND school_id = v_school_id;

  RETURN jsonb_build_object(
    'success', true,
    'removed_count', v_removed_count,
    'removed_amount', v_total_removed_amount,
    'bill_id', p_bill_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.remove_fee_items_from_bill(uuid, uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';