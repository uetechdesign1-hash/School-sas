"use client";

import { useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { StatCard } from "@/components/ui/stat-card";
import { Badge, Card, DataTable, ErrorBanner, LoadingBlock, PageHeader, buttonClass } from "@/components/business/ui";
import { useAsyncData } from "@/components/business/hooks";
import { PAYMENT_STATUS_LABELS, formatDate, formatInr, planLabel, statusTone, titleCase, toNumber } from "@/lib/business/format";
import type { BillingSummary, RepPerformance, SalesRep, SchoolMou, SchoolPayment } from "@/lib/business/types";
import { Building2, CheckCircle2, Clock, FileSignature, Wallet } from "lucide-react";

type Ownership = { school_id: string; original_acquisition_rep_id: string | null; current_rep_id: string | null };

export function SalesRepDetail({ repId }: { repId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { data, error, loading } = useAsyncData(async () => {
    const repResult = await supabase.from("sales_representatives").select("*").eq("id", repId).maybeSingle();
    if (repResult.error) throw repResult.error;
    const rep = repResult.data as SalesRep | null;
    if (!rep?.user_id) return { rep, performance: null, schools: [], mous: [], payments: [], ownership: [] as Ownership[], names: new Map<string, string>() };

    const [performance, ownership, payments] = await Promise.all([
      supabase.from("sales_rep_performance").select("*").eq("rep_user_id", rep.user_id).maybeSingle(),
      supabase.from("school_sales_ownership").select("school_id, original_acquisition_rep_id, current_rep_id").or(`original_acquisition_rep_id.eq.${rep.user_id},current_rep_id.eq.${rep.user_id}`),
      supabase.from("school_payments").select("*").eq("collected_by_rep_id", rep.user_id).order("submitted_at", { ascending: false }),
    ]);
    for (const result of [performance, ownership, payments]) if (result.error) throw result.error;
    const owned = (ownership.data ?? []) as Ownership[];
    const ids = owned.map((row) => row.school_id);
    const [summary, mous, schools] = ids.length
      ? await Promise.all([
          supabase.from("school_billing_summary").select("*").in("school_id", ids),
          supabase.from("school_mous").select("*").in("school_id", ids),
          supabase.from("schools").select("id, name").in("id", ids),
        ])
      : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
    for (const result of [summary, mous, schools]) if (result.error) throw result.error;
    return {
      rep,
      performance: (performance.data as RepPerformance | null) ?? null,
      schools: (summary.data ?? []) as BillingSummary[],
      mous: (mous.data ?? []) as SchoolMou[],
      payments: (payments.data ?? []) as SchoolPayment[],
      ownership: owned,
      names: new Map((schools.data ?? []).map((row) => [row.id as string, row.name as string])),
    };
  });

  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorBanner message={error} />;
  if (!data?.rep) return <ErrorBanner message="Representative not found." />;

  const { rep, performance, schools, mous, payments, ownership, names } = data;
  const summaryOf = new Map(schools.map((row) => [row.school_id, row]));
  const mouLatest = (schoolId: string, type: "initial" | "final") => mous.filter((m) => m.school_id === schoolId && m.mou_type === type).sort((a, b) => b.version - a.version)[0];
  const money = (value: number | string | undefined) => formatInr(value ?? 0);

  return (
    <>
      <PageHeader
        title={rep.full_name}
        description={`${rep.email} · ${rep.mobile}`}
        actions={<Link href="/super-admin/sales-team" className={buttonClass("secondary")}>Back to sales team</Link>}
      />

      <Card title="Representative details" className="mb-6" actions={<Badge tone={statusTone(rep.status)}>{titleCase(rep.status)}</Badge>}>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Employee ID", rep.employee_id ?? "-"],
            ["Joining date", formatDate(rep.joining_date)],
            ["Address", rep.address ?? "-"],
            ["Created", formatDate(rep.created_at)],
          ].map(([name, value]) => (
            <div key={name} className="border-b border-slate-100 py-1.5"><dt className="text-xs text-slate-500">{name}</dt><dd className="font-medium text-slate-900">{value}</dd></div>
          ))}
        </dl>
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Schools" value={String(performance?.schools_brought ?? 0)} subtitle={`${performance?.schools_currently_owned ?? 0} owned now`} icon={<Building2 className="h-5 w-5" />} />
        <StatCard title="Active Schools" value={String(performance?.active_schools ?? 0)} subtitle="Active subscriptions" icon={<CheckCircle2 className="h-5 w-5" />} iconClassName="bg-emerald-100 text-emerald-600" />
        <StatCard title="Total Contract Value" value={money(performance?.total_contract_value)} subtitle="Schools acquired" icon={<FileSignature className="h-5 w-5" />} />
        <StatCard title="Total Invoiced" value={money(performance?.total_invoiced)} subtitle="Issued invoices" icon={<Wallet className="h-5 w-5" />} iconClassName="bg-amber-100 text-amber-600" />
        <StatCard title="Total Collected" value={money(performance?.total_collected)} subtitle="Verified" icon={<Wallet className="h-5 w-5" />} iconClassName="bg-emerald-100 text-emerald-600" />
        <StatCard title="Pending Verification" value={money(performance?.pending_verification)} subtitle="Not yet revenue" icon={<Clock className="h-5 w-5" />} iconClassName="bg-amber-100 text-amber-600" />
        <StatCard title="Outstanding" value={money(performance?.outstanding)} subtitle="Invoiced less collected" icon={<Clock className="h-5 w-5" />} iconClassName="bg-red-100 text-red-600" />
      </div>

      <Card title="Schools" className="mb-6">
        <DataTable
          rows={ownership}
          rowKey={(row) => row.school_id}
          empty="This representative has no schools yet."
          columns={[
            { header: "School", cell: (row) => <Link className="font-medium text-blue-600 hover:underline" href={`/super-admin/schools/${row.school_id}`}>{names.get(row.school_id) ?? "School"}</Link> },
            { header: "Students", cell: (row) => summaryOf.get(row.school_id)?.billing_student_count ?? "-", align: "right" },
            { header: "Plan", cell: (row) => planLabel(summaryOf.get(row.school_id)?.plan_code) },
            { header: "Price", cell: (row) => money(summaryOf.get(row.school_id)?.negotiated_unit_price ?? 0), align: "right" },
            { header: "Contract", cell: (row) => money(summaryOf.get(row.school_id)?.contract_amount), align: "right" },
            { header: "Initial MOU", cell: (row) => (mouLatest(row.school_id, "initial") ? `v${mouLatest(row.school_id, "initial")?.version}` : "-") },
            { header: "Final MOU", cell: (row) => (mouLatest(row.school_id, "final") ? `v${mouLatest(row.school_id, "final")?.version}` : "-") },
            { header: "Paid", cell: (row) => money(summaryOf.get(row.school_id)?.collected_amount), align: "right" },
            { header: "Outstanding", cell: (row) => money(summaryOf.get(row.school_id)?.outstanding_amount), align: "right" },
            { header: "Ownership", cell: (row) => <Badge tone={row.current_rep_id === rep.user_id ? "green" : "slate"}>{row.current_rep_id === rep.user_id ? (row.original_acquisition_rep_id === rep.user_id ? "Acquired & owned" : "Reassigned to them") : "Acquired, now reassigned"}</Badge> },
            { header: "Status", cell: (row) => <Badge tone={statusTone(summaryOf.get(row.school_id)?.subscription_status)}>{titleCase(summaryOf.get(row.school_id)?.subscription_status ?? "-")}</Badge> },
          ]}
        />
      </Card>

      <Card title="Collections">
        <DataTable
          rows={payments}
          rowKey={(row) => row.id}
          empty="No collections yet."
          columns={[
            { header: "Date", cell: (row) => formatDate(row.payment_date) },
            { header: "School", cell: (row) => names.get(row.school_id) ?? "School" },
            { header: "Amount", cell: (row) => formatInr(row.amount), align: "right" },
            { header: "Mode", cell: (row) => titleCase(row.payment_mode) },
            { header: "Reference", cell: (row) => row.transaction_reference },
            { header: "Status", cell: (row) => <Badge tone={statusTone(row.status)}>{PAYMENT_STATUS_LABELS[row.status] ?? row.status}</Badge> },
          ]}
        />
        <p className="mt-3 text-xs text-slate-500">Verified total: {formatInr(payments.filter((p) => p.status === "verified").reduce((sum, p) => sum + toNumber(p.amount), 0))}</p>
      </Card>
    </>
  );
}
