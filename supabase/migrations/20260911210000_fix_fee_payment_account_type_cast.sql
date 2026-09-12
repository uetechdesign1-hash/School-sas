-- Existing deployments may already have the fee-payment RPC marked applied.
-- Recreate its stored definition with an enum-safe account_type cast.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'record_fee_payment'
    and p.pronargs = 10;

  if v_definition is null then
    raise exception 'public.record_fee_payment function was not found';
  end if;

  v_definition := replace(
    v_definition,
    'lower(account_type) in',
    'lower(account_type::text) in'
  );

  execute v_definition;
end;
$$;
