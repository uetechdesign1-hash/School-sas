DROP TRIGGER IF EXISTS schools_audit_enabled_modules_change
  ON public.schools;
DROP TRIGGER IF EXISTS schools_guard_enabled_modules_change
  ON public.schools;

DROP FUNCTION IF EXISTS public.audit_school_modules_change();
DROP FUNCTION IF EXISTS public.guard_school_modules_change();
DROP FUNCTION IF EXISTS public.school_has_module(uuid, text);

ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_enabled_modules_check;

ALTER TABLE public.schools
  DROP COLUMN IF EXISTS enabled_modules;
