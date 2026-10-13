-- ============================================================================
-- 20261011022900_fee_carry_forwards_schema.sql
-- ============================================================================
-- Extend fee_carry_forwards so each outstanding balance is carried forward
-- exactly once and category-level history is preserved.
--
-- Existing columns (confirmed from the UI):
--   school_id, student_id, source_bill_id, target_bill_id, amount, status,
--   notes, to_academic_year_id, created_at, updated_at
--
-- Added columns:
--   source_academic_year_id  - the academic year the arrear originated in
--   fee_category_id          - the fee category the arrear belongs to
--   target_fee_bill_item_id  - the bill item created on the target bill
--   paid_amount              - how much of this carry-forward has been paid
--
-- Idempotency:
--   One carry-forward row per (school, student, source_bill,
--   to_academic_year, fee_category).  Enforced by a partial unique index
--   that ignores voided rows.
-- ============================================================================

ALTER TABLE public.fee_carry_forwards
  ADD COLUMN IF NOT EXISTS source_academic_year_id uuid
    REFERENCES public.academic_years(id) ON DELETE SET NULL;

ALTER TABLE public.fee_carry_forwards
  ADD COLUMN IF NOT EXISTS fee_category_id uuid
    REFERENCES public.fee_categories(id) ON DELETE SET NULL;

ALTER TABLE public.fee_carry_forwards
  ADD COLUMN IF NOT EXISTS target_fee_bill_item_id uuid
    REFERENCES public.fee_bill_items(id) ON DELETE SET NULL;

ALTER TABLE public.fee_carry_forwards
  ADD COLUMN IF NOT EXISTS paid_amount numeric(18,2) NOT NULL DEFAULT 0;

ALTER TABLE public.fee_carry_forwards
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill source_academic_year_id from the source bill where possible.
UPDATE public.fee_carry_forwards cf
SET source_academic_year_id = fb.academic_year_id
FROM public.fee_bills fb
WHERE cf.source_bill_id = fb.id
  AND cf.source_academic_year_id IS NULL
  AND fb.academic_year_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Idempotency index: one carry-forward per (school, student, source bill,
-- target year, category).  'void' rows are excluded so a re-run can create
-- a fresh entry after a void.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS
  fee_carry_forwards_unique_active
  ON public.fee_carry_forwards (
    school_id, student_id, source_bill_id, to_academic_year_id,
    coalesce(fee_category_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status <> 'void';

CREATE INDEX IF NOT EXISTS
  idx_fee_carry_forwards_student_target
  ON public.fee_carry_forwards (school_id, student_id, to_academic_year_id);

CREATE INDEX IF NOT EXISTS
  idx_fee_carry_forwards_status
  ON public.fee_carry_forwards (school_id, status);

-- ---------------------------------------------------------------------------
-- Status values: 'pending' | 'applied' | 'settled' | 'void'
-- ---------------------------------------------------------------------------
DO $migration$
DECLARE
  v_check text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid)
    INTO v_check
    FROM pg_constraint
   WHERE conrelid = 'public.fee_carry_forwards'::regclass
     AND conname = 'fee_carry_forwards_status_check'
     AND contype = 'c';

  IF v_check IS NULL THEN
    -- No check constraint yet; add one.
    ALTER TABLE public.fee_carry_forwards
      ADD CONSTRAINT fee_carry_forwards_status_check
      CHECK (status IN ('pending','applied','settled','void'));
  ELSIF v_check NOT ILIKE '%settled%' THEN
    EXECUTE 'ALTER TABLE public.fee_carry_forwards DROP CONSTRAINT fee_carry_forwards_status_check';
    EXECUTE 'ALTER TABLE public.fee_carry_forwards ADD CONSTRAINT fee_carry_forwards_status_check CHECK (status IN (''pending'',''applied'',''settled'',''void''))';
  END IF;
END;
$migration$;

-- ---------------------------------------------------------------------------
-- RLS: school-scoped, mirroring the accounting tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.fee_carry_forwards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fee_carry_forwards_school_policy ON public.fee_carry_forwards;
CREATE POLICY fee_carry_forwards_school_policy
  ON public.fee_carry_forwards
  FOR ALL
  USING (school_id = public.current_school_id())
  WITH CHECK (school_id = public.current_school_id());

DROP POLICY IF EXISTS fee_carry_forwards_super_admin_policy ON public.fee_carry_forwards;
CREATE POLICY fee_carry_forwards_super_admin_policy
  ON public.fee_carry_forwards
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.platform_role = 'super_admin'
        AND up.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.platform_role = 'super_admin'
        AND up.is_active = true
    )
  );

GRANT ALL ON TABLE public.fee_carry_forwards TO authenticated;
GRANT ALL ON TABLE public.fee_carry_forwards TO service_role;

NOTIFY pgrst, 'reload schema';
