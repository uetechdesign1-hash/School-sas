-- DRAFT ONLY. Do not apply until caller inventory, onboarding cutover, Edge
-- deployment, and service-role/maintenance compatibility have been approved.
-- This file is intentionally outside supabase/migrations.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.guard_school_modules_change()') IS NULL
     OR to_regprocedure('public.create_school_with_owner(text,text,text,text)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'schools'
         AND t.tgname = 'schools_guard_enabled_modules'
         AND NOT t.tgisinternal
         AND t.tgenabled IN ('O', 'A')
         AND t.tgfoid = to_regprocedure('public.guard_school_modules_change()')
     )
  THEN
    RAISE EXCEPTION 'Expected school creation RPC and enabled module guard trigger are missing.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_school_modules_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.enabled_modules IS NOT DISTINCT FROM OLD.enabled_modules THEN
    RETURN NEW;
  END IF;

  IF v_actor IS NULL
     OR auth.role() IS DISTINCT FROM 'authenticated'
     OR NOT EXISTS (
       SELECT 1
       FROM public.user_profiles up
       WHERE up.id = v_actor
         AND up.platform_role = 'super_admin'
         AND up.is_active = true
     )
  THEN
    RAISE EXCEPTION 'Only an authenticated active Super Admin may create a school or change its modules.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- This is a breaking cutover for the checked-in onboarding page and any
-- external RPC callers. Confirm all callers and replace onboarding first.
REVOKE EXECUTE ON FUNCTION public.create_school_with_owner(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
