-- Split the module permission check from auditing: audit rows must be inserted
-- after the school exists to satisfy audit_logs_school_id_fkey.

DROP TRIGGER IF EXISTS schools_audit_enabled_modules_change
  ON public.schools;

CREATE OR REPLACE FUNCTION public.guard_school_modules_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_modules_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_modules_changed :=
      NEW.enabled_modules IS DISTINCT FROM ARRAY['fees', 'payroll']::text[];
  ELSE
    v_modules_changed :=
      NEW.enabled_modules IS DISTINCT FROM OLD.enabled_modules;
  END IF;

  IF v_modules_changed
    AND v_actor_id IS NOT NULL
    AND auth.role() IS DISTINCT FROM 'service_role'
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = v_actor_id
        AND up.platform_role = 'super_admin'
        AND up.is_active = true
    )
  THEN
    RAISE EXCEPTION 'Only an active Super Admin may change enabled_modules.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_school_modules_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_school_modules_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_modules jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.enabled_modules IS NOT DISTINCT FROM ARRAY['fees', 'payroll']::text[] THEN
      RETURN NULL;
    END IF;
    v_old_modules := NULL;
  ELSE
    IF NEW.enabled_modules IS NOT DISTINCT FROM OLD.enabled_modules THEN
      RETURN NULL;
    END IF;
    v_old_modules := to_jsonb(OLD.enabled_modules);
  END IF;

  INSERT INTO public.audit_logs (
    school_id,
    user_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value,
    created_at
  )
  VALUES (
    NEW.id,
    auth.uid(),
    'enabled_modules_changed',
    'school',
    NEW.id,
    v_old_modules,
    to_jsonb(NEW.enabled_modules),
    now()
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_school_modules_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schools_guard_enabled_modules_change
  ON public.schools;
CREATE TRIGGER schools_guard_enabled_modules_change
  BEFORE INSERT OR UPDATE OF enabled_modules
  ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_school_modules_change();

CREATE TRIGGER schools_audit_enabled_modules_change
  AFTER INSERT OR UPDATE OF enabled_modules
  ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_school_modules_change();
