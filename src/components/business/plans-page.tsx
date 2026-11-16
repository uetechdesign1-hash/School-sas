"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, Field, LoadingBlock, Modal, PageHeader, SuccessBanner, buttonClass, inputClass } from "@/components/business/ui";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { callRpc } from "@/lib/business/rpc";
import { formatDate, formatInr, planLabel, pricingUnitLabel } from "@/lib/business/format";
import type { PlanPrice, PlanWithPrice } from "@/lib/business/types";

export function PlansPage() {
  const supabase = useMemo(() => createClient(), []);
  const action = useAction();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const [plans, prices] = await Promise.all([
      supabase.from("subscription_plans").select("*").order("sort_order"),
      supabase.from("subscription_plan_prices").select("*").order("effective_from", { ascending: false }),
    ]);
    for (const result of [plans, prices]) if (result.error) throw result.error;
    return { plans: (plans.data ?? []) as PlanWithPrice[], prices: (prices.data ?? []) as PlanPrice[] };
  });
  const [editing, setEditing] = useState<PlanWithPrice | null>(null);
  const [price, setPrice] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner message={error} />;

  const current = (plan: PlanWithPrice) => data.prices.find((p) => p.plan_id === plan.id && !p.effective_to);

  function edit(plan: PlanWithPrice) {
    const now = current(plan);
    setPrice(now ? String(now.default_price) : "");
    setMin(now?.recommended_min_price != null ? String(now.recommended_min_price) : "");
    setMax(now?.recommended_max_price != null ? String(now.recommended_max_price) : "");
    setFrom(new Date().toISOString().slice(0, 10));
    action.setError("");
    setEditing(plan);
  }

  return (
    <>
      <PageHeader title="Subscription plans" description="Prices are configured here only. Representatives may negotiate a different price per school; the list price is the starting point." />
      <ErrorBanner message={error} />
      <SuccessBanner message={action.success} />

      <div className="grid gap-4 lg:grid-cols-3">
        {data.plans.map((plan) => {
          const now = current(plan);
          return (
            <Card key={plan.id} title={planLabel(plan.code)} actions={<Badge tone={plan.is_active ? "green" : "slate"}>{plan.is_active ? "Active" : "Inactive"}</Badge>}>
              <p className="text-sm text-slate-600">{plan.description}</p>
              <div className="mt-4 text-3xl font-bold text-slate-900">{formatInr(now?.default_price)}</div>
              <div className="text-sm text-slate-500">{pricingUnitLabel(plan.pricing_unit)}</div>
              {now?.recommended_min_price != null || now?.recommended_max_price != null ? (
                <p className="mt-2 text-xs text-slate-500">Recommended range: {formatInr(now?.recommended_min_price)} - {formatInr(now?.recommended_max_price)}</p>
              ) : null}
              <p className="mt-1 text-xs text-slate-500">Effective from {formatDate(now?.effective_from)}</p>
              <button type="button" className={`${buttonClass("secondary", true)} mt-4`} onClick={() => edit(plan)}>Change price</button>
            </Card>
          );
        })}
      </div>

      <Card title="Price history" className="mt-6">
        <DataTable
          rows={data.prices}
          rowKey={(row) => row.id}
          columns={[
            { header: "Plan", cell: (row) => planLabel(data.plans.find((plan) => plan.id === row.plan_id)?.code) },
            { header: "List price", cell: (row) => formatInr(row.default_price), align: "right" },
            { header: "Recommended min", cell: (row) => (row.recommended_min_price != null ? formatInr(row.recommended_min_price) : "-"), align: "right" },
            { header: "Recommended max", cell: (row) => (row.recommended_max_price != null ? formatInr(row.recommended_max_price) : "-"), align: "right" },
            { header: "From", cell: (row) => formatDate(row.effective_from) },
            { header: "To", cell: (row) => (row.effective_to ? formatDate(row.effective_to) : <Badge tone="green">Current</Badge>) },
          ]}
        />
        <p className="mt-3 text-xs text-slate-500">Existing agreements keep the price they were signed at; a new price applies to new agreements only.</p>
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Change ${planLabel(editing.code)} price` : ""}
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className={buttonClass()} disabled={action.busy || price === ""} onClick={async () => { if (!editing) return; const ok = await action.run(() => callRpc(supabase, "set_subscription_plan_price", { p_plan_code: editing.code, p_default_price: Number(price), p_recommended_min: min === "" ? null : Number(min), p_recommended_max: max === "" ? null : Number(max), p_effective_from: from }), "Price updated."); if (ok !== undefined) { setEditing(null); await reload(); } }}>Save price</button>
          </>
        }
      >
        <ErrorBanner message={action.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`List price (${editing ? pricingUnitLabel(editing.pricing_unit) : ""})`} required><input className={inputClass} type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Effective from" required hint="Must be after the current price's start date."><input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Recommended minimum"><input className={inputClass} type="number" min={0} step="0.01" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
          <Field label="Recommended maximum"><input className={inputClass} type="number" min={0} step="0.01" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}
