ALTER TABLE public.fee_concessions
  ADD COLUMN IF NOT EXISTS fee_category_id uuid
  REFERENCES public.fee_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fee_concessions_fee_category_id_idx
  ON public.fee_concessions (fee_category_id);

NOTIFY pgrst, 'reload schema';
