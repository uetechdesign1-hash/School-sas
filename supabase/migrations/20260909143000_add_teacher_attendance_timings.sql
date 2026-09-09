create table if not exists public.staff_attendance_timings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  work_start_time time not null,
  work_end_time time not null,
  grace_period_minutes integer not null default 10
    check (grace_period_minutes >= 0),
  minimum_work_minutes integer not null default 450
    check (minimum_work_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, staff_id)
);

create index if not exists staff_attendance_timings_staff_idx
  on public.staff_attendance_timings (school_id, staff_id);

alter table public.staff_attendance_timings enable row level security;

drop policy if exists "School admins manage teacher attendance timings"
  on public.staff_attendance_timings;

create policy "School admins manage teacher attendance timings"
on public.staff_attendance_timings
for all
using (
  exists (
    select 1
    from public.school_users
    where school_users.school_id = staff_attendance_timings.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.school_users
    where school_users.school_id = staff_attendance_timings.school_id
      and school_users.user_id = auth.uid()
      and school_users.is_active = true
      and school_users.role in ('owner', 'admin')
  )
);

create or replace function public.touch_staff_attendance_timing()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists staff_attendance_timings_updated_at
  on public.staff_attendance_timings;

create trigger staff_attendance_timings_updated_at
before update on public.staff_attendance_timings
for each row execute function public.touch_staff_attendance_timing();

comment on table public.staff_attendance_timings is
  'Optional per-teacher attendance timing override. Missing rows use staff_attendance_settings.';

create or replace function public.apply_staff_attendance_timing()
returns trigger
language plpgsql
as $$
declare
  timing record;
  check_in_local timestamp;
  check_out_local timestamp;
  expected_start timestamp;
  expected_end timestamp;
begin
  select
    coalesce(override.work_start_time, universal.work_start_time) as work_start_time,
    coalesce(override.work_end_time, universal.work_end_time) as work_end_time,
    coalesce(override.grace_period_minutes, universal.grace_period_minutes) as grace_period_minutes,
    coalesce(override.minimum_work_minutes, universal.minimum_work_minutes) as minimum_work_minutes
  into timing
  from public.staff_attendance_settings universal
  left join public.staff_attendance_timings override
    on override.school_id = new.school_id
   and override.staff_id = new.staff_id
  where universal.school_id = new.school_id;

  if timing.work_start_time is null then
    return new;
  end if;

  check_in_local := new.check_in_at at time zone 'Asia/Kolkata';
  check_out_local := new.check_out_at at time zone 'Asia/Kolkata';
  expected_start := new.attendance_date + timing.work_start_time;
  expected_end := new.attendance_date + timing.work_end_time;

  if new.check_in_at is not null then
    new.is_late := check_in_local > expected_start +
      make_interval(mins => timing.grace_period_minutes);
    if new.status <> 'absent' then
      new.status := case when new.is_late then 'late' else 'present' end;
    end if;
  end if;

  if new.check_in_at is not null and new.check_out_at is not null then
    new.working_minutes := greatest(
      0,
      floor(extract(epoch from (new.check_out_at - new.check_in_at)) / 60)
    )::integer;
    new.is_early_checkout := check_out_local < expected_end;
    if new.status <> 'absent' and
       new.working_minutes < timing.minimum_work_minutes then
      new.status := 'half_day';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_attendance_apply_timing
  on public.staff_attendance;

create trigger staff_attendance_apply_timing
before insert or update of check_in_at, check_out_at on public.staff_attendance
for each row execute function public.apply_staff_attendance_timing();
