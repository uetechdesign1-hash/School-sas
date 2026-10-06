ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS size text;

-- A uniform is tracked as one inventory item per size variant. Existing
-- product names remain unique when size is NULL; sized variants may reuse
-- the same name while keeping separate stock ledgers.
ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_school_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_school_name_size_unique
  ON public.inventory_items (school_id, name, (coalesce(size, '')));

NOTIFY pgrst, 'reload schema';
