CREATE TABLE IF NOT EXISTS public.transport_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('driver', 'parent')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, school_id, role)
);

CREATE INDEX IF NOT EXISTS transport_users_school_id_idx
  ON public.transport_users (school_id);
CREATE INDEX IF NOT EXISTS transport_users_user_id_idx
  ON public.transport_users (user_id);

ALTER TABLE public.transport_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_users_select_own ON public.transport_users;
CREATE POLICY transport_users_select_own
  ON public.transport_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.transport_users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.transport_users TO authenticated;
GRANT ALL ON TABLE public.transport_users TO service_role;
