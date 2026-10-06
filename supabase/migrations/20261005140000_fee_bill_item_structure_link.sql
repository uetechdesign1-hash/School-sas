ALTER TABLE public.fee_bill_items
  ADD COLUMN IF NOT EXISTS fee_structure_item_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.fee_bill_items'::regclass
      AND conname = 'fee_bill_items_fee_structure_item_id_fkey'
  ) THEN
    ALTER TABLE public.fee_bill_items
      ADD CONSTRAINT fee_bill_items_fee_structure_item_id_fkey
      FOREIGN KEY (fee_structure_item_id)
      REFERENCES public.fee_structure_items(id)
      ON DELETE SET NULL;
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS fee_bill_items_fee_structure_item_id_idx
  ON public.fee_bill_items (fee_structure_item_id);

NOTIFY pgrst, 'reload schema';
