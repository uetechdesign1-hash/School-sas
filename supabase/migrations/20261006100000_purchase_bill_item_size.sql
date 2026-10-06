ALTER TABLE public.purchase_bill_items
  ADD COLUMN IF NOT EXISTS size text;

NOTIFY pgrst, 'reload schema';
