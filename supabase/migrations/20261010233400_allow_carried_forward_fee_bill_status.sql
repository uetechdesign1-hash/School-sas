DO $$
DECLARE
  v_status_check text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid)
    INTO v_status_check
    FROM pg_constraint
   WHERE conrelid = 'public.fee_bills'::regclass
     AND conname = 'fee_bills_status_check'
     AND contype = 'c';

  IF v_status_check IS NULL THEN
    RAISE EXCEPTION 'Expected fee_bills_status_check constraint was not found.';
  END IF;

  IF v_status_check ILIKE '%carried_forward%' THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.fee_bills DROP CONSTRAINT fee_bills_status_check';

  EXECUTE format(
    'ALTER TABLE public.fee_bills ADD CONSTRAINT fee_bills_status_check CHECK ((%s) OR status = %L)',
    v_status_check,
    'carried_forward'
  );
END;
$$;
