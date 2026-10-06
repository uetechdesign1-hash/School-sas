-- Delete an individual student and every student-owned record as one
-- database operation. The student delete trigger installed by
-- 20261005130000_student_data_delete_cascade.sql removes rows which carry
-- student_id; cascading foreign keys remove dependent bill/payment/accounting
-- rows as well.
CREATE OR REPLACE FUNCTION public.delete_student_and_owned_records(
  p_student_id uuid,
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_deleted_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.school_users AS school_user
    WHERE school_user.user_id = auth.uid()
      AND school_user.school_id = p_school_id
      AND school_user.is_active = true
      AND lower(school_user.role) = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only an active school Principal can delete a student.';
  END IF;

  DELETE FROM public.students
  WHERE id = p_student_id
    AND school_id = p_school_id
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'Student was not found in this school.';
  END IF;

  RETURN jsonb_build_object('success', true, 'student_id', v_deleted_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_student_and_owned_records(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_student_and_owned_records(uuid, uuid) TO authenticated;

-- Remove one concession, restore the category's remaining concession total,
-- and recalculate the parent bill without touching payment allocations.
CREATE OR REPLACE FUNCTION public.delete_fee_concession_and_recalculate(
  p_school_id uuid,
  p_concession_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_concession public.fee_concessions%rowtype;
  v_category_id uuid;
  v_item public.fee_bill_items%rowtype;
  v_previous_concessions numeric := 0;
  v_remaining_concessions numeric := 0;
  v_base_discount numeric := 0;
  v_next_discount numeric := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.school_users AS school_user
    WHERE school_user.user_id = auth.uid()
      AND school_user.school_id = p_school_id
      AND school_user.is_active = true
  ) THEN
    RAISE EXCEPTION 'You are not an active member of this school.';
  END IF;

  SELECT * INTO v_concession
  FROM public.fee_concessions
  WHERE id = p_concession_id
    AND school_id = p_school_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Concession was not found in this school.';
  END IF;

  v_category_id := v_concession.fee_category_id;
  IF v_category_id IS NULL AND v_concession.notes LIKE '[[fee-category:%' THEN
    v_category_id := split_part(split_part(v_concession.notes, '[[fee-category:', 2), ']]', 1)::uuid;
  END IF;

  IF v_category_id IS NOT NULL THEN
    SELECT * INTO v_item
    FROM public.fee_bill_items
    WHERE school_id = p_school_id
      AND bill_id = v_concession.bill_id
      AND fee_category_id = v_category_id
    ORDER BY id
    LIMIT 1
    FOR UPDATE;

    SELECT coalesce(sum(amount), 0) INTO v_previous_concessions
    FROM public.fee_concessions
    WHERE school_id = p_school_id
      AND bill_id = v_concession.bill_id
      AND (
        fee_category_id = v_category_id
        OR (fee_category_id IS NULL AND notes LIKE ('[[fee-category:' || v_category_id::text || ']]%'))
      );

    SELECT coalesce(sum(amount), 0) INTO v_remaining_concessions
    FROM public.fee_concessions
    WHERE school_id = p_school_id
      AND bill_id = v_concession.bill_id
      AND id <> p_concession_id
      AND (
        fee_category_id = v_category_id
        OR (fee_category_id IS NULL AND notes LIKE ('[[fee-category:' || v_category_id::text || ']]%'))
      );
  END IF;

  DELETE FROM public.fee_concessions
  WHERE id = p_concession_id
    AND school_id = p_school_id;

  IF v_category_id IS NOT NULL AND v_item.id IS NOT NULL THEN
    IF coalesce(v_item.discount, 0) + 0.005 >= v_previous_concessions THEN
      v_base_discount := greatest(0, coalesce(v_item.discount, 0) - v_previous_concessions);
    ELSE
      v_base_discount := coalesce(v_item.discount, 0);
    END IF;
    v_next_discount := v_base_discount + v_remaining_concessions;

    UPDATE public.fee_bill_items
    SET discount = v_next_discount,
        net_amount = greatest(0, coalesce(v_item.amount, 0) - v_next_discount)
    WHERE id = v_item.id
      AND school_id = p_school_id;
  END IF;

  PERFORM public.recalculate_fee_bill(v_concession.bill_id);

  RETURN jsonb_build_object(
    'success', true,
    'bill_id', v_concession.bill_id,
    'fee_category_id', v_category_id,
    'deleted_amount', v_concession.amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_fee_concession_and_recalculate(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_fee_concession_and_recalculate(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
