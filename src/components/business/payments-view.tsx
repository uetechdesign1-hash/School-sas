"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, Field, LoadingBlock, Modal, PageHeader, SuccessBanner, buttonClass, inputClass } from "@/components/business/ui";
import { PaymentFormModal } from "@/components/business/payment-form-modal";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { callRpc, newIdempotencyKey } from "@/lib/business/rpc";
import { downloadReceiptPdf } from "@/lib/business/pdf/download";
import { PAYMENT_STATUS_LABELS, formatDate, formatInr, statusTone, titleCase, toNumber } from "@/lib/business/format";
import type { InvoiceBalance, PaymentReversal, SalesRep, SchoolPayment } from "@/lib/business/types";

async function load(isAdmin: boolean) {
  const supabase = createClient();
  const [payments, invoices, schools, reversals, reps, balances] = await Promise.all([
    supabase.from("school_payments").select("*").order("submitted_at", { ascending: false }),
    supabase.from("school_invoices").select("id, invoice_number"),
    supabase.from("schools").select("id, name"),
    supabase.from("payment_reversals").select("*"),
    isAdmin ? supabase.from("sales_representatives").select("*") : Promise.resolve({ data: [], error: null }),
    supabase.from("school_invoice_balances").select("*"),
  ]);
  for (const result of [payments, invoices, schools, reversals, reps, balances]) if (result.error) throw result.error;
  return {
    payments: (payments.data ?? []) as SchoolPayment[],
    invoiceNumbers: new Map((invoices.data ?? []).map((row) => [row.id as string, row.invoice_number as string])),
    schoolNames: new Map((schools.data ?? []).map((row) => [row.id as string, row.name as string])),
    reversals: (reversals.data ?? []) as PaymentReversal[],
    reps: (reps.data ?? []) as SalesRep[],
    balances: (balances.data ?? []) as InvoiceBalance[],
  };
}

type Dialog = { kind: "reject" | "refund" | "verify"; payment: SchoolPayment } | null;

export function PaymentsView({ isAdmin }: { isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const { data, error, loading, reload } = useAsyncData(() => load(isAdmin));
  const action = useAction();
  const [tab, setTab] = useState<"pending" | "all">(isAdmin ? "pending" : "all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState("");
  const [refundType, setRefundType] = useState<"refund" | "reversal">("refund");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundKey, setRefundKey] = useState(newIdempotencyKey());
  const [payOpen, setPayOpen] = useState(false);
  const [search, setSearch] = useState("");

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner message={error} />;

  const refundedOf = (id: string) => data.reversals.filter((r) => r.payment_id === id).reduce((sum, r) => sum + toNumber(r.amount), 0);
  const repName = (id: string | null) => data.reps.find((rep) => rep.user_id === id)?.full_name ?? "-";
  const rows = data.payments
    .filter((payment) => (tab === "pending" ? payment.status === "pending_verification" : true))
    .filter((payment) => `${data.schoolNames.get(payment.school_id) ?? ""} ${payment.transaction_reference} ${payment.receipt_number ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const pendingTotal = data.payments.filter((p) => p.status === "pending_verification").reduce((sum, p) => sum + toNumber(p.amount), 0);

  function openDialog(kind: "reject" | "refund" | "verify", payment: SchoolPayment) {
    setText("");
    setRefundType("refund");
    setRefundAmount(String(toNumber(payment.amount) - refundedOf(payment.id)));
    setRefundKey(newIdempotencyKey());
    action.setError("");
    setDialog({ kind, payment });
  }

  async function submitDialog() {
    if (!dialog) return;
    const { kind, payment } = dialog;
    const done = await action.run(async () => {
      if (kind === "verify") await callRpc(supabase, "verify_school_payment", { p_payment_id: payment.id, p_note: text || null });
      if (kind === "reject") await callRpc(supabase, "reject_school_payment", { p_payment_id: payment.id, p_reason: text });
      if (kind === "refund") {
        await callRpc(supabase, "refund_school_payment", {
          p_payment_id: payment.id,
          p_amount: refundType === "reversal" ? toNumber(payment.amount) : Number(refundAmount),
          p_type: refundType,
          p_reason: text,
          p_idempotency_key: refundKey,
        });
      }
      return true;
    }, kind === "verify" ? "Payment verified and posted to the ledger once. The receipt is ready." : kind === "reject" ? "Payment rejected." : "Refund recorded with a reversing journal entry.");
    if (done) {
      setDialog(null);
      await reload();
    }
  }

  return (
    <>
      <PageHeader
        title={isAdmin ? "Payments & collections" : "Payment collection"}
        description={isAdmin ? "Verify collections entered by representatives. Pending payments never count as revenue." : "Record collections for your schools. They count only after Super Admin verifies them."}
        actions={!isAdmin ? <button type="button" className={buttonClass()} onClick={() => setPayOpen(true)}>Add collection</button> : undefined}
      />
      <ErrorBanner message={error} />
      <SuccessBanner message={action.success} />

      {isAdmin ? (
        <p className="mb-4 text-sm text-slate-600">Awaiting verification: <strong>{formatInr(pendingTotal)}</strong></p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(isAdmin ? (["pending", "all"] as const) : (["all"] as const)).map((value) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={buttonClass(tab === value ? "primary" : "secondary", true)}>
            {value === "pending" ? "Pending verification" : "All collections"}
          </button>
        ))}
        <input className={`${inputClass} !w-64 ml-auto`} placeholder="Search school, reference, receipt" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search collections" />
      </div>

      <Card>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty={tab === "pending" ? "Nothing is waiting for verification." : "No collections yet."}
          columns={[
            { header: "Date", cell: (row) => formatDate(row.payment_date) },
            { header: "School", cell: (row) => <Link className="text-blue-600 hover:underline" href={`${isAdmin ? "/super-admin" : "/sales"}/schools/${row.school_id}`}>{data.schoolNames.get(row.school_id) ?? "School"}</Link> },
            { header: "Invoice", cell: (row) => data.invoiceNumbers.get(row.invoice_id) ?? "-" },
            ...(isAdmin ? [{ header: "Collected by", cell: (row: SchoolPayment) => repName(row.collected_by_rep_id) }] : []),
            { header: "Amount", cell: (row) => formatInr(row.amount), align: "right" as const },
            { header: "Mode", cell: (row) => titleCase(row.payment_mode) },
            { header: "Reference", cell: (row) => row.transaction_reference },
            { header: "Receipt", cell: (row) => row.receipt_number ?? "-" },
            { header: "Status", cell: (row) => <Badge tone={statusTone(row.status)}>{PAYMENT_STATUS_LABELS[row.status] ?? row.status}</Badge> },
            { header: "Refunded", cell: (row) => (refundedOf(row.id) > 0 ? formatInr(refundedOf(row.id)) : "-"), align: "right" as const },
            {
              header: "",
              cell: (row) => (
                <div className="flex flex-wrap gap-2">
                  {row.receipt_snapshot ? <button type="button" className={buttonClass("secondary", true)} onClick={() => action.run(() => downloadReceiptPdf(supabase, row))}>Receipt</button> : null}
                  {isAdmin && row.status === "pending_verification" ? (
                    <>
                      <button type="button" className={buttonClass("primary", true)} onClick={() => openDialog("verify", row)}>Verify</button>
                      <button type="button" className={buttonClass("danger", true)} onClick={() => openDialog("reject", row)}>Reject</button>
                    </>
                  ) : null}
                  {isAdmin && row.status === "verified" ? <button type="button" className={buttonClass("secondary", true)} onClick={() => openDialog("refund", row)}>Refund / reverse</button> : null}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <PaymentFormModal open={payOpen} onClose={() => setPayOpen(false)} invoices={data.balances} onDone={(message) => { action.setSuccess(message); void reload(); }} />

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "verify" ? "Verify payment" : dialog?.kind === "reject" ? "Reject payment" : "Refund or reverse payment"}
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setDialog(null)} disabled={action.busy}>Cancel</button>
            <button type="button" className={buttonClass(dialog?.kind === "reject" ? "danger" : "primary")} onClick={submitDialog} disabled={action.busy || (dialog?.kind !== "verify" && !text.trim())}>{action.busy ? "Working..." : "Confirm"}</button>
          </>
        }
      >
        <ErrorBanner message={action.error} />
        {dialog ? (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              {formatInr(dialog.payment.amount)} via {titleCase(dialog.payment.payment_mode)} - ref <strong>{dialog.payment.transaction_reference}</strong> for {data.schoolNames.get(dialog.payment.school_id)}.
            </p>
            {dialog.kind === "verify" ? <p className="rounded-xl bg-emerald-50 p-3 text-emerald-800">Verifying records the revenue once (Dr {dialog.payment.payment_mode === "cash" ? "Cash" : "Bank"}, Cr Subscription Income) and issues the receipt. It cannot be edited afterwards; corrections use a refund or reversal.</p> : null}
            {dialog.kind === "refund" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type"><select className={inputClass} value={refundType} onChange={(e) => setRefundType(e.target.value as "refund" | "reversal")}><option value="refund">Refund (full or partial)</option><option value="reversal">Reversal (whole payment, entered in error)</option></select></Field>
                {refundType === "refund" ? <Field label="Amount" hint={`Up to ${formatInr(toNumber(dialog.payment.amount) - refundedOf(dialog.payment.id))}`}><input className={inputClass} type="number" min={0.01} step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} /></Field> : null}
              </div>
            ) : null}
            <Field label={dialog.kind === "verify" ? "Note (optional)" : "Reason"} required={dialog.kind !== "verify"}><textarea className={inputClass} rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
