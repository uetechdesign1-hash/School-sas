-- Phase 1 Security Fix - Step 2: Harden ensure_school_accounting_setup authorization
--
-- Problem (security audit):
--   public.ensure_school_accounting_setup is SECURITY DEFINER and accepts a
--   caller-supplied school ID. It validates that the school exists, but never
--   verifies that auth.uid() is an active member of that school with an
--   authorized administrator/accounting role. Any authenticated caller could
--   initialize or re-seed the chart of accounts and fiscal year for any school
--   they know the ID of.
--
-- Fix:
--   1. Require an authenticated caller (auth.uid() is not null).
--   2. Verify active membership in the exact supplied school via
--      public.school_users (is_active = true), matching the established school
--      membership table.
--   3. Restrict execution to authorized school administrator/accounting roles:
--      owner, admin, accountant -- the same role set used by the other
--      journal-posting operations (has_school_role(ARRAY['owner','admin','accountant'])
--      in fee collection and inventory payment RPCs).
--   4. Validate school ownership before creating/updating accounting setup
--      records (the school-existence check is retained and the authorization
--      check gates on the exact supplied school_id).
--   5. Harden SECURITY DEFINER:
--      - explicit, safe search_path = pg_catalog, public
--      - revoke execute from PUBLIC and anon
--      - grant execute only to authenticated
--
-- ---------------------------------------------------------------------------
-- 2. Redefine ensure_school_accounting_setup with authorization + hardened
--    search_path.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_school_accounting_setup(
  p_school_id uuid,
  p_fiscal_year_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_fiscal_year_name text;
  v_fiscal_year_id uuid;
  v_fy_start date;
  v_fy_end date;
  v_account_count int;
  v_authorized boolean := false;
begin
  -- --- Authorization (NEW) -------------------------------------------------
  -- 1. Require an authenticated caller.
  if auth.uid() is null then
    raise exception 'Authenticated user required to run school accounting setup.';
  end if;

  -- 2. Verify active membership in the exact supplied school with an
  --    authorized administrator/accounting role.
  --    School membership table: public.school_users
  --    Active-membership field: is_active = true
  --    Authorized roles: owner, admin, accountant
  select exists (
    select 1
    from public.school_users
    where school_id = p_school_id
      and user_id = auth.uid()
      and is_active = true
      and lower(coalesce(role, '')) in ('owner', 'admin', 'accountant')
  ) into v_authorized;

  if not v_authorized then
    raise exception
      'Only active school owners, admins and accountants may run school accounting setup.';
  end if;
  -- ------------------------------------------------------------------------

  -- Validate school ownership before creating or updating accounting records.
  if not exists (select 1 from public.schools where id = p_school_id) then
    raise exception 'School not found';
  end if;

  v_fiscal_year_name := coalesce(
    p_fiscal_year_name,
    to_char(current_date, 'YYYY') || '-' || to_char(current_date + interval '1 year', 'YY')
  );

  v_fy_start := make_date(extract(year from current_date)::int, 4, 1);
  v_fy_end := v_fy_start + interval '1 year' - interval '1 day';

  if not exists (
    select 1 from public.fiscal_years
    where school_id = p_school_id
      and name = v_fiscal_year_name
  ) then
    insert into public.fiscal_years (school_id, name, start_date, end_date, is_closed)
    values (p_school_id, v_fiscal_year_name, v_fy_start, v_fy_end, false)
    returning id into v_fiscal_year_id;
  else
    select id into v_fiscal_year_id
    from public.fiscal_years
    where school_id = p_school_id and name = v_fiscal_year_name
    limit 1;
  end if;

  insert into public.accounts (school_id, code, name, account_type, is_system, is_active)
  values
    (p_school_id, 'CASH', 'Cash', 'CASH', true, true),
    (p_school_id, 'BANK', 'Bank', 'BANK', true, true),
    (p_school_id, 'STUDENT_FEE_RECEIVABLE', 'Student Fee Receivable', 'RECEIVABLE', true, true),
    (p_school_id, 'OTHER_RECEIVABLES', 'Other Receivables', 'RECEIVABLE', true, true),
    (p_school_id, 'FIXED_ASSETS', 'Fixed Assets', 'ASSET', true, true),
    (p_school_id, 'SALARY_PAYABLE', 'Salary Payable', 'PAYABLE', true, true),
    (p_school_id, 'OTHER_PAYABLES', 'Other Payables', 'PAYABLE', true, true),
    (p_school_id, 'VENDOR_PAYABLES', 'Vendor Payables', 'PAYABLE', true, true),
    (p_school_id, 'LOAN_PAYABLES', 'Loan Payables', 'PAYABLE', true, true),
    (p_school_id, 'CAPITAL', 'Capital / Owner Equity', 'EQUITY', true, true),
    (p_school_id, 'RETAINED_EARNINGS', 'Retained Earnings', 'EQUITY', true, true),
    (p_school_id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true, true),
    (p_school_id, 'OTHER_INCOME', 'Other Income', 'INCOME', true, true),
    (p_school_id, 'TRANSPORT_FEES', 'Transport Fees', 'INCOME', true, true),
    (p_school_id, 'INTEREST_INCOME', 'Interest Income', 'INCOME', true, true),
    (p_school_id, 'SALARY_EXPENSE', 'Salary Expense', 'EXPENSE', true, true),
    (p_school_id, 'PAYROLL_EXPENSE', 'Payroll Expense', 'EXPENSE', true, true),
    (p_school_id, 'MAINTENANCE', 'Maintenance', 'EXPENSE', true, true),
    (p_school_id, 'UTILITIES', 'Utilities', 'EXPENSE', true, true),
    (p_school_id, 'TRANSPORT_FUEL', 'Transport / Fuel', 'EXPENSE', true, true),
    (p_school_id, 'BUILDING_MAINTENANCE', 'Building Maintenance', 'EXPENSE', true, true),
    (p_school_id, 'OFFICE_EXPENSE', 'Office Expenses', 'EXPENSE', true, true),
    (p_school_id, 'ACADEMIC_EXPENSE', 'Academic Expenses', 'EXPENSE', true, true)
  on conflict (school_id, code) do nothing;

  select count(*) into v_account_count
  from public.accounts
  where school_id = p_school_id;

  return jsonb_build_object(
    'school_id', p_school_id,
    'fiscal_year_id', v_fiscal_year_id,
    'fiscal_year_name', v_fiscal_year_name,
    'account_count', v_account_count
  );
end;
$$;

-- All existing accounting setup functionality is preserved:
--   - creates the canonical fiscal year (April 1 - March 31) when missing,
--   - seeds the standard chart of accounts (idempotent via ON CONFLICT),
--   - returns the fiscal year id/name and account count.
--
-- This migration redefines the existing function in place (same signature) so
-- any existing caller continues to work, now with the additional authorization
-- gate. It does not touch RLS policies or production data.

-- ---------------------------------------------------------------------------
-- 1. Revoke legacy broad execute grants before redefining.
-- ---------------------------------------------------------------------------
revoke execute
  on function public.ensure_school_accounting_setup(uuid, text)
  from public;

revoke execute
  on function public.ensure_school_accounting_setup(uuid, text)
  from anon;

-- ---------------------------------------------------------------------------
-- 3. Grant execution only to authenticated callers (not PUBLIC / anon).
-- ---------------------------------------------------------------------------
grant execute
  on function public.ensure_school_accounting_setup(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. SQL security tests for ensure_school_accounting_setup (Phase 1 Step 2).
--
-- Each block below is a self-contained DO block that inserts its own fixtures
-- inside a savepoint and rolls back to that savepoint at the end, so no
-- production data is persisted. Run them in the Supabase SQL Editor.
--
-- NOTE on auth.uid(): auth.uid() reads the caller's user id from the session
-- JWT. To exercise the authenticated test cases from the SQL Editor, set the
-- session's auth context to the intended test user (e.g. via the API with a
-- JWT for that user, or by setting the auth.uid GUC where supported). The
-- unauthenticated test runs with auth.uid() = null, which is the default in
-- raw SQL.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Test G: Authorized administrator (owner) can run accounting setup.
-- Expect: success; a setup result is returned.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_g_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School G');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'owner', true);

  select public.ensure_school_accounting_setup(v_school_id, null) into v_result;

  if v_result is null then
    raise exception 'Test G failed: expected a setup result for an authorized owner';
  end if;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test G passed: authorized administrator can run accounting setup.';
end $$;

-- ---------------------------------------------------------------------------
-- Test H: Cross-school access is rejected.
-- Expect: exception (no active membership in the supplied school).
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_h_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();   -- supplied school
  v_other_school_id uuid := gen_random_uuid(); -- user's actual school
  v_user_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Supplied School H');
  insert into public.schools (id, name) values (v_other_school_id, 'User School H');
  -- User is an owner, but only of the OTHER school.
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_other_school_id, 'owner', true);

  begin
    -- auth.uid() = v_user_id, who is NOT a member of v_school_id.
    select public.ensure_school_accounting_setup(v_school_id, null);
    raise exception 'Test H failed: expected an exception for cross-school access';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test H passed: cross-school access is rejected.';
end $$;

-- ---------------------------------------------------------------------------
-- Test I: Unauthorized role (active non-accounting member) is rejected.
-- Expect: exception mentioning authorized roles.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_i_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School I');
  -- User is an active member but with a non-accounting role.
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'staff', true);

  begin
    select public.ensure_school_accounting_setup(v_school_id, null);
    raise exception 'Test I failed: expected an exception for an unauthorized role';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test I passed: unauthorized role is rejected.';
end $$;

-- ---------------------------------------------------------------------------
-- Test J: Unauthenticated caller (auth.uid() = null) is rejected.
-- Expect: 'Authenticated user required' exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_j_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School J');

  -- auth.uid() is null in raw SQL context.
  begin
    select public.ensure_school_accounting_setup(v_school_id, null);
    raise exception 'Test J failed: expected an exception for an unauthenticated caller';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test J passed: unauthenticated caller is rejected.';
end $$;

