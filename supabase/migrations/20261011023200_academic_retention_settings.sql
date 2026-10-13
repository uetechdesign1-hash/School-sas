-- ============================================================================
-- 20261011023200_academic_retention_settings.sql
-- ============================================================================
-- Academic Data Retention for Super Admin / school owners.
--
-- * Retention in academic years: 2, 3, 5, 10 or indefinite (0).
-- * Archiving is SOFT: academic_years gains archived_at / archived_by /
--   archive_reason.  Students, fee bills, receipts, payments, allocations,
--   journal entries and audit logs are NEVER deleted because a retention
--   period elapsed.  Legal/financial retention is respected.
-- * Every archive / restore / setting change is written to
--   accounting_audit_log so retention behaviour is auditable.
-- * RLS + server-side checks restrict access to owner/admins and super admin.
-- ============================================================================

ALTER TABLE public.academic_years
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archive_reason text;

CREATE INDEX IF NOT EXISTS idx_academic_years_archived
  ON public.academic_years (school_id, archived_at);

-- retention_years = 0 means indefinite retention.
CREATE TABLE IF NOT EXISTS public.academic_retention_settings (
  school_id uuid PRIMARY KEY
    REFERENCES public.schools(id) ON DELETE CASCADE,
  retention_years integer NOT NULL DEFAULT 0
    CHECK (retention_years IN (0, 2, 3, 5, 10)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.academic_retention_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_retention_settings_school_policy
  ON public.academic_retention_settings;
CREATE POLICY academic_retention_settings_school_policy
  ON public.academic_retention_settings
  FOR ALL
  USING (school_id = public.current_school_id())
  WITH CHECK (school_id = public.current_school_id());

DROP POLICY IF EXISTS academic_retention_settings_super_admin_policy
  ON public.academic_retention_settings;
CREATE POLICY academic_retention_settings_super_admin_policy
  ON public.academic_retention_settings
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

GRANT ALL ON TABLE public.academic_retention_settings TO authenticated;
GRANT ALL ON TABLE public.academic_retention_settings TO service_role;

CREATE OR REPLACE FUNCTION public.academic_retention_actor_allowed(
  p_school_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.platform_role = 'super_admin'
      AND up.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.school_users su
    WHERE su.school_id = p_school_id
      AND su.user_id = auth.uid()
      AND su.is_active = true
      AND lower(coalesce(su.role, '')) IN ('owner','admin','principal','school_admin')
  );
$$;

REVOKE ALL ON FUNCTION public.academic_retention_actor_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academic_retention_actor_allowed(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_academic_retention_setting(
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_setting public.academic_retention_settings%ROWTYPE;
BEGIN
  IF NOT public.academic_retention_actor_allowed(p_school_id) THEN
    RAISE EXCEPTION 'You are not allowed to view retention settings for this school.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_setting
  FROM public.academic_retention_settings
  WHERE school_id = p_school_id;

  RETURN jsonb_build_object(
    'school_id', p_school_id,
    'retention_years', coalesce(v_setting.retention_years, 0),
    'indefinite', coalesce(v_setting.retention_years, 0) = 0,
    'updated_at', v_setting.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_academic_retention_setting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_academic_retention_setting(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_academic_retention_setting(
  p_school_id uuid,
  p_retention_years integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.academic_retention_actor_allowed(p_school_id) THEN
    RAISE EXCEPTION 'You are not allowed to change retention settings for this school.'
      USING ERRCODE = '42501';
  END IF;

  IF p_retention_years NOT IN (0, 2, 3, 5, 10) THEN
    RAISE EXCEPTION 'Retention must be 2, 3, 5, 10 years or indefinite (0).';
  END IF;

  INSERT INTO public.academic_retention_settings (school_id, retention_years, updated_by)
  VALUES (p_school_id, p_retention_years, auth.uid())
  ON CONFLICT (school_id) DO UPDATE
    SET retention_years = EXCLUDED.retention_years,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;

  INSERT INTO public.accounting_audit_log (
    school_id, entity_type, entity_id, action, actor_id, payload
  ) VALUES (
    p_school_id, 'academic_retention_setting', p_school_id, 'update',
    auth.uid(),
    jsonb_build_object('retention_years', p_retention_years)
  );

  RETURN public.get_academic_retention_setting(p_school_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_academic_retention_setting(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_academic_retention_setting(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Archive academic years whose end_date + retention has elapsed.
-- SOFT archive only: no student, bill, receipt, payment, allocation or
-- journal row is deleted.  The current year is never archived.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_expired_academic_years(
  p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_retention integer;
  v_year public.academic_years%ROWTYPE;
  v_archived jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.academic_retention_actor_allowed(p_school_id) THEN
    RAISE EXCEPTION 'You are not allowed to archive academic years for this school.'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(retention_years, 0) INTO v_retention
  FROM public.academic_retention_settings
  WHERE school_id = p_school_id;

  v_retention := coalesce(v_retention, 0);

  IF v_retention = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'retention_years', 0,
      'archived', '[]'::jsonb,
      'message', 'Indefinite retention: nothing is archived.'
    );
  END IF;

  FOR v_year IN
    SELECT * FROM public.academic_years
    WHERE school_id = p_school_id
      AND archived_at IS NULL
      AND coalesce(is_current, false) = false
      AND end_date IS NOT NULL
      AND end_date < (current_date - make_interval(years => v_retention))
    FOR UPDATE
  LOOP
    UPDATE public.academic_years
    SET archived_at = now(),
        archived_by = auth.uid(),
        archive_reason = 'Retention policy: ' || v_retention || ' year(s)'
    WHERE id = v_year.id;

    INSERT INTO public.accounting_audit_log (
      school_id, entity_type, entity_id, action, actor_id, payload
    ) VALUES (
      p_school_id, 'academic_year', v_year.id, 'archive', auth.uid(),
      jsonb_build_object(
        'academic_year_name', v_year.name,
        'end_date', v_year.end_date,
        'retention_years', v_retention
      )
    );

    v_archived := v_archived || jsonb_build_array(jsonb_build_object(
      'id', v_year.id,
      'name', v_year.name
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'retention_years', v_retention,
    'archived', v_archived,
    'archived_count', jsonb_array_length(v_archived)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_expired_academic_years(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_expired_academic_years(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Restore an archived academic year (authorized access to archived records).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_academic_year(
  p_school_id uuid,
  p_academic_year_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_year public.academic_years%ROWTYPE;
BEGIN
  IF NOT public.academic_retention_actor_allowed(p_school_id) THEN
    RAISE EXCEPTION 'You are not allowed to restore academic years for this school.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.academic_years
  SET archived_at = NULL,
      archived_by = NULL,
      archive_reason = NULL
  WHERE id = p_academic_year_id
    AND school_id = p_school_id
    AND archived_at IS NOT NULL
  RETURNING * INTO v_year;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Archived academic year was not found in this school.';
  END IF;

  INSERT INTO public.accounting_audit_log (
    school_id, entity_type, entity_id, action, actor_id, payload
  ) VALUES (
    p_school_id, 'academic_year', p_academic_year_id, 'restore', auth.uid(),
    jsonb_build_object('academic_year_name', v_year.name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_year.id,
    'name', v_year.name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_academic_year(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_academic_year(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

