"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, Field, LoadingBlock, Modal, SuccessBanner, buttonClass, inputClass } from "@/components/business/ui";
import { PaymentFormModal } from "@/components/business/payment-form-modal";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { callRpc } from "@/lib/business/rpc";
import { downloadInvoicePdf, downloadMouPdf, downloadReceiptPdf } from "@/lib/business/pdf/download";
import { runProvisioningJob } from "@/lib/business/provisioning-client";
import { PAYMENT_STATUS_LABELS, formatDate, formatInr, planLabel, pricingUnitLabel, statusTone, titleCase, toNumber } from "@/lib/business/format";
import type { BillingConfirmation, Invoice, InvoiceBalance, PaymentReversal, ProvisioningJob, SalesRep, SchoolMou, SchoolPayment } from "@/lib/business/types";

type Subscription = {
  id: string;
  school_id: string;
  amount: number | string;
  status: string;
  pricing_unit: string | null;
  estimated_student_count: number | null;
  billing_student_count: number | null;
  default_unit_price: number | string | null;
  negotiated_unit_price: number | string | null;
  discount_amount: number | string;
  contract_term_months: number | null;
  billing_frequency: string | null;
  monthly_instalments_allowed: boolean;
  payment_terms: string | null;
  special_conditions: string | null;
  price_outside_recommended_range: boolean;
  agreement_version: number;
  started_on: string;
  expires_on: string;
  subscription_plan_id: string | null;
  enabled_modules: string[] | null;
};

type Ownership = { original_acquisition_rep_id: string | null; current_rep_id: string | null; acquired_at: string };
type SchoolAcademicYear = { id: string; name: string; is_current?: boolean | null };
type RenewalResult = {
  subscription_id: string;
  mou_id: string;
  mou_number: string;
  version: number;
  total_amount: number | string;
  starts_on: string;
  expires_on: string;
};

async function load(schoolId: string, isAdmin: boolean) {
  const supabase = createClient();
  const [sub, mous, confirmations, balances, invoices, payments, reversals, jobs, ownership, reps, years] = await Promise.all([
    supabase.from("school_subscriptions").select("*").eq("school_id", schoolId).eq("status", "active").not("subscription_plan_id", "is", null).maybeSingle(),
    supabase.from("school_mous").select("*").eq("school_id", schoolId).order("generated_at", { ascending: false }),
    supabase.from("billing_count_confirmations").select("*").eq("school_id", schoolId).order("requested_at", { ascending: false }),
    supabase.from("school_invoice_balances").select("*").eq("school_id", schoolId).order("period_sequence"),
    supabase.from("school_invoices").select("*").eq("school_id", schoolId),
    supabase.from("school_payments").select("*").eq("school_id", schoolId).order("submitted_at", { ascending: false }),
    supabase.from("payment_reversals").select("*").eq("school_id", schoolId),
    supabase.from("business_provisioning_jobs").select("*").eq("subject_id", schoolId).eq("job_type", "school_owner").order("created_at", { ascending: false }).limit(1),
    supabase.from("school_sales_ownership").select("*").eq("school_id", schoolId).maybeSingle(),
    isAdmin ? supabase.from("sales_representatives").select("*").order("full_name") : Promise.resolve({ data: [], error: null }),
    supabase.from("academic_years").select("id,name,is_current").eq("school_id", schoolId).order("start_date", { ascending: false }),
  ]);
  for (const result of [sub, mous, confirmations, balances, invoices, payments, reversals, jobs, ownership, reps, years]) {
    if (result.error) throw result.error;
  }
  return {
    sub: (sub.data as Subscription | null) ?? null,
    mous: (mous.data ?? []) as SchoolMou[],
    confirmations: (confirmations.data ?? []) as BillingConfirmation[],
    balances: (balances.data ?? []) as InvoiceBalance[],
    invoices: (invoices.data ?? []) as Invoice[],
    payments: (payments.data ?? []) as SchoolPayment[],
    reversals: (reversals.data ?? []) as PaymentReversal[],
    job: ((jobs.data ?? [])[0] as ProvisioningJob | undefined) ?? null,
    ownership: (ownership.data as Ownership | null) ?? null,
    reps: (reps.data ?? []) as SalesRep[],
    years: (years.data ?? []) as SchoolAcademicYear[],
  };
}

export function SchoolBusinessPanel({ schoolId, isAdmin }: { schoolId: string; isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const { data, error, loading, reload } = useAsyncData(() => load(schoolId, isAdmin));
  const action = useAction();

  const [payOpen, setPayOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<string | undefined>();
  const [finalOpen, setFinalOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [finalCount, setFinalCount] = useState("");
  const [finalNote, setFinalNote] = useState("");
  const [finalAcademicYearId, setFinalAcademicYearId] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMode, setLoginMode] = useState<"invite" | "password">("invite");
  const [loginPassword, setLoginPassword] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignRep, setReassignRep] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [place, setPlace] = useState("");

  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { sub, mous, confirmations, balances, invoices, payments, reversals, job, ownership, reps, years } = data;
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const repName = (id: string | null) => (id ? reps.find((rep) => rep.user_id === id)?.full_name ?? "Representative" : "Company direct");
  const pendingConfirmation = confirmations.find((c) => c.status === "pending_approval");
  const hasInitial = mous.some((mou) => mou.mou_type === "initial");
  const selectedAcademicYear = years.find((year) => year.id === finalAcademicYearId);

  async function doAction(task: () => Promise<unknown>, message: string) {
    await action.run(task, message);
    await reload();
  }

  async function renewAgreement() {
    const result = await action.run(
      () => callRpc<RenewalResult>(supabase, "renew_school_subscription", {
        p_school_id: schoolId,
        p_place: place || null,
      }),
      "One-year renewal and new MOU created.",
    );
    if (!result) return;
    action.setSuccess(
      `Renewed through ${formatDate(result.expires_on)}. Initial MOU ${result.mou_number} (v${result.version}) is ready to download.`,
    );
    setRenewOpen(false);
    await reload();
  }

  async function retryLogin() {
    if (!job) return;
    const outcome = await runProvisioningJob(supabase, job.id, loginMode, loginMode === "password" ? loginPassword : undefined);
    if (!outcome.ok) throw new Error(outcome.error);
    setLoginOpen(false);
  }

  async function createLoginJob() {
    const key = crypto.randomUUID();
    const started = await callRpc<{ job_id: string }>(supabase, "start_school_owner_provisioning", {
      p_school_id: schoolId,
      p_owner_name: ownerName,
      p_owner_email: ownerEmail,
      p_owner_phone: null,
      p_idempotency_key: key,
    });
    const outcome = await runProvisioningJob(supabase, started.job_id, loginMode, loginMode === "password" ? loginPassword : undefined);
    if (!outcome.ok) throw new Error(outcome.error);
    setLoginOpen(false);
  }

  const loginPending = !job || job.status !== "completed";

  return (
    <div className="space-y-6">
      <ErrorBanner message={action.error} />
      <SuccessBanner message={action.success} />

      <Card title="Agreement" actions={sub ? <Badge tone="blue">Version {sub.agreement_version}</Badge> : undefined}>
        {!sub ? (
          <p className="text-sm text-slate-500">This school has no Phase 2 agreement (created before sales management was introduced).</p>
        ) : (
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Plan", planLabel(planCodeFor(sub))],
              ["Contract amount", formatInr(sub.amount)],
              ["Pricing", `${formatInr(sub.negotiated_unit_price)} ${pricingUnitLabel(sub.pricing_unit)}`],
              ["List price", formatInr(sub.default_unit_price)],
              ["Student strength (initial / billing)", `${sub.estimated_student_count} / ${sub.billing_student_count}`],
              ["Discount", formatInr(sub.discount_amount)],
              ["Frequency", titleCase(sub.billing_frequency)],
              ["Term", `${formatDate(sub.started_on)} to ${formatDate(sub.expires_on)}`],
              ["Payment terms", sub.payment_terms ?? "-"],
              ["Special conditions", sub.special_conditions ?? "-"],
              ["Representative", ownership ? `${repName(ownership.current_rep_id)}${ownership.original_acquisition_rep_id !== ownership.current_rep_id ? ` (originally ${repName(ownership.original_acquisition_rep_id)})` : ""}` : "-"],
            ].map(([name, value]) => (
              <div key={name} className="border-b border-slate-100 py-1.5"><dt className="text-xs text-slate-500">{name}</dt><dd className="font-medium text-slate-900">{value}</dd></div>
            ))}
          </dl>
        )}
        {sub?.price_outside_recommended_range ? <p className="mt-3 text-xs text-amber-700">Negotiated price is outside the recommended range.</p> : null}
        {isAdmin ? (
          <div className="mt-4"><button type="button" className={buttonClass("secondary", true)} onClick={() => setReassignOpen(true)}>Reassign representative</button></div>
        ) : null}
      </Card>

      <Card title="Owner login">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            {job ? (
              <>
                <Badge tone={statusTone(job.status)}>{titleCase(job.status)}</Badge>
                <span className="ml-2 text-slate-600">{job.target_email}</span>
                {job.last_error ? <p className="mt-2 text-xs text-red-600">Last error: {job.last_error}</p> : null}
              </>
            ) : (
              <span className="text-slate-500">No owner login has been set up for this school.</span>
            )}
          </div>
          {loginPending ? <button type="button" className={buttonClass("secondary", true)} onClick={() => setLoginOpen(true)}>{job ? "Retry owner login" : "Create owner login"}</button> : null}
        </div>
      </Card>

      <Card
        title="MOUs"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputClass} !w-40 !py-1.5 text-xs`} placeholder="Place (optional)" value={place} onChange={(e) => setPlace(e.target.value)} />
            <button type="button" className={buttonClass("primary", true)} disabled={action.busy || !sub} onClick={() => doAction(() => callRpc(supabase, "generate_initial_mou", { p_school_id: schoolId, p_place: place || null }), "A new Initial MOU version was generated.")}>
              {hasInitial ? "New Initial MOU version" : "Generate Initial MOU"}
            </button>
            {sub?.contract_term_months === 12 ? (
              <button
                type="button"
                className={buttonClass("primary", true)}
                disabled={action.busy || Boolean(pendingConfirmation)}
                onClick={() => setRenewOpen(true)}
                title={pendingConfirmation ? "Resolve the pending billing-count approval before renewing." : undefined}
              >
                Extend 1 year &amp; create MOU
              </button>
            ) : null}
            <button type="button" className={buttonClass("secondary", true)} disabled={!hasInitial || !years.length || Boolean(pendingConfirmation)} onClick={() => { setFinalAcademicYearId(years.find((year) => year.is_current)?.id ?? years[0]?.id ?? ""); setFinalOpen(true); }}>Create Final MOU</button>
          </div>
        }
      >
        {pendingConfirmation ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Final MOU awaiting approval:</strong> {pendingConfirmation.academic_year_name || "Selected academic year"}; initial {pendingConfirmation.initial_student_count} students, school records show {pendingConfirmation.observed_student_count}, confirmed {pendingConfirmation.confirmed_student_count}. Revised amount {formatInr(pendingConfirmation.revised_amount)} (was {formatInr(pendingConfirmation.previous_amount)}).
            {isAdmin ? (
              <div className="mt-2 flex gap-2">
                <button type="button" className={buttonClass("primary", true)} disabled={action.busy} onClick={() => doAction(() => callRpc(supabase, "decide_billing_count_confirmation", { p_confirmation_id: pendingConfirmation.id, p_approve: true }), "Approved. The Final MOU was generated.")}>Approve & generate Final MOU</button>
                <button type="button" className={buttonClass("secondary", true)} disabled={action.busy} onClick={() => doAction(() => callRpc(supabase, "decide_billing_count_confirmation", { p_confirmation_id: pendingConfirmation.id, p_approve: false }), "Confirmation rejected.")}>Reject</button>
              </div>
            ) : null}
          </div>
        ) : null}
        <DataTable
          rows={mous}
          rowKey={(row) => row.id}
          empty="No MOUs generated yet."
          columns={[
            { header: "MOU number", cell: (row) => row.mou_number },
            { header: "Type", cell: (row) => <Badge tone={row.mou_type === "final" ? "green" : "blue"}>{titleCase(row.mou_type)} v{row.version}</Badge> },
            { header: "Students", cell: (row) => row.student_count, align: "right" },
            { header: "Amount", cell: (row) => formatInr(row.total_amount), align: "right" },
            { header: "Terms", cell: (row) => `v${row.terms_version}` },
            { header: "Generated", cell: (row) => formatDate(row.generated_at) },
            { header: "", cell: (row) => <button type="button" className={buttonClass("secondary", true)} onClick={() => action.run(() => downloadMouPdf(supabase, row))}>Download PDF</button> },
          ]}
        />
      </Card>

      <Modal
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        title="Extend this school for one year?"
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setRenewOpen(false)}>Cancel</button>
            <button type="button" className={buttonClass()} disabled={action.busy} onClick={() => void renewAgreement()}>
              {action.busy ? "Creating renewal..." : "Extend 1 year & create MOU"}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm leading-6 text-slate-600">
          <p>This creates a new 12-month agreement using the current plan, student count, price and payment terms. The new term starts the day after the current expiry, or today if the agreement has already expired.</p>
          <p>The current agreement, invoices and MOU stay in the history. A new Initial MOU is generated for the renewed term; confirm the billing count afterward if the school needs a Final MOU.</p>
          <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">This action also extends the school&apos;s access through the new contract end date.</p>
        </div>
      </Modal>

      <Card
        title="Invoices"
        actions={isAdmin && sub ? <button type="button" className={buttonClass("secondary", true)} disabled={action.busy} onClick={() => doAction(async () => { const count = await callRpc<number>(supabase, "generate_school_invoices", { p_subscription_id: sub.id }); if (!count) throw new Error("No invoices are due yet."); }, "Invoices generated.")}>Generate due invoices</button> : undefined}
      >
        <DataTable
          rows={balances}
          rowKey={(row) => row.invoice_id}
          empty="No invoices yet."
          columns={[
            { header: "Invoice", cell: (row) => row.invoice_number },
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
                  <button type="button" className={buttonClass("secondary", true)} onClick={() => { const invoice = invoiceById.get(row.invoice_id); if (invoice) void action.run(() => downloadInvoicePdf(supabase, invoice, row)); }}>PDF</button>
                  {row.invoice_status === "issued" && toNumber(row.balance_amount) > 0 ? <button type="button" className={buttonClass("primary", true)} onClick={() => { setPayInvoice(row.invoice_id); setPayOpen(true); }}>Collect</button> : null}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Card title="Collections">
        <DataTable
          rows={payments}
          rowKey={(row) => row.id}
          empty="No payments recorded yet."
          columns={[
            { header: "Date", cell: (row) => formatDate(row.payment_date) },
            { header: "Invoice", cell: (row) => invoiceById.get(row.invoice_id)?.invoice_number ?? "-" },
            { header: "Amount", cell: (row) => formatInr(row.amount), align: "right" },
            { header: "Mode", cell: (row) => titleCase(row.payment_mode) },
            { header: "Reference", cell: (row) => row.transaction_reference },
            { header: "Status", cell: (row) => <Badge tone={statusTone(row.status)}>{PAYMENT_STATUS_LABELS[row.status] ?? row.status}</Badge> },
            { header: "Refunded", cell: (row) => formatInr(reversals.filter((r) => r.payment_id === row.id).reduce((sum, r) => sum + toNumber(r.amount), 0)), align: "right" },
            { header: "", cell: (row) => (row.receipt_snapshot ? <button type="button" className={buttonClass("secondary", true)} onClick={() => action.run(() => downloadReceiptPdf(supabase, row))}>Receipt</button> : null) },
          ]}
        />
      </Card>

      <PaymentFormModal open={payOpen} onClose={() => setPayOpen(false)} invoices={balances} defaultInvoiceId={payInvoice} onDone={(message) => { action.setSuccess(message); void reload(); }} />

      <Modal
        open={finalOpen}
        onClose={() => setFinalOpen(false)}
        title="Create Final MOU for an academic year"
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setFinalOpen(false)}>Cancel</button>
            <button type="button" className={buttonClass()} disabled={action.busy || !finalAcademicYearId || !(Number(finalCount) >= 1)} onClick={() => doAction(async () => { await callRpc(supabase, "request_year_billing_count_confirmation", { p_school_id: schoolId, p_academic_year_id: finalAcademicYearId, p_confirmed_student_count: Number(finalCount), p_note: finalNote || null }); setFinalOpen(false); }, "Submitted for Super Admin approval.")}>Submit for approval</button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">Create a separate Final MOU for each academic year. The active enrollment count for that year is shown as the school-record count; confirm the billable strength for Super Admin approval.</p>
        <div className="grid gap-4">
          <Field label="Academic year" required><select className={inputClass} value={finalAcademicYearId} onChange={async (e) => { const id = e.target.value; setFinalAcademicYearId(id); setFinalCount(""); if (id) { const { count, error } = await supabase.from("student_enrollments").select("student_id,students!inner(status)", { count: "exact", head: true }).eq("school_id", schoolId).eq("academic_year_id", id).eq("students.status", "active"); if (!error && count !== null) setFinalCount(String(count)); } }}><option value="">Select academic year</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}{year.is_current ? " (Current)" : ""}</option>)}</select></Field>
          <Field label={`Active students in ${selectedAcademicYear?.name ?? "selected year"}`} required><input className={inputClass} type="number" min={1} value={finalCount} onChange={(e) => setFinalCount(e.target.value)} /></Field>
          <Field label="Note"><textarea className={inputClass} rows={2} value={finalNote} onChange={(e) => setFinalNote(e.target.value)} /></Field>
        </div>
      </Modal>

      <Modal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        title={job ? "Retry owner login" : "Create owner login"}
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setLoginOpen(false)}>Cancel</button>
            <button type="button" className={buttonClass()} disabled={action.busy || (loginMode === "password" && loginPassword.length < 8) || (!job && (!ownerName.trim() || !ownerEmail.trim()))} onClick={() => doAction(job ? retryLogin : createLoginJob, "The owner login is ready.")}>{action.busy ? "Working..." : "Continue"}</button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          {!job ? (
            <div className="grid gap-4">
              <Field label="Owner name" required><input className={inputClass} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></Field>
              <Field label="Owner email" required><input className={inputClass} type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} /></Field>
            </div>
          ) : null}
          <label className="flex items-center gap-2"><input type="radio" checked={loginMode === "invite"} onChange={() => setLoginMode("invite")} /> Send an invitation email</label>
          <label className="flex items-center gap-2"><input type="radio" checked={loginMode === "password"} onChange={() => setLoginMode("password")} /> Set a temporary password</label>
          {loginMode === "password" ? <Field label="Temporary password" required><input className={inputClass} autoComplete="off" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} /></Field> : null}
          <p className="text-xs text-slate-500">Retrying is safe: an existing login is reused, never duplicated.</p>
        </div>
      </Modal>

      <Modal
        open={reassignOpen}
        onClose={() => setReassignOpen(false)}
        title="Reassign representative"
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setReassignOpen(false)}>Cancel</button>
            <button type="button" className={buttonClass()} disabled={action.busy || !reassignReason.trim()} onClick={() => doAction(async () => { await callRpc(supabase, "reassign_school_rep", { p_school_id: schoolId, p_new_rep_user_id: reassignRep || null, p_reason: reassignReason }); setReassignOpen(false); }, "School reassigned. The original attribution is preserved.")}>Reassign</button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="New representative"><select className={inputClass} value={reassignRep} onChange={(e) => setReassignRep(e.target.value)}><option value="">Company direct (no representative)</option>{reps.filter((rep) => rep.status === "active" && rep.user_id).map((rep) => <option key={rep.id} value={rep.user_id ?? ""}>{rep.full_name}</option>)}</select></Field>
          <Field label="Reason" required><textarea className={inputClass} rows={2} value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} /></Field>
          <p className="text-xs text-slate-500">The representative who originally acquired this school keeps the credit permanently in reports.</p>
        </div>
      </Modal>
    </div>
  );
}

function planCodeFor(sub: Subscription): string {
  const modules = sub.enabled_modules ?? [];
  if (modules.includes("fees") && modules.includes("payroll")) return "both";
  if (modules.includes("payroll")) return "plan2";
  return "plan1";
}
