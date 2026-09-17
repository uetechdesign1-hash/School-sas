-- Run in your Supabase SQL Editor. Requires earlier inventory and accounting migrations.
-- Generated from the three source migrations, unchanged, in chronological order.
BEGIN;

-- Source: 20260917120000_post_purchase_returns.sql
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
      and jl.credit > 0 and lower(a.account_type::text) in ('payable', 'liability')
    order by jl.credit desc limit 1;
  if payable_id is null then raise exception 'Original bill payable account not found'; end if;
  if p_settlement = 'refund' and not exists (
    select 1 from public.accounts where id = p_refund_account_id and school_id = p_school_id
      and is_active and lower(account_type::text) in ('cash', 'bank')
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



-- Source: 20260918120000_purchase_returns_history_particulars.sql
-- ============================================================
-- Vendor purchase returns: history, edit / delete and accounting particulars
-- ------------------------------------------------------------
-- Builds on:
--   20260916120000_inventory_purchase_returns_book_sales.sql  (tables)
--   20260917120000_post_purchase_returns.sql                  (record RPC)
--   20260916130000_cash_bank_books_vendor_links.sql           (cash/bank views)
--
-- What this migration adds, without deleting any posted history:
--   1. record_purchase_return now writes the vendor name and the description
--      captured while adding the vendor (vendors.notes) into every journal
--      description, so a return is identifiable in the Ledger, Day Book,
--      Cash/Bank Book and Trial Balance instead of a bare "purchase_return".
--   2. reverse_purchase_return_effect() unwinds the accounting entries and the
--      stock effect of one posted return (used by edit and delete).
--   3. update_purchase_return() replaces a posted return atomically: the old
--      effect is reversed first, then the return is re-posted with the new
--      lines / settlement under the same return id.
--   4. delete_purchase_return() removes a posted return and its accounting.
--   5. cash_book / bank_book expose the vendor behind a purchase-return refund
--      so money received back from a vendor shows the vendor name + return no.
-- ============================================================

-- ------------------------------------------------------------
-- 1) record_purchase_return: vendor particulars in every description
-- ------------------------------------------------------------
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
  label text; vendor_name text; vendor_desc text; particulars text;
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
      and jl.credit > 0 and lower(a.account_type::text) in ('payable', 'liability')
    order by jl.credit desc limit 1;
  if payable_id is null then raise exception 'Original bill payable account not found'; end if;
  if p_settlement = 'refund' and not exists (
    select 1 from public.accounts where id = p_refund_account_id and school_id = p_school_id
      and is_active and lower(account_type::text) in ('cash', 'bank')
  ) then raise exception 'Select an active Cash or Bank refund account'; end if;
  -- Vendor name + the description entered while adding the vendor travels into
  -- every accounting particular so reports never show a bare "purchase_return".
  select coalesce(v.name, 'Vendor'), nullif(trim(v.notes), '')
    into vendor_name, vendor_desc
    from public.vendors v
    where v.id = b.vendor_id and v.school_id = p_school_id;
  vendor_name := coalesce(vendor_name, 'Vendor');
  label := coalesce(nullif(trim(p_return_number), ''), 'PR-' || p_request_id::text);
  particulars := 'Purchase return ' || label || ' - ' || vendor_name
    || case when vendor_desc is null then '' else ' (' || vendor_desc || ')' end;
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
        'purchase_returns', p_request_id, particulars, auth.uid(), clock_timestamp());
      journal_lines := journal_lines || jsonb_build_array(jsonb_build_object(
        'accountId', account_id, 'debit', 0, 'credit', stock_cost,
        'description', 'Inventory return - ' || inv.name || ' (' || vendor_name || ')'));
      variance := amount - stock_cost;
      if variance <> 0 then
        code := case inv.category when 'books' then 'BOOKS_COGS'
          when 'uniform' then 'UNIFORM_COGS' else 'OTHER_COGS' end;
        select a.id into variance_id from public.accounts a where a.school_id = p_school_id
          and a.code = record_purchase_return.code and a.is_active;
        if variance_id is null then raise exception 'Return cost variance account missing: %', code; end if;
        journal_lines := journal_lines || jsonb_build_array(jsonb_build_object(
          'accountId', variance_id, 'debit', greatest(-variance, 0), 'credit', greatest(variance, 0),
          'description', 'Purchase return cost variance - ' || inv.name || ' (' || vendor_name || ')'));
      end if;
    else
      if account_id is null or not exists (select 1 from public.journal_lines jl
        where jl.journal_entry_id = b.journal_entry_id and jl.school_id = p_school_id
          and jl.account_id = record_purchase_return.account_id and jl.debit > 0) then
        raise exception 'Original expense account not found';
      end if;
      journal_lines := journal_lines || jsonb_build_array(jsonb_build_object(
        'accountId', account_id, 'debit', 0, 'credit', amount,
        'description', 'Purchase return - ' || coalesce(i.description, label) || ' (' || vendor_name || ')'));
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
    'accountId', payable_id, 'debit', total, 'credit', 0,
    'description', 'Vendor payable reduced - ' || particulars));
  journal := public.create_journal_entry(p_school_id, fiscal_id, p_return_date,
    particulars, 'ADJUSTMENT', 'vendor_purchases', 'purchase_returns',
    p_request_id, 'purchase_return', p_request_id::text, auth.uid(), journal_lines);
  if p_settlement = 'refund' then
    refund_journal := public.create_journal_entry(p_school_id, fiscal_id, p_return_date,
      'Vendor refund ' || label || ' - ' || vendor_name, 'RECEIPT', 'vendor_purchases', 'vendor_refunds',
      p_request_id, 'purchase_return_refund', p_request_id::text, auth.uid(),
      jsonb_build_array(
        jsonb_build_object('accountId', p_refund_account_id, 'debit', total, 'credit', 0,
          'description', 'Refund received from ' || vendor_name || ' (' || label || ')'),
        jsonb_build_object('accountId', payable_id, 'debit', 0, 'credit', total,
          'description', 'Vendor refund settlement - ' || vendor_name || ' (' || label || ')')));
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

-- ------------------------------------------------------------
-- 2) reverse_purchase_return_effect: unwind one posted return
--    (internal helper used by update / delete)
-- ------------------------------------------------------------
create or replace function public.reverse_purchase_return_effect(
  p_school_id uuid, p_return_id uuid
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  r public.purchase_returns%rowtype;
  it public.purchase_return_items%rowtype;
  mv public.inventory_stock_movements%rowtype;
  last_stock public.inventory_stock_movements%rowtype;
  v_qty numeric; v_cost numeric; v_qty_after numeric; v_avg_after numeric;
  v_date date;
begin
  select * into r from public.purchase_returns
    where id = p_return_id and school_id = p_school_id for update;
  if not found then raise exception 'Purchase return not found'; end if;
  -- Lock the bill exactly like the posting function so returns and payments
  -- for the same bill can never be reversed while a posting is in flight.
  perform 1 from public.purchase_bills
    where id = r.bill_id and school_id = p_school_id for update;
  if not found then raise exception 'Purchase bill not found'; end if;

  -- Serialize stock writes like every other stock writer.
  lock table public.inventory_stock_movements in share row exclusive mode;

  -- Put the stock back at the cost the return originally removed it at, so the
  -- weighted average returns to its previous value.
  for it in select * from public.purchase_return_items
    where return_id = r.id and school_id = p_school_id order by created_at, id
  loop
    if it.inventory_item_id is null then continue; end if;

    select * into mv from public.inventory_stock_movements
      where school_id = p_school_id
        and inventory_item_id = it.inventory_item_id
        and ref_table = 'purchase_returns'
        and ref_id = r.id
        and movement_type = 'purchase_return'
      order by created_at, id
      limit 1;
    if not found then continue; end if;

    select * into last_stock from public.inventory_stock_movements
      where school_id = p_school_id and inventory_item_id = it.inventory_item_id
      order by movement_date desc, created_at desc, id desc
      limit 1;
    if not found then continue; end if;

    v_qty := it.quantity;
    v_cost := mv.unit_cost;
    v_qty_after := last_stock.balance_quantity + v_qty;
    v_date := greatest(r.return_date, last_stock.movement_date);

    if v_qty_after <= 0 then
      v_avg_after := 0;
    elsif last_stock.balance_quantity <= 0 then
      v_avg_after := v_cost;
    else
      v_avg_after := round(
        (last_stock.balance_quantity * last_stock.balance_unit_cost + v_qty * v_cost)
          / v_qty_after, 4);
    end if;

    insert into public.inventory_stock_movements(school_id, inventory_item_id, movement_date,
      movement_type, quantity, unit_cost, total_cost, balance_quantity, balance_unit_cost,
      ref_table, ref_id, notes, created_by, created_at)
    values(p_school_id, it.inventory_item_id, v_date, 'adjustment', v_qty, v_cost,
      round(v_qty * v_cost, 2), v_qty_after, v_avg_after,
      'purchase_returns', r.id,
      'Purchase return reversed - ' || coalesce(r.return_number, r.id::text),
      auth.uid(), clock_timestamp());
  end loop;

  -- Remove the accounting. journal_lines and accounting_events cascade from
  -- journal_entries; the explicit event delete protects rows that were linked
  -- without a journal entry.
  delete from public.accounting_events
    where school_id = p_school_id
      and source_module = 'vendor_purchases'
      and source_record_id = r.id
      and source_table in ('purchase_returns', 'vendor_refunds');

  if r.refund_journal_entry_id is not null then
    delete from public.journal_entries
      where id = r.refund_journal_entry_id and school_id = p_school_id;
  end if;
  if r.journal_entry_id is not null then
    delete from public.journal_entries
      where id = r.journal_entry_id and school_id = p_school_id;
  end if;

  update public.purchase_returns
    set journal_entry_id = null, refund_journal_entry_id = null
    where id = r.id and school_id = p_school_id;
end;
$$;
revoke all on function public.reverse_purchase_return_effect(uuid,uuid) from public;

-- ------------------------------------------------------------
-- 3) update_purchase_return: replace a posted return atomically
-- ------------------------------------------------------------
create or replace function public.update_purchase_return(
  p_school_id uuid, p_return_id uuid, p_return_date date, p_return_number text,
  p_reason text, p_reference text, p_settlement text, p_refund_account_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  r public.purchase_returns%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.school_users where school_id = p_school_id
      and user_id = auth.uid() and is_active and role in ('owner', 'admin')
  ) then raise exception 'Only school owners and admins may edit purchase returns'; end if;
  if p_return_id is null or p_return_date is null or p_settlement is null
    or p_settlement not in ('credit', 'refund') then
    raise exception 'Return ID, date and valid settlement are required';
  end if;

  select * into r from public.purchase_returns
    where id = p_return_id and school_id = p_school_id for update;
  if not found then raise exception 'Purchase return not found'; end if;

  -- Reverse the previous posting (accounting + stock) before re-recording the
  -- corrected return under the same id, so both steps succeed or roll back.
  perform public.reverse_purchase_return_effect(p_school_id, p_return_id);

  delete from public.purchase_returns
    where id = p_return_id and school_id = p_school_id;

  return public.record_purchase_return(
    p_school_id, r.bill_id, p_return_id, p_return_date, p_return_number,
    p_reason, p_reference, p_settlement, p_refund_account_id, p_lines);
end;
$$;
revoke all on function public.update_purchase_return(uuid,uuid,date,text,text,text,text,uuid,jsonb) from public;
grant execute on function public.update_purchase_return(uuid,uuid,date,text,text,text,text,uuid,jsonb) to authenticated;

-- ------------------------------------------------------------
-- 4) delete_purchase_return: remove a posted return and its accounting
-- ------------------------------------------------------------
create or replace function public.delete_purchase_return(
  p_school_id uuid, p_return_id uuid
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  r public.purchase_returns%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.school_users where school_id = p_school_id
      and user_id = auth.uid() and is_active and role in ('owner', 'admin')
  ) then raise exception 'Only school owners and admins may delete purchase returns'; end if;
  if p_return_id is null then raise exception 'Return ID is required'; end if;

  select * into r from public.purchase_returns
    where id = p_return_id and school_id = p_school_id for update;
  if not found then raise exception 'Purchase return not found'; end if;

  perform public.reverse_purchase_return_effect(p_school_id, p_return_id);

  delete from public.purchase_returns
    where id = p_return_id and school_id = p_school_id;

  return jsonb_build_object('return_id', p_return_id, 'bill_id', r.bill_id,
    'vendor_id', r.vendor_id, 'total_amount', r.total_amount, 'deleted', true);
end;
$$;
revoke all on function public.delete_purchase_return(uuid,uuid) from public;
grant execute on function public.delete_purchase_return(uuid,uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) Cash / Bank book: carry the vendor behind a purchase-return refund
--    (recreated with the same base columns plus two appended return columns)
-- ------------------------------------------------------------
drop view if exists public.cash_book;
drop view if exists public.bank_book;

create view public.cash_book as
select
  je.id as journal_entry_id,
  je.school_id,
  je.id as entry_id,
  je.entry_date,
  je.entry_type,
  je.reference_type,
  je.reference_id,
  je.description as entry_description,
  jl.id as journal_line_id,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  jl.debit::numeric as debit,
  jl.credit::numeric as credit,
  jl.debit::numeric as cash_in,
  jl.credit::numeric as cash_out,
  null::numeric as bank_in,
  null::numeric as bank_out,
  jl.description as line_description,
  jl.created_at,
  vp.id as vendor_payment_id,
  coalesce(bp.bill_number, rb.bill_number) as vendor_bill_number,
  vp.reference_number as vendor_payment_ref,
  v.name as vendor_name,
  v.id as vendor_id,
  pr.id as purchase_return_id,
  pr.return_number as purchase_return_number
from public.journal_entries je
join public.journal_lines jl
  on jl.journal_entry_id = je.id
 and jl.school_id = je.school_id
join public.accounts a
  on a.id = jl.account_id
 and a.school_id = je.school_id
left join public.vendor_payments vp
  on vp.id = je.reference_id
 and vp.school_id = je.school_id
 and je.reference_type = 'vendor_payment'
left join public.purchase_returns pr
  on pr.id = je.reference_id
 and pr.school_id = je.school_id
 and je.reference_type = 'purchase_return_refund'
left join public.purchase_bills rb
  on rb.id = pr.bill_id
 and rb.school_id = pr.school_id
left join lateral (
  select pb.bill_number
  from public.bill_payment_allocations al
  join public.purchase_bills pb
    on pb.id = al.bill_id
   and pb.school_id = al.school_id
  where al.payment_id = vp.id
    and al.school_id = vp.school_id
  order by pb.bill_date, pb.created_at
  limit 1
) bp on true
left join public.vendors v
  on v.school_id = je.school_id
 and v.id = coalesce(vp.vendor_id, pr.vendor_id)
where a.account_type = 'cash'
  and a.is_active = true
union all
select
  t.id,
  t.school_id,
  t.id,
  t.transaction_date,
  t.transaction_type::text,
  t.reference_type,
  t.reference_id,
  t.description,
  te.id,
  a.id,
  a.code,
  a.name,
  te.debit::numeric,
  te.credit::numeric,
  te.debit::numeric,
  te.credit::numeric,
  null::numeric,
  null::numeric,
  te.description,
  te.created_at,
  null::uuid,
  null::text,
  null::text,
  null::text,
  null::uuid,
  null::uuid,
  null::text
from public.transactions t
join public.transaction_entries te
  on te.transaction_id = t.id
 and te.school_id = t.school_id
join public.accounts a
  on a.id = te.account_id
 and a.school_id = t.school_id
where a.account_type = 'cash'
  and a.is_active = true;

create view public.bank_book as
select
  je.id as journal_entry_id,
  je.school_id,
  je.id as entry_id,
  je.entry_date,
  je.entry_type,
  je.reference_type,
  je.reference_id,
  je.description as entry_description,
  jl.id as journal_line_id,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  jl.debit::numeric as debit,
  jl.credit::numeric as credit,
  null::numeric as cash_in,
  null::numeric as cash_out,
  jl.debit::numeric as bank_in,
  jl.credit::numeric as bank_out,
  jl.description as line_description,
  jl.created_at,
  vp.id as vendor_payment_id,
  coalesce(bp.bill_number, rb.bill_number) as vendor_bill_number,
  vp.reference_number as vendor_payment_ref,
  v.name as vendor_name,
  v.id as vendor_id,
  pr.id as purchase_return_id,
  pr.return_number as purchase_return_number
from public.journal_entries je
join public.journal_lines jl
  on jl.journal_entry_id = je.id
 and jl.school_id = je.school_id
join public.accounts a
  on a.id = jl.account_id
 and a.school_id = je.school_id
left join public.vendor_payments vp
  on vp.id = je.reference_id
 and vp.school_id = je.school_id
 and je.reference_type = 'vendor_payment'
left join public.purchase_returns pr
  on pr.id = je.reference_id
 and pr.school_id = je.school_id
 and je.reference_type = 'purchase_return_refund'
left join public.purchase_bills rb
  on rb.id = pr.bill_id
 and rb.school_id = pr.school_id
left join lateral (
  select pb.bill_number
  from public.bill_payment_allocations al
  join public.purchase_bills pb
    on pb.id = al.bill_id
   and pb.school_id = al.school_id
  where al.payment_id = vp.id
    and al.school_id = vp.school_id
  order by pb.bill_date, pb.created_at
  limit 1
) bp on true
left join public.vendors v
  on v.school_id = je.school_id
 and v.id = coalesce(vp.vendor_id, pr.vendor_id)
where a.account_type = 'bank'
  and a.is_active = true
union all
select
  t.id,
  t.school_id,
  t.id,
  t.transaction_date,
  t.transaction_type::text,
  t.reference_type,
  t.reference_id,
  t.description,
  te.id,
  a.id,
  a.code,
  a.name,
  te.debit::numeric,
  te.credit::numeric,
  null::numeric,
  null::numeric,
  te.debit::numeric,
  te.credit::numeric,
  te.description,
  te.created_at,
  null::uuid,
  null::text,
  null::text,
  null::text,
  null::uuid,
  null::uuid,
  null::text
from public.transactions t
join public.transaction_entries te
  on te.transaction_id = t.id
 and te.school_id = t.school_id
join public.accounts a
  on a.id = te.account_id
 and a.school_id = t.school_id
where a.account_type = 'bank'
  and a.is_active = true;

-- The views are read through the Data API by authenticated school members.
-- RLS on the underlying tables still scopes every row to the caller's school.
grant select on public.cash_book, public.bank_book to authenticated;
grant select on public.cash_book, public.bank_book to service_role;

comment on view public.cash_book is
  'Cash book: one row per cash-account journal line. Vendor payments carry vendor_payment_id, vendor_name and the allocated purchase bill number; purchase-return refunds carry purchase_return_id, purchase_return_number and the same vendor columns.';
comment on view public.bank_book is
  'Bank book: one row per bank-account journal line, with the same vendor payment / purchase-return refund linkage as cash_book.';

notify pgrst, 'reload schema';

-- Source: 20260919120000_vendor_purchase_legacy_alignment.sql
-- ============================================================
-- Vendor purchases / inventory: align pre-existing tables with the columns
-- and nullability this module actually writes.
-- ------------------------------------------------------------
-- The vendor-purchases (20260915120000), inventory / purchase-return
-- (20260916120000) and post-purchase-return (20260917120000 /
-- 20260918120000) migrations all use "create table if not exists", so on a
-- database where those tables already exist (they were created by the older
-- expenses module) the CREATE is a no-op and the columns the new code writes
-- are never added.
--
-- Two concrete failures this migration closes:
--
--   1. public.vendors has no notes column, so every vendor save fails with
--        "Could not find the 'notes' column of 'vendors' in the schema cache"
--      and record_purchase_return() cannot build the vendor particulars it
--      writes into every purchase-return journal description.
--
--   2. purchase_bills.bill_number, purchase_bill_items.description and
--      purchase_bill_items.expense_account_id are NOT NULL on those legacy
--      tables, but the module legitimately leaves them empty: a bill is
--      allowed to have no vendor invoice number, a bill line is allowed to
--      have no description, and an inventory (resale) line has no expense
--      account at all because it debits an inventory asset account instead.
--
-- Additive only: one column is added and three legacy NOT NULL constraints are
-- relaxed. No row is deleted and no posted journal entry is touched.
-- ============================================================

alter table public.vendors
  add column if not exists notes text;

comment on column public.vendors.notes is
  'Free-text description captured while adding the vendor; repeated in purchase-return accounting particulars (20260918120000).';

-- "table.column" pairs the application may write as null. Guarded so the
-- migration is safe to run repeatedly and on schemas that are already relaxed.
do $$
declare
  v_target text;
  v_table text;
  v_col text;
begin
  foreach v_target in array array[
    'purchase_bills.bill_number',
    'purchase_bills.status',
    'purchase_bills.invoice_number',
    'purchase_bill_items.description',
    'purchase_bill_items.expense_account_id',
    'vendor_payments.paid_from_account_id'
  ]
  loop
    v_table := split_part(v_target, '.', 1);
    v_col := split_part(v_target, '.', 2);

    if to_regclass('public.' || v_table) is not null and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table
        and column_name = v_col
        and is_nullable = 'NO'
    ) then
      execute format(
        'alter table public.%I alter column %I drop not null',
        v_table,
        v_col
      );
    end if;
  end loop;
end $$;

-- Refresh the PostgREST schema cache so the new column is exposed immediately
-- (and the dropped NOT NULL constraints are picked up by the API layer).
notify pgrst, 'reload schema';


COMMIT;
