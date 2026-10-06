ALTER TABLE public.purchase_bill_items
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'pcs';

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_category_check;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_category_check
  CHECK (category IN ('books', 'uniform', 'stationery', 'id_cards', 'bags', 'shoes', 'other'));

DROP INDEX IF EXISTS public.inventory_items_school_name_size_unique;
DROP INDEX IF EXISTS public.inventory_items_school_name_unit_size_unique;

CREATE UNIQUE INDEX inventory_items_school_name_unit_size_unique
  ON public.inventory_items (school_id, name, unit, (coalesce(size, '')), category);

NOTIFY pgrst, 'reload schema';
