alter table public.schools
  add column if not exists logo_url text;

create or replace function public.update_school_logo(
  p_school_id uuid,
  p_logo_url text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to update a school logo.';
  end if;

  if p_logo_url is not null and p_logo_url !~ '^https://res\.cloudinary\.com/[A-Za-z0-9_-]+/image/upload/' then
    raise exception 'The school logo must be hosted by Cloudinary.';
  end if;

  if not exists (
    select 1
    from public.school_users su
    where su.school_id = p_school_id
      and su.user_id = auth.uid()
      and su.is_active = true
      and lower(coalesce(su.role, '')) in ('owner', 'admin', 'principal', 'school_admin')
  ) then
    raise exception 'Only an active school owner or administrator can update the school logo.';
  end if;

  update public.schools
  set logo_url = nullif(trim(p_logo_url), '')
  where id = p_school_id;

  if not found then
    raise exception 'School not found.';
  end if;
end;
$$;

revoke all on function public.update_school_logo(uuid, text) from public;
grant execute on function public.update_school_logo(uuid, text) to authenticated;
