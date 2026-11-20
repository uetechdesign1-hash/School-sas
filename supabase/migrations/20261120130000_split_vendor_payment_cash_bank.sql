create or replace function public.record_vendor_payment_split(
  p_school_id uuid,
  p_vendor_id uuid,
  p_request_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_cash_account_id uuid,
  p_bank_account_id uuid,
  p_cash_amount numeric,
  p_bank_amount numeric,
  p_bill_id uuid,
  p_payment_method text,
  p_reference_number text,
  p_particulars text,
  p_notes text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb;
  v_journal_id uuid;
  v_fiscal_year_id uuid;
  v_description text;
  v_idempotent boolean;
  v_cash_type text;
  v_bank_type text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.school_users su
    where su.school_id = p_school_id and su.user_id = auth.uid()
      and su.is_active and su.role in ('owner', 'admin')
  ) then
    raise exception 'Only school owners and admins may record vendor payments';
  end if;

  if round(coalesce(p_cash_amount, 0) + coalesce(p_bank_amount, 0), 2) <> round(coalesce(p_amount, 0), 2)
    or coalesce(p_cash_amount, 0) <= 0 or coalesce(p_bank_amount, 0) <= 0 then
    raise exception 'Cash and Bank amounts must be positive and add up to the payment total';
  end if;

  select lower(a.account_type::text) into v_cash_type
  from public.accounts a where a.id = p_cash_account_id and a.school_id = p_school_id and a.is_active;
  select lower(a.account_type::text) into v_bank_type
  from public.accounts a where a.id = p_bank_account_id and a.school_id = p_school_id and a.is_active;
  if v_cash_type <> 'cash' or v_bank_type <> 'bank' then
    raise exception 'Choose a valid Cash account and a valid Bank account';
  end if;

  v_result := public.record_vendor_payment(
    p_school_id, p_vendor_id, p_request_id, p_payment_date, p_amount,
    p_cash_account_id, p_bill_id, 'Split Cash + Bank', p_reference_number,
    p_particulars, p_notes
  );
  v_idempotent := coalesce((v_result->>'idempotent')::boolean, false);

  if not v_idempotent then
    v_journal_id := (v_result->>'journal_entry_id')::uuid;
    select je.fiscal_year_id, je.description into v_fiscal_year_id, v_description
    from public.journal_entries je
    where je.id = v_journal_id and je.school_id = p_school_id;

    update public.journal_lines jl
    set credit = round(p_cash_amount, 2), description = coalesce(v_description, jl.description)
    where jl.journal_entry_id = v_journal_id and jl.school_id = p_school_id
      and jl.account_id = p_cash_account_id and jl.credit > 0;

    insert into public.journal_lines(
      school_id, fiscal_year_id, journal_entry_id, account_id, debit, credit, description
    ) values (
      p_school_id, v_fiscal_year_id, v_journal_id, p_bank_account_id,
      0, round(p_bank_amount, 2), coalesce(v_description, 'Split vendor payment')
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.record_vendor_payment_split(uuid, uuid, uuid, date, numeric, uuid, uuid, numeric, numeric, uuid, text, text, text, text) from public;
grant execute on function public.record_vendor_payment_split(uuid, uuid, uuid, date, numeric, uuid, uuid, numeric, numeric, uuid, text, text, text, text) to authenticated;
