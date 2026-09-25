-- Fix: deleting rows from public.journal_entries failed with
--
--   ERROR: update or delete on table "journal_entries" violates foreign key
--   constraint "vendor_payments_journal_entry_id_fkey" on table
--   "vendor_payments"
--
-- The schema migrations declare ON DELETE SET NULL / ON DELETE CASCADE, but
-- "create table if not exists" never rewrites a table that already exists, so
-- some deployments still carry the default NO ACTION rule on one or more
-- foreign keys pointing at journal_entries. That blocked every delete that
-- starts on the Expenses page or on the accounting pages (journal, payment,
-- vendor purchases), because the linked vendor payment / purchase bill /
-- purchase return row still referenced the entry.
--
-- This migration rebuilds EVERY foreign key that references
-- public.journal_entries:
--
--   journal_lines, accounting_events -> ON DELETE CASCADE (they belong to
--                                       the entry and must vanish with it)
--   every other public table         -> ON DELETE SET NULL
--     (vendor_payments, purchase_bills, purchase_returns, ...)
--
-- It is idempotent: each constraint is dropped and re-added with the same
-- name and the wanted delete rule.

do $$
declare
  v_constraint record;
  v_definition text;
  v_action text;
begin
  for v_constraint in
    select
      con.oid,
      con.conname,
      ns.nspname as schema_name,
      tbl.relname as table_name
    from pg_constraint con
    join pg_class tbl on tbl.oid = con.conrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'public.journal_entries'::regclass
      and ns.nspname = 'public'
  loop
    if v_constraint.table_name in ('journal_lines', 'accounting_events') then
      v_action := 'CASCADE';
    else
      v_action := 'SET NULL';
    end if;

    -- pg_get_constraintdef returns e.g.
    --   FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id)
    -- followed by a trailing ON DELETE clause when one exists. It is stripped
    -- so the wanted action can be appended exactly once.
    v_definition := regexp_replace(
      pg_get_constraintdef(v_constraint.oid),
      '\s+ON DELETE\s+.*$',
      '',
      'i'
    );

    execute format(
      'alter table %I.%I drop constraint %I, add constraint %I %s on delete %s',
      v_constraint.schema_name,
      v_constraint.table_name,
      v_constraint.conname,
      v_constraint.conname,
      v_definition,
      v_action
    );
  end loop;
end $$;
