ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS selling_price numeric(18, 2) NOT NULL DEFAULT 0;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_items_selling_price_nonnegative'
      AND conrelid = 'public.inventory_items'::regclass
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_selling_price_nonnegative
      CHECK (selling_price >= 0);
  END IF;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
