"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Banknote, Building2, CalendarDays, CheckCircle2, Clock, FileSignature, Handshake, TrendingUp, UserCheck, Users, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StatCard } from "@/components/ui/stat-card";
import { BarList, Card, ColumnChart, ErrorBanner, LoadingBlock, PageHeader, buttonClass } from "@/components/business/ui";
import { useAsyncData } from "@/components/business/hooks";
import { callRpc } from "@/lib/business/rpc";
import { formatInr, formatMonth, planLabel, toNumber } from "@/lib/business/format";
import type {
  BillingSummary,
  DashboardTotals,
  MonthlyCollection,
  PlanDistribution,
  RepPerformance,
} from "@/lib/business/types";

type Scope = "admin" | "rep";

async function load(scope: Scope) {
  const supabase = createClient();
  const [totals, performance, summary, monthly, plans, reps] = await Promise.all([
    callRpc<DashboardTotals>(supabase, "business_dashboard_totals"),
    supabase.from("sales_rep_performance").select("*"),
    supabase.from("school_billing_summary").select("*"),
    supabase.from("business_monthly_collections").select("*").order("month", { ascending: true }),
    supabase.from("subscription_plan_distribution").select("*"),
    scope === "admin"
      ? supabase.from("sales_representatives").select("id", { count: "exact", head: true })
      : Promise.resolve({ count: null, error: null }),
  ]);
  for (const result of [performance, summary, monthly, plans, reps]) {
    if (result.error) throw result.error;
  }
  return {
    totals,
    performance: (performance.data ?? []) as RepPerformance[],
    summary: (summary.data ?? []) as BillingSummary[],
    monthly: (monthly.data ?? []) as MonthlyCollection[],
    plans: (plans.data ?? []) as PlanDistribution[],
    repCount: reps.count ?? 0,
  };
}

export function BusinessDashboard({ scope }: { scope: Scope }) {
  const { data, error, loading } = useAsyncData(() => load(scope));

  const derived = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Indian financial year: 1 April to 31 March.
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStart = `${fyStartYear}-04`;
    const fyEnd = `${fyStartYear + 1}-03`;
    const thisMonth = data.monthly.filter((row) => row.month.slice(0, 7) === monthKey).reduce((sum, row) => sum + toNumber(row.net_amount), 0);
    const thisYear = data.monthly
      .filter((row) => row.month.slice(0, 7) >= fyStart && row.month.slice(0, 7) <= fyEnd)
      .reduce((sum, row) => sum + toNumber(row.net_amount), 0);
    const outstanding = [...data.summary]
      .filter((row) => toNumber(row.outstanding_amount) > 0)
      .sort((a, b) => toNumber(b.outstanding_amount) - toNumber(a.outstanding_amount))
      .slice(0, 6);
    const own = data.performance[0];
    return { thisMonth, thisYear, outstanding, own, fyLabel: `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}` };
  }, [data]);

  if (loading) return <LoadingBlock label="Loading dashboard..." />;
  if (error) return <ErrorBanner message={error} />;
  if (!data || !derived) return null;

  const { totals } = data;
  const money = (value: number) => formatInr(value);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={scope === "admin" ? "Every figure is read from verified business records." : "Your schools, agreements and collections."}
        actions={
          scope === "rep" ? (
            <Link href="/sales/schools/new" className={buttonClass()}>
              Add new school
            </Link>
          ) : (
            <Link href="/super-admin/schools/new" className={buttonClass()}>
              Add new school
            </Link>
          )
        }
      />

      {scope === "admin" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Total Schools" value={String(totals.total_schools)} subtitle="Schools with an active agreement" icon={<Building2 className="h-5 w-5" />} />
          <StatCard title="Active Schools" value={String(totals.active_schools)} subtitle="Active subscriptions" icon={<CheckCircle2 className="h-5 w-5" />} iconClassName="bg-emerald-100 text-emerald-600" />
          <StatCard title="Sales Representatives" value={String(data.repCount)} subtitle="Registered representatives" icon={<Users className="h-5 w-5" />} iconClassName="bg-purple-100 text-purple-600" />
          <StatCard title="Total Contract Value" value={money(totals.total_contract_value)} subtitle="Agreed contract amounts" icon={<FileSignature className="h-5 w-5" />} />
          <StatCard title="Total Invoiced" value={money(totals.total_invoiced)} subtitle="Issued invoices (memo)" icon={<Banknote className="h-5 w-5" />} iconClassName="bg-amber-100 text-amber-600" />
          <StatCard title="Total Collected" value={money(totals.total_collected)} subtitle="Verified, net of refunds" icon={<Wallet className="h-5 w-5" />} iconClassName="bg-emerald-100 text-emerald-600" />
          <StatCard title="Total Outstanding" value={money(totals.total_outstanding)} subtitle="Invoiced less collected" icon={<Clock className="h-5 w-5" />} iconClassName="bg-red-100 text-red-600" />
          <StatCard title="Pending Verification" value={money(totals.pending_verification)} subtitle="Not counted as revenue" icon={<Clock className="h-5 w-5" />} iconClassName="bg-amber-100 text-amber-600" />
          <StatCard title="Monthly Collections" value={money(derived.thisMonth)} subtitle="This month, net" icon={<CalendarDays className="h-5 w-5" />} />
          <StatCard title="Yearly Collections" value={money(derived.thisYear)} subtitle={`${derived.fyLabel}, net`} icon={<TrendingUp className="h-5 w-5" />} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard title="My Schools" value={String(totals.total_schools)} subtitle="Schools you currently manage" icon={<Building2 className="h-5 w-5" />} />
          <StatCard title="Total Schools Brought" value={String(derived.own?.schools_brought ?? 0)} subtitle="Credited to you, even if reassigned" icon={<UserCheck className="h-5 w-5" />} iconClassName="bg-purple-100 text-purple-600" />
          <StatCard title="Initial MOUs" value={String(totals.initial_mous)} subtitle="Schools with an Initial MOU" icon={<FileSignature className="h-5 w-5" />} />
          <StatCard title="Final MOUs" value={String(totals.final_mous)} subtitle="Schools with a Final MOU" icon={<Handshake className="h-5 w-5" />} iconClassName="bg-emerald-100 text-emerald-600" />
          <StatCard title="Total Contract Value" value={money(totals.total_contract_value)} subtitle="Your schools" icon={<FileSignature className="h-5 w-5" />} />
          <StatCard title="Total Invoiced" value={money(totals.total_invoiced)} subtitle="Issued invoices" icon={<Banknote className="h-5 w-5" />} iconClassName="bg-amber-100 text-amber-600" />
          <StatCard title="Total Collected" value={money(totals.total_collected)} subtitle="Verified payments" icon={<Wallet className="h-5 w-5" />} iconClassName="bg-emerald-100 text-emerald-600" />
          <StatCard title="Pending Verification" value={money(totals.pending_verification)} subtitle="Awaiting Super Admin" icon={<Clock className="h-5 w-5" />} iconClassName="bg-amber-100 text-amber-600" />
          <StatCard title="Outstanding Amount" value={money(totals.total_outstanding)} subtitle="Invoiced less collected" icon={<Clock className="h-5 w-5" />} iconClassName="bg-red-100 text-red-600" />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Monthly collections">
          <ColumnChart
            items={data.monthly.slice(-12).map((row) => ({ label: formatMonth(row.month), value: toNumber(row.collected_amount) }))}
            format={(value) => (value >= 100000 ? `${(value / 100000).toFixed(1)}L` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)))}
          />
        </Card>
        <Card title="Monthly revenue (net of refunds)">
          <ColumnChart
            items={data.monthly.slice(-12).map((row) => ({ label: formatMonth(row.month), value: Math.max(0, toNumber(row.net_amount)) }))}
            format={(value) => (value >= 100000 ? `${(value / 100000).toFixed(1)}L` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)))}
          />
        </Card>
        {scope === "admin" ? (
          <Card title="Schools acquired by representative">
            <BarList
              items={data.performance.map((row) => ({ label: row.rep_name, value: Number(row.schools_brought), hint: `${row.active_schools} active` }))}
              format={(value) => String(value)}
            />
          </Card>
        ) : null}
        <Card title="Subscriptions by plan">
          <BarList
            items={data.plans.map((row) => ({ label: planLabel(row.plan_code), value: Number(row.subscription_count), hint: formatInr(row.contract_value) }))}
            format={(value) => String(value)}
          />
        </Card>
        <Card title="Largest outstanding balances">
          <BarList
            items={derived.outstanding.map((row) => ({ label: row.school_name, value: toNumber(row.outstanding_amount), hint: row.next_due_date ? `Next due ${row.next_due_date}` : undefined }))}
            format={money}
          />
        </Card>
      </div>
    </>
  );
}
