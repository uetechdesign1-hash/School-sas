-- Minimal stand-in for the live Supabase schema (matches the inspected live
-- columns, constraints, defaults, grants and triggers used by Phase 2).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator noinherit login;
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
$$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
grant usage on schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create type public.platform_role as enum ('user', 'super_admin');
create type public.school_status as enum ('trial', 'active', 'suspended', 'expired', 'archived');
create type public.student_status as enum ('active', 'inactive');
create type public.account_type as enum (
  'cash','bank','income','expense','asset','liability','equity','receivable','payable',
  'ASSET','LIABILITY','EQUITY','INCOME','EXPENSE','CASH','BANK','RECEIVABLE','PAYABLE');

create function public.set_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end; $$;

create table public.profiles (id uuid primary key, full_name text, phone text);

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text, login_id text, phone text,
  platform_role public.platform_role not null default 'user',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text
);
create unique index user_profiles_login_id_unique on public.user_profiles (lower(login_id)) where login_id is not null;

create function public.is_super_admin() returns boolean language sql stable security definer
set search_path to 'public' as $$
  select exists (select 1 from public.user_profiles where id = auth.uid()
                 and platform_role = 'super_admin' and is_active = true);
$$;

create function public.sync_profile_email_from_auth() returns trigger language plpgsql
security definer set search_path to 'pg_catalog','public' as $$
begin select email into new.email from auth.users where id = new.id; return new; end; $$;
create trigger user_profile_email_sync before insert or update of email on public.user_profiles
  for each row execute function public.sync_profile_email_from_auth();

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null, code text not null unique, email text, phone text, address text,
  city text, state text, postal_code text, country text not null default 'India',
  logo_url text, status public.school_status not null default 'trial',
  trial_ends_at timestamptz, timezone text not null default 'Asia/Kolkata',
  currency_code text not null default 'INR',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  school_code text, contact_phone text, contact_email text, student_limit integer,
  plan_code text, starts_on date, expires_on date,
  created_by uuid references auth.users (id),
  enabled_modules text[] not null default '{fees,payroll}',
  constraint schools_enabled_modules_check check (
    cardinality(enabled_modules) >= 1 and enabled_modules <@ array['fees','payroll','transport']::text[])
);
create unique index schools_school_code_unique on public.schools (lower(school_code)) where school_code is not null;
create trigger schools_updated_at before update on public.schools
  for each row execute function public.set_updated_at();

create table public.school_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','admin','accountant','teacher','staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, school_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete cascade,
  user_id uuid, action text not null, entity_type text, entity_id uuid,
  old_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);

create table public.school_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  plan_code text not null, status public.school_status not null default 'trial',
  amount numeric not null default 0, started_on date not null, expires_on date not null,
  student_limit integer not null default 300,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  status public.student_status not null default 'active'
);

create table public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null, start_date date not null, end_date date not null,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, name)
);
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  code text, name text not null, account_type public.account_type not null,
  parent_account_id uuid, opening_balance numeric not null default 0, opening_balance_date date,
  is_system boolean not null default false, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (school_id, name),
  constraint accounts_account_type_check check (lower(account_type::text) = any (array['cash','bank','expense','income','asset','liability','equity','receivable','payable']))
);
create unique index idx_accounts_school_code_unique on public.accounts (school_id, code);
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  entry_date date not null, entry_type text, reference_type text, reference_id uuid,
  description text, created_by uuid references auth.users (id),
  created_at timestamptz not null default now(), fiscal_year_id uuid,
  source_module text, source_table text, source_record_id uuid, status text,
  posted_by uuid, posted_at timestamptz, updated_by uuid, updated_at timestamptz, entry_number text,
  constraint journal_entries_entry_type_check check (entry_type is null or (btrim(entry_type) <> '' and length(btrim(entry_type)) <= 48 and lower(btrim(entry_type)) = any (array['general','opening','payment','receipt','contra','adjustment','closing','payroll','payroll_accrual','payroll_payment','salary','salary_accrual','salary_payment','fee_collection','emi','expense','purchase','purchase_bill','purchase_return','vendor_payment','refund'])))
);
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete restrict,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  description text, created_at timestamptz not null default now(),
  fiscal_year_id uuid, updated_at timestamptz,
  check (not (debit > 0 and credit > 0)), check (debit > 0 or credit > 0)
);
create table public.accounting_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  source_module text not null, source_table text not null, source_record_id uuid not null,
  journal_entry_id uuid not null references public.journal_entries (id) on delete cascade,
  status text not null check (status in ('posted','reversed','cancelled')),
  created_at timestamptz not null default now()
);
create unique index idx_accounting_events_source_unique on public.accounting_events (school_id, source_module, source_table, source_record_id);
create table public.accounting_audit_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  entity_type text not null, entity_id uuid not null, action text not null,
  actor_id uuid, action_at timestamptz not null default now(), payload jsonb
);

-- Live (pre-Phase-1) guard trigger that the foundation script replaces.
create function public.guard_school_modules_change() returns trigger language plpgsql
security definer set search_path to 'public' as $$
begin return new; end; $$;
create trigger schools_guard_enabled_modules before insert or update of enabled_modules
  on public.schools for each row execute function public.guard_school_modules_change();

-- Existing schools policies (representative subset).
alter table public.schools enable row level security;
create policy schools_select_member on public.schools for select to authenticated
  using (is_super_admin() or exists (select 1 from school_users su where su.school_id = schools.id and su.user_id = auth.uid() and su.is_active));
create policy schools_super_admin_insert on public.schools for insert to authenticated with check (is_super_admin());
alter table public.school_subscriptions enable row level security;
create policy subscriptions_select_member on public.school_subscriptions for select to authenticated using (is_super_admin());
alter table public.user_profiles enable row level security;
create policy user_profiles_select_own on public.user_profiles for select to authenticated using (id = auth.uid() or is_super_admin());
create policy user_profiles_super_admin_update on public.user_profiles for update to authenticated using (is_super_admin());
alter table public.school_users enable row level security;
create policy school_users_select_own on public.school_users for select to authenticated using (user_id = auth.uid() or is_super_admin());
alter table public.journal_entries enable row level security;
create policy je_select on public.journal_entries for select to authenticated using (is_super_admin());
alter table public.journal_lines enable row level security;
create policy jl_select on public.journal_lines for select to authenticated using (is_super_admin());
alter table public.students enable row level security;
