create table if not exists public.platform_settings (
  setting_key text primary key,
  setting_value text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.platform_settings enable row level security;

create or replace function public.get_platform_logo()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select setting_value
  from public.platform_settings
  where setting_key = 'logo_url'
  limit 1;
$$;

create or replace function public.update_platform_logo(p_logo_url text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to update the platform logo.';
  end if;

  if not exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and platform_role = 'super_admin'
      and is_active = true
  ) then
    raise exception 'Only an active Super Administrator can update the platform logo.';
  end if;

  if p_logo_url is not null and p_logo_url !~ '^https://res\.cloudinary\.com/[A-Za-z0-9_-]+/image/upload/' then
    raise exception 'The platform logo must be hosted by Cloudinary.';
  end if;

  insert into public.platform_settings (setting_key, setting_value, updated_at, updated_by)
  values ('logo_url', nullif(trim(p_logo_url), ''), now(), auth.uid())
  on conflict (setting_key) do update
    set setting_value = excluded.setting_value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
end;
$$;

revoke all on public.platform_settings from anon, authenticated;
revoke all on function public.get_platform_logo() from public;
revoke all on function public.update_platform_logo(text) from public;
grant execute on function public.get_platform_logo() to anon, authenticated;
grant execute on function public.update_platform_logo(text) to authenticated;
