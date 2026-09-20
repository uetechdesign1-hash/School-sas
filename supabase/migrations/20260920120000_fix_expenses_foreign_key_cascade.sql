-- Fix: Modify expenses table foreign key to allow cascade delete
-- This ensures payments can be deleted along with their linked expenses

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  -- Find the foreign key constraint name on expenses table
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.expenses'::regclass
    AND contype = 'f'
    AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.expenses'::regclass AND attname = 'transaction_id')];

  -- If constraint exists, drop and recreate with ON DELETE CASCADE
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.expenses DROP CONSTRAINT %I', v_constraint_name);
    EXECUTE 'ALTER TABLE public.expenses 
      ADD CONSTRAINT expenses_transaction_id_fkey 
      FOREIGN KEY (transaction_id, school_id) 
      REFERENCES public.transactions(id, school_id) 
      ON DELETE CASCADE';
  END IF;
END $$;