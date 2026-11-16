"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, LoadingBlock, PageHeader, buttonClass, inputClass } from "@/components/business/ui";
import { SchoolBusinessPanel } from "@/components/business/school-business-panel";
import { useAsyncData } from "@/components/business/hooks";
import { formatDate, formatInr, planLabel, statusTone, titleCase } from "@/lib/business/format";
import type { BillingSummary } from "@/lib/business/types";

export function SalesSchoolsList() {
  const { data, error, loading } = useAsyncData(async () => {
    const supabase = createClient();
    const result = await supabase.from("school_billing_summary").select("*").order("school_name");
    if (result.error) throw result.error;
    return (result.data ?? []) as BillingSummary[];
  });
  const [search, setSearch] = useState("");
  if (loading && !data) return <LoadingBlock />;

  const rows = (data ?? []).filter((row) => row.school_name.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <PageHeader title="My schools" description="Schools you currently manage." actions={<Link href="/sales/schools/new" className={buttonClass()}>Add new school</Link>} />
      <ErrorBanner message={error} />
      <Card actions={<input className={`${inputClass} !w-64`} placeholder="Search schools" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search schools" />}>
        <DataTable
          rows={rows}
          rowKey={(row) => row.school_id}
          empty="You have no schools yet. Add your first school to get started."
          columns={[
            { header: "School", cell: (row) => <Link className="font-medium text-blue-600 hover:underline" href={`/sales/schools/${row.school_id}`}>{row.school_name}</Link> },
            { header: "Plan", cell: (row) => planLabel(row.plan_code) },
            { header: "Students", cell: (row) => row.billing_student_count ?? "-", align: "right" },
            { header: "Price", cell: (row) => formatInr(row.negotiated_unit_price), align: "right" },
            { header: "Contract", cell: (row) => formatInr(row.contract_amount), align: "right" },
            { header: "Collected", cell: (row) => formatInr(row.collected_amount), align: "right" },
            { header: "Outstanding", cell: (row) => formatInr(row.outstanding_amount), align: "right" },
            { header: "Next due", cell: (row) => formatDate(row.next_due_date) },
            { header: "Status", cell: (row) => <Badge tone={statusTone(row.subscription_status)}>{titleCase(row.subscription_status)}</Badge> },
          ]}
        />
      </Card>
    </>
  );
}

export function SalesSchoolDetail({ schoolId }: { schoolId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { data, error, loading } = useAsyncData(async () => {
    const result = await supabase.from("schools").select("id, name, code, school_code, address, city, district, state, postal_code, contact_person, contact_phone, email, principal_name, student_limit, staff_strength").eq("id", schoolId).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  });
  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return <ErrorBanner message="School not found, or it is not assigned to you." />;

  return (
    <>
      <PageHeader
        title={data.name}
        description={[data.school_code ?? data.code, data.city, data.district, data.state].filter(Boolean).join(" · ")}
        actions={<Link href="/sales/schools" className={buttonClass("secondary")}>Back to my schools</Link>}
      />
      <Card title="School details" className="mb-6">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Address", [data.address, data.postal_code].filter(Boolean).join(", ") || "-"],
            ["Contact person", data.contact_person ?? "-"],
            ["Contact number", data.contact_phone ?? "-"],
            ["Email", data.email ?? "-"],
            ["Principal", data.principal_name ?? "-"],
            ["Staff strength", String(data.staff_strength ?? "-")],
          ].map(([name, value]) => (
            <div key={name} className="border-b border-slate-100 py-1.5"><dt className="text-xs text-slate-500">{name}</dt><dd className="font-medium text-slate-900">{value}</dd></div>
          ))}
        </dl>
      </Card>
      <SchoolBusinessPanel schoolId={schoolId} isAdmin={false} />
    </>
  );
}
