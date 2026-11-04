-- ============================================================
-- Add attendance_model setting to school_attendance_settings
-- ============================================================
-- Supports two attendance models per school:
--   'actual_calendar' : Use actual days in month (28/29/30/31)
--   '30_day_fixed'    : Every month treated as exactly 30 days
--
-- Default is 'actual_calendar' for backward compatibility.
-- ============================================================

-- 1) Ensure the school_attendance_settings table exists
CREATE TABLE IF NOT EXISTS public.school_attendance_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  weekly_off_day integer not null default 0,
  attendance_model text not null default 'actual_calendar',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_weekly_off_day check (weekly_off_day >= 0 and weekly_off_day <= 6),
  constraint chk_attendance_model check (attendance_model in ('actual_calendar', '30_day_fixed'))
);

-- 2) Add attendance_model column if table already existed without it
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'school_attendance_settings'
    AND column_name = 'attendance_model';

  IF v_count = 0 THEN
    ALTER TABLE public.school_attendance_settings
      ADD COLUMN attendance_model TEXT NOT NULL DEFAULT 'actual_calendar';

    ALTER TABLE public.school_attendance_settings
      ADD CONSTRAINT chk_attendance_model
      CHECK (attendance_model IN ('actual_calendar', '30_day_fixed'));
  ELSE
    UPDATE public.school_attendance_settings
    SET attendance_model = 'actual_calendar'
    WHERE attendance_model IS NULL OR attendance_model = '';
  END IF;
END
$$;

-- 3) Enable RLS and add policies
alter table public.school_attendance_settings enable row level security;

drop policy if exists "School members can view attendance settings" on public.school_attendance_settings;
create policy "School members can view attendance settings"
on public.school_attendance_settings
for select
using (
  exists (
    select 1 from public.school_users su
    where su.school_id = school_attendance_settings.school_id
      and su.user_id = auth.uid()
      and su.is_active = true
  )
);

drop policy if exists "School admins can manage attendance settings" on public.school_attendance_settings;
create policy "School admins can manage attendance settings"
on public.school_attendance_settings
for all
using (
  exists (
    select 1 from public.school_users su
    where su.school_id = school_attendance_settings.school_id
      and su.user_id = auth.uid()
      and su.is_active = true
      and su.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1 from public.school_users su
    where su.school_id = school_attendance_settings.school_id
      and su.user_id = auth.uid()
      and su.is_active = true
      and su.role in ('owner', 'admin')
  )
);

-- 4) RPC: Get school attendance model
CREATE OR REPLACE FUNCTION public.get_school_attendance_model(p_school_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_model TEXT;
BEGIN
  SELECT attendance_model
  INTO v_model
  FROM public.school_attendance_settings
  WHERE school_id = p_school_id;

  IF v_model IS NULL THEN
    RETURN 'actual_calendar';
  END IF;

  RETURN v_model;
END;
$$;

-- 5) RPC: Update school attendance model
CREATE OR REPLACE FUNCTION public.update_school_attendance_model(
  p_school_id uuid,
  p_model TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_valid_models TEXT[] := ARRAY['actual_calendar', '30_day_fixed'];
  v_existing TEXT;
BEGIN
  IF NOT (p_model = ANY(v_valid_models)) THEN
    RAISE EXCEPTION 'Invalid attendance_model. Allowed values: actual_calendar, 30_day_fixed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.school_users su
    WHERE su.school_id = p_school_id
      AND su.user_id = auth.uid()
      AND su.is_active = true
      AND su.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only school owners and admins can update attendance model.';
  END IF;

  INSERT INTO public.school_attendance_settings (school_id, attendance_model)
  VALUES (p_school_id, p_model)
  ON CONFLICT (school_id)
  DO UPDATE SET attendance_model = EXCLUDED.attendance_model, updated_at = now();

  SELECT attendance_model
  INTO v_existing
  FROM public.school_attendance_settings
  WHERE school_id = p_school_id;

  RETURN v_existing;
END;
$$;

COMMENT ON FUNCTION public.get_school_attendance_model IS 'Get the attendance model for a school (actual_calendar or 30_day_fixed).';
COMMENT ON FUNCTION public.update_school_attendance_model IS 'Update the attendance model for a school. Only owner/admin can call.';

GRANT EXECUTE ON FUNCTION public.get_school_attendance_model TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_school_attendance_model TO authenticated;

-- Also grant direct table access for authenticated users (needed for RLS policies)
GRANT SELECT ON public.school_attendance_settings TO authenticated;
GRANT INSERT, UPDATE ON public.school_attendance_settings TO authenticated;