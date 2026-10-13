-- Keep the PostgREST RPC parameter order aligned with the browser callers.
-- The implementation remains the previously authorized student-first
-- function; this public wrapper exposes actor first, then student.
DO $migration$
BEGIN
  IF to_regprocedure(
    'public.assign_student_mandatory_fees_impl(uuid,uuid)'
  ) IS NULL THEN
    IF to_regprocedure(
      'public.assign_student_mandatory_fees(uuid,uuid)'
    ) IS NULL THEN
      RAISE EXCEPTION
        'assign_student_mandatory_fees is missing; apply the admission fee assignment migration first.';
    END IF;

    EXECUTE 'ALTER FUNCTION public.assign_student_mandatory_fees(uuid, uuid) RENAME TO assign_student_mandatory_fees_impl';
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.assign_student_mandatory_fees(
  p_actor_user_id uuid,
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT public.assign_student_mandatory_fees_impl(
    p_student_id,
    p_actor_user_id
  );
$function$;

REVOKE ALL ON FUNCTION public.assign_student_mandatory_fees(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_student_mandatory_fees(uuid, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
