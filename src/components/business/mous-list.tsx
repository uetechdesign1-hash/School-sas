"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, PageHeader, SuccessBanner, buttonClass, inputClass, LoadingBlock } from "@/components/business/ui";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { callRpc } from "@/lib/business/rpc";
import { downloadMouPdf } from "@/lib/business/pdf/download";
import { formatDate, formatInr, statusTone, titleCase } from "@/lib/business/format";
import type { BillingConfirmation, SchoolMou } from "@/lib/business/types";

type Row = SchoolMou & { school_name: string };

async function load(type: "initial" | "final") {
  const supabase = createClient();
  const [mous, schools, confirmations] = await Promise.all([
    supabase.from("school_mous").select("*").eq("mou_type", type).order("generated_at", { ascending: false }),
    supabase.from("schools").select("id, name"),
    type === "final" ? supabase.from("billing_count_confirmations").select("*").eq("status", "pending_approval").order("requested_at") : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [mous, schools, confirmations]) if (result.error) throw result.error;
  const names = new Map((schools.data ?? []).map((school) => [school.id as string, school.name as string]));
  return {
    rows: ((mous.data ?? []) as SchoolMou[]).map((mou) => ({ ...mou, school_name: names.get(mou.school_id) ?? "School" })) as Row[],
    pending: (confirmations.data ?? []) as BillingConfirmation[],
    names,
  };
}

export function MousList({ type, isAdmin }: { type: "initial" | "final"; isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const { data, error, loading, reload } = useAsyncData(() => load(type));
  const action = useAction();
  const [search, setSearch] = useState("");
  const base = isAdmin ? "/super-admin" : "/sales";

  if (loading && !data) return <LoadingBlock />;
  const rows = (data?.rows ?? []).filter((row) => `${row.school_name} ${row.mou_number}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader
        title={type === "initial" ? "Initial MOUs" : "Final MOUs"}
        description={type === "initial" ? "Provisional agreements based on the estimated student strength. Every regeneration is a new version." : "Agreements based on the approved billing student count. Initial MOUs are never altered."}
        actions={isAdmin && type === "initial" ? <Link href="/super-admin/policies/mou-terms" className={buttonClass("secondary")}>MOU terms</Link> : undefined}
      />
      <ErrorBanner message={error || action.error} />
      <SuccessBanner message={action.success} />

      {type === "final" && (data?.pending.length ?? 0) > 0 ? (
        <Card title="Awaiting Super Admin approval" className="mb-6">
          <DataTable
            rows={data?.pending ?? []}
            rowKey={(row) => row.id}
            columns={[
              { header: "School", cell: (row) => <Link className="text-blue-600 hover:underline" href={`${base}/schools/${row.school_id}`}>{data?.names.get(row.school_id) ?? "School"}</Link> },
              { header: "Academic year", cell: (row) => row.academic_year_name ?? "—" },
              { header: "Initial", cell: (row) => row.initial_student_count, align: "right" },
              { header: "School records", cell: (row) => row.observed_student_count, align: "right" },
              { header: "Confirmed", cell: (row) => row.confirmed_student_count, align: "right" },
              { header: "Revised amount", cell: (row) => `${formatInr(row.revised_amount)} (was ${formatInr(row.previous_amount)})`, align: "right" },
              { header: "Requested", cell: (row) => formatDate(row.requested_at) },
              {
                header: "",
                cell: (row) =>
                  isAdmin ? (
                    <div className="flex gap-2">
                      <button type="button" className={buttonClass("primary", true)} disabled={action.busy} onClick={async () => { await action.run(() => callRpc(supabase, "decide_billing_count_confirmation", { p_confirmation_id: row.id, p_approve: true }), "Approved. The Final MOU was generated."); await reload(); }}>Approve</button>
                      <button type="button" className={buttonClass("secondary", true)} disabled={action.busy} onClick={async () => { await action.run(() => callRpc(supabase, "decide_billing_count_confirmation", { p_confirmation_id: row.id, p_approve: false }), "Rejected."); await reload(); }}>Reject</button>
                    </div>
                  ) : (
                    <Badge tone={statusTone(row.status)}>{titleCase(row.status)}</Badge>
                  ),
              },
            ]}
          />
        </Card>
      ) : null}

      <Card
        actions={<input className={`${inputClass} !w-64`} placeholder="Search school or MOU number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />}
      >
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          empty={type === "initial" ? "No Initial MOUs yet. Generate one from a school's page." : "No Final MOUs yet."}
          columns={[
            { header: "MOU number", cell: (row) => row.mou_number },
            { header: "School", cell: (row) => <Link className="text-blue-600 hover:underline" href={`${base}/schools/${row.school_id}`}>{row.school_name}</Link> },
            { header: "Version", cell: (row) => `v${row.version}` },
            { header: "Students", cell: (row) => row.student_count, align: "right" },
            { header: "Amount", cell: (row) => formatInr(row.total_amount), align: "right" },
            { header: "Terms", cell: (row) => `v${row.terms_version}` },
            { header: "Generated", cell: (row) => formatDate(row.generated_at) },
            { header: "", cell: (row) => <button type="button" className={buttonClass("secondary", true)} onClick={() => action.run(() => downloadMouPdf(supabase, row))}>Download PDF</button> },
          ]}
        />
      </Card>
    </>
  );
}
