-- The legacy journal_entries table carries an entry_type CHECK constraint
-- that only whitelists the pre-canonical values observed in existing rows
-- (fee_collection, emi, adjustment, salary). The canonical posting engine
-- (create_journal_entry) writes uppercase canonical types (PAYMENT,
-- RECEIPT, GENERAL, CONTRA, ...), so every canonical posting failed with:
--   new row for relation "journal_entries" violates check constraint
--   "journal_entries_entry_type_check"
-- As a result no canonical journal ever posted on this database: purchase
-- bills and vendor payments were recorded but never linked to a journal.
-- Replace the constraint with a case-insensitive whitelist covering both
-- the legacy values and the canonical entry types.

alter table public.journal_entries
  drop constraint if exists journal_entries_entry_type_check;

alter table public.journal_entries
  add constraint journal_entries_entry_type_check
  check (lower(entry_type) in (
    -- canonical entry types
    'general', 'opening', 'payment', 'receipt',
    'contra', 'adjustment', 'closing',
    -- legacy entry types observed in existing rows
    'fee_collection', 'emi', 'salary'
  ));

notify pgrst, 'reload schema';
