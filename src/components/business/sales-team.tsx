"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, Field, LoadingBlock, Modal, PageHeader, SuccessBanner, buttonClass, inputClass } from "@/components/business/ui";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { callRpc, newIdempotencyKey } from "@/lib/business/rpc";
import { runProvisioningJob } from "@/lib/business/provisioning-client";
import { formatDate, formatInr, statusTone, titleCase } from "@/lib/business/format";
import type { ProvisioningJob, RepPerformance, SalesRep } from "@/lib/business/types";

type Draft = { id?: string; full_name: string; email: string; mobile: string; address: string; employee_id: string; joining_date: string };

const blank = (): Draft => ({ full_name: "", email: "", mobile: "", address: "", employee_id: "", joining_date: new Date().toISOString().slice(0, 10) });

export function SalesTeamPage() {
  const supabase = useMemo(() => createClient(), []);
  const action = useAction();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [reps, performance, jobs] = await Promise.all([
      supabase.from("sales_representatives").select("*").order("full_name"),
      supabase.from("sales_rep_performance").select("*"),
      supabase.from("business_provisioning_jobs").select("*").eq("job_type", "sales_rep").neq("status", "completed").neq("status", "cancelled"),
    ]);
    for (const result of [reps, performance, jobs]) if (result.error) throw result.error;
    return {
      reps: (reps.data ?? []) as SalesRep[],
      performance: new Map(((performance.data ?? []) as RepPerformance[]).map((row) => [row.rep_user_id, row])),
      jobs: new Map(((jobs.data ?? []) as ProvisioningJob[]).map((job) => [job.subject_id, job])),
    };
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [password, setPassword] = useState("");
  const [retry, setRetry] = useState<{ rep: SalesRep; job: ProvisioningJob } | null>(null);
  const [search, setSearch] = useState("");
  const [idempotency, setIdempotency] = useState(newIdempotencyKey());

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner message={error} />;

  const rows = data.reps.filter((rep) => `${rep.full_name} ${rep.email} ${rep.employee_id ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const setField = (key: keyof Draft, value: string) => setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function saveRep() {
    if (!draft) return;
    const ok = await action.run(async () => {
      if (draft.id) {
        const { error: updateError } = await supabase.from("sales_representatives").update({
          full_name: draft.full_name.trim(),
          mobile: draft.mobile.trim(),
          address: draft.address.trim() || null,
          employee_id: draft.employee_id.trim() || null,
          joining_date: draft.joining_date,
        }).eq("id", draft.id);
        if (updateError) throw updateError;
        return "updated";
      }
      const started = await callRpc<{ job_id: string }>(supabase, "start_sales_rep_provisioning", {
        p_full_name: draft.full_name,
        p_email: draft.email,
        p_mobile: draft.mobile,
        p_address: draft.address || null,
        p_employee_id: draft.employee_id || null,
        p_joining_date: draft.joining_date,
        p_idempotency_key: idempotency,
      });
      const outcome = await runProvisioningJob(supabase, started.job_id, mode, mode === "password" ? password : undefined);
      if (!outcome.ok) throw new Error(`The representative was saved but the login could not be created: ${outcome.error}. Use "Retry login" on the row.`);
      return outcome.invited ? "invited" : "created";
    }, draft.id ? "Representative updated." : mode === "invite" ? "Representative added and invited by email." : "Representative added with the temporary password.");
    if (ok !== undefined) {
      setDraft(null);
      setPassword("");
      setIdempotency(newIdempotencyKey());
    }
    await reload();
  }

  async function toggle(rep: SalesRep) {
    await action.run(() => callRpc(supabase, "set_sales_rep_active", { p_rep_id: rep.id, p_active: rep.status !== "active", p_reason: null }), rep.status === "active" ? "Representative deactivated. They can no longer sign in to the sales portal." : "Representative activated.");
    await reload();
  }

  async function sendReset(rep: SalesRep) {
    await action.run(async () => {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(rep.email, { redirectTo: `${window.location.origin}/auth/update-password` });
      if (resetError) throw resetError;
    }, `A password reset email was sent to ${rep.email}.`);
  }

  return (
    <>
      <PageHeader
        title="Sales team"
        description="Create and manage sales representatives. Only Super Admin can create or change representative accounts."
        actions={<button type="button" className={buttonClass()} onClick={() => { setMode("invite"); setPassword(""); setDraft(blank()); }}>Add representative</button>}
      />
      <ErrorBanner message={error || action.error} />
      <SuccessBanner message={action.success} />

      <Card actions={<input className={`${inputClass} !w-64`} placeholder="Search representatives" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search representatives" />}>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty="No representatives yet."
          columns={[
            { header: "Representative", cell: (row) => <div><Link className="font-medium text-blue-600 hover:underline" href={`/super-admin/sales-team/${row.id}`}>{row.full_name}</Link><div className="text-xs text-slate-500">{row.email}</div></div> },
            { header: "Mobile", cell: (row) => row.mobile },
            { header: "Joined", cell: (row) => formatDate(row.joining_date) },
            { header: "Schools", cell: (row) => (row.user_id ? data.performance.get(row.user_id)?.schools_brought ?? 0 : 0), align: "right" },
            { header: "Collected", cell: (row) => formatInr(row.user_id ? data.performance.get(row.user_id)?.total_collected : 0), align: "right" },
            { header: "Status", cell: (row) => <Badge tone={statusTone(row.status)}>{titleCase(row.status)}</Badge> },
            {
              header: "",
              cell: (row) => {
                const job = data.jobs.get(row.id);
                return (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass("secondary", true)} onClick={() => setDraft({ id: row.id, full_name: row.full_name, email: row.email, mobile: row.mobile, address: row.address ?? "", employee_id: row.employee_id ?? "", joining_date: row.joining_date })}>Edit</button>
                    {row.status === "pending_account" && job ? <button type="button" className={buttonClass("primary", true)} onClick={() => { setMode("invite"); setPassword(""); setRetry({ rep: row, job }); }}>Retry login</button> : null}
                    {row.status !== "pending_account" ? <button type="button" className={buttonClass(row.status === "active" ? "ghost" : "primary", true)} disabled={action.busy} onClick={() => toggle(row)}>{row.status === "active" ? "Deactivate" : "Activate"}</button> : null}
                    {row.status === "active" ? <button type="button" className={buttonClass("secondary", true)} onClick={() => sendReset(row)}>Reset password</button> : null}
                  </div>
                );
              },
            },
          ]}
        />
      </Card>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit representative" : "Add representative"}
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setDraft(null)} disabled={action.busy}>Cancel</button>
            <button type="button" className={buttonClass()} onClick={saveRep} disabled={action.busy || !draft?.full_name.trim() || !draft?.mobile.trim() || (!draft?.id && (!draft?.email.trim() || (mode === "password" && password.length < 8)))}>{action.busy ? "Saving..." : "Save"}</button>
          </>
        }
      >
        <ErrorBanner message={action.error} />
        {draft ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required><input className={inputClass} value={draft.full_name} onChange={(e) => setField("full_name", e.target.value)} /></Field>
            <Field label="Email" required hint={draft.id ? "Email changes use the account email workflow." : "This is the login email."}><input className={inputClass} type="email" value={draft.email} disabled={Boolean(draft.id)} onChange={(e) => setField("email", e.target.value)} /></Field>
            <Field label="Mobile number" required><input className={inputClass} inputMode="tel" value={draft.mobile} onChange={(e) => setField("mobile", e.target.value)} /></Field>
            <Field label="Employee ID"><input className={inputClass} value={draft.employee_id} onChange={(e) => setField("employee_id", e.target.value)} /></Field>
            <Field label="Joining date"><input className={inputClass} type="date" value={draft.joining_date} onChange={(e) => setField("joining_date", e.target.value)} /></Field>
            <Field label="Address"><input className={inputClass} value={draft.address} onChange={(e) => setField("address", e.target.value)} /></Field>
            {!draft.id ? (
              <div className="space-y-2 text-sm sm:col-span-2">
                <label className="flex items-center gap-2"><input type="radio" checked={mode === "invite"} onChange={() => setMode("invite")} /> Send an invitation email (recommended)</label>
                <label className="flex items-center gap-2"><input type="radio" checked={mode === "password"} onChange={() => setMode("password")} /> Set a temporary password</label>
                {mode === "password" ? <Field label="Temporary password" required><input className={inputClass} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={retry !== null}
        onClose={() => setRetry(null)}
        title="Retry representative login"
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setRetry(null)}>Cancel</button>
            <button type="button" className={buttonClass()} disabled={action.busy || (mode === "password" && password.length < 8)} onClick={async () => { if (!retry) return; const ok = await action.run(async () => { const outcome = await runProvisioningJob(supabase, retry.job.id, mode, mode === "password" ? password : undefined); if (!outcome.ok) throw new Error(outcome.error); return true; }, "The login is ready."); if (ok) setRetry(null); await reload(); }}>Retry</button>
          </>
        }
      >
        <ErrorBanner message={action.error} />
        {retry ? (
          <div className="space-y-3 text-sm">
            <p>{retry.rep.full_name} - attempt {retry.job.attempts} of {retry.job.max_attempts}.{retry.job.last_error ? ` Last error: ${retry.job.last_error}` : ""}</p>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "invite"} onChange={() => setMode("invite")} /> Send an invitation email</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "password"} onChange={() => setMode("password")} /> Set a temporary password</label>
            {mode === "password" ? <Field label="Temporary password" required><input className={inputClass} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></Field> : null}
            <p className="text-xs text-slate-500">Retrying is safe: an existing login is reused, never duplicated.</p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
