-- Requires the inventory/purchase-return and canonical accounting migrations.
-- All return, stock and journal writes succeed or roll back together.
create or replace function public.record_purchase_return(
  p_school_id uuid, p_bill_id uuid, p_request_id uuid, p_return_date date,
  p_return_number text, p_reason text, p_reference text,
  p_settlement text, p_refund_account_id uuid, p_lines jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  b public.purchase_bills%rowtype;
  i public.purchase_bill_items%rowtype;
  inv public.inventory_items%rowtype;
  last_stock public.inventory_stock_movements%rowtype;
  r public.purchase_returns%rowtype;
  l jsonb;
  qty numeric; already_qty numeric; already_amount numeric; amount numeric;
  total numeric := 0; paid numeric; credits numeric; refunds numeric;
  stock_qty numeric; stock_avg numeric; stock_cost numeric; variance numeric;
  account_id uuid; payable_id uuid; variance_id uuid; fiscal_id uuid;
  code text; journal jsonb; refund_journal jsonb;
  journal_lines jsonb := '[]'::jsonb;
  label text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.school_users where school_id = p_school_id
      and user_id = auth.uid() and is_active and role in ('owner', 'admin')
  ) then raise exception 'Only school owners and admins may post purchase returns'; end if;
  if p_request_id is null or p_return_date is null or p_settlement is null
    or p_settlement not in ('credit', 'refund') then
    raise exception 'Return ID, date and valid settlement are required';
  end if;
  -- Serialize returns/payments on this bill. No browser-supplied costs/accounts.
  select * into b from public.purchase_bills
    where id = p_bill_id and school_id = p_school_id for update;
  if not found then raise exception 'Purchase bill not found'; end if;
  select * into r from public.purchase_returns where id = p_request_id and school_id = p_school_id;
  if found then
    if r.bill_id <> p_bill_id then raise exception 'Return request belongs to another bill'; end if;
    return jsonb_build_object('return_id', r.id, 'total_amount', r.total_amount, 'idempotent', true);
  end if;
  if b.journal_entry_id is null then raise exception 'Post the original bill accounting first'; end if;
  if p_return_date < b.bill_date or p_return_date > current_date then
    raise exception 'Return date must be between the bill date and today';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Select at least one return line';
  end if;
  if (select count(*) <> count(distinct x->>'bill_item_id') from jsonb_array_elements(p_lines) x) then
    raise exception 'Duplicate return line';
  end if;
  select id into fiscal_id from public.fiscal_years where school_id = p_school_id
    and not is_closed and p_return_date between start_date and end_date
    order by start_date desc limit 1;
  if fiscal_id is null then raise exception 'No open fiscal year covers the return date'; end if;
  -- Reuse the payable account actually credited by the original bill.
  select jl.account_id into payable_id from public.journal_lines jl
    join public.accounts a on a.id = jl.account_id and a.school_id = jl.school_id
    where jl.journal_entry_id = b.journal_entry_id and jl.school_id = p_school_id
      and jl.credit > 0 and lower(a.account_type) in ('payable', 'liability')
    order by jl.credit desc limit 1;
  if payable_id is null then raise exception 'Original bill payable account not found'; end if;
  if p_settlement = 'refund' and not exists (
    select 1 from public.accounts where id = p_refund_account_id and school_id = p_school_id
      and is_active and lower(account_type) in ('cash', 'bank')
  ) then raise exception 'Select an active Cash or Bank refund account'; end if;
  label := coalesce(nullif(trim(p_return_number), ''), 'PR-' || p_request_id::text);
  insert into public.purchase_returns(id, school_id, bill_id, vendor_id, return_number,
    return_date, reason, reference, settlement_type, refund_account_id, created_by)
  values(p_request_id, p_school_id, b.id, b.vendor_id, label, p_return_date,
    nullif(trim(p_reason), ''), nullif(trim(p_reference), ''), p_settlement,
    case when p_settlement = 'refund' then p_refund_account_id end, auth.uid());
  -- Existing stock writers insert into this table; serialize return stock writes.
  lock table public.inventory_stock_movements in share row exclusive mode;
  for l in select value from jsonb_array_elements(p_lines) order by value->>'bill_item_id'
  loop
    select * into i from public.purchase_bill_items where id = (l->>'bill_item_id')::uuid
      and bill_id = b.id and school_id = p_school_id for update;
    if not found then raise exception 'Return line does not belong to this bill'; end if;
    qty := (l->>'quantity')::numeric;
    if qty is null or qty::text in ('NaN', 'Infinity', '-Infinity') or qty <= 0 or qty <> round(qty, 3) then
      raise exception 'Return quantities must be positive with at most three decimals';
    end if;
    select coalesce(sum(quantity),0), coalesce(sum(amount),0) into already_qty, already_amount
      from public.purchase_return_items where bill_item_id = i.id and school_id = p_school_id;
    if qty + already_qty > i.quantity then raise exception 'Return quantity exceeds remaining purchased quantity'; end if;
    -- Cumulative rounding makes the final partial return exactly reverse the line.
    amount := round(i.amount * (already_qty + qty) / i.quantity, 2) - already_amount;
    if amount <= 0 then raise exception 'Return line amount must be greater than zero'; end if;
    account_id := i.expense_account_id;
    if b.purchase_type = 'inventory' then
      select * into inv from public.inventory_items where id = i.inventory_item_id
        and school_id = p_school_id for update;
      if not found then raise exception 'Inventory item not found for return line'; end if;
      code := case inv.category when 'books' then 'BOOKS_INVENTORY'
        when 'uniform' then 'UNIFORM_INVENTORY' else 'OTHER_RESALE_INVENTORY' end;
      select a.id into account_id from public.accounts a where a.school_id = p_school_id
        and a.code = record_purchase_return.code and a.is_active;
      if account_id is null then raise exception 'Inventory account missing: %', code; end if;
      if not exists (select 1 from public.journal_lines jl where jl.journal_entry_id = b.journal_entry_id
        and jl.school_id = p_school_id and jl.account_id = record_purchase_return.account_id and jl.debit > 0) then
        raise exception 'Inventory category account differs from original bill; reconcile the bill first';
      end if;
      select * into last_stock from public.inventory_stock_movements
        where school_id = p_school_id and inventory_item_id = inv.id
        order by movement_date desc, created_at desc limit 1;
      if not found then raise exception 'Original inventory purchase has no stock movements'; end if;
      if p_return_date < last_stock.movement_date then
        raise exception 'Return date cannot precede the latest stock movement';
      end if;
      stock_qty := last_stock.balance_quantity;
      stock_avg := last_stock.balance_unit_cost;
      if qty > stock_qty then raise exception 'Not enough stock to return %. Available: %', inv.name, stock_qty; end if;
      stock_cost := round(qty * stock_avg, 2);
      insert into public.inventory_stock_movements(school_id, inventory_item_id, movement_date,
        movement_type, quantity, unit_cost, total_cost, balance_quantity, balance_unit_cost,
        ref_table, ref_id, notes, created_by, created_at)
      values(p_school_id, inv.id, p_return_date, 'purchase_return', -qty, stock_avg,
        stock_cost, stock_qty - qty, case when stock_qty = qty then 0 else stock_avg end,
        'purchase_returns', p_request_id, label, auth.uid(), clock_timestamp());
      journal_lines := journal_lines || jsonb_build_array(jsonb_build_object(
        'accountId', account_id, 'debit', 0, 'credit', stock_cost, 'description', 'Inventory return - ' || inv.name));
      variance := amount - stock_cost;
      if variance <> 0 then
        code := case inv.category when 'books' then 'BOOKS_COGS'
          when 'uniform' then 'UNIFORM_COGS' else 'OTHER_COGS' end;
        select a.id into variance_id from public.accounts a where a.school_id = p_school_id
          and a.code = record_purchase_return.code and a.is_active;
        if variance_id is null then raise exception 'Return cost variance account missing: %', code; end if;
        journal_lines := journal_lines || jsonb_build_array(jsonb_build_object(
          'accountId', variance_id, 'debit', greatest(-variance, 0), 'credit', greatest(variance, 0),
          'description', 'Purchase return cost variance - ' || inv.name));
      end if;
    else
      if account_id is null or not exists (select 1 from public.journal_lines jl
        where jl.journal_entry_id = b.journal_entry_id and jl.school_id = p_school_id
          and jl.account_id = record_purchase_return.account_id and jl.debit > 0) then
        raise exception 'Original expense account not found';
      end if;
      journal_lines := journal_lines || jsonb_build_array(jsonb_build_object(
        'accountId', account_id, 'debit', 0, 'credit', amount, 'description', 'Purchase return - ' || coalesce(i.description, label)));
    end if;
    insert into public.purchase_return_items(school_id, return_id, bill_item_id,
      inventory_item_id, description, quantity, unit_cost, amount)
    values(p_school_id, p_request_id, i.id, case when b.purchase_type = 'inventory' then i.inventory_item_id end,
      i.description, qty, i.unit_price, amount);
    total := total + amount;
  end loop;
  select coalesce(sum(amount),0) into paid from public.bill_payment_allocations
    where bill_id = b.id and school_id = p_school_id;
  select coalesce(sum(total_amount) filter (where settlement_type = 'credit'),0),
    coalesce(sum(total_amount) filter (where settlement_type = 'refund'),0)
    into credits, refunds from public.purchase_returns
    where bill_id = b.id and school_id = p_school_id and id <> p_request_id;
  if p_settlement = 'credit' and total > b.total_amount - paid - credits then
    raise exception 'Credit exceeds unpaid bill balance; use refund for amounts already paid';
  end if;
  if p_settlement = 'refund' and total > paid - refunds then
    raise exception 'Refund exceeds the amount paid less earlier refunds';
  end if;
  journal_lines := journal_lines || jsonb_build_array(jsonb_build_object(
    'accountId', payable_id, 'debit', total, 'credit', 0, 'description', 'Vendor payable reduced - ' || label));
  journal := public.create_journal_entry(p_school_id, fiscal_id, p_return_date,
    'Purchase return - ' || label, 'ADJUSTMENT', 'vendor_purchases', 'purchase_returns',
    p_request_id, 'purchase_return', p_request_id::text, auth.uid(), journal_lines);
  if p_settlement = 'refund' then
    refund_journal := public.create_journal_entry(p_school_id, fiscal_id, p_return_date,
      'Vendor refund - ' || label, 'RECEIPT', 'vendor_purchases', 'vendor_refunds',
      p_request_id, 'purchase_return_refund', p_request_id::text, auth.uid(),
      jsonb_build_array(
        jsonb_build_object('accountId', p_refund_account_id, 'debit', total, 'credit', 0, 'description', 'Refund received - ' || label),
        jsonb_build_object('accountId', payable_id, 'debit', 0, 'credit', total, 'description', 'Vendor refund settlement - ' || label)));
  end if;
  update public.purchase_returns set total_amount = total,
    journal_entry_id = (journal->>'journal_entry_id')::uuid,
    refund_journal_entry_id = (refund_journal->>'journal_entry_id')::uuid
    where id = p_request_id and school_id = p_school_id;
  return jsonb_build_object('return_id', p_request_id, 'total_amount', total,
    'journal_entry_id', journal->>'journal_entry_id', 'idempotent', false);
end;
$$;
revoke all on function public.record_purchase_return(uuid,uuid,uuid,date,text,text,text,text,uuid,jsonb) from public;
grant execute on function public.record_purchase_return(uuid,uuid,uuid,date,text,text,text,text,uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';

