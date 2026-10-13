-- ============================================================================
-- 20261011023100_academic_enrollment_backfill.sql
-- ============================================================================
-- Safe backfill of academic_enrollments from RELIABLE historical sources.
--
-- Rules:
--   * Current-year rows come from the students table (confident: this IS the
--     student's live class/section for their current academic year).
--   * Older-year rows are created ONLY when evidence exists (a non-cancelled
--     fee bill for that student in that year).  class_id stays NULL because
--     the class cannot be recovered confidently - these rows are reported so
--     an administrator can supply the mapping.  We never fabricate past
--     classes, fees, receipts or payments.
--   * Nothing is deleted; every statement is idempotent.
-- ============================================================================

-- Provenance column so admins can see where each enrollment came from.
ALTER TABLE public.academic_enrollments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- ---------------------------------------------------------------------------
-- 1) Current-year enrollments straight from the students table.
-- ---------------------------------------------------------------------------
INSERT INTO public.academic_enrollments (
  school_id, student_id, academic_year_id, class_id, section_id,
  enrollment_status, source
)
SELECT
  st.school_id,
  st.id,
  st.academic_year_id,
  st.class_id,
  st.section_id,
  CASE st.status
    WHEN 'transferred' THEN 'transferred'
    WHEN 'completed'   THEN 'completed'
    WHEN 'alumni'      THEN 'completed'
    ELSE 'active'
  END,
  'students_current'
FROM public.students st
WHERE st.academic_year_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.academic_enrollments ae
    WHERE ae.school_id = st.school_id
      AND ae.student_id = st.id
      AND ae.academic_year_id = st.academic_year_id
  )
ON CONFLICT (school_id, student_id, academic_year_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Evidence-based rows for earlier years (class unknown -> NULL).
-- ---------------------------------------------------------------------------
INSERT INTO public.academic_enrollments (
  school_id, student_id, academic_year_id, class_id, section_id,
  enrollment_status, source
)
SELECT DISTINCT
  fb.school_id,
  fb.student_id,
  fb.academic_year_id,
  NULL,
  NULL,
  'promoted',
  'fee_bill_evidence'
FROM public.fee_bills fb
JOIN public.students st ON st.id = fb.student_id
WHERE fb.academic_year_id IS NOT NULL
  AND coalesce(fb.status, 'unpaid') <> 'cancelled'
  AND (st.academic_year_id IS NULL
       OR fb.academic_year_id <> st.academic_year_id)
  AND NOT EXISTS (
    SELECT 1
    FROM public.academic_enrollments ae
    WHERE ae.school_id = fb.school_id
      AND ae.student_id = fb.student_id
      AND ae.academic_year_id = fb.academic_year_id
  )
ON CONFLICT (school_id, student_id, academic_year_id) DO NOTHING;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.academic_enrollments
  WHERE class_id IS NULL;
  RAISE NOTICE 'academic_enrollments backfill complete; % row(s) need class mapping.', v_count;
END;
$$;
