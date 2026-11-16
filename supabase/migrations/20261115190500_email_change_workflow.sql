ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email text;

CREATE TABLE IF NOT EXISTS public.auth_email_change_requests (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_email text NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_email_change_requests_email_unique
  ON public.auth_email_change_requests (lower(requested_email));

ALTER TABLE public.auth_email_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_email_change_requests FROM anon, authenticated;
GRANT SELECT ON public.auth_email_change_requests TO authenticated;

DROP POLICY IF EXISTS auth_email_change_requests_read_own
  ON public.auth_email_change_requests;
CREATE POLICY auth_email_change_requests_read_own
  ON public.auth_email_change_requests
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.update_principal_email(p_new_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_new_email text := lower(btrim(coalesce(p_new_email, '')));
  v_current_email text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.'
      USING ERRCODE = '42501';
  END IF;

  IF v_new_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.school_users
    WHERE user_id = v_actor_id
      AND is_active = true
      AND lower(role) = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only a school principal can request this email change.'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(email)
  INTO v_current_email
  FROM auth.users
  WHERE id = v_actor_id;

  IF v_current_email IS NULL THEN
    RAISE EXCEPTION 'Your login account could not be found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_new_email = v_current_email THEN
    RAISE EXCEPTION 'Enter an email address different from your current one.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = v_new_email
      AND id <> v_actor_id
  ) THEN
    RAISE EXCEPTION 'That email address is already in use.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.auth_email_change_requests (
    user_id,
    requested_email,
    requested_by
  )
  VALUES (v_actor_id, v_new_email, v_actor_id)
  ON CONFLICT (user_id) DO UPDATE
    SET requested_email = EXCLUDED.requested_email,
        requested_by = EXCLUDED.requested_by,
        created_at = now();

  RETURN jsonb_build_object(
    'status', 'pending_confirmation',
    'email', v_new_email
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_staff_email_by_principal(
  p_staff_id uuid,
  p_new_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_new_email text := lower(nullif(btrim(coalesce(p_new_email, '')), ''));
  v_staff public.staff%ROWTYPE;
  v_current_email text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_staff
  FROM public.staff AS staff_member
  WHERE staff_member.id = p_staff_id
    AND EXISTS (
      SELECT 1
      FROM public.school_users AS membership
      WHERE membership.user_id = v_actor_id
        AND membership.school_id = staff_member.school_id
        AND membership.is_active = true
        AND lower(membership.role) = 'owner'
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member was not found or you are not authorized.'
      USING ERRCODE = '42501';
  END IF;

  IF v_staff.user_id IS NULL THEN
    IF v_new_email IS NOT NULL
      AND v_new_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Enter a valid email address.'
        USING ERRCODE = '22023';
    END IF;

    IF v_new_email IS NOT NULL AND EXISTS (
      SELECT 1
      FROM auth.users
      WHERE lower(email) = v_new_email
    ) THEN
      RAISE EXCEPTION 'That email address is already in use.'
        USING ERRCODE = '23505';
    END IF;

    IF v_new_email IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.staff
      WHERE school_id = v_staff.school_id
        AND id <> p_staff_id
        AND lower(email) = v_new_email
    ) THEN
      RAISE EXCEPTION 'Another staff member already uses that email.'
        USING ERRCODE = '23505';
    END IF;

    UPDATE public.staff
    SET email = v_new_email
    WHERE id = p_staff_id;

    RETURN jsonb_build_object('status', 'updated', 'email', v_new_email);
  END IF;

  IF v_new_email IS NULL
    OR v_new_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A valid email is required for a linked login.'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(email)
  INTO v_current_email
  FROM auth.users
  WHERE id = v_staff.user_id;

  IF v_current_email IS NULL THEN
    RAISE EXCEPTION 'The staff login account could not be found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_new_email = v_current_email THEN
    RAISE EXCEPTION 'Enter an email address different from the current login.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = v_new_email
      AND id <> v_staff.user_id
  ) THEN
    RAISE EXCEPTION 'That email address is already in use.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.auth_email_change_requests (
    user_id,
    requested_email,
    requested_by
  )
  VALUES (v_staff.user_id, v_new_email, v_actor_id)
  ON CONFLICT (user_id) DO UPDATE
    SET requested_email = EXCLUDED.requested_email,
        requested_by = EXCLUDED.requested_by,
        created_at = now();

  RETURN jsonb_build_object(
    'status', 'pending_confirmation',
    'email', v_new_email
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_principal_email_by_super_admin(
  p_school_id uuid,
  p_new_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_new_email text := lower(btrim(coalesce(p_new_email, '')));
  v_target_user_id uuid;
  v_current_email text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.'
      USING ERRCODE = '42501';
  END IF;

  IF v_new_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = v_actor_id
      AND platform_role = 'super_admin'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Super Admin access is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id
  INTO v_target_user_id
  FROM public.school_users
  WHERE school_id = p_school_id
    AND lower(role) = 'owner'
    AND is_active = true
  ORDER BY created_at
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'No active principal login was found for this school.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT lower(email)
  INTO v_current_email
  FROM auth.users
  WHERE id = v_target_user_id;

  IF v_current_email IS NULL THEN
    RAISE EXCEPTION 'The principal login account could not be found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_new_email = v_current_email THEN
    RAISE EXCEPTION 'Enter an email address different from the current one.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = v_new_email
      AND id <> v_target_user_id
  ) THEN
    RAISE EXCEPTION 'That email address is already in use.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.auth_email_change_requests (
    user_id,
    requested_email,
    requested_by
  )
  VALUES (v_target_user_id, v_new_email, v_actor_id)
  ON CONFLICT (user_id) DO UPDATE
    SET requested_email = EXCLUDED.requested_email,
        requested_by = EXCLUDED.requested_by,
        created_at = now();

  RETURN jsonb_build_object(
    'status', 'pending_confirmation',
    'email', v_new_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_principal_email(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_staff_email_by_principal(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_principal_email_by_super_admin(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_principal_email(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff_email_by_principal(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_principal_email_by_super_admin(uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_auth_email_to_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.user_profiles
  SET email = NEW.email
  WHERE id = NEW.id
    AND email IS DISTINCT FROM NEW.email;

  UPDATE public.staff
  SET email = NEW.email
  WHERE user_id = NEW.id
    AND email IS DISTINCT FROM NEW.email;

  DELETE FROM public.auth_email_change_requests
  WHERE user_id = NEW.id
    AND lower(requested_email) = lower(NEW.email);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  SELECT email
  INTO NEW.email
  FROM auth.users
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_staff_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    SELECT email
    INTO NEW.email
    FROM auth.users
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_auth_email_to_profiles()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_staff_email_from_auth()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS auth_user_email_sync
  ON auth.users;
CREATE TRIGGER auth_user_email_sync
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_auth_email_to_profiles();

DROP TRIGGER IF EXISTS user_profile_email_sync
  ON public.user_profiles;
CREATE TRIGGER user_profile_email_sync
  BEFORE INSERT OR UPDATE OF email ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_from_auth();

DROP TRIGGER IF EXISTS staff_email_sync
  ON public.staff;
CREATE TRIGGER staff_email_sync
  BEFORE INSERT OR UPDATE OF email, user_id ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_staff_email_from_auth();

UPDATE public.user_profiles AS profile
SET email = auth_user.email
FROM auth.users AS auth_user
WHERE auth_user.id = profile.id
  AND profile.email IS DISTINCT FROM auth_user.email;

UPDATE public.staff AS staff_member
SET email = auth_user.email
FROM auth.users AS auth_user
WHERE auth_user.id = staff_member.user_id
  AND staff_member.email IS DISTINCT FROM auth_user.email;

CREATE OR REPLACE VIEW public.staff_email_status
WITH (security_invoker = true)
AS
SELECT
  staff_member.id AS staff_id,
  staff_member.user_id,
  staff_member.email AS staff_email,
  profile.email AS profile_email,
  CASE
    WHEN nullif(btrim(staff_member.email), '') IS NULL
      OR nullif(btrim(profile.email), '') IS NULL
      THEN 'NO_EMAIL'
    WHEN lower(btrim(staff_member.email)) = lower(btrim(profile.email))
      THEN 'SYNCED'
    ELSE 'MISMATCH'
  END AS status
FROM public.staff AS staff_member
LEFT JOIN public.user_profiles AS profile
  ON profile.id = staff_member.user_id;
