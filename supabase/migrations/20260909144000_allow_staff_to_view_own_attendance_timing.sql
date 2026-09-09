drop policy if exists "Staff can view their own attendance timing"
  on public.staff_attendance_timings;

create policy "Staff can view their own attendance timing"
on public.staff_attendance_timings
for select
using (
  exists (
    select 1
    from public.staff
    where staff.id = staff_attendance_timings.staff_id
      and staff.school_id = staff_attendance_timings.school_id
      and staff.user_id = auth.uid()
  )
);
