"use client";

import { createClient } from "@/lib/supabase/client";
import { Card, DataTable, ErrorBanner, LoadingBlock, PageHeader, buttonClass } from "@/components/business/ui";
import { useAsyncData } from "@/components/business/hooks";
import { downloadCsv, toCsv } from "@/lib/business/csv";
import { formatInr, formatMonth, planLabel, toNumber } from "@/lib/business/format";
import type { BillingSummary, MonthlyCollection, PlanDistribution, RepPerformance } from "@/lib/business/types";

export function ReportsView({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, loading } = useAsyncData(async () => {
    const supabase = createClient();
    const [performance, summary, monthly, plans] = await Promise.all([
      supabase.from("sales_rep_performance").select("*").order("rep_name"),
      supabase.from("school_billing_summary").select("*").order("school_name"),
      supabase.from("business_monthly_collections").select("*").order("month", { ascending: false }),
      supabase.from("subscription_plan_distribution").select("*"),
    ]);
    for (const result of [performance, summary, monthly, plans]) if (result.error) throw result.error;
    return {
      performance: (performance.data ?? []) as RepPerformance[],
      summary: (summary.data ?? []) as BillingSummary[],
      monthly: (monthly.data ?? []) as MonthlyCollection[],
      plans: (plans.data ?? []) as PlanDistribution[],
    };
  });
  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner message={error} />;

  const perfCsv = () => downloadCsv("representative-performance.csv", toCsv(data.performance, [
    { header: "Representative", value: (r) => r.rep_name },
    { header: "Schools brought", value: (r) => r.schools_brought },
    { header: "Currently owned", value: (r) => r.schools_currently_owned },
    { header: "Active schools", value: (r) => r.active_schools },
    { header: "Contract value", value: (r) => toNumber(r.total_contract_value) },
    { header: "Invoiced", value: (r) => toNumber(r.total_invoiced) },
    { header: "Collected", value: (r) => toNumber(r.total_collected) },
    { header: "Pending verification", value: (r) => toNumber(r.pending_verification) },
    { header: "Outstanding", value: (r) => toNumber(r.outstanding) },
  ]));
  const monthlyCsv = () => downloadCsv("monthly-collections.csv", toCsv(data.monthly, [
    { header: "Month", value: (r) => r.month },
    { header: "Collected", value: (r) => toNumber(r.collected_amount) },
    { header: "Refunded", value: (r) => toNumber(r.refunded_amount) },
    { header: "Net", value: (r) => toNumber(r.net_amount) },
  ]));
  const schoolsCsv = () => downloadCsv("school-billing.csv", toCsv(data.summary, [
    { header: "School", value: (r) => r.school_name },
    { header: "Plan", value: (r) => planLabel(r.plan_code) },
    { header: "Contract amount", value: (r) => toNumber(r.contract_amount) },
    { header: "Invoiced", value: (r) => toNumber(r.invoiced_amount) },
    { header: "Collected", value: (r) => toNumber(r.collected_amount) },
    { header: "Pending verification", value: (r) => toNumber(r.pending_verification_amount) },
    { header: "Outstanding", value: (r) => toNumber(r.outstanding_amount) },
  ]));

  return (
    <>
      <PageHeader title={isAdmin ? "Reports" : "My reports"} description="Figures use verified payments only. Representatives are credited for the schools they originally acquired." />
      <div className="space-y-6">
        <Card title="Representative performance" actions={<button type="button" className={buttonClass("secondary", true)} onClick={perfCsv}>Export CSV</button>}>
          <DataTable
            rows={data.performance}
            rowKey={(row) => row.rep_user_id}
            columns={[
              { header: "Representative", cell: (row) => row.rep_name },
              { header: "Brought", cell: (row) => row.schools_brought, align: "right" },
              { header: "Owned now", cell: (row) => row.schools_currently_owned, align: "right" },
              { header: "Contract value", cell: (row) => formatInr(row.total_contract_value), align: "right" },
              { header: "Invoiced", cell: (row) => formatInr(row.total_invoiced), align: "right" },
              { header: "Collected", cell: (row) => formatInr(row.total_collected), align: "right" },
              { header: "Pending", cell: (row) => formatInr(row.pending_verification), align: "right" },
              { header: "Outstanding", cell: (row) => formatInr(row.outstanding), align: "right" },
            ]}
          />
        </Card>

        <Card title="Monthly collections" actions={<button type="button" className={buttonClass("secondary", true)} onClick={monthlyCsv}>Export CSV</button>}>
          <DataTable
            rows={data.monthly}
            rowKey={(row) => row.month}
            columns={[
              { header: "Month", cell: (row) => formatMonth(row.month) },
              { header: "Collected", cell: (row) => formatInr(row.collected_amount), align: "right" },
              { header: "Refunded", cell: (row) => formatInr(row.refunded_amount), align: "right" },
              { header: "Net", cell: (row) => formatInr(row.net_amount), align: "right" },
            ]}
          />
        </Card>

        <Card title="School-wise billing" actions={<button type="button" className={buttonClass("secondary", true)} onClick={schoolsCsv}>Export CSV</button>}>
          <DataTable
            rows={data.summary}
            rowKey={(row) => row.school_id}
            columns={[
              { header: "School", cell: (row) => row.school_name },
              { header: "Plan", cell: (row) => planLabel(row.plan_code) },
              { header: "Contract", cell: (row) => formatInr(row.contract_amount), align: "right" },
              { header: "Invoiced", cell: (row) => formatInr(row.invoiced_amount), align: "right" },
              { header: "Collected", cell: (row) => formatInr(row.collected_amount), align: "right" },
              { header: "Outstanding", cell: (row) => formatInr(row.outstanding_amount), align: "right" },
            ]}
          />
        </Card>

        <Card title="Subscriptions by plan">
          <DataTable
            rows={data.plans}
            rowKey={(row) => row.plan_code}
            columns={[
              { header: "Plan", cell: (row) => planLabel(row.plan_code) },
              { header: "Active subscriptions", cell: (row) => row.subscription_count, align: "right" },
              { header: "Contract value", cell: (row) => formatInr(row.contract_value), align: "right" },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
