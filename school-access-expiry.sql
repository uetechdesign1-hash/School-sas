-- SchoolFlow school subscription access control
-- Run this in Supabase SQL Editor after installing the application files.

CREATE OR REPLACE FUNCTION public.school_access_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.platform_role = 'super_admin'
        AND up.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.school_users su
      JOIN public.schools s
        ON s.id = su.school_id
      WHERE su.user_id = auth.uid()
        AND su.is_active = true
        AND COALESCE(s.status, 'active') <> 'suspended'
        AND (
          s.expires_on IS NULL
          OR s.expires_on >= CURRENT_DATE
        )
    );
$$;

REVOKE ALL ON FUNCTION public.school_access_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.school_access_allowed() TO authenticated;
