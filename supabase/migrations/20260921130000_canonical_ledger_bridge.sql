-- ============================================================
-- CANONICAL LEDGER BRIDGE + ORPHANED PAYMENT JOURNAL REPAIR
-- ------------------------------------------------------------
-- Background
--   Payment, expense, purchase, contra, payroll and fee flows post ONE
--   canonical journal entry (journal_entries / journal_lines). Some flows
--   also wrote the legacy transactions / transaction_entries tables
--   (historical behaviour) and some reports still read only the legacy tables.
--
-- This migration gives every report ONE canonical dataset:
--
--   legacy_superseded_transactions -> legacy transactions already represented
--                                     by a canonical journal entry
--   ledger_transactions            -> legacy (not superseded) + canonical
--   ledger_entries                 -> legacy (not superseded) + canonical
--
--   * nothing is deleted from the legacy tables, so historical accounting,
--     reconciliations and audit history stay intact
--   * each financial event appears exactly once in the reports
--
-- It also repairs the orphaned journal entries created by the older Payment
-- page flow (journal posted without a canonical link), which is why a deleted
-- payment kept showing in the Cash Book, Bank Book and Ledger.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Legacy transactions already represented canonically
-- ------------------------------------------------------------
create or replace view public.legacy_superseded_transactions as
select
  t.id as transaction_id,
  t.school_id
from public.transactions t
where
  -- (a) the journal entry points at the legacy transaction
  exists (
    select 1
    from public.journal_entries je
    where je.school_id = t.school_id
      and (
        je.source_record_id = t.id
        or je.reference_id = t.id
      )
  )
  -- (b) the legacy transaction belongs to an expense record that already has
  --     a canonical journal entry
  or exists (
    select 1
    from public.expenses e
    join public.journal_entries je
      on je.school_id = e.school_id
     and je.source_record_id = e.id
    where e.transaction_id = t.id
  )
  -- (c) exact mirror: the journal entry has the same date and exactly the
  --     same lines as the legacy transaction
  or exists (
    select 1
    from public.journal_entries je
    where je.school_id = t.school_id
      and je.entry_date = t.transaction_date
      and exists (
        select 1
        from public.journal_lines jl
        where jl.journal_entry_id = je.id
      )
      and not exists (
        select 1
        from public.transaction_entries te
        where te.transaction_id = t.id
          and not exists (
            select 1
            from public.journal_lines jl2
            where jl2.journal_entry_id = je.id
              and jl2.account_id = te.account_id
              and coalesce(jl2.debit, 0) = coalesce(te.debit, 0)
              and coalesce(jl2.credit, 0) = coalesce(te.credit, 0)
          )
      )
      and not exists (
        select 1
        from public.journal_lines jl3
        where jl3.journal_entry_id = je.id
          and not exists (
            select 1
            from public.transaction_entries te2
            where te2.transaction_id = t.id
              and te2.account_id = jl3.account_id
              and coalesce(te2.debit, 0) = coalesce(jl3.debit, 0)
              and coalesce(te2.credit, 0) = coalesce(jl3.credit, 0)
          )
      )
  );


-- ------------------------------------------------------------
-- 2. Canonical dataset used by the Trial Balance, Balance Sheet, Bank
--    Reconciliation, Ledger, P&L and the export helpers.
--    Column shapes match the legacy tables so report code can read either
--    source using the same column names.
-- ------------------------------------------------------------
drop view if exists public.ledger_entries;
drop view if exists public.ledger_transactions;

create view public.ledger_transactions as
select
  t.id,
  t.school_id,
  t.transaction_number::text as transaction_number,
  t.transaction_date::date as transaction_date,
  t.transaction_type::text as transaction_type,
  t.description,
  t.reference_type,
  t.reference_id,
  t.created_at
from public.transactions t
where not exists (
  select 1
  from public.legacy_superseded_transactions s
  where s.transaction_id = t.id
)
union all
select
  je.id,
  je.school_id,
  je.entry_number::text as transaction_number,
  je.entry_date::date as transaction_date,
  coalesce(je.entry_type, 'JOURNAL')::text as transaction_type,
  je.description,
  je.reference_type,
  je.reference_id,
  je.created_at
from public.journal_entries je;

create view public.ledger_entries as
select
  te.id,
  te.school_id,
  te.transaction_id,
  te.account_id,
  te.debit::numeric(18, 2) as debit,
  te.credit::numeric(18, 2) as credit,
  te.description,
  te.created_at
from public.transaction_entries te
join public.transactions t
  on t.id = te.transaction_id
where not exists (
  select 1
  from public.legacy_superseded_transactions s
  where s.transaction_id = t.id
)
union all
select
  jl.id,
  jl.school_id,
  jl.journal_entry_id as transaction_id,
  jl.account_id,
  jl.debit::numeric(18, 2) as debit,
  jl.credit::numeric(18, 2) as credit,
  jl.description,
  jl.created_at
from public.journal_lines jl;

-- ------------------------------------------------------------
-- 2b. Expose the views to the Data API safely
-- ------------------------------------------------------------
-- security_invoker makes the views run with the querying user's rights, so the
-- row level security policies of the base tables (school scoping) always apply
-- and every school only ever sees its own accounting data. Explicit grants
-- make the views visible to the PostgREST schema cache (otherwise the API
-- answers "Could not find the table ... in the schema cache").
alter view public.legacy_superseded_transactions set (security_invoker = on);
alter view public.ledger_transactions set (security_invoker = on);
alter view public.ledger_entries set (security_invoker = on);

grant select on public.legacy_superseded_transactions
  to anon, authenticated, service_role;
grant select on public.ledger_transactions
  to anon, authenticated, service_role;
grant select on public.ledger_entries
  to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Repair orphaned expense / payment journals
-- ------------------------------------------------------------
-- The older Payment page posted the journal entry without linking it to the
-- payment record (source_record_id and reference_id were null). Deleting the
-- payment therefore removed only the expenses row while the journal entry
-- stayed behind, so the deleted payment kept appearing in the Cash Book, Bank
-- Book and Ledger.
--
-- Step 3a: link the orphans that clearly belong to an existing payment record
--          (same school, same date, same amount, still unlinked) so deleting
--          that payment removes the journal from now on.
with orphans as (
  select
    je.id,
    je.school_id,
    je.entry_date,
    (
      select coalesce(sum(jl.debit), 0)
      from public.journal_lines jl
      where jl.journal_entry_id = je.id
    ) as total_debit,
    row_number() over (
      partition by
        je.school_id,
        je.entry_date,
        (
          select coalesce(sum(jl.debit), 0)
          from public.journal_lines jl
          where jl.journal_entry_id = je.id
        )
      order by je.created_at, je.id
    ) as match_rank
  from public.journal_entries je
  where je.source_module in ('expenses', 'salary_payment')
    and je.reference_type in ('expense', 'payment', 'salary_payment')
    and je.source_record_id is null
    and je.reference_id is null
),
unlinked_expenses as (
  select
    e.id as expense_id,
    e.school_id,
    e.expense_date,
    coalesce(e.amount, 0) as amount,
    row_number() over (
      partition by e.school_id, e.expense_date, coalesce(e.amount, 0)
      order by e.created_at, e.id
    ) as match_rank
  from public.expenses e
  where not exists (
    select 1
    from public.journal_entries je2
    where je2.school_id = e.school_id
      and je2.source_record_id = e.id
  )
),
orphan_matches as (
  select
    o.id as journal_entry_id,
    u.expense_id as expense_id
  from orphans o
  join unlinked_expenses u
    on u.school_id = o.school_id
   and u.expense_date = o.entry_date
   and u.amount = o.total_debit
   and u.match_rank = o.match_rank
)
update public.journal_entries je
set
  source_record_id = m.expense_id,
  reference_id = m.expense_id
from orphan_matches m
where je.id = m.journal_entry_id;

-- Step 3b: recreate the canonical accounting_events link for expense journal
--          entries that now have a source record but no event row yet.
insert into public.accounting_events (
  school_id,
  source_module,
  source_table,
  source_record_id,
  journal_entry_id,
  status
)
select
  je.school_id,
  'expenses',
  'expenses',
  je.source_record_id,
  je.id,
  'posted'
from public.journal_entries je
where je.source_module = 'expenses'
  and je.source_table = 'expenses'
  and je.source_record_id is not null
  and not exists (
    select 1
    from public.accounting_events ae
    where ae.journal_entry_id = je.id
  )
  and not exists (
    select 1
    from public.accounting_events ae2
    where ae2.school_id = je.school_id
      and ae2.source_module = 'expenses'
      and ae2.source_table = 'expenses'
      and ae2.source_record_id = je.source_record_id
  );

-- Step 3c: delete the orphans whose payment record no longer exists (the user
--          already deleted that payment). A journal entry is only removed when
--          no expenses row can be matched for the same school and date (by
--          amount or by the cash/bank account it was paid from), so an
--          existing expense is never left without its accounting.
delete from public.journal_entries je
where je.source_module in ('expenses', 'salary_payment')
  and je.reference_type in ('expense', 'payment', 'salary_payment')
  and je.source_record_id is null
  and je.reference_id is null
  and not exists (
    select 1
    from public.expenses e
    where e.school_id = je.school_id
      and e.expense_date = je.entry_date
      and (
        coalesce(e.amount, 0) = (
          select coalesce(sum(jl.debit), 0)
          from public.journal_lines jl
          where jl.journal_entry_id = je.id
        )
        or e.paid_from_account_id = (
          select jl.account_id
          from public.journal_lines jl
          join public.accounts a
            on a.id = jl.account_id
          where jl.journal_entry_id = je.id
            and a.account_type in ('cash', 'bank')
          limit 1
        )
      )
  );

-- Refresh the PostgREST schema cache so the new views are visible.
notify pgrst, 'reload schema';

