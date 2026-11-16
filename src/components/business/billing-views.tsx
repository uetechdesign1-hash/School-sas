"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, LoadingBlock, Modal, PageHeader, SuccessBanner, Field, buttonClass, inputClass } from "@/components/business/ui";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { callRpc } from "@/lib/business/rpc";
import { downloadInvoicePdf } from "@/lib/business/pdf/download";
import { downloadCsv, toCsv } from "@/lib/business/csv";
import { formatDate, formatInr, planLabel, statusTone, titleCase, toNumber } from "@/lib/business/format";
import type { BillingSummary, Invoice, InvoiceBalance } from "@/lib/business/types";

export function InvoicesView() {
  const supabase = useMemo(() => createClient(), []);
  const action = useAction();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [balances, invoices, schools] = await Promise.all([
      supabase.from("school_invoice_balances").select("*").order("invoice_date", { ascending: false }),
      supabase.from("school_invoices").select("*"),
      supabase.from("schools").select("id, name"),
    ]);
    for (const result of [balances, invoices, schools]) if (result.error) throw result.error;
    return {
      balances: (balances.data ?? []) as InvoiceBalance[],
      invoices: new Map(((invoices.data ?? []) as Invoice[]).map((invoice) => [invoice.id, invoice])),
      names: new Map((schools.data ?? []).map((row) => [row.id as string, row.name as string])),
    };
  });
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner message={error} />;

  const rows = data.balances
    .filter((row) => status === "all" || row.display_status === status)
    .filter((row) => `${row.invoice_number} ${data.names.get(row.school_id) ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Invoices follow each agreement's payment schedule. An invoice is a memo: it records what is due, not revenue."
        actions={
          <button type="button" className={buttonClass()} disabled={action.busy} onClick={async () => { await action.run(async () => { const count = await callRpc<number>(supabase, "generate_due_invoices"); return count; }, "Due invoices generated for the current schedule."); await reload(); }}>
            Generate due invoices
          </button>
        }
      />
      <ErrorBanner message={error || action.error} />
      <SuccessBanner message={action.success} />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className={`${inputClass} !w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          {["all", "unpaid", "partially_paid", "overdue", "paid", "cancelled"].map((value) => <option key={value} value={value}>{value === "all" ? "All statuses" : titleCase(value)}</option>)}
        </select>
        <input className={`${inputClass} !w-64`} placeholder="Search invoice or school" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
      </div>
      <Card>
        <DataTable
          rows={rows}
          rowKey={(row) => row.invoice_id}
          empty="No invoices match."
          columns={[
            { header: "Invoice", cell: (row) => row.invoice_number },
            { header: "School", cell: (row) => <Link className="text-blue-600 hover:underline" href={`/super-admin/schools/${row.school_id}`}>{data.names.get(row.school_id) ?? "School"}</Link> },
            { header: "Period", cell: (row) => `${formatDate(row.period_start)} - ${formatDate(row.period_end)}` },
            { header: "Due", cell: (row) => formatDate(row.due_date) },
            { header: "Total", cell: (row) => formatInr(row.total_amount), align: "right" },
            { header: "Paid", cell: (row) => formatInr(row.paid_amount), align: "right" },
            { header: "Balance", cell: (row) => formatInr(row.balance_amount), align: "right" },
            { header: "Status", cell: (row) => <Badge tone={statusTone(row.display_status)}>{titleCase(row.display_status)}</Badge> },
            {
              header: "",
              cell: (row) => (
                <div className="flex gap-2">
                  <button type="button" className={buttonClass("secondary", true)} onClick={() => { const invoice = data.invoices.get(row.invoice_id); if (invoice) void action.run(() => downloadInvoicePdf(supabase, invoice, row)); }}>PDF</button>
                  {row.invoice_status === "issued" ? <button type="button" className={buttonClass("ghost", true)} onClick={() => { setReason(""); setCancelId(row.invoice_id); }}>Cancel</button> : null}
                </div>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        open={cancelId !== null}
        onClose={() => setCancelId(null)}
        title="Cancel invoice"
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setCancelId(null)}>Keep invoice</button>
            <button type="button" className={buttonClass("danger")} disabled={action.busy || !reason.trim()} onClick={async () => { const ok = await action.run(() => callRpc(supabase, "cancel_school_invoice", { p_invoice_id: cancelId, p_reason: reason }), "Invoice cancelled."); if (ok !== undefined) { setCancelId(null); await reload(); } }}>Cancel invoice</button>
          </>
        }
      >
        <ErrorBanner message={action.error} />
        <p className="mb-3 text-sm text-slate-600">An invoice with payments cannot be cancelled; reverse its payments first. Cancelling frees the billing period for re-issue.</p>
        <Field label="Reason" required><textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

export function OutstandingView() {
  const { data, error, loading } = useAsyncData(async () => {
    const supabase = createClient();
    const [summary, balances] = await Promise.all([
      supabase.from("school_billing_summary").select("*"),
      supabase.from("school_invoice_balances").select("school_id, display_status, balance_amount"),
    ]);
    for (const result of [summary, balances]) if (result.error) throw result.error;
    const overdue = new Map<string, number>();
    for (const row of balances.data ?? []) {
      if (row.display_status === "overdue") overdue.set(row.school_id as string, (overdue.get(row.school_id as string) ?? 0) + toNumber(row.balance_amount as number));
    }
    return { summary: (summary.data ?? []) as BillingSummary[], overdue };
  });
  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner message={error} />;

  const rows = data.summary.filter((row) => toNumber(row.outstanding_amount) > 0).sort((a, b) => toNumber(b.outstanding_amount) - toNumber(a.outstanding_amount));
  const total = rows.reduce((sum, row) => sum + toNumber(row.outstanding_amount), 0);

  return (
    <>
      <PageHeader
        title="Outstanding payments"
        description="Invoiced amounts not yet collected (verified payments only)."
        actions={
          <button type="button" className={buttonClass("secondary")} onClick={() => downloadCsv("outstanding-payments.csv", toCsv(rows, [
            { header: "School", value: (r) => r.school_name },
            { header: "Plan", value: (r) => planLabel(r.plan_code) },
            { header: "Contract amount", value: (r) => toNumber(r.contract_amount) },
            { header: "Invoiced", value: (r) => toNumber(r.invoiced_amount) },
            { header: "Collected", value: (r) => toNumber(r.collected_amount) },
            { header: "Pending verification", value: (r) => toNumber(r.pending_verification_amount) },
            { header: "Outstanding", value: (r) => toNumber(r.outstanding_amount) },
            { header: "Overdue", value: (r) => data.overdue.get(r.school_id) ?? 0 },
            { header: "Next due", value: (r) => r.next_due_date },
          ]))}>Export CSV</button>
        }
      />
      <ErrorBanner message={error} />
      <p className="mb-4 text-sm text-slate-600">Total outstanding: <strong>{formatInr(total)}</strong></p>
      <Card>
        <DataTable
          rows={rows}
          rowKey={(row) => row.school_id}
          empty="Nothing is outstanding."
          columns={[
            { header: "School", cell: (row) => <Link className="text-blue-600 hover:underline" href={`/super-admin/schools/${row.school_id}`}>{row.school_name}</Link> },
            { header: "Plan", cell: (row) => planLabel(row.plan_code) },
            { header: "Contract", cell: (row) => formatInr(row.contract_amount), align: "right" },
            { header: "Invoiced", cell: (row) => formatInr(row.invoiced_amount), align: "right" },
            { header: "Collected", cell: (row) => formatInr(row.collected_amount), align: "right" },
            { header: "Pending", cell: (row) => formatInr(row.pending_verification_amount), align: "right" },
            { header: "Outstanding", cell: (row) => <strong>{formatInr(row.outstanding_amount)}</strong>, align: "right" },
            { header: "Overdue", cell: (row) => ((data.overdue.get(row.school_id) ?? 0) > 0 ? <Badge tone="red">{formatInr(data.overdue.get(row.school_id))}</Badge> : "-"), align: "right" },
            { header: "Next due", cell: (row) => formatDate(row.next_due_date) },
          ]}
        />
      </Card>
    </>
  );
}
