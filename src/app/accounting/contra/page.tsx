"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckCircle2,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getCurrentSchoolId } from "@/lib/supabase/current-school";

type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type: string;
  opening_balance: number | null;
  is_system: boolean;
  is_active: boolean;
};

type ContraRow = {
  id: string;
  transaction_number: string | null;
  transaction_date: string;
  description: string | null;
  from_account: string;
  to_account: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
};

const supabase = createClient();

function today() {
  return new Date().toISOString().split("T")[0];
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export default function ContraPage() {
  const [schoolId, setSchoolId] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<ContraRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [viewRow, setViewRow] = useState<ContraRow | null>(null);
  const [editingRow, setEditingRow] = useState<ContraRow | null>(null);
  const [deletingRow, setDeletingRow] = useState<ContraRow | null>(null);

  const [contraDate, setContraDate] = useState(today());
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [particulars, setParticulars] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const numericAmount = Number(amount || 0);

  const contraAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.is_active &&
          (account.account_type === "cash" ||
            account.account_type === "bank")
      ),
    [accounts]
  );

  const fromAccount = accounts.find(
    (account) => account.id === fromAccountId
  );

  const toAccount = accounts.find(
    (account) => account.id === toAccountId
  );

  async function loadAccounts(currentSchoolId: string) {
    const { data, error } = await supabase
      .from("accounts")
      .select(
        `
          id,
          school_id,
          code,
          name,
          account_type,
          opening_balance,
          is_system,
          is_active
        `
      )
      .eq("school_id", currentSchoolId)
      .eq("is_active", true)
      .in("account_type", ["cash", "bank"])
      .order("account_type")
      .order("name");

    if (error) throw error;

    setAccounts((data || []) as Account[]);
  }

  async function loadHistory(currentSchoolId: string) {
    const { data: transactions, error: transactionError } =
      await supabase
        .from("transactions")
        .select(
          `
            id,
            transaction_number,
            transaction_date,
            description,
            transaction_type,
            reference_type
          `
        )
        .eq("school_id", currentSchoolId)
        .eq("transaction_type", "transfer")
        .eq("reference_type", "contra")
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);

    if (transactionError) throw transactionError;

    if (!transactions?.length) {
      setHistory([]);
      return;
    }

    const transactionIds = transactions.map((t) => t.id);

    const { data: entries, error: entriesError } = await supabase
      .from("transaction_entries")
      .select(
        `
          id,
          transaction_id,
          account_id,
          debit,
          credit,
          description
        `
      )
      .eq("school_id", currentSchoolId)
      .in("transaction_id", transactionIds);

    if (entriesError) throw entriesError;

    const accountIds = Array.from(
      new Set((entries || []).map((entry) => entry.account_id))
    );

    const { data: entryAccounts, error: accountError } =
      await supabase
        .from("accounts")
        .select(
          `
            id,
            school_id,
            code,
            name,
            account_type,
            opening_balance,
            is_system,
            is_active
          `
        )
        .eq("school_id", currentSchoolId)
        .in("id", accountIds);

    if (accountError) throw accountError;

    const accountMap = new Map<string, Account>();

    (entryAccounts || []).forEach((account) => {
      accountMap.set(account.id, account as Account);
    });

    const result: ContraRow[] = transactions.map((transaction) => {
      const transactionEntries = (entries || []).filter(
        (entry) => entry.transaction_id === transaction.id
      );

      const debitEntry = transactionEntries.find(
        (entry) => Number(entry.debit || 0) > 0
      );

      const creditEntry = transactionEntries.find(
        (entry) => Number(entry.credit || 0) > 0
      );

      return {
        id: transaction.id,
        transaction_number: transaction.transaction_number,
        transaction_date: transaction.transaction_date,
        description: transaction.description,

        from_account_id: creditEntry?.account_id || "",
        to_account_id: debitEntry?.account_id || "",

        from_account:
          accountMap.get(creditEntry?.account_id || "")?.name ||
          "Unknown",

        to_account:
          accountMap.get(debitEntry?.account_id || "")?.name ||
          "Unknown",

        amount: Number(
          debitEntry?.debit ||
            creditEntry?.credit ||
            0
        ),
      };
    });

    setHistory(result);
  }

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const currentSchoolId = await getCurrentSchoolId();

      setSchoolId(currentSchoolId);

      await Promise.all([
        loadAccounts(currentSchoolId),
        loadHistory(currentSchoolId),
      ]);
    } catch (err: any) {
      console.error(err);

      setError(
        err?.message ||
          "Unable to load Contra page."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, []);

  function resetForm() {
    setContraDate(today());
    setFromAccountId("");
    setToAccountId("");
    setAmount("");
    setParticulars("");
    setReferenceNumber("");
    setNotes("");
    setEditingRow(null);
  }

  function openCreate() {
    setError("");
    setSuccess("");
    resetForm();
    setShowForm(true);
  }

  function openEdit(row: ContraRow) {
    setError("");
    setSuccess("");

    setEditingRow(row);
    setContraDate(row.transaction_date);
    setFromAccountId(row.from_account_id);
    setToAccountId(row.to_account_id);
    setAmount(String(row.amount));
    setParticulars(row.description || "");
    setReferenceNumber("");
    setNotes("");

    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    resetForm();
  }

  function validateForm() {
    if (!schoolId) {
      setError("Current school could not be determined.");
      return false;
    }

    if (!fromAccountId) {
      setError("Select the account from which money is transferred.");
      return false;
    }

    if (!toAccountId) {
      setError("Select the account into which money is transferred.");
      return false;
    }

    if (fromAccountId === toAccountId) {
      setError("From Account and To Account cannot be the same.");
      return false;
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid amount greater than zero.");
      return false;
    }

    if (!particulars.trim()) {
      setError("Enter Contra particulars.");
      return false;
    }

    return true;
  }

  async function submitContra(event: FormEvent) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!validateForm()) return;

    setSaving(true);

    try {
      const description = particulars.trim();

      if (editingRow) {
        const { data, error } = await supabase.rpc(
          "update_contra",
          {
            p_transaction_id: editingRow.id,
            p_transaction_date: contraDate,
            p_from_account_id: fromAccountId,
            p_to_account_id: toAccountId,
            p_amount: numericAmount,
            p_description: description,
            p_reference_number:
              referenceNumber.trim() || null,
            p_notes: notes.trim() || null,
          }
        );

        if (error) throw error;

        const transactionNumber =
          data?.transaction_number ||
          editingRow.transaction_number ||
          editingRow.id.slice(0, 8);

        setSuccess(
          `Contra updated successfully â€” ${transactionNumber}.`
        );
      } else {
        const { data: userData, error: userError } =
          await supabase.auth.getUser();

        if (userError || !userData.user) {
          throw new Error("No authenticated user found.");
        }

        let finalDescription = description;

        if (referenceNumber.trim()) {
          finalDescription +=
            ` | Reference: ${referenceNumber.trim()}`;
        }

        if (notes.trim()) {
          finalDescription += ` | ${notes.trim()}`;
        }

        const { data: transaction, error: transactionError } =
          await supabase
            .from("transactions")
            .insert({
              school_id: schoolId,
              transaction_date: contraDate,
              transaction_type: "transfer",
              description: finalDescription,
              reference_type: "contra",
              reference_id: null,
            })
            .select(
              `
                id,
                transaction_number
              `
            )
            .single();

        if (transactionError) throw transactionError;

        const entries = [
          {
            school_id: schoolId,
            transaction_id: transaction.id,
            account_id: toAccountId,
            debit: numericAmount,
            credit: 0,
            description: `Contra transfer from ${
              fromAccount?.name || "source account"
            }`,
          },
          {
            school_id: schoolId,
            transaction_id: transaction.id,
            account_id: fromAccountId,
            debit: 0,
            credit: numericAmount,
            description: `Contra transfer to ${
              toAccount?.name || "destination account"
            }`,
          },
        ];

        const { error: entriesError } =
          await supabase
            .from("transaction_entries")
            .insert(entries);

        if (entriesError) {
          await supabase
            .from("transactions")
            .delete()
            .eq("id", transaction.id)
            .eq("school_id", schoolId);

          throw entriesError;
        }

        setSuccess(
          `Contra saved successfully â€” ${
            transaction.transaction_number ||
            transaction.id.slice(0, 8)
          }. ${money(numericAmount)} transferred from ${
            fromAccount?.name || "source"
          } to ${toAccount?.name || "destination"}.`
        );
      }

      setShowForm(false);
      resetForm();

      await loadHistory(schoolId!);
    } catch (err: any) {
      console.error("CONTRA SAVE ERROR:", err);

      setError(
        err?.message ||
          "Unable to save Contra."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteContra() {
    if (!deletingRow) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { data, error } = await supabase.rpc(
        "delete_contra",
        {
          p_transaction_id: deletingRow.id,
        }
      );

      if (error) throw error;

      setSuccess(
        `Contra ${
          data?.transaction_number ||
          deletingRow.transaction_number ||
          deletingRow.id.slice(0, 8)
        } deleted successfully.`
      );

      setDeletingRow(null);

      if (schoolId) {
        await loadHistory(schoolId!);
      }
    } catch (err: any) {
      console.error("CONTRA DELETE ERROR:", err);

      setError(
        err?.message ||
          "Unable to delete Contra."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Link
            href="/dashboard"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600"
          >
            <ArrowLeft size={16} />
            Dashboard
          </Link>

          <div className="text-sm font-semibold text-blue-600">
            Accounting
          </div>

          <div className="mt-1 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Contra
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Transfer money between Cash and Bank accounts.
              </p>
            </div>

            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={17} />
              New Contra
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 size={18} />
            {success}
          </div>
        )}

        {/* ACCOUNTING RULE */}
        <section className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5">
            <div className="text-xs font-semibold text-slate-500">
              CASH â†’ BANK
            </div>

            <div className="mt-3 font-mono text-sm">
              Dr Bank
            </div>

            <div className="font-mono text-sm">
              Cr Cash
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5">
            <div className="text-xs font-semibold text-slate-500">
              BANK â†’ CASH
            </div>

            <div className="mt-3 font-mono text-sm">
              Dr Cash
            </div>

            <div className="font-mono text-sm">
              Cr Bank
            </div>
          </div>
        </section>

        {/* FORM */}
        {showForm && (
          <section className="mb-6 rounded-2xl border bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {editingRow
                    ? "Edit Contra"
                    : "Create Contra"}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Every Contra creates a balanced double-entry transfer.
                </p>
              </div>

              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border p-2 hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-10 text-sm text-slate-500">
                <Loader2
                  size={18}
                  className="mr-2 animate-spin"
                />
                Loading...
              </div>
            ) : (
              <form
                onSubmit={submitContra}
                className="space-y-6"
              >
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Contra Date
                  </label>

                  <input
                    type="date"
                    value={contraDate}
                    onChange={(e) =>
                      setContraDate(e.target.value)
                    }
                    className="w-full max-w-sm rounded-lg border px-3 py-2.5"
                  />
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Transfer From
                    </label>

                    <select
                      value={fromAccountId}
                      onChange={(e) => {
                        setFromAccountId(e.target.value);

                        if (
                          e.target.value ===
                          toAccountId
                        ) {
                          setToAccountId("");
                        }
                      }}
                      className="w-full rounded-lg border bg-white px-3 py-2.5"
                    >
                      <option value="">
                        Select Cash / Bank
                      </option>

                      {contraAccounts.map(
                        (account) => (
                          <option
                            key={account.id}
                            value={account.id}
                          >
                            {account.name}
                            {account.code
                              ? ` (${account.code})`
                              : ""}
                            {" â€” "}
                            {account.account_type ===
                            "cash"
                              ? "Cash"
                              : "Bank"}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Transfer To
                    </label>

                    <select
                      value={toAccountId}
                      onChange={(e) =>
                        setToAccountId(
                          e.target.value
                        )
                      }
                      className="w-full rounded-lg border bg-white px-3 py-2.5"
                    >
                      <option value="">
                        Select Cash / Bank
                      </option>

                      {contraAccounts
                        .filter(
                          (account) =>
                            account.id !==
                            fromAccountId
                        )
                        .map((account) => (
                          <option
                            key={account.id}
                            value={account.id}
                          >
                            {account.name}
                            {account.code
                              ? ` (${account.code})`
                              : ""}
                            {" â€” "}
                            {account.account_type ===
                            "cash"
                              ? "Cash"
                              : "Bank"}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="max-w-md">
                  <label className="mb-1 block text-sm font-medium">
                    Amount
                  </label>

                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      â‚¹
                    </span>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) =>
                        setAmount(
                          e.target.value
                        )
                      }
                      placeholder="0.00"
                      className="w-full rounded-lg border py-2.5 pl-8 pr-3"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Particulars
                    </label>

                    <input
                      type="text"
                      value={particulars}
                      onChange={(e) =>
                        setParticulars(
                          e.target.value
                        )
                      }
                      placeholder="Cash deposited into bank"
                      className="w-full rounded-lg border px-3 py-2.5"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Reference
                    </label>

                    <input
                      type="text"
                      value={referenceNumber}
                      onChange={(e) =>
                        setReferenceNumber(
                          e.target.value
                        )
                      }
                      placeholder="Deposit slip / bank reference"
                      className="w-full rounded-lg border px-3 py-2.5"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Notes
                  </label>

                  <textarea
                    value={notes}
                    onChange={(e) =>
                      setNotes(e.target.value)
                    }
                    rows={3}
                    placeholder="Optional notes"
                    className="w-full rounded-lg border px-3 py-2.5"
                  />
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
                  <h3 className="font-semibold">
                    Accounting Preview
                  </h3>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg bg-white p-5">
                      <div className="text-xs font-medium text-slate-500">
                        DEBIT
                      </div>

                      <div className="mt-1 font-semibold">
                        {toAccount?.name ||
                          "Destination Account"}
                      </div>

                      <div className="mt-2 text-lg font-bold text-emerald-600">
                        {money(numericAmount)}
                      </div>
                    </div>

                    <div className="rounded-lg bg-white p-5">
                      <div className="text-xs font-medium text-slate-500">
                        CREDIT
                      </div>

                      <div className="mt-1 font-semibold">
                        {fromAccount?.name ||
                          "Source Account"}
                      </div>

                      <div className="mt-2 text-lg font-bold text-blue-600">
                        {money(numericAmount)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={saving}
                    className="rounded-lg border px-5 py-2.5 font-semibold hover:bg-slate-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={
                      saving ||
                      !fromAccountId ||
                      !toAccountId ||
                      !amount ||
                      !particulars.trim()
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <Loader2
                          size={17}
                          className="animate-spin"
                        />
                        Saving...
                      </>
                    ) : (
                      <>
                        <ArrowRightLeft size={17} />
                        {editingRow
                          ? "Update Contra"
                          : "Save Contra"}
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* HISTORY */}
        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">
                Contra History
              </h2>

              <p className="text-xs text-slate-500">
                {history.length} contra entries
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                schoolId &&
                loadHistory(schoolId)
              }
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-12 text-sm text-slate-500">
              <Loader2
                size={18}
                className="mr-2 animate-spin"
              />
              Loading...
            </div>
          ) : history.length === 0 ? (
            <div className="p-12 text-center">
              <h3 className="font-semibold text-slate-900">
                No Contra transactions
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Click New Contra to create the first transfer.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      Date
                    </th>

                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      Transaction
                    </th>

                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      From
                    </th>

                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      To
                    </th>

                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      Particulars
                    </th>

                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                      Amount
                    </th>

                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {history.map((row) => (
                    <tr
                      key={row.id}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-5 py-4 text-sm">
                        {row.transaction_date}
                      </td>

                      <td className="px-5 py-4 font-mono text-xs text-blue-600">
                        {row.transaction_number ||
                          row.id.slice(0, 8)}
                      </td>

                      <td className="px-5 py-4 text-sm font-medium text-red-600">
                        {row.from_account}
                      </td>

                      <td className="px-5 py-4 text-sm font-medium text-emerald-600">
                        {row.to_account}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {row.description || "-"}
                      </td>

                      <td className="px-5 py-4 text-right font-semibold">
                        {money(row.amount)}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setViewRow(row)
                            }
                            title="View"
                            className="rounded-lg border p-2 text-slate-600 hover:bg-slate-100"
                          >
                            <Eye size={16} />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              openEdit(row)
                            }
                            title="Edit"
                            className="rounded-lg border p-2 text-blue-600 hover:bg-blue-50"
                          >
                            <Pencil size={16} />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setDeletingRow(row)
                            }
                            title="Delete"
                            className="rounded-lg border p-2 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* VIEW MODAL */}
      {viewRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                Contra Details
              </h2>

              <button
                onClick={() => setViewRow(null)}
                className="rounded-lg border p-2"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <Detail
                label="Transaction"
                value={
                  viewRow.transaction_number ||
                  viewRow.id.slice(0, 8)
                }
              />

              <Detail
                label="Date"
                value={viewRow.transaction_date}
              />

              <Detail
                label="From"
                value={viewRow.from_account}
              />

              <Detail
                label="To"
                value={viewRow.to_account}
              />

              <Detail
                label="Amount"
                value={money(viewRow.amount)}
              />

              <Detail
                label="Particulars"
                value={viewRow.description || "-"}
              />
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setViewRow(null)}
                className="rounded-lg border px-5 py-2.5 font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE MODAL */}
      {deletingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
              <Trash2 size={20} />
            </div>

            <h2 className="mt-4 text-xl font-bold text-slate-900">
              Delete Contra?
            </h2>

            <p className="mt-2 text-sm text-slate-600">
              This will delete the Contra transaction and its two
              accounting entries.
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
              <div>
                <strong>Transaction:</strong>{" "}
                {deletingRow.transaction_number ||
                  deletingRow.id.slice(0, 8)}
              </div>

              <div className="mt-1">
                <strong>Transfer:</strong>{" "}
                {deletingRow.from_account} â†’{" "}
                {deletingRow.to_account}
              </div>

              <div className="mt-1">
                <strong>Amount:</strong>{" "}
                {money(deletingRow.amount)}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() =>
                  setDeletingRow(null)
                }
                disabled={saving}
                className="rounded-lg border px-5 py-2.5 font-semibold"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={deleteContra}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving && (
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />
                )}

                Delete Contra
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </div>

      <div className="mt-1 font-medium text-slate-900">
        {value}
      </div>
    </div>
  );
}