"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Field, Modal, ErrorBanner, buttonClass, inputClass } from "@/components/business/ui";
import { callRpc, getErrorMessage, newIdempotencyKey } from "@/lib/business/rpc";
import { PAYMENT_MODES, formatInr, formatDate, toNumber } from "@/lib/business/format";
import type { InvoiceBalance } from "@/lib/business/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  invoices: readonly InvoiceBalance[];
  defaultInvoiceId?: string;
};

export function PaymentFormModal({ open, onClose, onDone, invoices, defaultInvoiceId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const open_ = invoices.filter((invoice) => invoice.invoice_status === "issued" && toNumber(invoice.balance_amount) - toNumber(invoice.pending_verification_amount) > 0);
  const idempotencyKey = useRef(newIdempotencyKey());

  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState("upi");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(false);

  const selected = open_.find((invoice) => invoice.invoice_id === invoiceId);
  const available = selected ? toNumber(selected.balance_amount) - toNumber(selected.pending_verification_amount) : 0;

  useEffect(() => {
    if (!open) return;
    idempotencyKey.current = newIdempotencyKey();
    const first = open_.find((invoice) => invoice.invoice_id === defaultInvoiceId) ?? open_[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInvoiceId(first?.invoice_id ?? "");
    setAmount(first ? String(toNumber(first.balance_amount) - toNumber(first.pending_verification_amount)) : "");
    setReference("");
    setRemarks("");
    setError("");
    setDuplicate(false);
    // Re-initialise only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(acknowledge: boolean) {
    setBusy(true);
    setError("");
    try {
      await callRpc(supabase, "submit_school_payment", {
        p_invoice_id: invoiceId,
        p_amount: Number(amount),
        p_payment_date: date,
        p_payment_mode: mode,
        p_transaction_reference: reference.trim() || null,
        p_idempotency_key: idempotencyKey.current,
        p_remarks: remarks.trim() || null,
        p_acknowledge_possible_duplicate: acknowledge,
      });
      onDone("Payment recorded as Pending Verification. It counts as revenue only after Super Admin verifies it.");
      onClose();
    } catch (caught) {
      const message = getErrorMessage(caught);
      setDuplicate(/same invoice, amount, date and mode/i.test(message));
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const invalid = !invoiceId || !(Number(amount) > 0) || Number(amount) > available + 0.001 || (mode !== "cash" && !reference.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add collection"
      footer={
        <>
          <button type="button" className={buttonClass("secondary")} onClick={onClose} disabled={busy}>Cancel</button>
          {duplicate ? (
            <button type="button" className={buttonClass("danger")} onClick={() => submit(true)} disabled={busy}>Record anyway</button>
          ) : (
            <button type="button" className={buttonClass()} onClick={() => submit(false)} disabled={busy || invalid}>{busy ? "Saving..." : "Submit for verification"}</button>
          )}
        </>
      }
    >
      <ErrorBanner message={error} />
      {open_.length === 0 ? (
        <p className="text-sm text-slate-600">There is no invoice with an open balance to collect against.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Invoice" required>
              <select className={inputClass} value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); const next = open_.find((i) => i.invoice_id === e.target.value); if (next) setAmount(String(toNumber(next.balance_amount) - toNumber(next.pending_verification_amount))); }}>
                {open_.map((invoice) => (
                  <option key={invoice.invoice_id} value={invoice.invoice_id}>{invoice.invoice_number} - due {formatDate(invoice.due_date)} - open {formatInr(toNumber(invoice.balance_amount) - toNumber(invoice.pending_verification_amount))}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Amount" required hint={selected ? `Up to ${formatInr(available)}` : undefined}><input className={inputClass} type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Payment date" required><input className={inputClass} type="date" max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Payment mode" required><select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}>{PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
          <Field label="Transaction reference" required={mode !== "cash"} hint={mode === "cheque" ? "Include the bank, e.g. HDFC-000123." : mode === "cash" ? "Optional for cash; a reference is generated if blank." : "Must be unique across all payments."}>
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <div className="sm:col-span-2"><Field label="Remarks"><textarea className={inputClass} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field></div>
        </div>
      )}
    </Modal>
  );
}
