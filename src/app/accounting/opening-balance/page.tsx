"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type: string;
  is_active: boolean;
};

type OpeningBalanceRecord = {
  id: string;
  school_id: string;
  account_id: string;
  balance: number;
  as_of_date: string;
  notes: string | null;
  created_at: string;
};

type OpeningRow = {
  account: Account;
  balance: number;
  savedBalance: number;
};

type FinancialYear = {
  label: string;
  from: string;
  to: string;
};

const supabase = createClient();

function formatINR(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatDisplayDate(value: string) {
  if (!value) return "";

  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}-${month}-${year}`;
}

function getFinancialYear(startYear: number): FinancialYear {
  return {
    label: `${startYear}-${String(startYear + 1).slice(-2)}`,
    from: `${startYear}-04-01`,
    to: `${startYear + 1}-03-31`,
  };
}

function getCurrentFinancialYear() {
  const now = new Date();

  const startYear =
    now.getMonth() >= 3
      ? now.getFullYear()
      : now.getFullYear() - 1;

  return getFinancialYear(startYear);
}

/**
 * Opening balances are Balance Sheet balances.
 *
 * Debit:
 *   asset
 *   cash
 *   bank
 *   receivable
 *
 * Credit:
 *   liability
 *   payable
 *   equity
 */
function getSide(accountType: string) {
  const type = accountType.toLowerCase();

  if (
    [
      "liability",
      "payable",
      "equity",
    ].includes(type)
  ) {
    return "Credit";
  }

  return "Debit";
}

function isOpeningBalanceAccount(accountType: string) {
  const type = accountType.toLowerCase();

  return [
    "asset",
    "cash",
    "bank",
    "receivable",
    "liability",
    "payable",
    "equity",
  ].includes(type);
}

function getSupabaseErrorMessage(error: unknown) {
  if (!error) return "Unknown database error.";

  if (error instanceof Error) return error.message;

  if (typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts = [
      typeof e.message === "string" ? e.message : "",
      typeof e.details === "string" ? `Details: ${e.details}` : "",
      typeof e.hint === "string" ? `Hint: ${e.hint}` : "",
      typeof e.code === "string" ? `Code: ${e.code}` : "",
    ].filter(Boolean);

    if (parts.length) return parts.join(" | ");

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown database error.";
    }
  }

  return String(error);
}

function getPreviousDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getGroup(accountType: string) {
  const type = accountType.toLowerCase();

  if (
    [
      "asset",
      "cash",
      "bank",
      "receivable",
    ].includes(type)
  ) {
    return "Assets / Cash / Bank / Receivables";
  }

  if (
    [
      "liability",
      "payable",
    ].includes(type)
  ) {
    return "Liabilities / Payables";
  }

  if (type === "equity") {
    return "Equity";
  }

  return "Other";
}

export default function OpeningBalancePage() {
  const [financialYear, setFinancialYear] =
    useState<FinancialYear>(
      getCurrentFinancialYear(),
    );

  const [financialYears, setFinancialYears] =
    useState<FinancialYear[]>([]);

  const [rows, setRows] = useState<OpeningRow[]>(
    [],
  );

  const [schoolId, setSchoolId] = useState<
    string | null
  >(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /**
   * ---------------------------------------------------------
   * Financial years
   * ---------------------------------------------------------
   */
  useEffect(() => {
    const currentYear =
      new Date().getFullYear();

    const years: FinancialYear[] = [];

    for (
      let year = currentYear - 3;
      year <= currentYear + 2;
      year++
    ) {
      years.push(getFinancialYear(year));
    }

    setFinancialYears(years);
  }, []);

  /**
   * ---------------------------------------------------------
   * Get logged-in user's school
   * ---------------------------------------------------------
   */
  const getSchoolId = useCallback(async () => {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      throw authError;
    }

    if (!user) {
      window.location.href = "/login";
      return null;
    }

    const { data, error: schoolError } =
      await supabase
        .from("school_users")
        .select("school_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

    if (schoolError) {
      throw schoolError;
    }

    if (!data?.school_id) {
      throw new Error(
        "No active school was found for this account.",
      );
    }

    setSchoolId(data.school_id);

    return data.school_id as string;
  }, []);

  /**
   * ---------------------------------------------------------
   * Load accounts
   * ---------------------------------------------------------
   */
  const loadAccounts = useCallback(
    async (school: string) => {
      const { data, error: accountError } =
        await supabase
          .from("accounts")
          .select(
            "id, school_id, code, name, account_type, is_active",
          )
          .eq("school_id", school)
          .eq("is_active", true)
          .order("name", {
            ascending: true,
          });

      if (accountError) {
        throw accountError;
      }

      return (data || []) as Account[];
    },
    [],
  );

  /**
   * ---------------------------------------------------------
   * Load opening balances
   *
   * IMPORTANT:
   * Your actual table uses:
   *
   * balance
   * as_of_date
   *
   * NOT amount / financial_year.
   * ---------------------------------------------------------
   */
  const loadOpeningBalances = useCallback(
    async (
      school: string,
      accountList: Account[],
      asOfDate: string,
    ) => {
      const { data, error: balanceError } =
        await supabase
          .from("opening_balances")
          .select(
            "id, school_id, account_id, balance, as_of_date, notes, created_at",
          )
          .eq("school_id", school)
          .eq("as_of_date", asOfDate);

      if (balanceError) {
        throw new Error(
          `Unable to load opening balances: ${balanceError.message}`,
        );
      }

      const saved =
        (data || []) as OpeningBalanceRecord[];

      const balanceMap = new Map<
        string,
        number
      >();

      for (const record of saved) {
        balanceMap.set(
          record.account_id,
          Number(record.balance || 0),
        );
      }

      return accountList
        .filter((account) =>
          isOpeningBalanceAccount(
            account.account_type,
          ),
        )
        .map((account) => {
          const balance =
            balanceMap.get(account.id) || 0;

          return {
            account,
            balance,
            savedBalance: balance,
          };
        });
    },
    [],
  );

  /**
   * ---------------------------------------------------------
   * Load complete page
   * ---------------------------------------------------------
   */
  const loadData = useCallback(
    async (
      selectedYear: FinancialYear = financialYear,
      showLoading = true,
    ) => {
      try {
        if (showLoading) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setError("");
        setMessage("");

        const school =
          schoolId || (await getSchoolId());

        if (!school) {
          return;
        }

        const accounts =
          await loadAccounts(school);

        const openingDate = getPreviousDate(selectedYear.from);

        const opening =
          await loadOpeningBalances(
            school,
            accounts,
            openingDate,
          );

        setRows(opening);
      } catch (err: unknown) {
        console.error(
          "OPENING BALANCE LOAD ERROR:",
          getSupabaseErrorMessage(err),
        );
        console.error("OPENING BALANCE LOAD RAW:", err);

        setError(
          getSupabaseErrorMessage(err) ||
            "Unable to load opening balances.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      financialYear,
      schoolId,
      getSchoolId,
      loadAccounts,
      loadOpeningBalances,
    ],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /**
   * ---------------------------------------------------------
   * Financial year change
   * ---------------------------------------------------------
   */
  async function handleFinancialYearChange(
    value: string,
  ) {
    const selected = financialYears.find(
      (item) => item.label === value,
    );

    if (!selected) {
      return;
    }

    setFinancialYear(selected);

    await loadData(selected, false);
  }

  /**
   * ---------------------------------------------------------
   * Update balance
   * ---------------------------------------------------------
   */
  function updateBalance(
    accountId: string,
    value: string,
  ) {
    const cleaned = value.replace(
      /[^0-9.]/g,
      "",
    );

    const amount =
      cleaned === ""
        ? 0
        : Number(cleaned);

    setRows((current) =>
      current.map((row) =>
        row.account.id === accountId
          ? {
              ...row,
              balance:
                Number.isFinite(amount)
                  ? Math.max(0, amount)
                  : 0,
            }
          : row,
      ),
    );

    setMessage("");
    setError("");
  }

  /**
   * ---------------------------------------------------------
   * Totals
   * ---------------------------------------------------------
   */
  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;

    for (const row of rows) {
      const amount = Number(
        row.balance || 0,
      );

      if (amount <= 0) {
        continue;
      }

      if (
        getSide(
          row.account.account_type,
        ) === "Debit"
      ) {
        debit += amount;
      } else {
        credit += amount;
      }
    }

    const difference = Math.abs(
      debit - credit,
    );

    return {
      debit,
      credit,
      difference,
      balanced: difference < 0.01,
    };
  }, [rows]);

  /**
   * ---------------------------------------------------------
   * Reset to saved values
   * ---------------------------------------------------------
   */
  function handleReset() {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        balance: row.savedBalance,
      })),
    );

    setMessage(
      "Opening balance changes have been reset.",
    );

    setError("");
  }

  /**
   * ---------------------------------------------------------
   * Clear unsaved
   * ---------------------------------------------------------
   */
  function handleClearUnsaved() {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        balance: row.savedBalance,
      })),
    );

    setMessage(
      "Unsaved changes were cleared.",
    );

    setError("");
  }

  /**
   * ---------------------------------------------------------
   * Save
   *
   * Actual database columns:
   *
   * school_id
   * account_id
   * balance
   * as_of_date
   * notes
   * ---------------------------------------------------------
   */
  async function handleSave() {
    if (!schoolId) {
      setError("School could not be identified. Please sign in again.");
      return;
    }

    if (!rows.length) {
      setError("No balance-sheet accounts are available.");
      return;
    }

    if (!totals.balanced) {
      setError(
        `Opening balances are not balanced. Difference: ${formatINR(
          totals.difference,
        )}`,
      );
      return;
    }

    try {
      setSaving(true);
      setError("");
      setMessage("");

      // FY 2026-27 = 01-04-2026 to 31-03-2027.
      // Opening position is the previous day: 31-03-2026.
      const openingDate = getPreviousDate(financialYear.from);

      // Save acts as Create + Edit:
      // remove the old records for this school/opening date,
      // then insert the current non-zero balances.
      const { error: deleteError } = await supabase
        .from("opening_balances")
        .delete()
        .eq("school_id", schoolId)
        .eq("as_of_date", openingDate);

      if (deleteError) {
        throw new Error(
          `Could not clear existing opening balances: ${getSupabaseErrorMessage(
            deleteError,
          )}`,
        );
      }

      const records = rows
        .filter((row) => Number(row.balance || 0) > 0)
        .map((row) => ({
          school_id: schoolId,
          account_id: row.account.id,
          balance: Number(row.balance || 0),
          as_of_date: openingDate,
          notes: `Opening balance for financial year ${financialYear.label}`,
        }));

      if (records.length > 0) {
        const { error: insertError } = await supabase
          .from("opening_balances")
          .insert(records);

        if (insertError) {
          throw new Error(
            `Could not save opening balances: ${getSupabaseErrorMessage(
              insertError,
            )}`,
          );
        }
      }

      setRows((current) =>
        current.map((row) => ({
          ...row,
          savedBalance: row.balance,
        })),
      );

      setMessage(
        `Opening balances saved successfully for ${financialYear.label}. Opening date: ${formatDisplayDate(
          openingDate,
        )}.`,
      );
    } catch (err: unknown) {
      const message = getSupabaseErrorMessage(err);

      console.error("OPENING BALANCE SAVE ERROR:", message);
      console.error("OPENING BALANCE SAVE RAW:", err);

      setError(message || "Unable to save opening balances.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * ---------------------------------------------------------
   * Group rows
   * ---------------------------------------------------------
   */
  const groupedRows = useMemo(() => {
    const groups = new Map<
      string,
      OpeningRow[]
    >();

    for (const row of rows) {
      const group = getGroup(
        row.account.account_type,
      );

      if (!groups.has(group)) {
        groups.set(group, []);
      }

      groups.get(group)!.push(row);
    }

    return Array.from(groups.entries());
  }, [rows]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 text-center shadow-sm">
              <RefreshCw
                size={25}
                className="mx-auto animate-spin text-blue-600"
              />

              <p className="mt-3 text-sm font-medium text-slate-600">
                Loading opening balances...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* HEADER */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-7">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-blue-600"
          >
            <ArrowLeft size={16} />
            Dashboard
          </Link>

          <div className="mt-5">
            <p className="text-sm font-semibold text-blue-600">
              Accounting
            </p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Opening Balance
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Set the opening position for the
              selected financial year.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* FINANCIAL YEAR */}
        <section className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_280px]">
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-700">
                Financial Year
              </label>

              <select
                value={financialYear.label}
                onChange={(event) =>
                  void handleFinancialYearChange(
                    event.target.value,
                  )
                }
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {financialYears.map((year) => (
                  <option
                    key={year.label}
                    value={year.label}
                  >
                    {year.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold text-slate-700">
                Date From
              </label>

              <input
                type="date"
                value={financialYear.from}
                readOnly
                className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold text-slate-700">
                Date To
              </label>

              <input
                type="date"
                value={financialYear.to}
                readOnly
                className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm"
              />
            </div>

            <div className="rounded-2xl bg-blue-50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-blue-600">
                Financial Year
              </p>

              <p className="mt-1 text-lg font-bold text-blue-900">
                {financialYear.label}
              </p>

              <p className="mt-1 text-xs text-blue-600">
                {formatDisplayDate(
                  financialYear.from,
                )}{" "}
                →{" "}
                {formatDisplayDate(
                  financialYear.to,
                )}
              </p>
            </div>
          </div>
        </section>

        {/* SUMMARY */}
        <section className="mt-5 grid gap-4 md:grid-cols-3">
          <SummaryCard
            label="Total Debit"
            value={formatINR(totals.debit)}
          />

          <SummaryCard
            label="Total Credit"
            value={formatINR(totals.credit)}
          />

          <div
            className={`rounded-2xl border p-5 ${
              totals.balanced
                ? "border-emerald-200 bg-emerald-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Balanced Status
            </p>

            <div className="mt-2 flex items-center gap-2">
              {totals.balanced && (
                <CheckCircle2
                  size={20}
                  className="text-emerald-600"
                />
              )}

              <p
                className={`text-xl font-bold ${
                  totals.balanced
                    ? "text-emerald-700"
                    : "text-red-700"
                }`}
              >
                {totals.balanced
                  ? "BALANCED"
                  : "NOT BALANCED"}
              </p>
            </div>

            <p
              className={`mt-1 text-sm ${
                totals.balanced
                  ? "text-emerald-700"
                  : "text-red-700"
              }`}
            >
              Difference:{" "}
              {formatINR(
                totals.difference,
              )}
            </p>
          </div>
        </section>

        {/* ERROR */}
        {error && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* SUCCESS */}
        {message && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            {message}
          </div>
        )}

        {/* OPENING BALANCES */}
        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-300 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Opening Balances
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Enter opening balances for assets,
                liabilities and equity. Income and
                expense accounts are excluded.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw size={15} />
                Reset
              </button>

              <button
                type="button"
                onClick={handleClearUnsaved}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-medium text-amber-700 hover:bg-amber-50"
              >
                Clear Unsaved
              </button>

              <button
                type="button"
                onClick={() =>
                  void loadData(
                    financialYear,
                    false,
                  )
                }
                disabled={refreshing}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw
                  size={15}
                  className={
                    refreshing
                      ? "animate-spin"
                      : ""
                  }
                />
                Refresh
              </button>

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={
                  saving ||
                  !totals.balanced
                }
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={15} />

                {saving
                  ? "Saving..."
                  : "Save Opening Balances"}
              </button>
            </div>
          </div>

          {/* TABLE HEADER */}
          <div className="hidden grid-cols-[140px_minmax(240px,1fr)_180px_220px_100px] border-b border-slate-200 bg-slate-50 px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-500 md:grid">
            <div>Code</div>
            <div>Account</div>
            <div>Type</div>
            <div>Opening Balance</div>
            <div>Side</div>
          </div>

          {groupedRows.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm font-medium text-slate-600">
                No balance-sheet accounts found.
              </p>

              <Link
                href="/accounting/accounts"
                className="mt-3 inline-flex text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                Open Chart of Accounts
              </Link>
            </div>
          ) : (
            groupedRows.map(
              ([groupName, groupRows]) => (
                <div key={groupName}>
                  <div className="border-b border-slate-200 bg-slate-100 px-5 py-3 text-sm font-bold text-slate-800">
                    {groupName}
                  </div>

                  {groupRows.map((row) => {
                    const side = getSide(
                      row.account.account_type,
                    );

                    return (
                      <div
                        key={row.account.id}
                        className="grid gap-3 border-b border-slate-200 px-5 py-4 md:grid-cols-[140px_minmax(240px,1fr)_180px_220px_100px] md:items-center"
                      >
                        <div>
                          <span className="text-xs font-medium text-slate-500">
                            {row.account.code ||
                              "—"}
                          </span>
                        </div>

                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {row.account.name}
                          </p>

                          <p className="mt-1 text-xs text-slate-400 md:hidden">
                            {
                              row.account
                                .account_type
                            }{" "}
                            · {side}
                          </p>
                        </div>

                        <div className="text-sm capitalize text-slate-600">
                          {row.account.account_type}
                        </div>

                        <div>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                              ₹
                            </span>

                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.balance}
                              onChange={(event) =>
                                updateBalance(
                                  row.account.id,
                                  event.target.value,
                                )
                              }
                              className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 text-right text-sm font-medium text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                          </div>
                        </div>

                        <div>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${
                              side === "Debit"
                                ? "bg-red-50 text-red-600"
                                : "bg-blue-50 text-blue-600"
                            }`}
                          >
                            {side}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ),
            )
          )}

          {/* FOOTER */}
          <div className="border-t border-slate-300 bg-slate-50 px-5 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  Opening Balance Summary
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  {rows.length} balance-sheet
                  accounts ·{" "}
                  {financialYear.label}
                </p>
              </div>

              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <span className="text-slate-500">
                    Debit
                  </span>

                  <p className="font-bold text-red-600">
                    {formatINR(totals.debit)}
                  </p>
                </div>

                <div>
                  <span className="text-slate-500">
                    Credit
                  </span>

                  <p className="font-bold text-blue-600">
                    {formatINR(totals.credit)}
                  </p>
                </div>

                <div>
                  <span className="text-slate-500">
                    Difference
                  </span>

                  <p
                    className={`font-bold ${
                      totals.balanced
                        ? "text-emerald-600"
                        : "text-red-600"
                    }`}
                  >
                    {formatINR(
                      totals.difference,
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* INFORMATION */}
        <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-bold">
            Opening Balance
          </p>

          <p className="mt-1 leading-6">
            For FY {financialYear.label}, the financial year runs from{" "}
            {formatDisplayDate(financialYear.from)} to{" "}
            {formatDisplayDate(financialYear.to)}. Opening balances are
            stored as of{" "}
            {formatDisplayDate(getPreviousDate(financialYear.from))}.
            Assets, Cash, Bank and Receivables are treated as Debit
            balances. Liabilities, Payables and Equity are treated as
            Credit balances.
          </p>
        </div>
      </main>
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <p className="mt-2 text-2xl font-bold text-slate-900">
        {value}
      </p>
    </div>
  );
}