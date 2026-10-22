create or replace function public.get_super_admin_student_counts()
returns table (
  school_id uuid,
  active_student_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and platform_role = 'super_admin'
      and is_active = true
  ) then
    raise exception 'Active Super Administrator access is required.';
  end if;

  return query
  select
    schools.id,
    count(students.id)::bigint
  from public.schools
  left join public.students
    on students.school_id = schools.id
    and lower(coalesce(students.status, 'active')) = 'active'
  group by schools.id;
end;
$$;

revoke all on function public.get_super_admin_student_counts() from public;
grant execute on function public.get_super_admin_student_counts() to authenticated;
