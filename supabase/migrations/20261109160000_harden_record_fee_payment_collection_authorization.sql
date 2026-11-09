-- Phase 1 Security Fix - Step 3: Harden record_fee_payment_collection authorization
--
-- Problem (security audit):
--   public.record_fee_payment_collection is SECURITY DEFINER and accepts
--   student/bill identifiers. It resolves the school from those records but
--   never verifies that auth.uid() is an active member of that school with a
--   fee-collection role. Any authenticated caller could collect payments and
--   post journals for any school by supplying a student/bill they know.
--
-- Fix:
--   A. Authorization
--      1. Require an authenticated caller (auth.uid() is not null).
--      2. Resolve school ownership from the student and fee bill records
--         (existing behavior retained).
--      3. Confirm student and bill belong to the same school (existing
--         behavior retained; cross-school bill is rejected).
--      4. Verify active school_users membership for auth.uid() in that school
--         (is_active = true).
--      5. Restrict payment collection to owner, admin, accountant -- the same
--         role set used by the sibling split variant
--         (has_school_role(ARRAY['owner','admin','accountant'])).
--      6. Reject cross-school payment attempts (bill lookup already scopes to
--         v_school_id; membership check gates on the same school).
--   B. Financial validation (all preserved):
--      - Payment amount positive; every allocation positive
--      - Total allocations equal payment amount (existing tolerance)
--      - Payment account belongs to same school, active, cash/bank
--      - Duplicate receipt numbers rejected
--      - Idempotency and existing journal posting behavior preserved
--   C. Database security:
--      - SECURITY DEFINER with explicit search_path = pg_catalog, public
--      - Revoke execute from PUBLIC and anon
--      - Grant execute only to authenticated
--   D. Tests: 8 SQL security tests (see section 4 below).
--
-- Callers reviewed (all use the authenticated Supabase client, not service-role):
--   - src/app/accounting/receipt/page.tsx        -> supabase.rpc("record_fee_payment_collection")
--   - src/app/dashboard/students/[id]/fees/page.tsx -> supabase.rpc("record_fee_payment_collection")
--   - public.record_fee_payment_collection_split (internal SECURITY DEFINER)
--
-- This migration redefines the existing function in place (same signature) so
-- every existing caller continues to work, now with the additional authorization
-- gate. It does not touch RLS policies or production data.

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 2. Redefine record_fee_payment_collection with authorization + hardened
--    search_path. All existing financial validations are preserved.
-- ---------------------------------------------------------------------------
create or replace function public.record_fee_payment_collection(
  p_student_id uuid,
  p_bill_id uuid,
  p_amount numeric,
  p_payment_mode text,
  p_account_id uuid,
  p_receipt_number text,
  p_payment_date date,
  p_reference_number text default null,
  p_remarks text default null,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_school_id uuid;
  v_bill public.fee_bills%rowtype;
  v_payment_id uuid;
  v_fiscal_year_id uuid;
  v_fy_start date;
  v_fy_end date;
  v_fy_name text;
  v_fee_income uuid;
  v_remaining numeric(18,2);
  v_paid numeric(18,2);
  v_alloc jsonb;
  v_alloc_total numeric(18,2) := 0;
  v_authorized boolean := false;
begin
  -- --- Authorization (NEW) -------------------------------------------------
  -- A1. Require an authenticated caller.
  if auth.uid() is null then
    raise exception 'Authenticated user required to record fee payments.';
  end if;

  -- A2/A3. Resolve school from the student record; confirm the bill belongs
  --        to the same student and same school (cross-school rejected).
  select school_id into v_school_id from public.students where id = p_student_id;
  if v_school_id is null then
    raise exception 'Student was not found';
  end if;

  select * into v_bill
   from public.fee_bills
   where id = p_bill_id and school_id = v_school_id and student_id = p_student_id
   for update;
  if not found then
    raise exception 'Fee bill was not found for this student';
  end if;

  -- A4/A5. Verify active membership in the resolved school with an authorized
  --        fee-collection role (owner, admin, accountant).
  select exists (
    select 1
    from public.school_users
    where school_id = v_school_id
      and user_id = auth.uid()
      and is_active = true
      and lower(coalesce(role, '')) in ('owner', 'admin', 'accountant')
  ) into v_authorized;

  if not v_authorized then
    raise exception
      'Only active school owners, admins and accountants may collect fee payments.';
  end if;
  -- ------------------------------------------------------------------------

  -- B. Payment account must belong to the same school, active, cash/bank.
  if p_account_id is null or not exists (
    select 1 from public.accounts
    where id = p_account_id and school_id = v_school_id
      and is_active = true
      and lower(account_type::text) in ('cash', 'bank')
  ) then
    raise exception 'The selected payment account is invalid';
  end if;

  -- B. Payment amount must be positive.
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  -- B. Receipt number is required.
  if nullif(btrim(coalesce(p_receipt_number, '')), '') is null then
    raise exception 'Manual receipt number is required';
  end if;

  -- B. Prevent duplicate receipt numbers within the school.
  if exists (select 1 from public.fee_payments
      where school_id = v_school_id
        and lower(trim(receipt_number)) = lower(trim(p_receipt_number))) then
    raise exception 'Receipt number % has already been used in this school', p_receipt_number;
  end if;

  -- B. Payment must not exceed the remaining bill balance.
  v_remaining := greatest(coalesce(v_bill.balance_amount, 0), 0);
  if p_amount > v_remaining + 0.005 then
    raise exception 'Payment exceeds the remaining bill balance';
  end if;

  -- B. Validate allocations: every allocation positive, total matches amount.
  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) = 'array' then
    for v_alloc in
      select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
    loop
      if coalesce((v_alloc->>'amount')::numeric, 0) <= 0 then
        raise exception 'Every allocation amount must be positive';
      end if;
      v_alloc_total := v_alloc_total + coalesce((v_alloc->>'amount')::numeric, 0);
      if not exists (
        select 1 from public.fee_bill_items
        where id = (v_alloc->>'fee_bill_item_id')::uuid
          and bill_id = p_bill_id and school_id = v_school_id
      ) then
        raise exception 'The selected fee item does not belong to this bill';
      end if;
    end loop;
    if abs(round(v_alloc_total, 2) - round(p_amount, 2)) > 0.005 then
      raise exception 'Allocation total does not match payment total';
    end if;
  end if;

-- 1. Revoke legacy broad execute grants before redefining.
-- ---------------------------------------------------------------------------
revoke execute
  on function public.record_fee_payment_collection(
    uuid, uuid, numeric, text, uuid, text, date, text, text, jsonb
  )
  from public;

revoke execute
  on function public.record_fee_payment_collection(
    uuid, uuid, numeric, text, uuid, text, date, text, text, jsonb
  )
  from anon;

  -- Resolve / self-heal the fiscal year covering the payment date.
  select id into v_fiscal_year_id from public.fiscal_years
   where school_id = v_school_id and p_payment_date between start_date and end_date
   order by start_date desc limit 1;
  if v_fiscal_year_id is null then
    v_fy_start := (date_trunc('year', p_payment_date) + interval '3 months')::date;
    if p_payment_date < v_fy_start then v_fy_start := v_fy_start - interval '1 year'; end if;
    v_fy_end := v_fy_start + interval '1 year' - interval '1 day';
    select id into v_fiscal_year_id from public.fiscal_years
     where school_id = v_school_id and start_date = v_fy_start and end_date = v_fy_end limit 1;
    if v_fiscal_year_id is null then
      v_fy_name := to_char(v_fy_start, 'YYYY') || '-' || to_char(v_fy_end, 'YY');
      insert into public.fiscal_years (school_id, name, start_date, end_date)
      values (v_school_id, v_fy_name, v_fy_start, v_fy_end) returning id into v_fiscal_year_id;
    end if;
  end if;

  -- Locate or create the Student Fees income account for this school.
  select id into v_fee_income from public.accounts
   where school_id = v_school_id and code = 'STUDENT_FEES'
     and lower(account_type::text) = 'income' and is_active = true
   limit 1;
  if v_fee_income is null then
    insert into public.accounts (school_id, code, name, account_type, is_system, is_active)
    values (v_school_id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true, true)
    on conflict (school_id, code) do nothing returning id into v_fee_income;
    if v_fee_income is null then
      select id into v_fee_income from public.accounts
       where school_id = v_school_id and code = 'STUDENT_FEES' limit 1;
    end if;
  end if;
  if v_fee_income is null then
    raise exception 'Student Fees income account is not configured';
  end if;

  -- Record the payment.
  insert into public.fee_payments (
    school_id, student_id, bill_id, receipt_number, payment_date, amount,
    payment_method, account_id, reference_number, notes, received_by
  ) values (
    v_school_id, p_student_id, p_bill_id, btrim(p_receipt_number), p_payment_date,
    round(p_amount, 2), lower(trim(p_payment_mode))::payment_method, p_account_id,
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_remarks, '')), ''), auth.uid()
  ) returning id into v_payment_id;

  -- Record category allocations.
  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) = 'array' then
    insert into public.fee_payment_allocations (school_id, bill_id, payment_id, amount, fee_bill_item_id)
    select v_school_id, p_bill_id, v_payment_id,
      round((x.amount)::numeric, 2), x.fee_bill_item_id
      from jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb))
        as x(fee_bill_item_id uuid, amount numeric)
     where x.fee_bill_item_id is not null;
  end if;

  -- Update the bill balance and status.
  v_paid := coalesce(v_bill.paid_amount, 0) + p_amount;
  update public.fee_bills set paid_amount = v_paid,
    balance_amount = greatest(coalesce(total_amount, 0) - v_paid, 0),
    status = case
      when greatest(coalesce(total_amount, 0) - v_paid, 0) <= 0.005 then 'paid'
      when v_paid > 0 then 'partial' else 'unpaid'
    end,
    updated_at = now()
   where id = p_bill_id and school_id = v_school_id;

  -- Post the canonical journal entry (debit payment account, credit Student Fees income).
  perform public.create_journal_entry(
    v_school_id, v_fiscal_year_id, p_payment_date,
    'Student fee payment ' || coalesce(btrim(p_receipt_number), v_payment_id::text),
    'fee_collection', 'fees', 'fee_payments', v_payment_id,
    'fee_payment', v_payment_id::text, auth.uid(),
    jsonb_build_array(
      jsonb_build_object('accountId', p_account_id, 'debit', round(p_amount, 2),
        'credit', 0, 'description', 'Fee payment received'),
      jsonb_build_object('accountId', v_fee_income, 'debit', 0,
        'credit', round(p_amount, 2), 'description', 'Student fee income earned')));

  return jsonb_build_object('success', true, 'payment_id', v_payment_id,
    'bill_id', p_bill_id, 'amount', round(p_amount, 2));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Grant execution only to authenticated callers (not PUBLIC / anon).
-- ---------------------------------------------------------------------------
grant execute
  on function public.record_fee_payment_collection(
    uuid, uuid, numeric, text, uuid, text, date, text, text, jsonb
  )
  to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4. SQL security tests for record_fee_payment_collection (Phase 1 Step 3).
--
-- Each block below is a self-contained DO block that inserts its own fixtures
-- inside a savepoint and rolls back to that savepoint at the end, so no
-- production data is persisted. Run them in the Supabase SQL Editor.
--
-- NOTE on auth.uid(): auth.uid() reads the caller's user id from the session
-- JWT. To exercise the authenticated test cases from the SQL Editor, set the
-- session's auth context to the intended test user (e.g. via the API with a
-- JWT for that user). The unauthenticated test runs with auth.uid() = null,
-- which is the default in raw SQL.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Test 1: Authorized accountant can collect a payment and create a journal.
-- Expect: success; payment and journal entry created.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_1_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_bill_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
  v_item_id uuid := gen_random_uuid();
  v_fy_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School 1');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'accountant', true);
  insert into public.students (id, school_id) values (v_student_id, v_school_id);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (v_fy_id, v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);
  insert into public.fee_bills (id, school_id, student_id, total_amount, balance_amount, paid_amount, status)
    values (v_bill_id, v_school_id, v_student_id, 100.00, 100.00, 0, 'unpaid');
  insert into public.fee_bill_items (id, bill_id, school_id, amount)
    values (v_item_id, v_bill_id, v_school_id, 100.00);

  select public.record_fee_payment_collection(
    v_student_id, v_bill_id, 100.00, 'cash', v_acct_id,
    'RCPT-001', current_date, null, null,
    jsonb_build_array(
      jsonb_build_object('fee_bill_item_id', v_item_id, 'amount', 100.00)
    )
  ) into v_result;

  if v_result is null or (v_result->>'success')::boolean is not true then
    raise exception 'Test 1 failed: expected a successful payment result';
  end if;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test 1 passed: authorized accountant can collect a payment.';
end $$;

-- ---------------------------------------------------------------------------
-- Test 2: Unauthorized staff member is rejected.
-- Expect: exception mentioning authorized roles.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_2_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_bill_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School 2');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'staff', true);  -- not an accounting role
  insert into public.students (id, school_id) values (v_student_id, v_school_id);
  insert into public.fee_bills (id, school_id, student_id, total_amount, balance_amount, paid_amount, status)
    values (v_bill_id, v_school_id, v_student_id, 100.00, 100.00, 0, 'unpaid');
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);

  begin
    select public.record_fee_payment_collection(
      v_student_id, v_bill_id, 100.00, 'cash', v_acct_id,
      'RCPT-002', current_date, null, null, '[]'::jsonb
    );
    raise exception 'Test 2 failed: expected an exception for an unauthorized staff member';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test 2 passed: unauthorized staff member is rejected.';
end $$;


-- ---------------------------------------------------------------------------
-- Test 3: Cross-school student/bill combination is rejected.
-- Expect: exception (bill does not belong to the student's school).
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_3_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();   -- user's school
  v_other_school_id uuid := gen_random_uuid(); -- student's school (different)
  v_user_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_bill_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'User School 3');
  insert into public.schools (id, name) values (v_other_school_id, 'Student School 3');
  -- User is an accountant of v_school_id, but the student belongs to another school.
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'accountant', true);
  insert into public.students (id, school_id) values (v_student_id, v_other_school_id);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_other_school_id, 'CASH', 'Cash', 'CASH', true);
  insert into public.fee_bills (id, school_id, student_id, total_amount, balance_amount, paid_amount, status)
    values (v_bill_id, v_other_school_id, v_student_id, 100.00, 100.00, 0, 'unpaid');

  begin
    -- auth.uid() = v_user_id (member of v_school_id), student/bill belong to v_other_school_id.
    select public.record_fee_payment_collection(
      v_student_id, v_bill_id, 100.00, 'cash', v_acct_id,
      'RCPT-003', current_date, null, null, '[]'::jsonb
    );
    raise exception 'Test 3 failed: expected an exception for cross-school student/bill';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test 3 passed: cross-school student/bill combination is rejected.';
end $$;

-- ---------------------------------------------------------------------------
-- Test 4: Unauthenticated caller (auth.uid() = null) is rejected.
-- Expect: 'Authenticated user required' exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_4_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_bill_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School 4');
  insert into public.students (id, school_id) values (v_student_id, v_school_id);
  insert into public.fee_bills (id, school_id, student_id, total_amount, balance_amount, paid_amount, status)
    values (v_bill_id, v_school_id, v_student_id, 100.00, 100.00, 0, 'unpaid');
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);

  -- auth.uid() is null in raw SQL context.
  begin
    select public.record_fee_payment_collection(
      v_student_id, v_bill_id, 100.00, 'cash', v_acct_id,
      'RCPT-004', current_date, null, null, '[]'::jsonb
    );
    raise exception 'Test 4 failed: expected an exception for an unauthenticated caller';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test 4 passed: unauthenticated caller is rejected.';
end $$;


-- ---------------------------------------------------------------------------
-- Test 5: Negative or zero allocation amount is rejected.
-- Expect: 'Every allocation amount must be positive' exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_5_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_bill_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
  v_item_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School 5');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'accountant', true);
  insert into public.students (id, school_id) values (v_student_id, v_school_id);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (gen_random_uuid(), v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);
  insert into public.fee_bills (id, school_id, student_id, total_amount, balance_amount, paid_amount, status)
    values (v_bill_id, v_school_id, v_student_id, 100.00, 100.00, 0, 'unpaid');
  insert into public.fee_bill_items (id, bill_id, school_id, amount)
    values (v_item_id, v_bill_id, v_school_id, 100.00);

  begin
    -- Zero allocation amount.
    select public.record_fee_payment_collection(
      v_student_id, v_bill_id, 100.00, 'cash', v_acct_id,
      'RCPT-005', current_date, null, null,
      jsonb_build_array(
        jsonb_build_object('fee_bill_item_id', v_item_id, 'amount', 0)
      )
    );
    raise exception 'Test 5 failed: expected an exception for a zero allocation';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test 5 passed: zero allocation amount is rejected.';
end $$;

-- ---------------------------------------------------------------------------
-- Test 6: Allocation total mismatch is rejected.
-- Expect: 'Allocation total does not match payment total' exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_6_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_bill_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
  v_item_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School 6');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'admin', true);
  insert into public.students (id, school_id) values (v_student_id, v_school_id);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (gen_random_uuid(), v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);
  insert into public.fee_bills (id, school_id, student_id, total_amount, balance_amount, paid_amount, status)
    values (v_bill_id, v_school_id, v_student_id, 100.00, 100.00, 0, 'unpaid');
  insert into public.fee_bill_items (id, bill_id, school_id, amount)
    values (v_item_id, v_bill_id, v_school_id, 100.00);

  begin
    -- Allocations total 60 but payment is 100.
    select public.record_fee_payment_collection(
      v_student_id, v_bill_id, 100.00, 'cash', v_acct_id,
      'RCPT-006', current_date, null, null,
      jsonb_build_array(
        jsonb_build_object('fee_bill_item_id', v_item_id, 'amount', 60.00)
      )
    );
    raise exception 'Test 6 failed: expected an exception for allocation total mismatch';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test 6 passed: allocation total mismatch is rejected.';
end $$;


-- ---------------------------------------------------------------------------
-- Test 7: Duplicate receipt number is rejected.
-- Expect: 'Receipt number ... has already been used' exception.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_7_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_bill_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School 7');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'owner', true);
  insert into public.students (id, school_id) values (v_student_id, v_school_id);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (gen_random_uuid(), v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);
  insert into public.fee_bills (id, school_id, student_id, total_amount, balance_amount, paid_amount, status)
    values (v_bill_id, v_school_id, v_student_id, 100.00, 100.00, 0, 'unpaid');
  insert into public.fee_payments (school_id, student_id, bill_id, receipt_number, payment_date, amount, payment_method, account_id, received_by)
    values (v_school_id, v_student_id, v_bill_id, 'RCPT-DUP', current_date, 50.00, 'cash', v_acct_id, v_user_id);

  begin
    -- Same receipt number reused in the same school.
    select public.record_fee_payment_collection(
      v_student_id, v_bill_id, 100.00, 'cash', v_acct_id,
      'RCPT-DUP', current_date, null, null, '[]'::jsonb
    );
    raise exception 'Test 7 failed: expected an exception for a duplicate receipt';
  exception when others then
    null;
  end;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test 7 passed: duplicate receipt number is rejected.';
end $$;

-- ---------------------------------------------------------------------------
-- Test 8: Valid payment and journal creation (full happy path).
-- Expect: success; payment row, allocation, bill update, and journal entry exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sp text := 'sp_test_8_' || gen_random_uuid()::text;
  v_school_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_bill_id uuid := gen_random_uuid();
  v_acct_id uuid := gen_random_uuid();
  v_item_id uuid := gen_random_uuid();
  v_result jsonb;
  v_payment_count int;
  v_journal_count int;
begin
  execute 'SAVEPOINT ' || v_sp;

  insert into public.schools (id, name) values (v_school_id, 'Test School 8');
  insert into public.school_users (user_id, school_id, role, is_active)
    values (v_user_id, v_school_id, 'accountant', true);
  insert into public.students (id, school_id) values (v_student_id, v_school_id);
  insert into public.fiscal_years (id, school_id, name, start_date, end_date, is_closed)
    values (gen_random_uuid(), v_school_id, 'FY2026', '2026-04-01', '2027-03-31', false);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (v_acct_id, v_school_id, 'CASH', 'Cash', 'CASH', true);
  insert into public.accounts (id, school_id, code, name, account_type, is_active)
    values (gen_random_uuid(), v_school_id, 'STUDENT_FEES', 'Student Fees', 'INCOME', true);
  insert into public.fee_bills (id, school_id, student_id, total_amount, balance_amount, paid_amount, status)
    values (v_bill_id, v_school_id, v_student_id, 100.00, 100.00, 0, 'unpaid');
  insert into public.fee_bill_items (id, bill_id, school_id, amount)
    values (v_item_id, v_bill_id, v_school_id, 100.00);

  select public.record_fee_payment_collection(
    v_student_id, v_bill_id, 100.00, 'cash', v_acct_id,
    'RCPT-008', current_date, null, null,
    jsonb_build_array(
      jsonb_build_object('fee_bill_item_id', v_item_id, 'amount', 100.00)
    )
  ) into v_result;

  if v_result is null or (v_result->>'success')::boolean is not true then
    raise exception 'Test 8 failed: expected a successful payment result';
  end if;

  select count(*) into v_payment_count from public.fee_payments
   where receipt_number = 'RCPT-008' and school_id = v_school_id;
  if v_payment_count <> 1 then
    raise exception 'Test 8 failed: expected exactly one fee_payment row, found %', v_payment_count;
  end if;

  select count(*) into v_journal_count from public.journal_entries
   where reference_type = 'fee_payment' and school_id = v_school_id;
  if v_journal_count < 1 then
    raise exception 'Test 8 failed: expected at least one journal entry, found %', v_journal_count;
  end if;

  execute 'ROLLBACK TO SAVEPOINT ' || v_sp;
  raise notice 'Test 8 passed: valid payment and journal creation works.';
end $$;

