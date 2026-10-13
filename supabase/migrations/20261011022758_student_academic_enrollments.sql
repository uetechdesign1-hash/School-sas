-- ============================================================================
-- 20261011022758_student_academic_enrollments.sql
-- ============================================================================
-- Academic Enrollment / Student Historical-Status Table
--
-- Purpose
-- -------
-- Decouples a student's permanent identity from the class/section they
-- belonged to in any given academic year.  A student's CURRENT class
-- (students.class_id) must never be used as the filter for historical
-- fee/receipt/payment/promotion queries.
--
-- Data model
-- ----------
-- public.academic_enrollments
--   id                   uuid  primary key
--   school_id            uuid  -> public.schools.id (ON DELETE CASCADE)
--   student_id           uuid  -> public.students.id (ON DELETE CASCADE)
--   academic_year_id     uuid  -> public.academic_years.id (ON DELETE CASCADE)
--   class_id             uuid  -> public.classes.id (ON DELETE SET NULL)
--   section_id           uuid  -> public.sections.id (ON DELETE SET NULL)
--   enrollment_status    'active' | 'promoted' | 'graduated' | 'transferred'
--                        | 'dropped' | 'completed'
--   promotion_from_enrollment_id
--                        nullable self-reference for promotion chains
--   created_at / updated_at
--   created_by / updated_by
--
-- Constraints
-- -----------
--   UNIQUE (school_id, student_id, academic_year_id)  -- one valid enrollment
--   per student per academic year.
--   class_id / section_id may be NULL when a school-wide fee applies to a
--   class-less structure.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.academic_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  class_id uuid NULL REFERENCES public.classes(id) ON DELETE SET NULL,
  section_id uuid NULL REFERENCES public.sections(id) ON DELETE SET NULL,

  enrollment_status text NOT NULL DEFAULT 'active' CHECK (
    enrollment_status IN (
      'active','promoted','graduated','transferred','dropped','completed'
    )
  ),

  promotion_from_enrollment_id uuid NULL
    REFERENCES public.academic_enrollments(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,

  CONSTRAINT academic_enrollments_school_student_year_unique
    UNIQUE (school_id, student_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS
  idx_academic_enrollments_student_id
  ON public.academic_enrollments (school_id, student_id);

CREATE INDEX IF NOT EXISTS
  idx_academic_enrollments_academic_year_id
  ON public.academic_enrollments (school_id, academic_year_id);

CREATE INDEX IF NOT EXISTS
  idx_academic_enrollments_active_for_year
  ON public.academic_enrollments (school_id, academic_year_id, student_id)
  WHERE enrollment_status = 'active';

CREATE INDEX IF NOT EXISTS
  idx_academic_enrollments_current_student_year
  ON public.academic_enrollments (school_id, student_id, academic_year_id)
  WHERE enrollment_status = 'active';

ALTER TABLE public.academic_enrollments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
-- Any authenticated user belonging to the school can read the school's
-- historical enrollments.  Writes are restricted to the promotion,
-- restoration and administration RPCs which re-check the same condition.
DROP POLICY IF EXISTS academic_enrollments_school_policy ON public.academic_enrollments;

CREATE POLICY academic_enrollments_school_policy
  ON public.academic_enrollments
  FOR ALL
  USING (school_id = public.current_school_id())
  WITH CHECK (school_id = public.current_school_id());

-- Allow the platform super-admin to read any school's enrollment records.
DROP POLICY IF EXISTS academic_enrollments_super_admin_policy ON public.academic_enrollments;

CREATE POLICY academic_enrollments_super_admin_policy
  ON public.academic_enrollments
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

-- Allow owners/admins to manage enrollments for their school.
DROP POLICY IF EXISTS academic_enrollments_owner_admin_policy ON public.academic_enrollments;

CREATE POLICY academic_enrollments_owner_admin_policy
  ON public.academic_enrollments
  FOR ALL
  USING (
    school_id IN (
      SELECT su.school_id
      FROM public.school_users su
      WHERE su.user_id = auth.uid()
        AND su.is_active = true
        AND lower(su.role) IN ('owner','admin','principal','school_admin')
    )
  )
  WITH CHECK (
    school_id IN (
      SELECT su.school_id
      FROM public.school_users su
      WHERE su.user_id = auth.uid()
        AND su.is_active = true
        AND lower(su.role) IN ('owner','admin','principal','school_admin')
    )
  );

grant all on table public.academic_enrollments to authenticated;
grant all on table public.academic_enrollments to service_role;
