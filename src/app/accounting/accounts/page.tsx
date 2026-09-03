// src/app/accounting/accounts/page.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
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
  created_at?: string;
};

const ACCOUNT_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "receivable", label: "Receivable" },
  { value: "payable", label: "Payable" },
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
];

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function labelForType(type: string) {
  return (
    ACCOUNT_TYPES.find((item) => item.value === type)?.label ||
    type
  );
}

export default function AccountsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [isActive, setIsActive] = useState(true);

  async function loadAccounts(currentSchoolId?: string) {
    try {
      const id = currentSchoolId || schoolId;

      if (!id) return;

      setLoading(true);
      setError("");

      const { data, error } = await supabase
        .from("accounts")
        .select(`
          id,
          school_id,
          code,
          name,
          account_type,
          opening_balance,
          is_system,
          is_active,
          created_at
        `)
        .eq("school_id", id)
        .order("account_type")
        .order("name");

      if (error) throw new Error(error.message);

      setAccounts((data || []) as Account[]);
    } catch (err: any) {
      console.error("ACCOUNTS LOAD ERROR:", err);
      setError(err?.message || "Unable to load Chart of Accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      try {
        const id = await getCurrentSchoolId();
        setSchoolId(id);
        await loadAccounts(id);
      } catch (err: any) {
        setError(err?.message || "Unable to determine current school.");
        setLoading(false);
      }
    }

    init();
  }, []);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return accounts.filter((account) => {
      const matchesSearch =
        !q ||
        (account.name || "").toLowerCase().includes(q) ||
        (account.code || "").toLowerCase().includes(q);

      const matchesType =
        typeFilter === "all" ||
        account.account_type === typeFilter;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && account.is_active) ||
        (statusFilter === "inactive" && !account.is_active);

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [accounts, search, typeFilter, statusFilter]);

  const counts = useMemo(() => {
    return {
      total: accounts.length,
      active: accounts.filter((a) => a.is_active).length,
      inactive: accounts.filter((a) => !a.is_active).length,
      system: accounts.filter((a) => a.is_system).length,
    };
  }, [accounts]);

  function clearForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setAccountType("");
    setOpeningBalance("0");
    setIsActive(true);
  }

  function startEdit(account: Account) {
    setEditingId(account.id);
    setCode(account.code || "");
    setName(account.name);
    setAccountType(account.account_type);
    setOpeningBalance(
      Number(account.opening_balance || 0).toFixed(2)
    );
    setIsActive(account.is_active);
    setViewing(null);
    setError("");
    setSuccess("");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startView(account: Account) {
    setViewing(account);
    setError("");
    setSuccess("");
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();

    if (!schoolId) {
      setError("Current school could not be determined.");
      return;
    }

    setError("");
    setSuccess("");

    const cleanName = name.trim();
    const cleanCode = code.trim() || null;
    const balance = Number(openingBalance || 0);

    if (!cleanName) {
      setError("Account name is required.");
      return;
    }

    if (!accountType) {
      setError("Select an account type.");
      return;
    }

    if (!Number.isFinite(balance)) {
      setError("Opening balance must be a valid number.");
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        const existing = accounts.find(
          (account) => account.id === editingId
        );

        if (!existing) {
          throw new Error("Account no longer exists.");
        }

        // System accounts should remain in their accounting category.
        if (
          existing.is_system &&
          existing.account_type !== accountType
        ) {
          throw new Error(
            "System account type cannot be changed."
          );
        }

        const { error: updateError } = await supabase
          .from("accounts")
          .update({
            code: cleanCode,
            name: cleanName,
            account_type: accountType,
            opening_balance: balance,
            is_active: isActive,
          })
          .eq("id", editingId)
          .eq("school_id", schoolId);

        if (updateError) throw new Error(updateError.message);

        setSuccess(`Account "${cleanName}" updated successfully.`);
      } else {
        const { data: duplicate, error: duplicateError } =
          await supabase
            .from("accounts")
            .select("id")
            .eq("school_id", schoolId)
            .ilike("name", cleanName)
            .limit(1);

        if (duplicateError) {
          throw new Error(duplicateError.message);
        }

        if (duplicate?.length) {
          throw new Error(
            `An account named "${cleanName}" already exists.`
          );
        }

        if (cleanCode) {
          const { data: codeDuplicate, error: codeError } =
            await supabase
              .from("accounts")
              .select("id")
              .eq("school_id", schoolId)
              .eq("code", cleanCode)
              .limit(1);

          if (codeError) throw new Error(codeError.message);

          if (codeDuplicate?.length) {
            throw new Error(
              `Account code "${cleanCode}" is already in use.`
            );
          }
        }

        const { error: insertError } = await supabase
          .from("accounts")
          .insert({
            school_id: schoolId,
            code: cleanCode,
            name: cleanName,
            account_type: accountType,
            opening_balance: balance,
            is_system: false,
            is_active: isActive,
          });

        if (insertError) throw new Error(insertError.message);

        setSuccess(`Account "${cleanName}" created successfully.`);
      }

      clearForm();
      await loadAccounts();
    } catch (err: any) {
      console.error("ACCOUNT SAVE ERROR:", err);
      setError(err?.message || "Unable to save account.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(account: Account) {
    if (!schoolId) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { error: updateError } = await supabase
        .from("accounts")
        .update({ is_active: !account.is_active })
        .eq("id", account.id)
        .eq("school_id", schoolId);

      if (updateError) throw new Error(updateError.message);

      setSuccess(
        `${account.name} is now ${
          !account.is_active ? "active" : "inactive"
        }.`
      );

      await loadAccounts();
    } catch (err: any) {
      setError(err?.message || "Unable to update account status.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    if (!deleteTarget || !schoolId) return;

    const account = deleteTarget;

    if (account.is_system) {
      setError("System accounts cannot be deleted.");
      setDeleteTarget(null);
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      /*
       * First check whether the account is already used in accounting.
       * Used accounts should be deactivated, not deleted, because
       * deleting them would break historical ledger entries.
       */
      const { count, error: usageError } = await supabase
        .from("transaction_entries")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("school_id", schoolId)
        .eq("account_id", account.id);

      if (usageError) throw new Error(usageError.message);

      if ((count || 0) > 0) {
        const { error: deactivateError } = await supabase
          .from("accounts")
          .update({ is_active: false })
          .eq("id", account.id)
          .eq("school_id", schoolId);

        if (deactivateError) {
          throw new Error(deactivateError.message);
        }

        setSuccess(
          `"${account.name}" has accounting history, so it was deactivated instead of deleted.`
        );
      } else {
        const { error: deleteError } = await supabase
          .from("accounts")
          .delete()
          .eq("id", account.id)
          .eq("school_id", schoolId);

        if (deleteError) throw new Error(deleteError.message);

        setSuccess(`"${account.name}" deleted successfully.`);
      }

      setDeleteTarget(null);
      await loadAccounts();
    } catch (err: any) {
      console.error("ACCOUNT DELETE ERROR:", err);
      setError(err?.message || "Unable to delete account.");
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

          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Chart of Accounts
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Manage the accounts used by Receipt, Payment, Contra,
                Journal and all accounting reports.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                clearForm();
                setError("");
                setSuccess("");
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={17} />
              New Account
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 size={18} />
            {success}
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <StatCard label="Total Accounts" value={counts.total} />
          <StatCard label="Active" value={counts.active} />
          <StatCard label="Inactive" value={counts.inactive} />
          <StatCard label="System Accounts" value={counts.system} />
        </div>

        <section className="mb-6 rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {editingId ? "Edit Account" : "Create Account"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Use clear account names because these names appear in
                vouchers, books and reports.
              </p>
            </div>

            {editingId && (
              <button
                type="button"
                onClick={clearForm}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                <X size={15} />
                Cancel
              </button>
            )}
          </div>

          <form onSubmit={saveAccount}>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Account Code">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. EXP-001"
                  className="input"
                />
              </Field>

              <Field label="Account Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Electricity Expense"
                  className="input"
                  required
                />
              </Field>

              <Field label="Account Type">
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  className="input"
                  required
                >
                  <option value="">Select account type</option>
                  {ACCOUNT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Opening Balance">
                <input
                  type="number"
                  step="0.01"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  className="input"
                />
              </Field>
            </div>

            <div className="mt-5 flex items-center justify-between rounded-xl border bg-slate-50 p-4">
              <div>
                <div className="font-semibold text-slate-800">
                  Account Status
                </div>
                <div className="text-xs text-slate-500">
                  Inactive accounts cannot be selected for new entries.
                </div>
              </div>

              <label className="inline-flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm font-semibold">
                  {isActive ? "Active" : "Inactive"}
                </span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={clearForm}
                disabled={saving}
                className="rounded-lg border px-5 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
              >
                Clear
              </button>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : editingId ? (
                  <Pencil size={16} />
                ) : (
                  <Plus size={16} />
                )}

                {editingId ? "Update Account" : "Create Account"}
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="relative">
                <Search
                  size={17}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or code..."
                  className="input pl-10"
                />
              </div>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="input"
              >
                <option value="all">All Account Types</option>
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="input"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>

                <button
                  type="button"
                  onClick={() => loadAccounts()}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold hover:bg-slate-50"
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center p-12 text-sm text-slate-500">
              <Loader2 size={18} className="mr-2 animate-spin" />
              Loading accounts...
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500">
              No accounts found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      Code
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      Account Name
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      Type
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                      Opening Balance
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      Status
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                      Source
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {filteredAccounts.map((account) => (
                    <tr key={account.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4 font-mono text-xs text-slate-500">
                        {account.code || "-"}
                      </td>

                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">
                          {account.name}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {labelForType(account.account_type)}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-right font-semibold">
                        {money(Number(account.opening_balance || 0))}
                      </td>

                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => toggleActive(account)}
                          disabled={saving}
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            account.is_active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {account.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>

                      <td className="px-5 py-4">
                        {account.is_system ? (
                          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                            System
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">
                            User
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => startView(account)}
                            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                          >
                            <Eye size={14} />
                            View
                          </button>

                          <button
                            type="button"
                            onClick={() => startEdit(account)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                          >
                            <Pencil size={14} />
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteTarget(account)}
                            disabled={account.is_system}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 size={14} />
                            Delete
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

      {viewing && (
        <Modal title="Account Details" onClose={() => setViewing(null)}>
          <div className="grid gap-5 md:grid-cols-2">
            <Detail label="Account Code" value={viewing.code || "-"} />
            <Detail label="Account Name" value={viewing.name} />
            <Detail
              label="Account Type"
              value={labelForType(viewing.account_type)}
            />
            <Detail
              label="Opening Balance"
              value={money(Number(viewing.opening_balance || 0))}
            />
            <Detail
              label="Status"
              value={viewing.is_active ? "Active" : "Inactive"}
            />
            <Detail
              label="Account Source"
              value={viewing.is_system ? "System Account" : "User Account"}
            />
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setViewing(null);
                startEdit(viewing);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Pencil size={15} />
              Edit
            </button>

            <button
              type="button"
              onClick={() => setViewing(null)}
              className="rounded-lg border px-4 py-2.5 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="Delete Account?"
          onClose={() => setDeleteTarget(null)}
        >
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            <div className="font-semibold">{deleteTarget.name}</div>
            <div className="mt-1">
              If this account has accounting history, it will be
              deactivated instead of deleted so historical Ledger,
              Trial Balance and reports remain intact.
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border px-4 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={deleteAccount}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              Delete / Deactivate
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      {children}
    </div>
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
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">
        {value}
      </div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border p-2 hover:bg-slate-50"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}