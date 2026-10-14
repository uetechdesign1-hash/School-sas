-- Enable split receipt editing: split-leg storage.
-- Split receipts store account_id = NULL on fee_payments with detail rows in
-- fee_payment_splits (one row per Cash/Bank leg). The split create path
-- referenced this table without shipping its DDL, so older databases fail.
CREATE TABLE IF NOT EXISTS public.fee_payment_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.fee_payments(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  payment_mode text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reference_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_payment_splits_payment_idx
  ON public.fee_payment_splits (payment_id);
CREATE INDEX IF NOT EXISTS fee_payment_splits_school_idx
  ON public.fee_payment_splits (school_id);
ALTER TABLE public.fee_payment_splits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fee_payment_splits_school_policy ON public.fee_payment_splits;
CREATE POLICY fee_payment_splits_school_policy
  ON public.fee_payment_splits FOR ALL
  USING (school_id = public.current_school_id())
  WITH CHECK (school_id = public.current_school_id());
NOTIFY pgrst, 'reload schema';
