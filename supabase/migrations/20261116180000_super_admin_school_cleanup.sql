-- Allow the server-side Super Admin school cleanup to remove this school's
-- immutable Phase 2 billing and sales history in one transaction.
CREATE OR REPLACE FUNCTION public.business_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are immutable and cannot be % .', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_count_confirmations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['status', 'decided_by', 'decided_at', 'decision_note', 'mou_id'];
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Billing confirmations are audit records and cannot be deleted.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'pending_approval'
     OR (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR current_setting('app.confirmation_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'A billing confirmation can only be decided once, through the approval function.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_invoices_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason'];
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
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
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted. Use rejection, reversal or refund.'
      USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['updated_at']) = (to_jsonb(OLD) - ARRAY['updated_at']) THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.payment_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Payments change only through the payment functions.' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Verification facts of a payment are immutable.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_sales_ownership_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'School ownership history cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  IF NEW.original_acquisition_rep_id IS DISTINCT FROM OLD.original_acquisition_rep_id
     OR NEW.acquired_by IS DISTINCT FROM OLD.acquired_by
     OR NEW.acquired_at IS DISTINCT FROM OLD.acquired_at
  THEN
    RAISE EXCEPTION 'The original acquisition attribution is permanent.' USING ERRCODE = '42501';
  END IF;
  IF NEW.current_rep_id IS DISTINCT FROM OLD.current_rep_id
     AND current_setting('app.ownership_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Use the reassignment function to change school ownership.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_sales_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_keep text[] := ARRAY['effective_to'];
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assignment history cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - v_keep) IS DISTINCT FROM (to_jsonb(OLD) - v_keep)
     OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to)
  THEN
    RAISE EXCEPTION 'Assignment history is immutable except for closing the open period.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_activity_logs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.school_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Activity logs are append-only.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin() THEN
    NEW.rep_user_id := auth.uid();
    IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.school_leads l
      WHERE l.id = NEW.lead_id AND l.assigned_rep_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'You can only log activity for your own leads.' USING ERRCODE = '42501';
    END IF;
    IF NEW.school_id IS NOT NULL AND NOT public.rep_owns_school(NEW.school_id) THEN
      RAISE EXCEPTION 'You can only log activity for your own schools.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.school_leads_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.school_cleanup', true) = 'on'
     AND TG_OP = 'UPDATE'
     AND NEW.converted_school_id IS NULL
     AND (to_jsonb(NEW) - ARRAY['converted_school_id', 'updated_at'])
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['converted_school_id', 'updated_at'])
  THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_super_admin() THEN
      NEW.assigned_rep_id := auth.uid();
    END IF;
    NEW.created_by := auth.uid();
    NEW.status := CASE WHEN NEW.status = 'converted' THEN 'new_lead' ELSE NEW.status END;
    NEW.converted_school_id := NULL;
    IF NOT EXISTS (
      SELECT 1 FROM public.sales_representatives sr
      WHERE sr.user_id = NEW.assigned_rep_id AND sr.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Leads can only be assigned to an active sales representative.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'converted' THEN
    RAISE EXCEPTION 'A converted lead is read-only.' USING ERRCODE = '42501';
  END IF;
  IF (NEW.assigned_rep_id IS DISTINCT FROM OLD.assigned_rep_id
      OR NEW.converted_school_id IS DISTINCT FROM OLD.converted_school_id
      OR NEW.status = 'converted')
     AND current_setting('app.lead_rpc', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Lead assignment and conversion are managed through dedicated functions.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- MOU and confirmation rows reference each other. A school cleanup is the
-- only operation that needs to remove both; make this same-school dependency
-- cascade from the MOU while retaining the normal immutable guards.
ALTER TABLE public.billing_count_confirmations
  DROP CONSTRAINT IF EXISTS billing_count_confirmations_mou_fk;
ALTER TABLE public.billing_count_confirmations
  ADD CONSTRAINT billing_count_confirmations_mou_fk
  FOREIGN KEY (mou_id) REFERENCES public.school_mous (id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.cleanup_school_business_records(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'This cleanup operation is restricted to the server.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'School not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.school_cleanup', 'on', true);

  DELETE FROM public.school_mous WHERE school_id = p_school_id;
  DELETE FROM public.billing_count_confirmations WHERE school_id = p_school_id;
  DELETE FROM public.school_subscription_history WHERE school_id = p_school_id;
  DELETE FROM public.payment_verification_logs l
   WHERE EXISTS (SELECT 1 FROM public.school_payments p
                 WHERE p.id = l.payment_id AND p.school_id = p_school_id);
  DELETE FROM public.payment_reversals WHERE school_id = p_school_id;
  DELETE FROM public.school_payments WHERE school_id = p_school_id;
  DELETE FROM public.school_invoices WHERE school_id = p_school_id;
  DELETE FROM public.sales_activity_logs WHERE school_id = p_school_id;
  DELETE FROM public.school_sales_assignments WHERE school_id = p_school_id;
  DELETE FROM public.school_sales_ownership WHERE school_id = p_school_id;
  PERFORM set_config('app.lead_rpc', 'on', true);
  UPDATE public.school_leads SET converted_school_id = NULL
   WHERE converted_school_id = p_school_id;
  PERFORM set_config('app.lead_rpc', 'off', true);
  DELETE FROM public.school_subscriptions WHERE school_id = p_school_id;
  DELETE FROM public.business_audit_logs WHERE school_id = p_school_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_school_business_records(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_school_business_records(uuid) TO service_role;
