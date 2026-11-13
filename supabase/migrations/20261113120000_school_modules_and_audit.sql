ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS enabled_modules text[] NOT NULL DEFAULT '{fees,payroll}';

UPDATE public.schools
SET enabled_modules = ARRAY['fees', 'payroll']::text[]
WHERE enabled_modules IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_enabled_modules_check'
      AND conrelid = 'public.schools'::regclass
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_enabled_modules_check
      CHECK (
        cardinality(enabled_modules) >= 1
        AND enabled_modules <@ ARRAY['fees', 'payroll', 'transport']::text[]
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_has_module(
  p_school_id uuid,
  p_module text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.schools s
      WHERE s.id = p_school_id
        AND p_module = ANY(s.enabled_modules)
        AND (
          EXISTS (
            SELECT 1
            FROM public.school_users su
            WHERE su.user_id = auth.uid()
              AND su.school_id = s.id
              AND su.is_active = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND up.platform_role = 'super_admin'
              AND up.is_active = true
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.school_has_module(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_has_module(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_school_modules_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_modules_changed boolean;
  v_old_modules jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_modules_changed :=
      NEW.enabled_modules IS DISTINCT FROM ARRAY['fees', 'payroll']::text[];
    v_old_modules := NULL;
  ELSE
    v_modules_changed :=
      NEW.enabled_modules IS DISTINCT FROM OLD.enabled_modules;
    v_old_modules := to_jsonb(OLD.enabled_modules);
  END IF;

  IF NOT v_modules_changed THEN
    RETURN NEW;
  END IF;

  IF v_actor_id IS NOT NULL
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
    v_actor_id,
    'enabled_modules_changed',
    'school',
    NEW.id,
    v_old_modules,
    to_jsonb(NEW.enabled_modules),
    now()
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_school_modules_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schools_audit_enabled_modules_change
  ON public.schools;
CREATE TRIGGER schools_audit_enabled_modules_change
  BEFORE INSERT OR UPDATE OF enabled_modules
  ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_school_modules_change();
