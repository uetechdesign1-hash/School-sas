-- Preserve legacy-only rows while excluding manual journals already represented
-- by a linked canonical journal. Keep the existing view columns and grants.
create or replace view public.cash_book as
select
  je.id as journal_entry_id, je.school_id, je.id as entry_id, je.entry_date,
  je.entry_type, je.reference_type, je.reference_id, je.description as entry_description,
  jl.id as journal_line_id, a.id as account_id, a.code as account_code,
  a.name as account_name, jl.debit::numeric as debit, jl.credit::numeric as credit,
  jl.debit::numeric as cash_in, jl.credit::numeric as cash_out,
  null::numeric as bank_in, null::numeric as bank_out, jl.description as line_description,
  jl.created_at, vp.id as vendor_payment_id,
  coalesce(bp.bill_number, rb.bill_number) as vendor_bill_number,
  vp.reference_number as vendor_payment_ref, v.name as vendor_name, v.id as vendor_id,
  pr.id as purchase_return_id, pr.return_number as purchase_return_number
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id and jl.school_id = je.school_id
join public.accounts a on a.id = jl.account_id and a.school_id = je.school_id
left join public.vendor_payments vp on vp.id = je.reference_id and vp.school_id = je.school_id and je.reference_type = 'vendor_payment'
left join public.purchase_returns pr on pr.id = je.reference_id and pr.school_id = je.school_id and je.reference_type = 'purchase_return_refund'
left join public.purchase_bills rb on rb.id = pr.bill_id and rb.school_id = pr.school_id
left join lateral (
  select pb.bill_number
  from public.bill_payment_allocations al
  join public.purchase_bills pb on pb.id = al.bill_id and pb.school_id = al.school_id
  where al.payment_id = vp.id and al.school_id = vp.school_id
  order by pb.bill_date, pb.created_at limit 1
) bp on true
left join public.vendors v on v.school_id = je.school_id and v.id = coalesce(vp.vendor_id, pr.vendor_id)
where a.account_type = 'cash' and a.is_active = true
union all
select
  t.id, t.school_id, t.id, t.transaction_date, t.transaction_type::text,
  t.reference_type, t.reference_id, t.description, te.id, a.id, a.code, a.name,
  te.debit::numeric, te.credit::numeric, te.debit::numeric, te.credit::numeric,
  null::numeric, null::numeric, te.description, te.created_at, null::uuid,
  null::text, null::text, null::text, null::uuid, null::uuid, null::text
from public.transactions t
join public.transaction_entries te on te.transaction_id = t.id and te.school_id = t.school_id
join public.accounts a on a.id = te.account_id and a.school_id = t.school_id
where a.account_type = 'cash' and a.is_active = true
  and (
    t.transaction_type is distinct from 'journal' or t.reference_type is distinct from 'journal'
    or not exists (
      select 1 from public.journal_entries linked
      where linked.school_id = t.school_id
        and linked.source_module = 'journal'
        and (linked.source_record_id = t.id or linked.reference_id = t.id)
    )
  );

create or replace view public.bank_book as
select
  je.id as journal_entry_id, je.school_id, je.id as entry_id, je.entry_date,
  je.entry_type, je.reference_type, je.reference_id, je.description as entry_description,
  jl.id as journal_line_id, a.id as account_id, a.code as account_code,
  a.name as account_name, jl.debit::numeric as debit, jl.credit::numeric as credit,
  null::numeric as cash_in, null::numeric as cash_out,
  jl.debit::numeric as bank_in, jl.credit::numeric as bank_out, jl.description as line_description,
  jl.created_at, vp.id as vendor_payment_id,
  coalesce(bp.bill_number, rb.bill_number) as vendor_bill_number,
  vp.reference_number as vendor_payment_ref, v.name as vendor_name, v.id as vendor_id,
  pr.id as purchase_return_id, pr.return_number as purchase_return_number
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id and jl.school_id = je.school_id
join public.accounts a on a.id = jl.account_id and a.school_id = je.school_id
left join public.vendor_payments vp on vp.id = je.reference_id and vp.school_id = je.school_id and je.reference_type = 'vendor_payment'
left join public.purchase_returns pr on pr.id = je.reference_id and pr.school_id = je.school_id and je.reference_type = 'purchase_return_refund'
left join public.purchase_bills rb on rb.id = pr.bill_id and rb.school_id = pr.school_id
left join lateral (
  select pb.bill_number
  from public.bill_payment_allocations al
  join public.purchase_bills pb on pb.id = al.bill_id and pb.school_id = al.school_id
  where al.payment_id = vp.id and al.school_id = vp.school_id
  order by pb.bill_date, pb.created_at limit 1
) bp on true
left join public.vendors v on v.school_id = je.school_id and v.id = coalesce(vp.vendor_id, pr.vendor_id)
where a.account_type = 'bank' and a.is_active = true
union all
select
  t.id, t.school_id, t.id, t.transaction_date, t.transaction_type::text,
  t.reference_type, t.reference_id, t.description, te.id, a.id, a.code, a.name,
  te.debit::numeric, te.credit::numeric, null::numeric, null::numeric,
  te.debit::numeric, te.credit::numeric, te.description, te.created_at, null::uuid,
  null::text, null::text, null::text, null::uuid, null::uuid, null::text
from public.transactions t
join public.transaction_entries te on te.transaction_id = t.id and te.school_id = t.school_id
join public.accounts a on a.id = te.account_id and a.school_id = t.school_id
where a.account_type = 'bank' and a.is_active = true
  and (
    t.transaction_type is distinct from 'journal' or t.reference_type is distinct from 'journal'
    or not exists (
      select 1 from public.journal_entries linked
      where linked.school_id = t.school_id
        and linked.source_module = 'journal'
        and (linked.source_record_id = t.id or linked.reference_id = t.id)
    )
  );

create or replace function public.get_cash_book_summary(
  p_from_date date default null, p_to_date date default null
)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_school_id uuid := public.current_school_id();
  v_opening numeric;
  v_before_in numeric;
  v_before_out numeric;
  v_period_in numeric;
  v_period_out numeric;
begin
  if v_school_id is null then raise exception 'No school associated with current user'; end if;
  select coalesce(sum(opening_balance), 0) into v_opening
    from public.accounts where school_id = v_school_id and account_type = 'cash' and is_active = true;
  select coalesce(sum(cash_in), 0), coalesce(sum(cash_out), 0)
    into v_before_in, v_before_out from public.cash_book
   where school_id = v_school_id and p_from_date is not null and entry_date < p_from_date;
  select coalesce(sum(cash_in), 0), coalesce(sum(cash_out), 0)
    into v_period_in, v_period_out from public.cash_book
   where school_id = v_school_id and (p_from_date is null or entry_date >= p_from_date)
     and (p_to_date is null or entry_date <= p_to_date);
  return json_build_object(
    'opening_balance', v_opening + v_before_in - v_before_out,
    'cash_in', v_period_in, 'cash_out', v_period_out,
    'closing_balance', v_opening + v_before_in - v_before_out + v_period_in - v_period_out
  );
end;
$function$;

create or replace function public.save_manual_journal(
  p_school_id uuid,
  p_transaction_id uuid,
  p_fiscal_year_id uuid,
  p_date date,
  p_description text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_transaction_id uuid := p_transaction_id;
  v_number text;
  v_journal_id uuid;
  v_count integer;
  v_line jsonb;
  v_debit numeric;
  v_credit numeric;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.school_users
    where school_id = p_school_id and user_id = auth.uid() and is_active
      and lower(role) in ('owner', 'admin', 'accountant')
  ) then
    raise exception 'Only active school owners, admins and accountants may change journals.';
  end if;
  if p_date is null or nullif(btrim(p_description), '') is null then
    raise exception 'Journal date and particulars are required.';
  end if;
  if not exists (select 1 from public.fiscal_years where id = p_fiscal_year_id and school_id = p_school_id) then
    raise exception 'Fiscal year not found for this school.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal requires at least two accounting lines.';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_credit := coalesce((v_line->>'credit')::numeric, 0);
    if v_debit::text in ('NaN', 'Infinity', '-Infinity')
       or v_credit::text in ('NaN', 'Infinity', '-Infinity')
       or v_debit < 0 or v_credit < 0 or (v_debit > 0) = (v_credit > 0)
       or v_debit <> round(v_debit, 2) or v_credit <> round(v_credit, 2) then
      raise exception 'Each journal line must have a positive debit or credit with at most two decimal places.';
    end if;
    if not exists (
      select 1 from public.accounts
      where id = (v_line->>'accountId')::uuid and school_id = p_school_id and is_active
    ) then
      raise exception 'Invalid or inactive account for this school.';
    end if;
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  end loop;
  if v_total_debit <> v_total_credit then
    raise exception 'Journal entry is not balanced.';
  end if;

  if v_transaction_id is null then
    insert into public.transactions (school_id, transaction_date, transaction_type, description, reference_type)
    values (p_school_id, p_date, 'journal', p_description, 'journal')
    returning id, transaction_number into v_transaction_id, v_number;
  else
    select transaction_number into v_number from public.transactions
    where id = v_transaction_id and school_id = p_school_id
      and transaction_type = 'journal' and reference_type = 'journal'
    for update;
    if not found then raise exception 'Journal entry could not be found for this school.'; end if;

    perform 1 from public.journal_entries
    where school_id = p_school_id and source_module = 'journal'
      and (source_record_id = v_transaction_id or reference_id::text = v_transaction_id::text)
    for update;
    select count(*), (array_agg(id))[1] into v_count, v_journal_id
    from public.journal_entries
    where school_id = p_school_id and source_module = 'journal'
      and (source_record_id = v_transaction_id or reference_id::text = v_transaction_id::text);
    if v_count > 1 then raise exception 'Multiple canonical entries are linked to this journal; resolve them before editing.'; end if;
    if v_journal_id is not null then
      if exists (select 1 from public.bank_reconciliation_items where journal_entry_id = v_journal_id) then
        raise exception 'This journal is included in a bank reconciliation. Correct the reconciliation before editing it.';
      end if;
      if exists (
        select 1 from public.journal_entries where id = v_journal_id
          and ((source_record_id is not null and source_record_id <> v_transaction_id)
            or (reference_id is not null and reference_id::text <> v_transaction_id::text))
      ) or exists (
        select 1 from public.accounting_events where journal_entry_id = v_journal_id
          and (school_id <> p_school_id or source_module <> 'journal' or source_record_id <> v_transaction_id)
      ) then
        raise exception 'This journal has conflicting accounting links; resolve them before editing.';
      end if;
    end if;
    if exists (
      select 1 from public.accounting_events
      where school_id = p_school_id and source_module = 'journal' and source_record_id = v_transaction_id
        and journal_entry_id is distinct from v_journal_id
    ) then
      raise exception 'This journal has conflicting accounting links; resolve them before editing.';
    end if;
    update public.transactions set transaction_date = p_date, description = p_description
    where id = v_transaction_id and school_id = p_school_id;
    delete from public.transaction_entries where transaction_id = v_transaction_id and school_id = p_school_id;
  end if;

  insert into public.transaction_entries (school_id, transaction_id, account_id, debit, credit, description)
  select p_school_id, v_transaction_id, (line->>'accountId')::uuid,
    coalesce((line->>'debit')::numeric, 0), coalesce((line->>'credit')::numeric, 0),
    nullif(line->>'description', '')
  from jsonb_array_elements(p_lines) line;

  if v_journal_id is null then
    v_result := public.create_journal_entry(
      p_school_id, p_fiscal_year_id, p_date, p_description, 'GENERAL',
      'journal', 'journal_entries', v_transaction_id, 'journal', v_transaction_id::text, auth.uid(),
      (select jsonb_agg(line || jsonb_build_object(
        'description', coalesce(nullif(line->>'description', ''), p_description)
      )) from jsonb_array_elements(p_lines) line)
    );
    if coalesce((v_result->>'idempotent')::boolean, false) then
      raise exception 'This journal has conflicting accounting links; resolve them before saving.';
    end if;
  else
    update public.journal_entries
    set entry_date = p_date, description = p_description, fiscal_year_id = p_fiscal_year_id,
        updated_by = auth.uid(), updated_at = now()
    where id = v_journal_id and school_id = p_school_id;
    delete from public.journal_lines where journal_entry_id = v_journal_id and school_id = p_school_id;
    insert into public.journal_lines (school_id, fiscal_year_id, journal_entry_id, account_id, debit, credit, description)
    select p_school_id, p_fiscal_year_id, v_journal_id, (line->>'accountId')::uuid,
      coalesce((line->>'debit')::numeric, 0), coalesce((line->>'credit')::numeric, 0),
      coalesce(nullif(line->>'description', ''), p_description)
    from jsonb_array_elements(p_lines) line;
  end if;
  return jsonb_build_object('id', v_transaction_id, 'transaction_number', v_number);
end;
$function$;

create or replace function public.delete_manual_journal(p_school_id uuid, p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_journal_id uuid;
  v_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.school_users
    where school_id = p_school_id and user_id = auth.uid() and is_active
      and lower(role) in ('owner', 'admin', 'accountant')
  ) then
    raise exception 'Only active school owners, admins and accountants may change journals.';
  end if;
  perform 1 from public.transactions
  where id = p_transaction_id and school_id = p_school_id
    and transaction_type = 'journal' and reference_type = 'journal'
  for update;
  if not found then raise exception 'Journal entry could not be found for this school.'; end if;
  perform 1 from public.journal_entries
  where school_id = p_school_id and source_module = 'journal'
    and (source_record_id = p_transaction_id or reference_id::text = p_transaction_id::text)
  for update;
  select count(*), (array_agg(id))[1] into v_count, v_journal_id
  from public.journal_entries
  where school_id = p_school_id and source_module = 'journal'
    and (source_record_id = p_transaction_id or reference_id::text = p_transaction_id::text);
  if v_count > 1 then raise exception 'Multiple canonical entries are linked to this journal; resolve them before deleting.'; end if;
  if v_journal_id is not null then
    if exists (select 1 from public.bank_reconciliation_items where journal_entry_id = v_journal_id) then
      raise exception 'This journal is included in a bank reconciliation. Correct the reconciliation before deleting it.';
    end if;
    if exists (
      select 1 from public.journal_entries where id = v_journal_id
        and ((source_record_id is not null and source_record_id <> p_transaction_id)
          or (reference_id is not null and reference_id::text <> p_transaction_id::text))
    ) or exists (
      select 1 from public.accounting_events where journal_entry_id = v_journal_id
        and (school_id <> p_school_id or source_module <> 'journal' or source_record_id <> p_transaction_id)
    ) then
      raise exception 'This journal has conflicting accounting links; resolve them before deleting.';
    end if;
  end if;
  if exists (
    select 1 from public.accounting_events
    where school_id = p_school_id and source_module = 'journal' and source_record_id = p_transaction_id
      and journal_entry_id is distinct from v_journal_id
  ) then
    raise exception 'This journal has conflicting accounting links; resolve them before deleting.';
  end if;
  if v_journal_id is not null then
    delete from public.journal_entries where id = v_journal_id and school_id = p_school_id;
  end if;
  delete from public.transactions where id = p_transaction_id and school_id = p_school_id;
end;
$function$;

revoke all on function public.save_manual_journal(uuid, uuid, uuid, date, text, jsonb) from public, anon;
revoke all on function public.delete_manual_journal(uuid, uuid) from public, anon;
grant execute on function public.save_manual_journal(uuid, uuid, uuid, date, text, jsonb) to authenticated;
grant execute on function public.delete_manual_journal(uuid, uuid) to authenticated;
