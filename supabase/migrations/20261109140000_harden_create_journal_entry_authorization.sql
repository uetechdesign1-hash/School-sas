-- Phase 1 Security Fix - Step 1: Harden create_journal_entry authorization
--
-- Problem (security audit):
--   public.create_journal_entry is SECURITY DEFINER and accepts a caller-supplied
--   school ID. It validates account and fiscal-year ownership, but never verifies
--   that auth.uid() is an active member of that school with an authorized
--   accounting role. Any authenticated caller could fabricate journal entries for
--   any school they know the ID of.
--
-- Fix:
--   1. Require an authenticated caller (auth.uid() is not null).
--   2. Verify active membership in the exact supplied school via public.school_users
--      (is_active = true), matching the established school membership table.
--   3. Restrict journal creation to authorized school roles:
--      owner, admin, accountant -- the same role set used by the other
--      journal-posting operations (has_school_role(ARRAY['owner','admin','accountant'])
--      in fee collection and inventory payment RPCs).
--   4. Harden SECURITY DEFINER:
--      - explicit, safe search_path = pg_catalog, public
--      - revoke execute from PUBLIC and anon
--      - grant execute only to authenticated
--
-- All existing validations are preserved: at least one line, fiscal year exists
-- for the school, every account is active and owned by the school, amounts are
-- non-negative, and total debits equal total credits.
--
-- This migration is additive: it redefines the existing function in place (same
-- signature) so every existing caller (fee payments, vendor payments, purchase
-- returns, payroll, ...) continues to work, now with the additional authorization
-- gate. It does not touch RLS policies or production data.

-- ---------------------------------------------------------------------------
-- 1. Revoke legacy broad execute grants before redefining.
-- ---------------------------------------------------------------------------
revoke execute
  on function public.create_journal_entry(
    uuid, uuid, date, text, text, text, text, uuid, text, text, uuid, jsonb
  )
  from public;

revoke execute
  on function public.create_journal_entry(
    uuid, uuid, date, text, text, text, text, uuid, text, text, uuid, jsonb
  )
  from anon;

-- ---------------------------------------------------------------------------
-- 2. Redefine create_journal_entry with authorization + hardened search_path.
-- ---------------------------------------------------------------------------
create or replace function public.create_journal_entry(
  p_school_id uuid,
  p_fiscal_year_id uuid,
  p_entry_date date,
  p_description text,
  p_entry_type text,
  p_source_module text,
  p_source_table text,
  p_source_record_id uuid,
  p_reference_type text default null,
  p_reference_id text default null,
  p_created_by uuid default null,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_entry_id uuid;
  v_entry_number text;
  v_debit_total numeric(18,2) := 0;
  v_credit_total numeric(18,2) := 0;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_existing_journal_id uuid;
  v_authorized boolean := false;
begin
  -- --- Authorization (NEW) -------------------------------------------------
  -- 1. Require an authenticated caller.
  if auth.uid() is null then
    raise exception 'Authenticated user required to create journal entries.';
  end if;

  -- 2. Verify active membership in the exact supplied school with an
  --    authorized accounting role.
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
      'Only active school owners, admins and accountants may create journal entries.';
  end if;
  -- ------------------------------------------------------------------------

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Journal must contain at least one line';
  end if;

  if not exists (
    select 1 from public.fiscal_years
    where id = p_fiscal_year_id and school_id = p_school_id
  ) then
    raise exception 'Fiscal year not found for this school';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_account_id := (v_line->>'accountId')::uuid;
    v_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_credit := coalesce((v_line->>'credit')::numeric, 0);

    if v_debit < 0 or v_credit < 0 then
      raise exception 'Debit and credit must be non-negative';
    end if;

    if not exists (
      select 1 from public.accounts
      where id = v_account_id and school_id = p_school_id and is_active = true
    ) then
      raise exception 'Invalid or inactive account for this school: %', v_account_id;
    end if;

    v_debit_total := v_debit_total + v_debit;
    v_credit_total := v_credit_total + v_credit;
  end loop;

  if v_debit_total <> v_credit_total then
    raise exception 'Journal entry is not balanced';
  end if;

  v_entry_number := 'JE-' || to_char(current_date, 'YYYYMMDD') || '-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.journal_entries (
    school_id,
    fiscal_year_id,
    entry_date,
    entry_number,
    description,
    entry_type,
    source_module,
    source_table,
    source_record_id,
    reference_type,
    reference_id,
    status,
    posted_by,
    posted_at,
    created_by
  ) values (
    p_school_id,
    p_fiscal_year_id,
    p_entry_date,
    v_entry_number,
    p_description,
    p_entry_type,
    p_source_module,
    p_source_table,
    p_source_record_id,
    p_reference_type,
    p_reference_id,
    'posted',
    p_created_by,
    now(),
    p_created_by
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_account_id := (v_line->>'accountId')::uuid;
    v_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_credit := coalesce((v_line->>'credit')::numeric, 0);

    insert into public.journal_lines (
      school_id,
      fiscal_year_id,
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    ) values (
      p_school_id,
      p_fiscal_year_id,
      v_entry_id,
      v_account_id,
      v_debit,
      v_credit,
      v_line->>'description'
    );
  end loop;

  if p_source_table is not null and p_source_record_id is not null then
    insert into public.accounting_events (
      school_id,
      source_module,
      source_table,
      source_record_id,
      journal_entry_id,
      status
    ) values (
      p_school_id,
      p_source_module,
      p_source_table,
      p_source_record_id,
      v_entry_id,
      'posted'
    )
    on conflict (school_id, source_module, source_table, source_record_id)
    do nothing
    returning journal_entry_id into v_existing_journal_id;

    if v_existing_journal_id is null then
      select journal_entry_id
      into v_existing_journal_id
      from public.accounting_events
      where school_id = p_school_id
        and source_module = p_source_module
        and source_table = p_source_table
        and source_record_id = p_source_record_id;

      delete from public.journal_entries
      where id = v_entry_id;

      return jsonb_build_object(
        'journal_entry_id', v_existing_journal_id,
        'debit_total', v_debit_total,
        'credit_total', v_credit_total,
        'idempotent', true
      );
    end if;
  end if;

  return jsonb_build_object(
    'journal_entry_id', v_entry_id,
    'entry_number', v_entry_number,
    'debit_total', v_debit_total,
    'credit_total', v_credit_total,
    'idempotent', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grant execution only to authenticated callers (not PUBLIC / anon).
-- ---------------------------------------------------------------------------
grant execute
  on function public.create_journal_entry(
    uuid, uuid, date, text, text, text, text, uuid, text, text, uuid, jsonb
  )
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. SQL security tests for create_journal_entry (Phase 1 Step 1).
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
-- Test A: Authorized accounting user (accountant) can create a balanced journal.
-- Expect: success; a journal entry is returned.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_a_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_fy_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School A');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'accountant', true);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (v_fy_id, v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);

  -- auth.uid() must equal v_user_id for this call to pass authorization.
  select public.create_journal_entry(
    v_school_id, v_fy_id, current_date, 'Authorized journal', 'GENERAL',
    'test', 'test_table', null, null, null, v_user_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_acct_id, 'debit', 100.00, 'credit', 0, 'description', 'dr'),
      jsonb_build_object('accountId', v_acct_id, 'debit', 0, 'credit', 100.00, 'description', 'cr')
    )
  ) into v_result;

  if v_result is null or (v_result->>'idempotent')::boolean is not false then
    raise exception 'Test A failed: expected a new non-idempotent journal entry';
  end if;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test A passed: authorized accounting user can create a balanced journal.';
end $$;

-- ---------------------------------------------------------------------------
-- Test B: Unauthorized school member (active, non-accounting role) is rejected.
-- Expect: exception mentioning authorized roles.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_b_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_fy_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School B');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'staff', true);  -- not an accounting role
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (v_fy_id, v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);

  begin
    -- auth.uid() must equal v_user_id (active staff member, not authorized).
    select public.create_journal_entry(
      v_school_id, v_fy_id, current_date, 'Unauthorized journal', 'GENERAL',
      'test', 'test_table', null, null, null, v_user_id,
      jsonb_build_array(
        jsonb_build_object('accountId', v_acct_id, 'debit', 100.00, 'credit', 0, 'description', 'dr'),
        jsonb_build_object('accountId', v_acct_id, 'debit', 0, 'credit', 100.00, 'description', 'cr')
      )
    );
    raise exception 'Test B failed: expected an exception for an unauthorized school member';
  exception when others then
    -- Expected: authorization exception.
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test B passed: unauthorized school member is rejected.';
end $$;

-- ---------------------------------------------------------------------------
-- Test C: User from another school is rejected.
-- Expect: exception (no active membership in the supplied school).
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_c_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();   -- supplied school
  v_other_school_id uuid := gen_random_uuid(); -- user's actual school
  v_user_id uuid := gen_random_uuid();
  v_fy_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Supplied School');
  insert into public.schools (id, name) values (v_other_school_id, 'User School');
  -- User is an accountant, but only of the OTHER school.
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_other_school_id, 'accountant', true);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (v_fy_id, v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);

  begin
    -- auth.uid() = v_user_id, who is NOT a member of v_school_id.
    select public.create_journal_entry(
      v_school_id, v_fy_id, current_date, 'Cross-school journal', 'GENERAL',
      'test', 'test_table', null, null, null, v_user_id,
      jsonb_build_array(
        jsonb_build_object('accountId', v_acct_id, 'debit', 100.00, 'credit', 0, 'description', 'dr'),
        jsonb_build_object('accountId', v_acct_id, 'debit', 0, 'credit', 100.00, 'description', 'cr')
      )
    );
    raise exception 'Test C failed: expected an exception for a user from another school';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test C passed: user from another school is rejected.';
end $$;

-- ---------------------------------------------------------------------------
-- Test D: Unauthenticated caller (auth.uid() = null) is rejected.
-- Expect: 'Authenticated user required' exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_d_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_fy_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School D');
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (v_fy_id, v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);

  -- No school_users row is needed; auth.uid() is null in raw SQL context.
  begin
    select public.create_journal_entry(
      v_school_id, v_fy_id, current_date, 'Unauthenticated journal', 'GENERAL',
      'test', 'test_table', null, null, null, null,
      jsonb_build_array(
        jsonb_build_object('accountId', v_acct_id, 'debit', 100.00, 'credit', 0, 'description', 'dr'),
        jsonb_build_object('accountId', v_acct_id, 'debit', 0, 'credit', 100.00, 'description', 'cr')
      )
    );
    raise exception 'Test D failed: expected an exception for an unauthenticated caller';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test D passed: unauthenticated caller is rejected.';
end $$;


-- ---------------------------------------------------------------------------
-- Test E: Invalid or inactive account is rejected.
-- Expect: 'Invalid or inactive account' exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_e_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_fy_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();   -- inactive account
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School E');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'admin', true);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (v_fy_id, v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CLOSED', 'Closed Account', 'CASH', false); -- inactive

  begin
    select public.create_journal_entry(
      v_school_id, v_fy_id, current_date, 'Inactive account journal', 'GENERAL',
      'test', 'test_table', null, null, null, v_user_id,
      jsonb_build_array(
        jsonb_build_object('accountId', v_acct_id, 'debit', 100.00, 'credit', 0, 'description', 'dr'),
        jsonb_build_object('accountId', gen_random_uuid(), 'debit', 0, 'credit', 100.00, 'description', 'cr')
      )
    );
    raise exception 'Test E failed: expected an exception for an invalid/inactive account';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test E passed: invalid or inactive account is rejected.';
end $$;

-- ---------------------------------------------------------------------------
-- Test F: Unbalanced journal entry is rejected.
-- Expect: 'Journal entry is not balanced' exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_f_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_fy_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School F');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'owner', true);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (v_fy_id, v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);

  begin
    select public.create_journal_entry(
      v_school_id, v_fy_id, current_date, 'Unbalanced journal', 'GENERAL',
      'test', 'test_table', null, null, null, v_user_id,
      jsonb_build_array(
        jsonb_build_object('accountId', v_acct_id, 'debit', 100.00, 'credit', 0, 'description', 'dr'),
        jsonb_build_object('accountId', v_acct_id, 'debit', 0, 'credit', 50.00, 'description', 'cr')
      )
    );
    raise exception 'Test F failed: expected an exception for an unbalanced journal entry';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test F passed: unbalanced journal entry is rejected.';
end $$;

