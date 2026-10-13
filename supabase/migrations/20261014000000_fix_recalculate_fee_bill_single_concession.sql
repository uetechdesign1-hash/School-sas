-- Fix double concession deduction (fee 10000 + concession 1000 showed 8000).
-- Canonical rule (single deduction):
--   fee_bill_items.discount holds the concession per category
--   fee_bills.discount  = SUM(fee_bill_items.discount)
--   fee_bills.subtotal  = SUM(fee_bill_items.amount)
--   fee_bills.total_amount = subtotal - discount + late_fee
--   fee_concessions is the ledger; it must NOT be subtracted again on top
--   of the item discounts.
CREATE OR REPLACE FUNCTION public.recalculate_fee_bill(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_subtotal numeric(18,2) := 0;
  v_discount numeric(18,2) := 0;
  v_late_fee numeric(18,2) := 0;
  v_total numeric(18,2) := 0;
  v_paid numeric(18,2) := 0;
  v_balance numeric(18,2) := 0;
  v_status text;
  v_existing_status text;
BEGIN
  SELECT
    coalesce(sum(amount), 0),
    coalesce(sum(discount), 0)
  INTO v_subtotal, v_discount
  FROM public.fee_bill_items
  WHERE bill_id = p_bill_id;

  SELECT coalesce(late_fee, 0), coalesce(paid_amount, 0), status
  INTO v_late_fee, v_paid, v_existing_status
  FROM public.fee_bills
  WHERE id = p_bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fee bill was not found: %', p_bill_id;
  END IF;

  v_discount := greatest(v_discount, 0);
  v_total := greatest(v_subtotal - v_discount + coalesce(v_late_fee, 0), 0);
  -- Paid can never exceed the (reduced) total; cap it so balance never
  -- goes negative after a concession.
  v_paid := least(greatest(v_paid, 0), v_total);
  v_balance := greatest(v_total - v_paid, 0);

  IF v_balance <= 0.005 THEN
    v_status := 'paid';
  ELSIF v_paid > 0.005 THEN
    v_status := 'partial';
  ELSE
    v_status := 'unpaid';
  END IF;

  -- Preserve terminal states set by other flows.
  IF v_existing_status IN ('cancelled', 'carried_forward') THEN
    v_status := v_existing_status;
  END IF;

  UPDATE public.fee_bills
  SET subtotal = v_subtotal,
      discount = v_discount,
      total_amount = v_total,
      paid_amount = v_paid,
      balance_amount = v_balance,
      status = v_status,
      updated_at = now()
  WHERE id = p_bill_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_fee_bill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_fee_bill(uuid) TO authenticated, service_role;

-- Repair bills that were double-deducted (discount counted once in the
-- item net_amount and again in the header). Re-derive every open bill
-- header strictly from its items.
UPDATE public.fee_bills b
SET subtotal = s.subtotal,
    discount = s.discount,
    total_amount = greatest(s.subtotal - s.discount + coalesce(b.late_fee, 0), 0),
    paid_amount = least(greatest(coalesce(b.paid_amount, 0), 0), greatest(s.subtotal - s.discount + coalesce(b.late_fee, 0), 0)),
    balance_amount = greatest(greatest(s.subtotal - s.discount + coalesce(b.late_fee, 0), 0) - least(greatest(coalesce(b.paid_amount, 0), 0), greatest(s.subtotal - s.discount + coalesce(b.late_fee, 0), 0)), 0),
    updated_at = now()
FROM (
  SELECT bill_id,
         coalesce(sum(amount), 0) AS subtotal,
         coalesce(sum(discount), 0) AS discount
  FROM public.fee_bill_items
  GROUP BY bill_id
) s
WHERE s.bill_id = b.id
  AND b.status NOT IN ('cancelled', 'carried_forward');

NOTIFY pgrst, 'reload schema';
