"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, Field, LoadingBlock, Modal, PageHeader, SuccessBanner, buttonClass, inputClass } from "@/components/business/ui";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { callRpc } from "@/lib/business/rpc";
import { LEAD_STATUSES, formatDate, statusTone, titleCase } from "@/lib/business/format";
import type { Lead, SalesRep } from "@/lib/business/types";

type Draft = {
  id?: string;
  school_name: string;
  contact_person: string;
  mobile: string;
  email: string;
  address: string;
  district: string;
  state: string;
  estimated_student_strength: string;
  estimated_staff_strength: string;
  notes: string;
  next_follow_up_date: string;
  status: string;
  assigned_rep_id: string;
};

const blank: Draft = {
  school_name: "",
  contact_person: "",
  mobile: "",
  email: "",
  address: "",
  district: "",
  state: "",
  estimated_student_strength: "",
  estimated_staff_strength: "",
  notes: "",
  next_follow_up_date: "",
  status: "new_lead",
  assigned_rep_id: "",
};

const toDraft = (lead: Lead): Draft => ({
  id: lead.id,
  school_name: lead.school_name,
  contact_person: lead.contact_person ?? "",
  mobile: lead.mobile ?? "",
  email: lead.email ?? "",
  address: lead.address ?? "",
  district: lead.district ?? "",
  state: lead.state ?? "",
  estimated_student_strength: lead.estimated_student_strength?.toString() ?? "",
  estimated_staff_strength: lead.estimated_staff_strength?.toString() ?? "",
  notes: lead.notes ?? "",
  next_follow_up_date: lead.next_follow_up_date ?? "",
  status: lead.status,
  assigned_rep_id: lead.assigned_rep_id,
});

export function LeadsManager({ isAdmin }: { isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const action = useAction();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [leads, reps] = await Promise.all([
      supabase.from("school_leads").select("*").order("created_at", { ascending: false }),
      isAdmin ? supabase.from("sales_representatives").select("*").eq("status", "active").order("full_name") : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [leads, reps]) if (result.error) throw result.error;
    return { leads: (leads.data ?? []) as Lead[], reps: (reps.data ?? []) as SalesRep[] };
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState("all");
  const [repFilter, setRepFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [reassign, setReassign] = useState<{ lead: Lead; rep: string } | null>(null);

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner message={error} />;

  const repName = (id: string) => data.reps.find((rep) => rep.user_id === id)?.full_name ?? "Representative";
  const rows = data.leads
    .filter((lead) => status === "all" || lead.status === status)
    .filter((lead) => repFilter === "all" || lead.assigned_rep_id === repFilter)
    .filter((lead) => `${lead.school_name} ${lead.contact_person ?? ""} ${lead.district ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  const setField = (key: keyof Draft, value: string) => setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function save() {
    if (!draft) return;
    const payload = {
      school_name: draft.school_name.trim(),
      contact_person: draft.contact_person.trim() || null,
      mobile: draft.mobile.trim() || null,
      email: draft.email.trim() || null,
      address: draft.address.trim() || null,
      district: draft.district.trim() || null,
      state: draft.state.trim() || null,
      estimated_student_strength: draft.estimated_student_strength ? Number(draft.estimated_student_strength) : null,
      estimated_staff_strength: draft.estimated_staff_strength ? Number(draft.estimated_staff_strength) : null,
      notes: draft.notes.trim() || null,
      next_follow_up_date: draft.next_follow_up_date || null,
      status: draft.status,
    };
    const ok = await action.run(async () => {
      if (draft.id) {
        const { error: updateError } = await supabase.from("school_leads").update(payload).eq("id", draft.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from("school_leads").insert({ ...payload, ...(isAdmin ? { assigned_rep_id: draft.assigned_rep_id } : {}) });
        if (insertError) throw insertError;
      }
      return true;
    }, draft.id ? "Lead updated." : "Lead added.");
    if (ok) {
      setDraft(null);
      await reload();
    }
  }

  return (
    <>
      <PageHeader
        title={isAdmin ? "Leads / prospects" : "My leads"}
        description={isAdmin ? "Every representative's pipeline." : "Schools you are talking to. Convert a lead to create the school without re-entering details."}
        actions={<button type="button" className={buttonClass()} onClick={() => setDraft({ ...blank, assigned_rep_id: data.reps[0]?.user_id ?? "" })}>Add lead</button>}
      />
      <ErrorBanner message={error || action.error} />
      <SuccessBanner message={action.success} />

      <div className="mb-4 flex flex-wrap gap-2">
        <select className={`${inputClass} !w-48`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="all">All statuses</option>
          {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {isAdmin ? (
          <select className={`${inputClass} !w-48`} value={repFilter} onChange={(e) => setRepFilter(e.target.value)} aria-label="Representative filter">
            <option value="all">All representatives</option>
            {data.reps.map((rep) => <option key={rep.id} value={rep.user_id ?? ""}>{rep.full_name}</option>)}
          </select>
        ) : null}
        <input className={`${inputClass} !w-64`} placeholder="Search school, contact, district" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search leads" />
      </div>

      <Card>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty="No leads yet."
          columns={[
            { header: "School", cell: (row) => <div><div className="font-medium text-slate-900">{row.school_name}</div><div className="text-xs text-slate-500">{[row.district, row.state].filter(Boolean).join(", ")}</div></div> },
            { header: "Contact", cell: (row) => <div>{row.contact_person ?? "-"}<div className="text-xs text-slate-500">{row.mobile}</div></div> },
            { header: "Students / staff", cell: (row) => `${row.estimated_student_strength ?? "-"} / ${row.estimated_staff_strength ?? "-"}`, align: "right" },
            ...(isAdmin ? [{ header: "Representative", cell: (row: Lead) => repName(row.assigned_rep_id) }] : []),
            { header: "Follow-up", cell: (row) => formatDate(row.next_follow_up_date) },
            { header: "Status", cell: (row) => <Badge tone={statusTone(row.status)}>{titleCase(row.status)}</Badge> },
            {
              header: "",
              cell: (row) =>
                row.status === "converted" ? (
                  row.converted_school_id ? <Link className="text-blue-600 hover:underline" href={`${isAdmin ? "/super-admin" : "/sales"}/schools/${row.converted_school_id}`}>Open school</Link> : null
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass("secondary", true)} onClick={() => setDraft(toDraft(row))}>Edit</button>
                    {row.status !== "not_interested" ? <Link className={buttonClass("primary", true)} href={`${isAdmin ? "/super-admin" : "/sales"}/schools/new?lead=${row.id}`}>Convert</Link> : null}
                    {isAdmin ? <button type="button" className={buttonClass("ghost", true)} onClick={() => setReassign({ lead: row, rep: row.assigned_rep_id })}>Reassign</button> : null}
                  </div>
                ),
            },
          ]}
        />
      </Card>

      <Modal
        wide
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit lead" : "Add lead"}
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className={buttonClass()} disabled={action.busy || !draft?.school_name.trim() || (isAdmin && !draft?.id && !draft?.assigned_rep_id)} onClick={save}>{action.busy ? "Saving..." : "Save lead"}</button>
          </>
        }
      >
        <ErrorBanner message={action.error} />
        {draft ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School name" required><input className={inputClass} value={draft.school_name} onChange={(e) => setField("school_name", e.target.value)} /></Field>
            <Field label="Contact person"><input className={inputClass} value={draft.contact_person} onChange={(e) => setField("contact_person", e.target.value)} /></Field>
            <Field label="Mobile number"><input className={inputClass} inputMode="tel" value={draft.mobile} onChange={(e) => setField("mobile", e.target.value)} /></Field>
            <Field label="Email"><input className={inputClass} type="email" value={draft.email} onChange={(e) => setField("email", e.target.value)} /></Field>
            <Field label="Address"><input className={inputClass} value={draft.address} onChange={(e) => setField("address", e.target.value)} /></Field>
            <Field label="District"><input className={inputClass} value={draft.district} onChange={(e) => setField("district", e.target.value)} /></Field>
            <Field label="State"><input className={inputClass} value={draft.state} onChange={(e) => setField("state", e.target.value)} /></Field>
            <Field label="Next follow-up date"><input className={inputClass} type="date" value={draft.next_follow_up_date} onChange={(e) => setField("next_follow_up_date", e.target.value)} /></Field>
            <Field label="Estimated student strength"><input className={inputClass} type="number" min={0} value={draft.estimated_student_strength} onChange={(e) => setField("estimated_student_strength", e.target.value)} /></Field>
            <Field label="Estimated staff strength"><input className={inputClass} type="number" min={0} value={draft.estimated_staff_strength} onChange={(e) => setField("estimated_staff_strength", e.target.value)} /></Field>
            <Field label="Status"><select className={inputClass} value={draft.status} onChange={(e) => setField("status", e.target.value)}>{LEAD_STATUSES.filter((s) => s.value !== "converted").map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
            {isAdmin && !draft.id ? <Field label="Assigned representative" required><select className={inputClass} value={draft.assigned_rep_id} onChange={(e) => setField("assigned_rep_id", e.target.value)}>{data.reps.map((rep) => <option key={rep.id} value={rep.user_id ?? ""}>{rep.full_name}</option>)}</select></Field> : null}
            <div className="sm:col-span-2"><Field label="Notes"><textarea className={inputClass} rows={3} value={draft.notes} onChange={(e) => setField("notes", e.target.value)} /></Field></div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={reassign !== null}
        onClose={() => setReassign(null)}
        title="Reassign lead"
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setReassign(null)}>Cancel</button>
            <button type="button" className={buttonClass()} disabled={action.busy} onClick={async () => { if (!reassign) return; const ok = await action.run(() => callRpc(supabase, "reassign_lead", { p_lead_id: reassign.lead.id, p_new_rep_user_id: reassign.rep }), "Lead reassigned."); if (ok !== undefined) { setReassign(null); await reload(); } }}>Reassign</button>
          </>
        }
      >
        <ErrorBanner message={action.error} />
        {reassign ? <Field label={`New owner for ${reassign.lead.school_name}`}><select className={inputClass} value={reassign.rep} onChange={(e) => setReassign({ ...reassign, rep: e.target.value })}>{data.reps.map((rep) => <option key={rep.id} value={rep.user_id ?? ""}>{rep.full_name}</option>)}</select></Field> : null}
      </Modal>
    </>
  );
}
