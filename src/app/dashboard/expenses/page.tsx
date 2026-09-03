/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit3,
  Eye,
  FileText,
  Landmark,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; school_id: string; name: string };
type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type: string;
  is_active: boolean;
};
type Expense = {
  id: string;
  school_id: string;
  expense_category_id: string | null;
  expense_date: string;
  amount: number;
  paid_from_account_id: string | null;
  transaction_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  description: string | null;
  created_at: string;
};
type Entry = {
  id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
};
type Txn = {
  id: string;
  transaction_number: string | null;
  transaction_date: string;
  transaction_type: string;
  description: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

function money(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

function dateText(v: string) {
  if (!v) return "-";
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function monthText(v: string) {
  if (!v) return "";
  const [y, m] = v.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric" },
  );
}

function csv(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ExpensesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState("School");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);

  const [addDate, setAddDate] = useState(today());
  const [addCategory, setAddCategory] = useState("");
  const [addExpenseAccount, setAddExpenseAccount] = useState("");
  const [addPaidFrom, setAddPaidFrom] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addVendor, setAddVendor] = useState("");
  const [addInvoice, setAddInvoice] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [savingExpense, setSavingExpense] = useState(false);

  const [viewExpense, setViewExpense] = useState<Expense | null>(null);
  const [viewTxn, setViewTxn] = useState<Txn | null>(null);
  const [viewEntries, setViewEntries] = useState<Entry[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editPaidFrom, setEditPaidFrom] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editVendor, setEditVendor] = useState("");
  const [editInvoice, setEditInvoice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editExpenseAccount, setEditExpenseAccount] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function getSchool() {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!auth.user) {
      window.location.assign("/login");
      throw new Error("Please log in again.");
    }

    const { data: rpcId, error: rpcError } =
      await supabase.rpc("get_my_school_id");

    if (!rpcError && rpcId) return String(rpcId);

    const { data, error } = await supabase
      .from("school_users")
      .select("school_id")
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data?.school_id) throw new Error("No active school found.");
    return String(data.school_id);
  }

  async function loadData(id: string, selectedMonth = month) {
    const [schoolRes, catRes, accountRes] = await Promise.all([
      supabase.from("schools").select("id,name").eq("id", id).maybeSingle(),
      supabase.from("expense_categories").select("id,school_id,name").eq("school_id", id).order("name"),
      supabase
        .from("accounts")
        .select("id,school_id,code,name,account_type,is_active")
        .eq("school_id", id)
        .eq("is_active", true)
        .order("name"),
    ]);

    if (schoolRes.error) throw schoolRes.error;
    if (catRes.error) throw catRes.error;
    if (accountRes.error) throw accountRes.error;

    setSchoolName(schoolRes.data?.name || "School");
    setCategories((catRes.data || []) as Category[]);
    setAccounts((accountRes.data || []) as Account[]);

    const [y, m] = selectedMonth.split("-");
    const start = `${y}-${m}-01`;
    const next =
      Number(m) === 12
        ? `${Number(y) + 1}-01-01`
        : `${y}-${String(Number(m) + 1).padStart(2, "0")}-01`;

    const expenseRes = await supabase
      .from("expenses")
      .select(
        "id,school_id,expense_category_id,expense_date,amount,paid_from_account_id,transaction_id,vendor_name,invoice_number,description,created_at",
      )
      .eq("school_id", id)
      .gte("expense_date", start)
      .lt("expense_date", next)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (expenseRes.error) throw expenseRes.error;
    setExpenses((expenseRes.data || []) as Expense[]);
  }

  async function refresh(first = false) {
    try {
      if (first) setLoading(true);
      else setRefreshing(true);
      setError("");
      const id = schoolId || (await getSchool());
      setSchoolId(id);
      await loadData(id);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to load Expenses.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryMap = useMemo(
    () => new Map(categories.map((x) => [x.id, x.name])),
    [categories],
  );
  const accountMap = useMemo(
    () => new Map(accounts.map((x) => [x.id, x])),
    [accounts],
  );

  const expenseAccounts = useMemo(
    () => accounts.filter((x) => x.account_type === "expense"),
    [accounts],
  );
  const paidAccounts = useMemo(
    () =>
      accounts.filter(
        (x) =>
          x.account_type === "cash" ||
          x.account_type === "bank" ||
          x.account_type === "asset",
      ),
    [accounts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      const catOk = !categoryFilter || e.expense_category_id === categoryFilter;
      const accOk = !accountFilter || e.paid_from_account_id === accountFilter;
      if (!catOk || !accOk) return false;
      if (!q) return true;

      return [
        e.vendor_name,
        e.invoice_number,
        e.description,
        e.expense_date,
        e.expense_category_id ? categoryMap.get(e.expense_category_id) : "",
        e.paid_from_account_id ? accountMap.get(e.paid_from_account_id)?.name : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [expenses, search, categoryFilter, accountFilter, categoryMap, accountMap]);

  const totals = useMemo(() => {
    let total = 0;
    let cash = 0;
    let bank = 0;
    let other = 0;

    for (const e of filtered) {
      const amount = Number(e.amount || 0);
      total += amount;
      const type = e.paid_from_account_id
        ? accountMap.get(e.paid_from_account_id)?.account_type
        : "";
      if (type === "cash") cash += amount;
      else if (type === "bank") bank += amount;
      else other += amount;
    }
    return { total, cash, bank, other };
  }, [filtered, accountMap]);

  async function changeMonth(value: string) {
    setMonth(value);
    if (!schoolId) return;
    try {
      setRefreshing(true);
      await loadData(schoolId, value);
    } catch (e: any) {
      setError(e?.message || "Unable to load month.");
    } finally {
      setRefreshing(false);
    }
  }

  function resetAdd() {
    setAddDate(today());
    setAddCategory("");
    setAddExpenseAccount("");
    setAddPaidFrom("");
    setAddAmount("");
    setAddVendor("");
    setAddInvoice("");
    setAddDescription("");
  }

  async function createCategory() {
    if (!schoolId || !newCategory.trim()) return;
    try {
      setSavingCategory(true);
      setError("");
      const { error } = await supabase.from("expense_categories").insert({
        school_id: schoolId,
        name: newCategory.trim(),
      });
      if (error) throw error;
      setNewCategory("");
      setSuccess("Expense category created.");
      await loadData(schoolId);
    } catch (e: any) {
      setError(e?.message || "Unable to create category.");
    } finally {
      setSavingCategory(false);
    }
  }

  async function createExpense() {
    if (!schoolId) return;
    const amount = Number(addAmount);

    if (!addDate || !addCategory || !addExpenseAccount || !addPaidFrom) {
      setError("Date, category, expense account and paid-from account are required.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid expense amount.");
      return;
    }
    if (addExpenseAccount === addPaidFrom) {
      setError("Expense account and paid-from account cannot be the same.");
      return;
    }

    const expenseAccount = accountMap.get(addExpenseAccount);
    const paidAccount = accountMap.get(addPaidFrom);
    if (!expenseAccount || expenseAccount.account_type !== "expense") {
      setError("Select a valid Expense account.");
      return;
    }
    if (!paidAccount) {
      setError("Select a valid Cash/Bank account.");
      return;
    }

    try {
      setSavingExpense(true);
      setError("");
      setSuccess("");

      const description =
        addVendor.trim()
          ? `Expense - ${categoryMap.get(addCategory) || "Expense"} - ${addVendor.trim()}`
          : `Expense - ${categoryMap.get(addCategory) || "Expense"}`;

      const { data: txn, error: txnError } = await supabase
        .from("transactions")
        .insert({
          school_id: schoolId,
          transaction_date: addDate,
          transaction_type: "expense",
          description,
          reference_type: "expense",
          reference_id: null,
        })
        .select("id,transaction_number,transaction_date,transaction_type,description")
        .single();

      if (txnError) throw txnError;
      if (!txn) throw new Error("Accounting transaction was not created.");

      const { error: entryError } = await supabase
        .from("transaction_entries")
        .insert([
          {
            school_id: schoolId,
            transaction_id: txn.id,
            account_id: addExpenseAccount,
            debit: amount,
            credit: 0,
            description: `Expense - ${categoryMap.get(addCategory) || "Expense"}`,
          },
          {
            school_id: schoolId,
            transaction_id: txn.id,
            account_id: addPaidFrom,
            debit: 0,
            credit: amount,
            description: `Paid from ${paidAccount.name}`,
          },
        ]);

      if (entryError) throw entryError;

      const { error: expenseError } = await supabase.from("expenses").insert({
        school_id: schoolId,
        expense_category_id: addCategory,
        expense_date: addDate,
        amount,
        paid_from_account_id: addPaidFrom,
        transaction_id: txn.id,
        vendor_name: addVendor.trim() || null,
        invoice_number: addInvoice.trim() || null,
        description: addDescription.trim() || null,
        created_by: (await supabase.auth.getUser()).data.user?.id || null,
      });

      if (expenseError) throw expenseError;

      setShowAdd(false);
      resetAdd();
      setSuccess("Expense recorded and accounting transaction created.");
      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to create expense.");
    } finally {
      setSavingExpense(false);
    }
  }

  async function openView(expense: Expense) {
    setViewExpense(expense);
    setViewTxn(null);
    setViewEntries([]);
    if (!expense.transaction_id) return;

    try {
      setViewLoading(true);
      const [txnRes, entryRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("id,transaction_number,transaction_date,transaction_type,description")
          .eq("id", expense.transaction_id)
          .eq("school_id", expense.school_id)
          .maybeSingle(),
        supabase
          .from("transaction_entries")
          .select("id,account_id,debit,credit,description")
          .eq("transaction_id", expense.transaction_id)
          .eq("school_id", expense.school_id)
          .order("created_at"),
      ]);
      if (txnRes.error) throw txnRes.error;
      if (entryRes.error) throw entryRes.error;
      setViewTxn((txnRes.data || null) as Txn | null);
      setViewEntries((entryRes.data || []) as Entry[]);
    } catch (e: any) {
      setError(e?.message || "Unable to load accounting details.");
    } finally {
      setViewLoading(false);
    }
  }

  async function openEdit(expense: Expense) {
    setEditExpense(expense);
    setEditCategory(expense.expense_category_id || "");
    setEditPaidFrom(expense.paid_from_account_id || "");
    setEditAmount(String(Number(expense.amount || 0)));
    setEditDate(expense.expense_date);
    setEditVendor(expense.vendor_name || "");
    setEditInvoice(expense.invoice_number || "");
    setEditDescription(expense.description || "");
    setEditExpenseAccount("");

    if (expense.transaction_id) {
      const { data, error } = await supabase
        .from("transaction_entries")
        .select("account_id,debit,credit")
        .eq("transaction_id", expense.transaction_id)
        .eq("school_id", expense.school_id);

      if (!error) {
        const debit = (data || []).find(
          (x: any) => Number(x.debit || 0) > 0 && Number(x.credit || 0) === 0,
        );
        if (debit) setEditExpenseAccount(debit.account_id);
      }
    }
  }

  async function saveEdit() {
    if (!schoolId || !editExpense) return;
    const amount = Number(editAmount);
    if (!editDate || !editCategory || !editExpenseAccount || !editPaidFrom) {
      setError("Date, category, expense account and paid-from account are required.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (editExpenseAccount === editPaidFrom) {
      setError("Expense account and paid-from account cannot be the same.");
      return;
    }

    try {
      setSavingEdit(true);
      setError("");

      const { error: expenseError } = await supabase
        .from("expenses")
        .update({
          expense_category_id: editCategory,
          expense_date: editDate,
          amount,
          paid_from_account_id: editPaidFrom,
          vendor_name: editVendor.trim() || null,
          invoice_number: editInvoice.trim() || null,
          description: editDescription.trim() || null,
        })
        .eq("id", editExpense.id)
        .eq("school_id", schoolId);

      if (expenseError) throw expenseError;

      if (editExpense.transaction_id) {
        const description = editVendor.trim()
          ? `Expense - ${categoryMap.get(editCategory) || "Expense"} - ${editVendor.trim()}`
          : `Expense - ${categoryMap.get(editCategory) || "Expense"}`;

        const { error: txnError } = await supabase
          .from("transactions")
          .update({ transaction_date: editDate, description })
          .eq("id", editExpense.transaction_id)
          .eq("school_id", schoolId);
        if (txnError) throw txnError;

        const { data: entries, error: entriesError } = await supabase
          .from("transaction_entries")
          .select("id,debit,credit")
          .eq("transaction_id", editExpense.transaction_id)
          .eq("school_id", schoolId)
          .order("created_at");
        if (entriesError) throw entriesError;

        const debit = (entries || []).find(
          (x: any) => Number(x.debit || 0) > 0 && Number(x.credit || 0) === 0,
        );
        const credit = (entries || []).find(
          (x: any) => Number(x.credit || 0) > 0 && Number(x.debit || 0) === 0,
        );
        if (!debit || !credit) {
          throw new Error("Linked accounting transaction is not a normal expense journal.");
        }

        const { error: dErr } = await supabase
          .from("transaction_entries")
          .update({
            account_id: editExpenseAccount,
            debit: amount,
            credit: 0,
            description: `Expense - ${categoryMap.get(editCategory) || "Expense"}`,
          })
          .eq("id", debit.id)
          .eq("school_id", schoolId);
        if (dErr) throw dErr;

        const paid = accountMap.get(editPaidFrom);
        const { error: cErr } = await supabase
          .from("transaction_entries")
          .update({
            account_id: editPaidFrom,
            debit: 0,
            credit: amount,
            description: `Paid from ${paid?.name || "account"}`,
          })
          .eq("id", credit.id)
          .eq("school_id", schoolId);
        if (cErr) throw cErr;
      }

      setEditExpense(null);
      setSuccess("Expense and accounting transaction updated.");
      await loadData(schoolId);
    } catch (e: any) {
      setError(e?.message || "Unable to update expense.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteExpense() {
    if (!schoolId || !deleteTarget) return;
    try {
      setDeleting(true);
      setError("");

      if (deleteTarget.transaction_id) {
        const { data: txn, error: txnReadError } = await supabase
          .from("transactions")
          .select("id,reference_type")
          .eq("id", deleteTarget.transaction_id)
          .eq("school_id", schoolId)
          .maybeSingle();
        if (txnReadError) throw txnReadError;

        if (txn?.reference_type === "payroll") {
          throw new Error("Payroll-linked expenses cannot be deleted here.");
        }
      }

      const { error: expenseError } = await supabase
        .from("expenses")
        .delete()
        .eq("id", deleteTarget.id)
        .eq("school_id", schoolId);
      if (expenseError) throw expenseError;

      if (deleteTarget.transaction_id) {
        const { error: entryError } = await supabase
          .from("transaction_entries")
          .delete()
          .eq("transaction_id", deleteTarget.transaction_id)
          .eq("school_id", schoolId);
        if (entryError) throw entryError;

        const { error: txnError } = await supabase
          .from("transactions")
          .delete()
          .eq("id", deleteTarget.transaction_id)
          .eq("school_id", schoolId);
        if (txnError) throw txnError;
      }

      setDeleteTarget(null);
      setSuccess("Expense and linked accounting transaction deleted.");
      await loadData(schoolId);
    } catch (e: any) {
      setError(e?.message || "Unable to delete expense.");
    } finally {
      setDeleting(false);
    }
  }

  function exportCsv() {
    const rows = [
      ["Date", "Category", "Vendor", "Paid From", "Amount", "Invoice", "Description"],
      ...filtered.map((e) => [
        e.expense_date,
        e.expense_category_id ? categoryMap.get(e.expense_category_id) || "" : "",
        e.vendor_name || "",
        e.paid_from_account_id ? accountMap.get(e.paid_from_account_id)?.name || "" : "",
        Number(e.amount || 0).toFixed(2),
        e.invoice_number || "",
        e.description || "",
      ]),
    ];
    const blob = new Blob(
      [rows.map((r) => r.map(csv).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={20} />
          Loading Expenses...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm text-blue-600 font-semibold">{schoolName}</div>
              <h1 className="mt-1 text-3xl font-bold text-slate-900">Expenses</h1>
              <p className="mt-1 text-sm text-slate-500">
                Monthly expense dashboard, register and accounting details.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void refresh(false)}
                className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
              <button
                onClick={exportCsv}
                className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                <Download size={16} />
                Export
              </button>
              <button
                onClick={() => setShowCategories(true)}
                className="rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                Categories
              </button>
              <button
                onClick={() => {
                  resetAdd();
                  setShowAdd(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Plus size={17} />
                Add Expense
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="flex gap-2"><AlertCircle size={18} />{error}</div>
            <button onClick={() => setError("")}><X size={16} /></button>
          </div>
        )}
        {success && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <div className="flex items-center gap-2"><CheckCircle2 size={18} />{success}</div>
            <button onClick={() => setSuccess("")}><X size={16} /></button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card title="Total Expenses" value={money(totals.total)} sub={`${filtered.length} records`} icon={<Receipt size={20} />} />
          <Card title="Cash" value={money(totals.cash)} sub="Paid from Cash" icon={<Banknote size={20} />} />
          <Card title="Bank" value={money(totals.bank)} sub="Paid from Bank" icon={<Landmark size={20} />} />
          <Card title="Other" value={money(totals.other)} sub="Other accounts" icon={<Wallet size={20} />} />
        </div>

        <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Month">
              <input type="month" value={month} onChange={(e) => void changeMonth(e.target.value)} className="input" />
            </Field>
            <Field label="Category">
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input">
                <option value="">All Categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Paid From">
              <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="input">
                <option value="">All Accounts</option>
                {paidAccounts.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} - ` : ""}{a.name}</option>)}
              </select>
            </Field>
            <Field label="Search">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vendor, invoice, description..." className="input" />
            </Field>
          </div>
          <div className="mt-4 text-xs text-slate-500">
            Showing <b>{filtered.length}</b> of <b>{expenses.length}</b> expenses for <b>{monthText(month)}</b>.
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[1050px] w-full">
              <thead className="bg-slate-50">
                <tr className="border-b">
                  {["Date","Category","Vendor / Description","Paid From","Amount","Accounting","Actions"].map((h) => (
                    <th key={h} className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-16 text-center text-sm text-slate-500">
                    <Receipt className="mx-auto text-slate-300" size={34} />
                    <div className="mt-3 font-semibold text-slate-700">No expenses found</div>
                    <div className="mt-1">Try another filter or click Add Expense.</div>
                  </td></tr>
                ) : (
                  filtered.map((e) => {
                    const cat = e.expense_category_id ? categoryMap.get(e.expense_category_id) : "Uncategorized";
                    const acc = e.paid_from_account_id ? accountMap.get(e.paid_from_account_id) : null;
                    return (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="px-5 py-4 text-sm font-semibold">{dateText(e.expense_date)}</td>
                        <td className="px-5 py-4"><span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{cat}</span></td>
                        <td className="px-5 py-4">
                          <div className="font-semibold text-sm">{e.vendor_name || "School Expense"}</div>
                          <div className="mt-1 max-w-[280px] truncate text-xs text-slate-500">{e.description || e.invoice_number || "-"}</div>
                        </td>
                        <td className="px-5 py-4 text-sm">
                          <div className="font-semibold">{acc?.name || "Not selected"}</div>
                          <div className="text-xs text-slate-400">{acc?.account_type || ""}</div>
                        </td>
                        <td className="px-5 py-4 text-right font-bold">{money(Number(e.amount || 0))}</td>
                        <td className="px-5 py-4 text-center">
                          {e.transaction_id ? (
                            <button onClick={() => void openView(e)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"><Eye size={14}/> View</button>
                          ) : <span className="text-xs text-amber-600">No entry</span>}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => void openView(e)} className="rounded-lg border p-2 hover:bg-slate-100" title="View"><Eye size={16}/></button>
                            <button onClick={() => void openEdit(e)} className="rounded-lg border p-2 hover:bg-blue-50 hover:text-blue-600" title="Edit"><Edit3 size={16}/></button>
                            <button onClick={() => setDeleteTarget(e)} className="rounded-lg border p-2 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 size={16}/></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showAdd && (
        <Modal title="Add Expense" onClose={() => !savingExpense && setShowAdd(false)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Expense Date"><input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} className="input"/></Field>
            <Field label="Category"><select value={addCategory} onChange={(e) => setAddCategory(e.target.value)} className="input"><option value="">Select category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Expense Account"><select value={addExpenseAccount} onChange={(e)=>setAddExpenseAccount(e.target.value)} className="input"><option value="">Select expense account</option>{expenseAccounts.map(a=><option key={a.id} value={a.id}>{a.code ? `${a.code} - ` : ""}{a.name}</option>)}</select></Field>
            <Field label="Paid From"><select value={addPaidFrom} onChange={(e)=>setAddPaidFrom(e.target.value)} className="input"><option value="">Select Cash / Bank</option>{paidAccounts.map(a=><option key={a.id} value={a.id}>{a.code ? `${a.code} - ` : ""}{a.name} ({a.account_type})</option>)}</select></Field>
            <Field label="Amount"><input type="number" min="0.01" step="0.01" value={addAmount} onChange={(e)=>setAddAmount(e.target.value)} className="input" placeholder="0.00"/></Field>
            <Field label="Vendor / Paid To"><input value={addVendor} onChange={(e)=>setAddVendor(e.target.value)} className="input" placeholder="Vendor name"/></Field>
            <Field label="Invoice Number"><input value={addInvoice} onChange={(e)=>setAddInvoice(e.target.value)} className="input" placeholder="Optional"/></Field>
            <Field label="Description"><input value={addDescription} onChange={(e)=>setAddDescription(e.target.value)} className="input" placeholder="What was this expense for?"/></Field>
          </div>
          <div className="mt-5 rounded-xl bg-blue-50 border border-blue-100 p-4 text-xs text-blue-800">
            Accounting entry: <b>Dr Expense Account â†’ Cr Cash / Bank</b>
          </div>
          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button onClick={()=>setShowAdd(false)} className="rounded-lg border px-5 py-2.5 text-sm font-semibold">Cancel</button>
            <button onClick={()=>void createExpense()} disabled={savingExpense} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{savingExpense?<><Loader2 size={16} className="animate-spin"/>Saving...</>:<><CheckCircle2 size={16}/>Save Expense</>}</button>
          </div>
        </Modal>
      )}

      {showCategories && (
        <Modal title="Expense Categories" onClose={()=>setShowCategories(false)}>
          <div className="flex gap-2">
            <input value={newCategory} onChange={(e)=>setNewCategory(e.target.value)} placeholder="New category name" className="input"/>
            <button onClick={()=>void createCategory()} disabled={savingCategory} className="rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white">{savingCategory?"Saving...":"Add"}</button>
          </div>
          <div className="mt-5 space-y-2">
            {categories.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">No categories yet.</div> :
              categories.map(c=><div key={c.id} className="flex items-center justify-between rounded-xl border px-4 py-3"><span className="font-semibold text-sm">{c.name}</span><span className="text-xs text-slate-400">School category</span></div>)}
          </div>
        </Modal>
      )}

      {viewExpense && (
        <Modal title="Expense & Accounting Details" onClose={()=>{setViewExpense(null);setViewTxn(null);setViewEntries([]);}}>
          <div className="grid gap-4 rounded-xl bg-slate-50 border p-4 sm:grid-cols-2">
            <Info label="Date" value={dateText(viewExpense.expense_date)}/>
            <Info label="Amount" value={money(Number(viewExpense.amount||0))}/>
            <Info label="Category" value={viewExpense.expense_category_id ? categoryMap.get(viewExpense.expense_category_id)||"-" : "Uncategorized"}/>
            <Info label="Paid From" value={viewExpense.paid_from_account_id ? accountMap.get(viewExpense.paid_from_account_id)?.name||"-" : "-"}/>
            <Info label="Vendor" value={viewExpense.vendor_name||"-"}/>
            <Info label="Invoice" value={viewExpense.invoice_number||"-"}/>
          </div>
          <div className="mt-5 flex items-center gap-2 font-bold"><FileText size={18} className="text-blue-600"/> Accounting Transaction</div>
          {viewLoading ? <div className="py-10 text-center text-sm text-slate-500"><Loader2 className="mx-auto animate-spin" size={22}/><div className="mt-2">Loading...</div></div> :
          !viewTxn ? <div className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">No linked accounting transaction.</div> :
          <div className="mt-3 overflow-hidden rounded-xl border">
            <div className="grid gap-3 border-b bg-slate-50 p-4 sm:grid-cols-3">
              <Info label="Transaction No." value={viewTxn.transaction_number||"-"}/>
              <Info label="Date" value={dateText(viewTxn.transaction_date)}/>
              <Info label="Type" value={viewTxn.transaction_type||"-"}/>
            </div>
            <table className="w-full"><thead className="bg-white"><tr className="border-b"><th className="p-3 text-left text-xs text-slate-500">Account</th><th className="p-3 text-right text-xs text-slate-500">Debit</th><th className="p-3 text-right text-xs text-slate-500">Credit</th></tr></thead>
              <tbody>{viewEntries.map(e=><tr key={e.id} className="border-b last:border-0"><td className="p-3 text-sm font-semibold">{accountMap.get(e.account_id)?.name||"Unknown"}</td><td className="p-3 text-right text-sm">{Number(e.debit||0)>0?money(Number(e.debit)): "-"}</td><td className="p-3 text-right text-sm">{Number(e.credit||0)>0?money(Number(e.credit)): "-"}</td></tr>)}</tbody>
            </table>
          </div>}
        </Modal>
      )}

      {editExpense && (
        <Modal title="Edit Expense" onClose={()=>!savingEdit&&setEditExpense(null)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date"><input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)} className="input"/></Field>
            <Field label="Category"><select value={editCategory} onChange={e=>setEditCategory(e.target.value)} className="input"><option value="">Select category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Expense Account"><select value={editExpenseAccount} onChange={e=>setEditExpenseAccount(e.target.value)} className="input"><option value="">Select expense account</option>{expenseAccounts.map(a=><option key={a.id} value={a.id}>{a.code ? `${a.code} - ` : ""}{a.name}</option>)}</select></Field>
            <Field label="Paid From"><select value={editPaidFrom} onChange={e=>setEditPaidFrom(e.target.value)} className="input"><option value="">Select account</option>{paidAccounts.map(a=><option key={a.id} value={a.id}>{a.code ? `${a.code} - ` : ""}{a.name}</option>)}</select></Field>
            <Field label="Amount"><input type="number" min="0.01" step="0.01" value={editAmount} onChange={e=>setEditAmount(e.target.value)} className="input"/></Field>
            <Field label="Vendor"><input value={editVendor} onChange={e=>setEditVendor(e.target.value)} className="input"/></Field>
            <Field label="Invoice"><input value={editInvoice} onChange={e=>setEditInvoice(e.target.value)} className="input"/></Field>
            <Field label="Description"><input value={editDescription} onChange={e=>setEditDescription(e.target.value)} className="input"/></Field>
          </div>
          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button onClick={()=>setEditExpense(null)} className="rounded-lg border px-5 py-2.5 text-sm font-semibold">Cancel</button>
            <button onClick={()=>void saveEdit()} disabled={savingEdit} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{savingEdit?<><Loader2 size={16} className="animate-spin"/>Saving...</>:<>Update Expense</>}</button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete Expense" onClose={()=>!deleting&&setDeleteTarget(null)}>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            This will delete the expense and its linked accounting transaction.
            Payroll-linked expenses are protected.
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="font-semibold">{deleteTarget.vendor_name||"School Expense"}</div>
            <div className="mt-1 text-sm text-slate-500">{dateText(deleteTarget.expense_date)}</div>
            <div className="mt-2 text-lg font-bold">{money(Number(deleteTarget.amount||0))}</div>
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button onClick={()=>setDeleteTarget(null)} className="rounded-lg border px-5 py-2.5 text-sm font-semibold">Cancel</button>
            <button onClick={()=>void deleteExpense()} disabled={deleting} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{deleting?<><Loader2 size={16} className="animate-spin"/>Deleting...</>:<><Trash2 size={16}/>Delete</>}</button>
          </div>
        </Modal>
      )}

      <style>{`
        .input{width:100%;border:1px solid rgb(203 213 225);border-radius:.5rem;background:white;padding:.65rem .75rem;font-size:.875rem;outline:none}
        .input:focus{border-color:rgb(59 130 246);box-shadow:0 0 0 3px rgb(219 234 254)}
      `}</style>
    </main>
  );
}

function Card({title,value,sub,icon}:{title:string;value:string;sub:string;icon:React.ReactNode}) {
  return <div className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex justify-between"><div><div className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</div><div className="mt-2 text-2xl font-bold text-slate-900">{value}</div><div className="mt-1 text-xs text-slate-500">{sub}</div></div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">{icon}</div></div></div>;
}
function Field({label,children}:{label:string;children:React.ReactNode}) { return <div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</label>{children}</div>; }
function Info({label,value}:{label:string;value:string}) { return <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold text-slate-800">{value}</div></div>; }
function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b px-6 py-4"><h2 className="text-lg font-bold text-slate-900">{title}</h2><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19}/></button></div><div className="max-h-[calc(92vh-73px)] overflow-y-auto p-6">{children}</div></div></div>;
}

