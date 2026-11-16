-- Phase 2 / STEP 1 of 2 - add the sales_rep platform role.
--
-- This file MUST be executed (and committed) on its own, before any other
-- Phase 2 SQL. PostgreSQL does not allow a newly added enum value to be used in
-- the same transaction that created it, so no later Phase 2 file is allowed to
-- run until this statement has been committed.
--
-- Safe to re-run: ADD VALUE IF NOT EXISTS is a no-op when the label exists.

DO $$
BEGIN
  IF to_regtype('public.platform_role') IS NULL THEN
    RAISE EXCEPTION
      'Phase 2 step 1 aborted: enum type public.platform_role does not exist.';
  END IF;
END;
$$;

ALTER TYPE public.platform_role ADD VALUE IF NOT EXISTS 'sales_rep';
