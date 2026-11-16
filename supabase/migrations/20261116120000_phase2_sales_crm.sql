-- Phase 2 / 04 - Sales team, school ownership with permanent original
-- attribution, leads/CRM, activity log and the safe provisioning job ledger
-- used for Supabase Auth invitations.

-- ---------------------------------------------------------------------------
-- Sales representatives (profile extension of user_profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users (id),
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  mobile text NOT NULL CHECK (btrim(mobile) <> ''),
  address text,
  employee_id text,
  joining_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'pending_account'
    CHECK (status IN ('pending_account', 'active', 'inactive')),
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_representatives_linked_when_active CHECK (
    status = 'pending_account' OR user_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_representatives_email_key
  ON public.sales_representatives (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS sales_representatives_employee_id_key
  ON public.sales_representatives (lower(employee_id))
  WHERE employee_id IS NOT NULL;

DROP TRIGGER IF EXISTS sales_representatives_updated_at ON public.sales_representatives;
CREATE TRIGGER sales_representatives_updated_at
  BEFORE UPDATE ON public.sales_representatives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS sales_representatives_audit ON public.sales_representatives;
CREATE TRIGGER sales_representatives_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_representatives
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- Link, status and identity columns change only through the RPCs.
CREATE OR REPLACE FUNCTION public.sales_representatives_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sales representatives are deactivated, never deleted.'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.created_by IS DISTINCT FROM OLD.created_by)
     AND current_setting('app.sales_rep_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Representative status, login link and email are managed through dedicated functions.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_representatives_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_representatives_guard ON public.sales_representatives;
CREATE TRIGGER sales_representatives_guard
  BEFORE UPDATE OR DELETE ON public.sales_representatives
  FOR EACH ROW EXECUTE FUNCTION public.sales_representatives_guard();

CREATE OR REPLACE FUNCTION public.is_active_sales_rep()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles up
      JOIN public.sales_representatives sr ON sr.user_id = up.id
      WHERE up.id = auth.uid()
        AND up.platform_role::text = 'sales_rep'
        AND up.is_active = true
        AND sr.status = 'active'
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_sales_rep() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_sales_rep() TO authenticated;

-- A representative's school always carries an agreement, an owner record and
-- an owner-provisioning job; those are created together by create_school_sale,
-- so a direct INSERT by a representative is refused.
CREATE OR REPLACE FUNCTION public.schools_require_sale_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_super_admin()
     AND public.is_active_sales_rep()
     AND current_setting('app.school_sale_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Sales representatives create schools only through the sales workflow.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.schools_require_sale_workflow()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schools_require_sale_workflow ON public.schools;
CREATE TRIGGER schools_require_sale_workflow
  BEFORE INSERT ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.schools_require_sale_workflow();

-- ---------------------------------------------------------------------------
-- Provisioning jobs: durable, resumable Auth account workflow
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('sales_rep', 'school_owner')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'auth_created', 'completed', 'failed', 'cancelled')),
  subject_id uuid NOT NULL,
  target_email text NOT NULL CHECK (target_email = lower(btrim(target_email))),
  display_name text,
  auth_user_id uuid,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  last_error text,
  locked_until timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT business_provisioning_jobs_idem_key UNIQUE (idempotency_key),
  CONSTRAINT business_provisioning_jobs_auth_link CHECK (
    status NOT IN ('auth_created', 'completed') OR auth_user_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_provisioning_jobs_one_open
  ON public.business_provisioning_jobs (job_type, subject_id)
  WHERE status IN ('pending', 'auth_created', 'failed');

CREATE INDEX IF NOT EXISTS business_provisioning_jobs_status_idx
  ON public.business_provisioning_jobs (status, updated_at);

DROP TRIGGER IF EXISTS business_provisioning_jobs_updated_at
  ON public.business_provisioning_jobs;
CREATE TRIGGER business_provisioning_jobs_updated_at
  BEFORE UPDATE ON public.business_provisioning_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS business_provisioning_jobs_audit
  ON public.business_provisioning_jobs;
CREATE TRIGGER business_provisioning_jobs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.business_provisioning_jobs
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- ---------------------------------------------------------------------------
-- School ownership: original attribution is permanent, current owner moves
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_sales_ownership (
  school_id uuid PRIMARY KEY REFERENCES public.schools (id) ON DELETE RESTRICT,
  original_acquisition_rep_id uuid REFERENCES public.sales_representatives (user_id),
  current_rep_id uuid REFERENCES public.sales_representatives (user_id),
  acquired_by uuid NOT NULL REFERENCES auth.users (id),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS school_sales_ownership_current_idx
  ON public.school_sales_ownership (current_rep_id);
CREATE INDEX IF NOT EXISTS school_sales_ownership_original_idx
  ON public.school_sales_ownership (original_acquisition_rep_id);

CREATE TABLE IF NOT EXISTS public.school_sales_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  rep_user_id uuid REFERENCES public.sales_representatives (user_id),
  previous_rep_user_id uuid REFERENCES public.sales_representatives (user_id),
  assignment_type text NOT NULL
    CHECK (assignment_type IN ('original_acquisition', 'reassignment', 'unassignment')),
  reason text,
  assigned_by uuid NOT NULL REFERENCES auth.users (id),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  CONSTRAINT school_sales_assignments_period CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS school_sales_assignments_one_open
  ON public.school_sales_assignments (school_id)
  WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS school_sales_assignments_school_idx
  ON public.school_sales_assignments (school_id, effective_from DESC);

CREATE OR REPLACE FUNCTION public.school_sales_ownership_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'School ownership history cannot be deleted.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.original_acquisition_rep_id IS DISTINCT FROM OLD.original_acquisition_rep_id
     OR NEW.acquired_by IS DISTINCT FROM OLD.acquired_by
     OR NEW.acquired_at IS DISTINCT FROM OLD.acquired_at
  THEN
    RAISE EXCEPTION 'The original acquisition attribution is permanent.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.current_rep_id IS DISTINCT FROM OLD.current_rep_id
     AND current_setting('app.ownership_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Use the reassignment function to change school ownership.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_sales_ownership_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_sales_ownership_guard ON public.school_sales_ownership;
CREATE TRIGGER school_sales_ownership_guard
  BEFORE UPDATE OR DELETE ON public.school_sales_ownership
  FOR EACH ROW EXECUTE FUNCTION public.school_sales_ownership_guard();

DROP TRIGGER IF EXISTS school_sales_ownership_updated_at ON public.school_sales_ownership;
CREATE TRIGGER school_sales_ownership_updated_at
  BEFORE UPDATE ON public.school_sales_ownership
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS school_sales_ownership_reject_internal
  ON public.school_sales_ownership;
CREATE TRIGGER school_sales_ownership_reject_internal
  BEFORE INSERT OR UPDATE OF school_id ON public.school_sales_ownership
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_sales_ownership_audit ON public.school_sales_ownership;
CREATE TRIGGER school_sales_ownership_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_sales_ownership
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

CREATE OR REPLACE FUNCTION public.school_sales_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['effective_to'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assignment history cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to)
  THEN
    RAISE EXCEPTION 'Assignment history is immutable except for closing the open period.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_sales_assignments_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_sales_assignments_guard ON public.school_sales_assignments;
CREATE TRIGGER school_sales_assignments_guard
  BEFORE UPDATE OR DELETE ON public.school_sales_assignments
  FOR EACH ROW EXECUTE FUNCTION public.school_sales_assignments_guard();

DROP TRIGGER IF EXISTS school_sales_assignments_reject_internal
  ON public.school_sales_assignments;
CREATE TRIGGER school_sales_assignments_reject_internal
  BEFORE INSERT OR UPDATE OF school_id ON public.school_sales_assignments
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_sales_assignments_audit ON public.school_sales_assignments;
CREATE TRIGGER school_sales_assignments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_sales_assignments
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

CREATE OR REPLACE FUNCTION public.rep_owns_school(p_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.is_active_sales_rep()
    AND EXISTS (
      SELECT 1
      FROM public.school_sales_ownership o
      WHERE o.school_id = p_school_id
        AND o.current_rep_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.rep_owns_school(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_owns_school(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Leads / CRM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name text NOT NULL CHECK (btrim(school_name) <> ''),
  contact_person text,
  mobile text,
  email text,
  address text,
  district text,
  state text,
  estimated_student_strength integer CHECK (estimated_student_strength IS NULL OR estimated_student_strength >= 0),
  estimated_staff_strength integer CHECK (estimated_staff_strength IS NULL OR estimated_staff_strength >= 0),
  notes text,
  next_follow_up_date date,
  assigned_rep_id uuid NOT NULL REFERENCES public.sales_representatives (user_id),
  status text NOT NULL DEFAULT 'new_lead'
    CHECK (status IN (
      'new_lead', 'contacted', 'meeting_scheduled', 'negotiation',
      'proposal_sent', 'initial_mou', 'converted', 'not_interested'
    )),
  converted_school_id uuid UNIQUE REFERENCES public.schools (id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users (id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_leads_converted_has_school CHECK (
    (status = 'converted') = (converted_school_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS school_leads_rep_idx
  ON public.school_leads (assigned_rep_id, status);
CREATE INDEX IF NOT EXISTS school_leads_follow_up_idx
  ON public.school_leads (next_follow_up_date)
  WHERE next_follow_up_date IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_leads_open_duplicate_key
  ON public.school_leads (assigned_rep_id, lower(btrim(school_name)), lower(COALESCE(btrim(district), '')))
  WHERE status NOT IN ('converted', 'not_interested');

DROP TRIGGER IF EXISTS school_leads_updated_at ON public.school_leads;
CREATE TRIGGER school_leads_updated_at
  BEFORE UPDATE ON public.school_leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS school_leads_audit ON public.school_leads;
CREATE TRIGGER school_leads_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_leads
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- A representative can only create leads for themselves; only Super Admin may
-- assign a lead to somebody else. Conversion is performed by the sale RPC.
CREATE OR REPLACE FUNCTION public.school_leads_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_super_admin() THEN
      NEW.assigned_rep_id := auth.uid();
    END IF;
    NEW.created_by := auth.uid();
    NEW.status := CASE WHEN NEW.status = 'converted' THEN 'new_lead' ELSE NEW.status END;
    NEW.converted_school_id := NULL;
    IF NOT EXISTS (
      SELECT 1 FROM public.sales_representatives sr
      WHERE sr.user_id = NEW.assigned_rep_id AND sr.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Leads can only be assigned to an active sales representative.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'converted' THEN
    RAISE EXCEPTION 'A converted lead is read-only.' USING ERRCODE = '42501';
  END IF;

  IF (NEW.assigned_rep_id IS DISTINCT FROM OLD.assigned_rep_id
      OR NEW.converted_school_id IS DISTINCT FROM OLD.converted_school_id
      OR NEW.status = 'converted')
     AND current_setting('app.lead_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Lead assignment and conversion are managed through dedicated functions.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_leads_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_leads_guard ON public.school_leads;
CREATE TRIGGER school_leads_guard
  BEFORE INSERT OR UPDATE ON public.school_leads
  FOR EACH ROW EXECUTE FUNCTION public.school_leads_guard();

CREATE TABLE IF NOT EXISTS public.sales_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_user_id uuid NOT NULL REFERENCES public.sales_representatives (user_id),
  lead_id uuid REFERENCES public.school_leads (id) ON DELETE RESTRICT,
  school_id uuid REFERENCES public.schools (id) ON DELETE RESTRICT,
  activity_type text NOT NULL
    CHECK (activity_type IN ('visit', 'call', 'meeting', 'email', 'proposal', 'follow_up', 'other')),
  notes text,
  activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_activity_logs_subject CHECK (lead_id IS NOT NULL OR school_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS sales_activity_logs_rep_idx
  ON public.sales_activity_logs (rep_user_id, activity_at DESC);

CREATE OR REPLACE FUNCTION public.sales_activity_logs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Activity logs are append-only.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin() THEN
    NEW.rep_user_id := auth.uid();
    IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.school_leads l
      WHERE l.id = NEW.lead_id AND l.assigned_rep_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'You can only log activity for your own leads.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.school_id IS NOT NULL AND NOT public.rep_owns_school(NEW.school_id) THEN
      RAISE EXCEPTION 'You can only log activity for your own schools.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_activity_logs_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_activity_logs_guard ON public.sales_activity_logs;
CREATE TRIGGER sales_activity_logs_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.sales_activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.sales_activity_logs_guard();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_provisioning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_sales_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_sales_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sales_representatives, public.business_provisioning_jobs,
  public.school_sales_ownership, public.school_sales_assignments,
  public.school_leads, public.sales_activity_logs
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.sales_representatives TO authenticated;
GRANT UPDATE (full_name, mobile, address, employee_id, joining_date)
  ON public.sales_representatives TO authenticated;
GRANT SELECT ON public.business_provisioning_jobs TO authenticated;
GRANT SELECT ON public.school_sales_ownership TO authenticated;
GRANT SELECT ON public.school_sales_assignments TO authenticated;

GRANT SELECT ON public.school_leads TO authenticated;
GRANT INSERT (
  school_name, contact_person, mobile, email, address, district, state,
  estimated_student_strength, estimated_staff_strength, notes,
  next_follow_up_date, assigned_rep_id, status
) ON public.school_leads TO authenticated;
GRANT UPDATE (
  school_name, contact_person, mobile, email, address, district, state,
  estimated_student_strength, estimated_staff_strength, notes,
  next_follow_up_date, status
) ON public.school_leads TO authenticated;

GRANT SELECT ON public.sales_activity_logs TO authenticated;
GRANT INSERT (rep_user_id, lead_id, school_id, activity_type, notes, activity_at)
  ON public.sales_activity_logs TO authenticated;

DROP POLICY IF EXISTS sales_representatives_select ON public.sales_representatives;
CREATE POLICY sales_representatives_select ON public.sales_representatives
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS sales_representatives_super_admin_update
  ON public.sales_representatives;
CREATE POLICY sales_representatives_super_admin_update ON public.sales_representatives
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS business_provisioning_jobs_select
  ON public.business_provisioning_jobs;
CREATE POLICY business_provisioning_jobs_select ON public.business_provisioning_jobs
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (job_type = 'school_owner' AND created_by = auth.uid()
        AND public.rep_owns_school(subject_id))
  );

DROP POLICY IF EXISTS school_sales_ownership_select ON public.school_sales_ownership;
CREATE POLICY school_sales_ownership_select ON public.school_sales_ownership
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (current_rep_id = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS school_sales_assignments_select ON public.school_sales_assignments;
CREATE POLICY school_sales_assignments_select ON public.school_sales_assignments
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));

DROP POLICY IF EXISTS school_leads_select ON public.school_leads;
CREATE POLICY school_leads_select ON public.school_leads
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (assigned_rep_id = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS school_leads_insert ON public.school_leads;
CREATE POLICY school_leads_insert ON public.school_leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.is_active_sales_rep() AND assigned_rep_id = auth.uid())
  );

DROP POLICY IF EXISTS school_leads_update ON public.school_leads;
CREATE POLICY school_leads_update ON public.school_leads
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (assigned_rep_id = auth.uid() AND public.is_active_sales_rep())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (assigned_rep_id = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS sales_activity_logs_select ON public.sales_activity_logs;
CREATE POLICY sales_activity_logs_select ON public.sales_activity_logs
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (rep_user_id = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS sales_activity_logs_insert ON public.sales_activity_logs;
CREATE POLICY sales_activity_logs_insert ON public.sales_activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.is_active_sales_rep());

-- A sales representative can see the schools they currently own. Combined with
-- the existing schools policies this is purely additive read access.
DROP POLICY IF EXISTS schools_sales_rep_select ON public.schools;
CREATE POLICY schools_sales_rep_select ON public.schools
  FOR SELECT TO authenticated
  USING (public.rep_owns_school(id));

-- Hide the internal platform-company tenant from every API reader. The
-- accounting functions reach it through SECURITY DEFINER code only.
DROP POLICY IF EXISTS schools_hide_platform_internal ON public.schools;
CREATE POLICY schools_hide_platform_internal ON public.schools
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (NOT is_platform_internal);

DROP POLICY IF EXISTS schools_hide_platform_internal_anon ON public.schools;
CREATE POLICY schools_hide_platform_internal_anon ON public.schools
  AS RESTRICTIVE
  FOR SELECT TO anon
  USING (NOT is_platform_internal);
