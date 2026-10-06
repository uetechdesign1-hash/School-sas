alter table public.staff
  add column if not exists attendance_mode text not null default 'online';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.staff'::regclass
      and conname = 'staff_attendance_mode_check'
  ) then
    alter table public.staff
      add constraint staff_attendance_mode_check
      check (attendance_mode in ('online', 'offline'));
  end if;
end;
$$;

create table if not exists public.staff_attendance_offline_syncs (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  attendance_id uuid not null references public.staff_attendance(id) on delete cascade,
  attendance_date date not null,
  action text not null check (action in ('check_in', 'check_out')),
  captured_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision not null,
  distance_meters double precision not null,
  synced_at timestamptz not null default now()
);

create index if not exists staff_attendance_offline_syncs_staff_date_idx
  on public.staff_attendance_offline_syncs (staff_id, captured_at desc);

alter table public.staff_attendance_offline_syncs enable row level security;
revoke all on public.staff_attendance_offline_syncs from anon, authenticated;
grant select, insert, update, delete
  on public.staff_attendance_offline_syncs to service_role;

create or replace function public.sync_staff_offline_attendance(
  p_user_id uuid,
  p_staff_id uuid,
  p_request_id uuid,
  p_action text,
  p_captured_at timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff public.staff%rowtype;
  v_school_timezone text;
  v_settings public.staff_attendance_settings%rowtype;
  v_employee_id uuid;
  v_attendance public.staff_attendance%rowtype;
  v_attendance_id uuid;
  v_distance double precision;
  v_a double precision;
  v_today date;
  v_event_day date;
  v_existing public.staff_attendance_offline_syncs%rowtype;
  v_full_name text;
  v_user_email text;
  v_matching_staff_count integer;
begin
  if p_user_id is null or p_staff_id is null or p_request_id is null then
    raise exception 'Authenticated user, staff profile and request ID are required.';
  end if;
  if p_action is null or p_action not in ('check_in', 'check_out') then
    raise exception 'Offline attendance action is invalid.';
  end if;
  if p_captured_at is null or p_captured_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'The device time is invalid or too far in the future.';
  end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
     or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'A valid GPS location is required.';
  end if;
  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 5000 then
    raise exception 'GPS accuracy is insufficient for offline attendance.';
  end if;

  select email
  into v_user_email
  from auth.users
  where id = p_user_id;

  if not found then
    raise exception 'Authenticated user was not found.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('offline-attendance-request:' || p_request_id::text, 0)
  );

  select *
  into v_existing
  from public.staff_attendance_offline_syncs
  where request_id = p_request_id;

  if found then
    if v_existing.user_id <> p_user_id
       or v_existing.staff_id <> p_staff_id
       or v_existing.action <> p_action
       or v_existing.captured_at <> p_captured_at
       or v_existing.latitude <> p_latitude
       or v_existing.longitude <> p_longitude
       or v_existing.accuracy_meters <> p_accuracy_meters then
      raise exception 'Offline request ID was already used for a different attendance event.';
    end if;
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'attendance_id', v_existing.attendance_id,
      'attendance_date', v_existing.attendance_date,
      'action', v_existing.action,
      'distance_meters', v_existing.distance_meters
    );
  end if;

  select count(*)
  into v_matching_staff_count
  from public.staff s
  where s.status = 'active'
    and s.attendance_mode = 'offline'
    and exists (
      select 1
      from public.school_users su
      where su.school_id = s.school_id
        and su.user_id = p_user_id
        and su.is_active = true
    )
    and (
      s.user_id = p_user_id
      or (
        s.user_id is null
        and v_user_email is not null
        and lower(s.email) = lower(v_user_email)
      )
    )
    and s.id = p_staff_id;

  if v_matching_staff_count <> 1 then
    raise exception 'No unique active staff profile configured for offline attendance was found.';
  end if;

  select s.*
  into v_staff
  from public.staff s
  where s.status = 'active'
    and s.attendance_mode = 'offline'
    and exists (
      select 1
      from public.school_users su
      where su.school_id = s.school_id
        and su.user_id = p_user_id
        and su.is_active = true
    )
    and (
      s.user_id = p_user_id
      or (
        s.user_id is null
        and v_user_email is not null
        and lower(s.email) = lower(v_user_email)
      )
    )
    and s.id = p_staff_id
  order by (s.user_id = p_user_id) desc, s.created_at
  limit 1
  for update;

  if not found then
    raise exception 'No active staff profile configured for offline attendance was found.';
  end if;

  select coalesce(nullif(timezone, ''), 'Asia/Kolkata')
  into v_school_timezone
  from public.schools
  where id = v_staff.school_id;

  if v_school_timezone is null then
    raise exception 'School timezone could not be determined.';
  end if;

  v_today := timezone(v_school_timezone, clock_timestamp())::date;
  v_event_day := timezone(v_school_timezone, p_captured_at)::date;
  if v_event_day <> v_today then
    raise exception 'Offline attendance can only sync before the end of the school day it was captured.';
  end if;

  select *
  into v_settings
  from public.staff_attendance_settings
  where school_id = v_staff.school_id;

  if not found or not v_settings.attendance_enabled then
    raise exception 'Staff attendance is not enabled for this school.';
  end if;
  if not v_settings.gps_required then
    raise exception 'GPS attendance must be enabled to sync offline attendance.';
  end if;
  if v_settings.school_latitude is null
     or v_settings.school_longitude is null
     or v_settings.geofence_radius_meters is null
     or v_settings.geofence_radius_meters <= 0 then
    raise exception 'The school GPS geofence is not configured.';
  end if;
  if p_accuracy_meters > v_settings.geofence_radius_meters then
    raise exception 'GPS accuracy is insufficient for this school geofence.';
  end if;

  v_a :=
    power(sin(radians(p_latitude - v_settings.school_latitude) / 2), 2)
    + cos(radians(v_settings.school_latitude))
    * cos(radians(p_latitude))
    * power(sin(radians(p_longitude - v_settings.school_longitude) / 2), 2);
  v_distance := 2 * 6371000 * atan2(
    sqrt(least(1, greatest(0, v_a))),
    sqrt(least(1, greatest(0, 1 - v_a)))
  );

  if v_distance > v_settings.geofence_radius_meters then
    raise exception 'Saved GPS location is outside the school geofence (% meters away).',
      round(v_distance)::integer;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'offline-attendance-day:' || v_staff.id::text || ':' || v_event_day::text,
      0
    )
  );

  select id
  into v_employee_id
  from public.employees
  where school_id = v_staff.school_id
    and user_id = p_user_id
  limit 1
  for update;

  if v_employee_id is null and v_staff.employee_no is not null then
  select id
  into v_employee_id
  from public.employees
  where school_id = v_staff.school_id
    and employee_code = v_staff.employee_no
  limit 1
  for update;

  if v_employee_id is not null then
    update public.employees
    set user_id = p_user_id
    where id = v_employee_id
      and user_id is null;

    if not found then
      raise exception 'The employee record is already assigned to another login.';
    end if;
  end if;
  end if;

  if v_employee_id is null then
    v_full_name := concat_ws(
      ' ',
      nullif(v_staff.first_name, ''),
      nullif(v_staff.middle_name, ''),
      nullif(v_staff.last_name, '')
    );

    insert into public.employees (
      school_id,
      user_id,
      employee_code,
      name,
      designation,
      joining_date,
      phone,
      email,
      monthly_salary,
      status
    )
    values (
      v_staff.school_id,
      p_user_id,
      v_staff.employee_no,
      coalesce(nullif(v_full_name, ''), v_staff.employee_no, 'Staff'),
      v_staff.designation,
      v_staff.joining_date,
      v_staff.phone,
      v_staff.email,
      0,
      'active'
    )
    returning id into v_employee_id;
  end if;

  select *
  into v_attendance
  from public.staff_attendance
  where staff_id = v_staff.id
    and attendance_date = v_event_day
  limit 1
  for update;

  if p_action = 'check_in' then
    if v_attendance.id is not null and v_attendance.check_in_at is not null then
      raise exception 'A check-in is already recorded for this school day.';
    end if;

    if v_attendance.id is null then
      insert into public.staff_attendance (
        school_id,
        employee_id,
        staff_id,
        attendance_date,
        status,
        marked_by,
        check_in_at,
        check_in_latitude,
        check_in_longitude,
        check_in_accuracy_meters,
        check_in_distance_meters,
        attendance_source,
        updated_at
      )
      values (
        v_staff.school_id,
        v_employee_id,
        v_staff.id,
        v_event_day,
        'present',
        p_user_id,
        p_captured_at,
        p_latitude,
        p_longitude,
        p_accuracy_meters,
        v_distance,
        'gps',
        now()
      )
      returning id into v_attendance_id;
    else
      update public.staff_attendance
      set check_in_at = p_captured_at,
          check_in_latitude = p_latitude,
          check_in_longitude = p_longitude,
          check_in_accuracy_meters = p_accuracy_meters,
          check_in_distance_meters = v_distance,
          attendance_source = 'gps',
          updated_at = now()
      where id = v_attendance.id
      returning id into v_attendance_id;
    end if;
  else
    if v_attendance.id is null or v_attendance.check_in_at is null then
      raise exception 'Check-in must be synced before check-out.';
    end if;
    if v_attendance.check_out_at is not null then
      raise exception 'A check-out is already recorded for this school day.';
    end if;
    if p_captured_at <= v_attendance.check_in_at then
      raise exception 'Check-out time must be later than check-in time.';
    end if;

    update public.staff_attendance
    set check_out_at = p_captured_at,
        check_out_latitude = p_latitude,
        check_out_longitude = p_longitude,
        check_out_accuracy_meters = p_accuracy_meters,
        check_out_distance_meters = v_distance,
        attendance_source = 'gps',
        updated_at = now()
    where id = v_attendance.id
    returning id into v_attendance_id;
  end if;

  insert into public.staff_attendance_offline_syncs (
    request_id,
    user_id,
    school_id,
    staff_id,
    attendance_id,
    attendance_date,
    action,
    captured_at,
    latitude,
    longitude,
    accuracy_meters,
    distance_meters
  )
  values (
    p_request_id,
    p_user_id,
    v_staff.school_id,
    v_staff.id,
    v_attendance_id,
    v_event_day,
    p_action,
    p_captured_at,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    v_distance
  );

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'attendance_id', v_attendance_id,
    'attendance_date', v_event_day,
    'action', p_action,
    'distance_meters', v_distance
  );
end;
$$;

revoke all on function public.sync_staff_offline_attendance(
  uuid, uuid, uuid, text, timestamptz, double precision, double precision, double precision
) from public, anon, authenticated;
grant execute on function public.sync_staff_offline_attendance(
  uuid, uuid, uuid, text, timestamptz, double precision, double precision, double precision
) to service_role;

notify pgrst, 'reload schema';
