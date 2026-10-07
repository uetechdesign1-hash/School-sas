"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Banknote,
  CalendarDays,
  Loader2,
  Mail,
  RefreshCw,
  Share2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentSchoolId } from "@/lib/supabase/current-school";

type ReceiptHistoryRow = {
  id: string;
  reference_id: string | null;
  transaction_date: string;
  transaction_number: string | null;
  receipt_type: "student_fee" | "other_income";
  description: string | null;
  amount: number | string;
  fee_category_amounts?: Array<{ description: string; amount: number | string }>;
};

type Receipt = ReceiptHistoryRow & { categories: Array<{ name: string; amount: number }> };
type Expense = { id: string; expense_date: string; amount: number | string; description: string | null; vendor_name: string | null; invoice_number: string | null };
type VendorPayment = { id: string; payment_date: string; amount: number | string; notes: string | null; vendor_id: string };
type Vendor = { id: string; name: string };

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function money(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount || 0);
}

function dateLabel(value: string) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export default function DailyReportPage() {
  const supabase = useMemo(() => createClient(), []);
  const [date, setDate] = useState(localToday());
  const [schoolName, setSchoolName] = useState("School");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vendorPayments, setVendorPayments] = useState<VendorPayment[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const schoolId = await getCurrentSchoolId();
      const [schoolRes, historyRes, expenseRes, paymentRes, vendorRes] = await Promise.all([
        supabase.from("schools").select("name").eq("id", schoolId).maybeSingle(),
        supabase.rpc("get_receipt_history", { p_school_id: schoolId }),
        supabase.from("expenses").select("id,expense_date,amount,description,vendor_name,invoice_number").eq("school_id", schoolId).eq("expense_date", date).order("created_at", { ascending: true }),
        supabase.from("vendor_payments").select("id,payment_date,amount,notes,vendor_id").eq("school_id", schoolId).eq("payment_date", date).order("created_at", { ascending: true }),
        supabase.from("vendors").select("id,name").eq("school_id", schoolId),
      ]);
      if (historyRes.error) throw historyRes.error;
      if (expenseRes.error) throw expenseRes.error;
      if (paymentRes.error) throw paymentRes.error;
      if (vendorRes.error) throw vendorRes.error;
      setSchoolName(schoolRes.data?.name || "School");
      const history = ((historyRes.data || []) as ReceiptHistoryRow[]).filter((row) => row.transaction_date === date);

      // Build category totals from the same fee-payment allocations used in receipt history.
      const paymentIds = history.filter((row) => row.receipt_type === "student_fee" && row.reference_id).map((row) => row.reference_id as string);
      let categoryByPayment = new Map<string, Map<string, number>>();
      if (paymentIds.length) {
        const allocationRes = await supabase.from("fee_payment_allocations").select("payment_id,fee_bill_item_id,amount").eq("school_id", schoolId).in("payment_id", paymentIds);
        if (allocationRes.error) throw allocationRes.error;
        const allocations = allocationRes.data || [];
        const itemIds = Array.from(new Set(allocations.map((item) => item.fee_bill_item_id).filter(Boolean))) as string[];
        const { data: items, error: itemError } = itemIds.length
          ? await supabase.from("fee_bill_items").select("id,description,fee_category_id").eq("school_id", schoolId).in("id", itemIds)
          : { data: [], error: null };
        if (itemError) throw itemError;
        const categoryIds = Array.from(new Set((items || []).map((item) => item.fee_category_id).filter(Boolean))) as string[];
        const { data: feeCategories, error: categoryError } = categoryIds.length
          ? await supabase.from("fee_categories").select("id,name").eq("school_id", schoolId).in("id", categoryIds)
          : { data: [], error: null };
        if (categoryError) throw categoryError;
        const categoryName = new Map<string, string>((feeCategories || []).map((category): [string, string] => [category.id, category.name]));
        const itemName = new Map<string, string>((items || []).map((item): [string, string] => [item.id, categoryName.get(item.fee_category_id) || item.description?.replace(/^Fee Management\s*-\s*/i, "").replace(/^Fee\s*[-:]\s*/i, "").trim() || "Fee"]));
        categoryByPayment = new Map();
        for (const allocation of allocations) {
          const category = itemName.get(allocation.fee_bill_item_id) || "Fee";
          const map = categoryByPayment.get(allocation.payment_id) || new Map<string, number>();
          map.set(category, (map.get(category) || 0) + Number(allocation.amount || 0));
          categoryByPayment.set(allocation.payment_id, map);
        }
      }

      setReceipts(history.map((row) => {
        const mapped = row.reference_id ? Array.from(categoryByPayment.get(row.reference_id) || []).map(([name, amount]) => ({ name, amount })) : [];
        const fallback = (row.fee_category_amounts || []).map((item) => ({ name: item.description, amount: Number(item.amount || 0) }));
        return { ...row, categories: mapped.length ? mapped : fallback.length ? fallback : [{ name: row.receipt_type === "other_income" ? "Other income" : "Student fees", amount: Number(row.amount || 0) }] };
      }));
      setExpenses((expenseRes.data || []) as Expense[]);
      setVendorPayments((paymentRes.data || []) as VendorPayment[]);
      setVendors((vendorRes.data || []) as Vendor[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the daily report.");
      setReceipts([]);
      setExpenses([]);
      setVendorPayments([]);
    } finally {
      setLoading(false);
    }
  }, [date, supabase]);

  useEffect(() => { void loadReport(); }, [loadReport]);

  const receiptGroups = useMemo(() => {
    const totals = new Map<string, number>();
    for (const receipt of receipts) for (const category of receipt.categories) totals.set(category.name, (totals.get(category.name) || 0) + category.amount);
    return Array.from(totals, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [receipts]);

  const expenseGroups = useMemo(() => {
    const totals = new Map<string, number>();
    for (const expense of expenses) {
      const name = expense.description?.trim() || expense.vendor_name?.trim() || "Expense";
      totals.set(name, (totals.get(name) || 0) + Number(expense.amount || 0));
    }
    const vendorById = new Map<string, string>(vendors.map((vendor): [string, string] => [vendor.id, vendor.name]));
    for (const payment of vendorPayments) {
      const vendorName = vendorById.get(payment.vendor_id) || "Vendor payment";
      const name = payment.notes?.trim() || vendorName;
      totals.set(name, (totals.get(name) || 0) + Number(payment.amount || 0));
    }
    return Array.from(totals, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [expenses, vendorPayments, vendors]);

  const receiptTotal = receipts.reduce((total, row) => total + Number(row.amount || 0), 0);
  const expenseTotal = expenses.reduce((total, row) => total + Number(row.amount || 0), 0) + vendorPayments.reduce((total, row) => total + Number(row.amount || 0), 0);

  const reportText = useMemo(() => [
    `${schoolName} — Daily Receipt & Payment Report`,
    dateLabel(date),
    "",
    `RECEIPTS: ${money(receiptTotal)}`,
    ...(receiptGroups.length ? receiptGroups.map((row) => `• ${row.name}: ${money(row.amount)}`) : ["• No receipts recorded"]),
    "",
    `PAYMENTS / EXPENSES: ${money(expenseTotal)}`,
    ...(expenseGroups.length ? expenseGroups.map((row) => `• ${row.name}: ${money(row.amount)}`) : ["• No payments recorded"]),
    "",
    `Net for the day: ${money(receiptTotal - expenseTotal)}`,
  ].join("\n"), [schoolName, date, receiptTotal, receiptGroups, expenseTotal, expenseGroups]);

  function shareWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(reportText)}`, "_blank", "noopener,noreferrer");
  }

  function shareEmail() {
    window.location.href = `mailto:?subject=${encodeURIComponent(`${schoolName} Daily Report - ${date}`)}&body=${encodeURIComponent(reportText)}`;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-indigo-600">Accounting</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Daily Report</h1>
            <p className="mt-2 text-sm text-slate-500">Daily receipts grouped by fee category and payments grouped by particulars.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm">
              <CalendarDays size={17} />
              <span className="sr-only">Report date</span>
              <input aria-label="Report date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="bg-transparent outline-none" />
            </label>
            <button onClick={() => void loadReport()} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-60">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </header>

        {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}

        {loading ? <div className="flex min-h-64 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-500"><Loader2 className="mr-2 animate-spin" size={20} />Loading report…</div> : <>
          <section className="grid gap-4 sm:grid-cols-3">
            <SummaryCard title="Total receipts" value={money(receiptTotal)} count={`${receipts.length} receipt${receipts.length === 1 ? "" : "s"}`} icon={<TrendingUp size={19} />} tone="emerald" />
            <SummaryCard title="Total payments" value={money(expenseTotal)} count={`${expenses.length + vendorPayments.length} payment${expenses.length + vendorPayments.length === 1 ? "" : "s"}`} icon={<TrendingDown size={19} />} tone="rose" />
            <SummaryCard title="Net for the day" value={money(receiptTotal - expenseTotal)} count={dateLabel(date)} icon={<Wallet size={19} />} tone="indigo" />
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <ReportCard title="Receipts by fee category" subtitle={`${receipts.length} receipts on ${dateLabel(date)}`} icon={<Banknote size={19} />} accent="emerald" rows={receiptGroups} empty="No receipts were recorded on this day." />
            <ReportCard title="Payments by particulars" subtitle={`${expenses.length + vendorPayments.length} payments on ${dateLabel(date)}`} icon={<TrendingDown size={19} />} accent="rose" rows={expenseGroups} empty="No payments or expenses were recorded on this day." />
          </section>

          <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div><h2 className="font-bold text-slate-900">Share this report</h2><p className="mt-1 text-sm text-slate-500">Choose an app. The report will be added to a message for you to review and send.</p></div>
            <div className="flex flex-wrap gap-3">
              <button onClick={shareWhatsApp} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700"><Share2 size={17} /> WhatsApp</button>
              <button onClick={shareEmail} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700"><Mail size={17} /> Email</button>
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}

function SummaryCard({ title, value, count, icon, tone }: { title: string; value: string; count: string; icon: ReactNode; tone: "emerald" | "rose" | "indigo" }) {
  const colors = { emerald: "bg-emerald-50 text-emerald-700", rose: "bg-rose-50 text-rose-700", indigo: "bg-indigo-50 text-indigo-700" };
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-500">{title}</span><span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${colors[tone]}`}>{icon}</span></div><p className="mt-4 text-2xl font-bold tracking-tight text-slate-900">{value}</p><p className="mt-1 text-sm text-slate-500">{count}</p></div>;
}

function ReportCard({ title, subtitle, icon, accent, rows, empty }: { title: string; subtitle: string; icon: ReactNode; accent: "emerald" | "rose"; rows: Array<{ name: string; amount: number }>; empty: string }) {
  const color = accent === "emerald" ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50";
  return <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center gap-3 border-b border-slate-100 p-5"><span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${color}`}>{icon}</span><div><h2 className="font-bold text-slate-900">{title}</h2><p className="text-sm text-slate-500">{subtitle}</p></div></div><div className="divide-y divide-slate-100 px-5">{rows.length ? rows.map((row) => <div key={row.name} className="flex items-center justify-between gap-4 py-4"><span className="truncate text-sm font-medium text-slate-700">{row.name}</span><span className="shrink-0 text-sm font-bold text-slate-900">{money(row.amount)}</span></div>) : <p className="py-8 text-center text-sm text-slate-500">{empty}</p>}</div><div className="flex justify-between border-t border-slate-100 bg-slate-50/70 px-5 py-4 text-sm font-bold"><span>Total</span><span>{money(rows.reduce((sum, row) => sum + row.amount, 0))}</span></div></div>;
}
