ALTER TABLE public.fee_bill_items
  ADD COLUMN IF NOT EXISTS inventory_sale_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.fee_bill_items'::regclass
      AND conname = 'fee_bill_items_inventory_sale_id_fkey'
  ) THEN
    ALTER TABLE public.fee_bill_items
      ADD CONSTRAINT fee_bill_items_inventory_sale_id_fkey
      FOREIGN KEY (inventory_sale_id)
      REFERENCES public.student_book_sales(id)
      ON DELETE SET NULL;
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS fee_bill_items_inventory_sale_id_idx
  ON public.fee_bill_items (inventory_sale_id)
  WHERE inventory_sale_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
