-- Phase 2 / 06 - Billing: invoices, payments, verification history and
-- partial refunds / reversals. Money columns are numeric(18,2). Verified
-- payments are immutable; every state change is recorded.

-- ---------------------------------------------------------------------------
-- Invoices (memo-only: an invoice never creates an accounting entry)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.school_subscriptions (id) ON DELETE RESTRICT,
  period_sequence integer NOT NULL CHECK (period_sequence >= 1),
  period_start date NOT NULL,
  period_end date NOT NULL,
  invoice_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(18,2) NOT NULL CHECK (total_amount > 0),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  snapshot jsonb NOT NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users (id),
  cancel_reason text,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_invoices_period CHECK (period_end >= period_start),
  CONSTRAINT school_invoices_total CHECK (total_amount = amount + tax_amount),
  CONSTRAINT school_invoices_cancel CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
  )
);

-- One live invoice per subscription billing period; a cancelled invoice frees
-- the period for re-issue.
CREATE UNIQUE INDEX IF NOT EXISTS school_invoices_one_per_period
  ON public.school_invoices (subscription_id, period_start)
  WHERE status = 'issued';
CREATE UNIQUE INDEX IF NOT EXISTS school_invoices_one_per_sequence
  ON public.school_invoices (subscription_id, period_sequence)
  WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS school_invoices_school_idx
  ON public.school_invoices (school_id, due_date);

CREATE OR REPLACE FUNCTION public.school_invoices_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoices cannot be deleted; cancel them instead.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'cancelled'
     OR (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR current_setting('app.invoice_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Invoices are immutable; use the cancel function.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_invoices_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_invoices_guard ON public.school_invoices;
CREATE TRIGGER school_invoices_guard
  BEFORE UPDATE OR DELETE ON public.school_invoices
  FOR EACH ROW EXECUTE FUNCTION public.school_invoices_guard();

DROP TRIGGER IF EXISTS school_invoices_reject_internal ON public.school_invoices;
CREATE TRIGGER school_invoices_reject_internal
  BEFORE INSERT ON public.school_invoices
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_invoices_audit ON public.school_invoices;
CREATE TRIGGER school_invoices_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_invoices
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.school_invoices (id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  payment_mode text NOT NULL
    CHECK (payment_mode IN ('cash', 'upi', 'bank_transfer', 'cheque', 'other')),
  transaction_reference text NOT NULL
    CHECK (btrim(transaction_reference) <> '' AND length(transaction_reference) <= 120),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  remarks text,
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified', 'rejected', 'reversed', 'refunded')),
  submitted_by uuid NOT NULL REFERENCES auth.users (id),
  collected_by_rep_id uuid REFERENCES public.sales_representatives (user_id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES auth.users (id),
  verified_at timestamptz,
  verification_note text,
  receipt_number text,
  receipt_snapshot jsonb,
  rejected_by uuid REFERENCES auth.users (id),
  rejected_at timestamptz,
  rejection_reason text,
  accounting_journal_entry_id uuid REFERENCES public.journal_entries (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_payments_idempotency_key UNIQUE (submitted_by, idempotency_key),
  CONSTRAINT school_payments_receipt_unique UNIQUE (receipt_number),
  CONSTRAINT school_payments_journal_unique UNIQUE (accounting_journal_entry_id),
  CONSTRAINT school_payments_verified_fields CHECK (
    status NOT IN ('verified', 'reversed', 'refunded')
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL
        AND receipt_number IS NOT NULL AND receipt_snapshot IS NOT NULL
        AND accounting_journal_entry_id IS NOT NULL)
  ),
  CONSTRAINT school_payments_rejected_fields CHECK (
    status <> 'rejected'
    OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL
        AND NULLIF(btrim(rejection_reason), '') IS NOT NULL)
  ),
  CONSTRAINT school_payments_pending_clean CHECK (
    status <> 'pending_verification'
    OR (verified_by IS NULL AND receipt_number IS NULL
        AND accounting_journal_entry_id IS NULL AND rejected_by IS NULL)
  )
);

-- A transaction reference can be used once across all live payments,
-- whatever the mode. Normalised so spacing and case variants collide. A
-- rejected payment releases its reference so the collection can be re-entered.
-- Cheque references should include the bank, e.g. HDFC-000123.
CREATE UNIQUE INDEX IF NOT EXISTS school_payments_reference_key
  ON public.school_payments (lower(btrim(transaction_reference)))
  WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS school_payments_invoice_idx
  ON public.school_payments (invoice_id);
CREATE INDEX IF NOT EXISTS school_payments_school_idx
  ON public.school_payments (school_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS school_payments_status_idx
  ON public.school_payments (status, submitted_at);
CREATE INDEX IF NOT EXISTS school_payments_rep_idx
  ON public.school_payments (collected_by_rep_id, status);

CREATE TABLE IF NOT EXISTS public.payment_verification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.school_payments (id) ON DELETE RESTRICT,
  action text NOT NULL
    CHECK (action IN ('submitted', 'verified', 'rejected', 'partial_refund', 'reversed', 'refunded')),
  from_status text,
  to_status text NOT NULL,
  actor_id uuid REFERENCES auth.users (id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_verification_logs_payment_idx
  ON public.payment_verification_logs (payment_id, created_at);

-- Partial refunds and full reversals. The sum of all rows for a payment can
-- never exceed the payment amount (enforced under a row lock by the RPC and
-- re-checked by the trigger below).
CREATE TABLE IF NOT EXISTS public.payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.school_payments (id) ON DELETE RESTRICT,
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE RESTRICT,
  reversal_type text NOT NULL CHECK (reversal_type IN ('reversal', 'refund')),
  reversal_number text NOT NULL UNIQUE,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reversal_date date NOT NULL DEFAULT current_date,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  accounting_journal_entry_id uuid NOT NULL UNIQUE
    REFERENCES public.journal_entries (id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_reversals_idempotency_key UNIQUE (payment_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_reversals_payment_idx
  ON public.payment_reversals (payment_id);

CREATE OR REPLACE FUNCTION public.payment_reversals_total_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment_amount numeric(18,2);
  v_total numeric(18,2);
BEGIN
  SELECT amount INTO v_payment_amount
  FROM public.school_payments WHERE id = NEW.payment_id FOR UPDATE;

  SELECT COALESCE(sum(amount), 0) INTO v_total
  FROM public.payment_reversals WHERE payment_id = NEW.payment_id;

  IF v_total + NEW.amount > v_payment_amount THEN
    RAISE EXCEPTION 'Refunds and reversals cannot exceed the verified payment amount.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reversal_type = 'reversal'
     AND (v_total <> 0 OR NEW.amount <> v_payment_amount)
  THEN
    RAISE EXCEPTION 'A reversal must cancel the whole payment; use a refund for part of it.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_reversals_total_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_reversals_total_guard ON public.payment_reversals;
CREATE TRIGGER payment_reversals_total_guard
  BEFORE INSERT ON public.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.payment_reversals_total_guard();

DROP TRIGGER IF EXISTS payment_reversals_immutable ON public.payment_reversals;
CREATE TRIGGER payment_reversals_immutable
  BEFORE UPDATE OR DELETE ON public.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.business_immutable_row();

DROP TRIGGER IF EXISTS payment_verification_logs_immutable
  ON public.payment_verification_logs;
CREATE TRIGGER payment_verification_logs_immutable
  BEFORE UPDATE OR DELETE ON public.payment_verification_logs
  FOR EACH ROW EXECUTE FUNCTION public.business_immutable_row();

-- Payment state machine. All writes come through the RPCs, which set
-- app.payment_rpc; verified-payment facts are frozen regardless.
CREATE OR REPLACE FUNCTION public.school_payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_frozen text[] := ARRAY[
    'school_id', 'invoice_id', 'amount', 'payment_date', 'payment_mode',
    'transaction_reference', 'idempotency_key', 'remarks', 'submitted_by',
    'collected_by_rep_id', 'submitted_at', 'created_at'
  ];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted. Use rejection, reversal or refund.'
      USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['updated_at']) = (to_jsonb(OLD) - ARRAY['updated_at']) THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.payment_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Payments change only through the payment functions.'
      USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'verified_by', 'verified_at',
        'verification_note', 'receipt_number', 'receipt_snapshot', 'rejected_by',
        'rejected_at', 'rejection_reason', 'accounting_journal_entry_id'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'verified_by', 'verified_at',
        'verification_note', 'receipt_number', 'receipt_snapshot', 'rejected_by',
        'rejected_at', 'rejection_reason', 'accounting_journal_entry_id'])
  THEN
    RAISE EXCEPTION 'Core payment details are immutable (%).', array_to_string(v_frozen, ', ')
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (OLD.status = 'pending_verification' AND NEW.status IN ('verified', 'rejected'))
    OR (OLD.status = 'verified' AND NEW.status IN ('reversed', 'refunded'))
  ) THEN
    RAISE EXCEPTION 'Illegal payment status change % -> %.', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status <> 'pending_verification'
     AND (NEW.verified_by IS DISTINCT FROM OLD.verified_by
          OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
          OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
          OR NEW.accounting_journal_entry_id IS DISTINCT FROM OLD.accounting_journal_entry_id
          OR NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot)
  THEN
    RAISE EXCEPTION 'Verification facts of a payment are immutable.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.school_payments_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS school_payments_guard ON public.school_payments;
CREATE TRIGGER school_payments_guard
  BEFORE UPDATE OR DELETE ON public.school_payments
  FOR EACH ROW EXECUTE FUNCTION public.school_payments_guard();

DROP TRIGGER IF EXISTS school_payments_updated_at ON public.school_payments;
CREATE TRIGGER school_payments_updated_at
  BEFORE UPDATE ON public.school_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS school_payments_reject_internal ON public.school_payments;
CREATE TRIGGER school_payments_reject_internal
  BEFORE INSERT ON public.school_payments
  FOR EACH ROW EXECUTE FUNCTION public.reject_platform_internal_school();

DROP TRIGGER IF EXISTS school_payments_audit ON public.school_payments;
CREATE TRIGGER school_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.school_payments
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

DROP TRIGGER IF EXISTS payment_reversals_audit ON public.payment_reversals;
CREATE TRIGGER payment_reversals_audit
  AFTER INSERT ON public.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.business_audit_row();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security (read-only API; writes via RPCs)
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_verification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reversals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_invoices, public.school_payments,
  public.payment_verification_logs, public.payment_reversals
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.school_invoices TO authenticated;
GRANT SELECT ON public.school_payments TO authenticated;
GRANT SELECT ON public.payment_verification_logs TO authenticated;
GRANT SELECT ON public.payment_reversals TO authenticated;

DROP POLICY IF EXISTS school_invoices_select ON public.school_invoices;
CREATE POLICY school_invoices_select ON public.school_invoices
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));

-- A representative sees payments for schools they currently own, plus every
-- payment they personally collected (even if the school was later reassigned).
DROP POLICY IF EXISTS school_payments_select ON public.school_payments;
CREATE POLICY school_payments_select ON public.school_payments
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.rep_owns_school(school_id)
    OR (submitted_by = auth.uid() AND public.is_active_sales_rep())
  );

DROP POLICY IF EXISTS payment_verification_logs_select
  ON public.payment_verification_logs;
CREATE POLICY payment_verification_logs_select
  ON public.payment_verification_logs
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.school_payments p
      WHERE p.id = payment_verification_logs.payment_id
        AND (public.rep_owns_school(p.school_id)
             OR (p.submitted_by = auth.uid() AND public.is_active_sales_rep()))
    )
  );

DROP POLICY IF EXISTS payment_reversals_select ON public.payment_reversals;
CREATE POLICY payment_reversals_select ON public.payment_reversals
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.rep_owns_school(school_id));
