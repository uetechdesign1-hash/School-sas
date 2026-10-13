-- Allow school administrators to create legacy student_fee_bills only for
-- students belonging to a school they actively administer. The security-
-- definer predicate avoids relying on the caller's visibility into students
-- while keeping tenant and role checks in the RLS policy.
CREATE OR REPLACE FUNCTION public.student_fee_bill_insert_allowed(
  p_school_id uuid,
  p_student_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p_school_id IS NOT NULL
    AND p_student_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.students st
      JOIN public.school_users su
        ON su.school_id = st.school_id
      WHERE st.id = p_student_id
        AND st.school_id = p_school_id
        AND su.user_id = auth.uid()
        AND su.is_active = true
        AND lower(coalesce(su.role, '')) IN (
          'owner', 'admin', 'principal', 'school_admin'
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.student_fee_bill_insert_allowed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_fee_bill_insert_allowed(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS student_fee_bills_school_admin_insert
  ON public.student_fee_bills;
CREATE POLICY student_fee_bills_school_admin_insert
  ON public.student_fee_bills
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.student_fee_bill_insert_allowed(school_id, student_id)
  );

NOTIFY pgrst, 'reload schema';
