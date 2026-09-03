"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  Search,
} from "lucide-react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type: string;
  is_active: boolean;
};

type Transaction = {
  id: string;
  transaction_date: string;
};

type TransactionEntry = {
  id: string;
  school_id: string;
  transaction_id: string;
  account_id: string;
  debit: number | string | null;
  credit: number | string | null;
};

type ReportRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  amount: number;
};

function today() {
  return new Date().toISOString().split("T")[0];
}

function firstDayOfFinancialYear() {
  const now = new Date();

  const year =
    now.getMonth() >= 3
      ? now.getFullYear()
      : now.getFullYear() - 1;

  return `${year}-04-01`;
}

function formatDate(value: string) {
  if (!value) return "-";

  return new Date(
    `${value}T00:00:00`
  ).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function cleanFileName(value: string) {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export default function ProfitLossPage() {
  const supabase = createClient();

  const [schoolId, setSchoolId] =
    useState<string | null>(null);

  const [schoolName, setSchoolName] =
    useState("");

  const [accounts, setAccounts] =
    useState<Account[]>([]);

  const [transactions, setTransactions] =
    useState<Transaction[]>([]);

  const [entries, setEntries] =
    useState<TransactionEntry[]>([]);

  const [dateFrom, setDateFrom] =
    useState(
      firstDayOfFinancialYear()
    );

  const [dateTo, setDateTo] =
    useState(today());

  const [loading, setLoading] =
    useState(true);

  const [viewed, setViewed] =
    useState(false);

  const [error, setError] =
    useState("");

  /*
   * =====================================================
   * CURRENT SCHOOL
   * =====================================================
   */

  async function getCurrentSchoolId() {
    const {
      data: userData,
      error: userError,
    } =
      await supabase.auth.getUser();

    if (userError) {
      throw new Error(
        userError.message
      );
    }

    if (!userData.user) {
      throw new Error(
        "No logged-in user found."
      );
    }

    /*
     * Automatically detect current school.
     */

    const {
      data: rpcSchoolId,
      error: rpcError,
    } =
      await supabase.rpc(
        "get_my_school_id"
      );

    if (!rpcError && rpcSchoolId) {
      return rpcSchoolId as string;
    }

    /*
     * Fallback.
     */

    const {
      data: membership,
      error: membershipError,
    } =
      await supabase
        .from("school_users")
        .select(
          "school_id, is_active, created_at"
        )
        .eq(
          "user_id",
          userData.user.id
        )
        .eq(
          "is_active",
          true
        )
        .order(
          "created_at",
          {
            ascending: true,
          }
        )
        .limit(1)
        .maybeSingle();

    if (membershipError) {
      throw new Error(
        membershipError.message
      );
    }

    if (!membership?.school_id) {
      throw new Error(
        "No active school found."
      );
    }

    return membership.school_id as string;
  }

  /*
   * =====================================================
   * LOAD DATA
   * =====================================================
   */

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const currentSchoolId =
        await getCurrentSchoolId();

      setSchoolId(
        currentSchoolId
      );

      const [
        schoolResult,
        accountResult,
        transactionResult,
        entryResult,
      ] = await Promise.all([
        supabase
          .from("schools")
          .select("id, name")
          .eq(
            "id",
            currentSchoolId
          )
          .maybeSingle(),

        supabase
          .from("accounts")
          .select(
            `
            id,
            school_id,
            code,
            name,
            account_type,
            is_active
            `
          )
          .eq(
            "school_id",
            currentSchoolId
          )
          .eq(
            "is_active",
            true
          )
          .order("name"),

        supabase
          .from("transactions")
          .select(
            `
            id,
            transaction_date
            `
          )
          .eq(
            "school_id",
            currentSchoolId
          ),

        supabase
          .from("transaction_entries")
          .select(
            `
            id,
            school_id,
            transaction_id,
            account_id,
            debit,
            credit
            `
          )
          .eq(
            "school_id",
            currentSchoolId
          ),
      ]);

      if (schoolResult.error) {
        throw new Error(
          `Unable to load school: ${schoolResult.error.message}`
        );
      }

      if (accountResult.error) {
        throw new Error(
          `Unable to load accounts: ${accountResult.error.message}`
        );
      }

      if (transactionResult.error) {
        throw new Error(
          `Unable to load transactions: ${transactionResult.error.message}`
        );
      }

      if (entryResult.error) {
        console.error(
          "PROFIT LOSS transaction_entries ERROR:",
          entryResult.error
        );

        throw new Error(
          `Unable to load transaction entries: ${entryResult.error.message}`
        );
      }

      setSchoolName(
        schoolResult.data?.name || ""
      );

      setAccounts(
        (accountResult.data ||
          []) as Account[]
      );

      setTransactions(
        (transactionResult.data ||
          []) as Transaction[]
      );

      setEntries(
        (entryResult.data ||
          []) as TransactionEntry[]
      );
    } catch (err: any) {
      console.error(
        "PROFIT LOSS ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to load Profit & Loss."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, []);

  /*
   * =====================================================
   * TRANSACTION MAP
   * =====================================================
   */

  const transactionMap =
    useMemo(() => {
      const map =
        new Map<
          string,
          Transaction
        >();

      for (const transaction of transactions) {
        map.set(
          transaction.id,
          transaction
        );
      }

      return map;
    }, [transactions]);

  /*
   * =====================================================
   * INCOME
   *
   * Income accounts normally have credit balances.
   *
   * Net income =
   * credit - debit
   * =====================================================
   */

  const incomeRows =
    useMemo<ReportRow[]>(() => {
      const totals =
        new Map<
          string,
          {
            debit: number;
            credit: number;
          }
        >();

      for (const entry of entries) {
        const account =
          accounts.find(
            (item) =>
              item.id ===
              entry.account_id
          );

        if (!account) {
          continue;
        }

        if (
          account.account_type
            .toLowerCase() !==
          "income"
        ) {
          continue;
        }

        const transaction =
          transactionMap.get(
            entry.transaction_id
          );

        if (!transaction) {
          continue;
        }

        if (
          transaction.transaction_date <
            dateFrom ||
          transaction.transaction_date >
            dateTo
        ) {
          continue;
        }

        const current =
          totals.get(
            entry.account_id
          ) || {
            debit: 0,
            credit: 0,
          };

        current.debit += Number(
          entry.debit || 0
        );

        current.credit += Number(
          entry.credit || 0
        );

        totals.set(
          entry.account_id,
          current
        );
      }

      const result: ReportRow[] = [];

      for (const account of accounts) {
        if (
          account.account_type
            .toLowerCase() !==
          "income"
        ) {
          continue;
        }

        const total =
          totals.get(account.id);

        const debit =
          total?.debit || 0;

        const credit =
          total?.credit || 0;

        const amount =
          credit - debit;

        if (
          Math.abs(amount) <
          0.000001
        ) {
          continue;
        }

        result.push({
          id: account.id,
          code:
            account.code || "",
          name: account.name,
          type:
            account.account_type,
          amount:
            amount,
        });
      }

      result.sort((a, b) =>
        a.name.localeCompare(
          b.name
        )
      );

      return result;
    }, [
      accounts,
      entries,
      transactionMap,
      dateFrom,
      dateTo,
    ]);

  /*
   * =====================================================
   * EXPENSES
   *
   * Expense accounts normally have debit balances.
   *
   * Net expense =
   * debit - credit
   * =====================================================
   */

  const expenseRows =
    useMemo<ReportRow[]>(() => {
      const totals =
        new Map<
          string,
          {
            debit: number;
            credit: number;
          }
        >();

      for (const entry of entries) {
        const account =
          accounts.find(
            (item) =>
              item.id ===
              entry.account_id
          );

        if (!account) {
          continue;
        }

        if (
          account.account_type
            .toLowerCase() !==
          "expense"
        ) {
          continue;
        }

        const transaction =
          transactionMap.get(
            entry.transaction_id
          );

        if (!transaction) {
          continue;
        }

        if (
          transaction.transaction_date <
            dateFrom ||
          transaction.transaction_date >
            dateTo
        ) {
          continue;
        }

        const current =
          totals.get(
            entry.account_id
          ) || {
            debit: 0,
            credit: 0,
          };

        current.debit += Number(
          entry.debit || 0
        );

        current.credit += Number(
          entry.credit || 0
        );

        totals.set(
          entry.account_id,
          current
        );
      }

      const result: ReportRow[] = [];

      for (const account of accounts) {
        if (
          account.account_type
            .toLowerCase() !==
          "expense"
        ) {
          continue;
        }

        const total =
          totals.get(account.id);

        const debit =
          total?.debit || 0;

        const credit =
          total?.credit || 0;

        const amount =
          debit - credit;

        if (
          Math.abs(amount) <
          0.000001
        ) {
          continue;
        }

        result.push({
          id: account.id,
          code:
            account.code || "",
          name: account.name,
          type:
            account.account_type,
          amount:
            amount,
        });
      }

      result.sort((a, b) =>
        a.name.localeCompare(
          b.name
        )
      );

      return result;
    }, [
      accounts,
      entries,
      transactionMap,
      dateFrom,
      dateTo,
    ]);

  /*
   * =====================================================
   * TOTALS
   * =====================================================
   */

  const totalIncome =
    incomeRows.reduce(
      (sum, row) =>
        sum + row.amount,
      0
    );

  const totalExpenses =
    expenseRows.reduce(
      (sum, row) =>
        sum + row.amount,
      0
    );

  const netProfit =
    totalIncome -
    totalExpenses;

  const isProfit =
    netProfit >= 0;

  /*
   * =====================================================
   * VIEW
   * =====================================================
   */

  function handleView() {
    setError("");

    if (!dateFrom || !dateTo) {
      setError(
        "Please select Date From and Date To."
      );
      return;
    }

    if (dateFrom > dateTo) {
      setError(
        "Date From cannot be after Date To."
      );
      return;
    }

    setViewed(true);
  }

  /*
   * =====================================================
   * CLEAR
   * =====================================================
   */

  function handleClear() {
    setDateFrom(
      firstDayOfFinancialYear()
    );

    setDateTo(today());

    setViewed(false);
    setError("");
  }

  /*
   * =====================================================
   * PRINT / PDF
   * =====================================================
   */

  function handlePrint() {
    if (!viewed) {
      setError(
        "Please click View first."
      );
      return;
    }

    window.print();
  }

  /*
   * =====================================================
   * EXCEL
   * =====================================================
   */

  function handleExcel() {
    if (!viewed) {
      setError(
        "Please click View first."
      );
      return;
    }

    const excelRows: any[] = [
      {
        "School Name":
          schoolName,
      },
      {
        Report:
          "Profit & Loss",
      },
      {
        Period:
          `${formatDate(
            dateFrom
          )} - ${formatDate(
            dateTo
          )}`,
      },
      {},
      {
        Section:
          "INCOME",
        "Account Code":
          "Account Code",
        Account:
          "Account",
        Amount:
          "Amount",
      },
    ];

    for (const row of incomeRows) {
      excelRows.push({
        Section:
          "Income",
        "Account Code":
          row.code,
        Account:
          row.name,
        Amount:
          row.amount,
      });
    }

    excelRows.push({
      Section:
        "Total Income",
      Amount:
        totalIncome,
    });

    excelRows.push({});

    excelRows.push({
      Section:
        "EXPENSES",
      "Account Code":
        "Account Code",
      Account:
        "Account",
      Amount:
        "Amount",
    });

    for (const row of expenseRows) {
      excelRows.push({
        Section:
          "Expense",
        "Account Code":
          row.code,
        Account:
          row.name,
        Amount:
          row.amount,
      });
    }

    excelRows.push({
      Section:
        "Total Expenses",
      Amount:
        totalExpenses,
    });

    excelRows.push({});

    excelRows.push({
      Section:
        isProfit
          ? "NET PROFIT"
          : "NET LOSS",
      Amount:
        Math.abs(netProfit),
    });

    const worksheet =
      XLSX.utils.json_to_sheet(
        excelRows,
        {
          skipHeader: true,
        }
      );

    worksheet["!cols"] = [
      {
        wch: 20,
      },
      {
        wch: 18,
      },
      {
        wch: 40,
      },
      {
        wch: 20,
      },
    ];

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Profit & Loss"
    );

    XLSX.writeFile(
      workbook,
      `profit-loss-${dateFrom}-to-${dateTo}.xlsx`
    );
  }

  /*
   * =====================================================
   * RENDER
   * =====================================================
   */

  return (
    <>
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm;
          }

          body {
            background: white !important;
          }

          .no-print {
            display: none !important;
          }

          .print-only {
            display: block !important;
          }

          .pl-print {
            width: 100% !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
          }

          table {
            width: 100% !important;
            border-collapse: collapse !important;
          }

          th,
          td {
            border: 1px solid #d1d5db !important;
            padding: 7px !important;
            font-size: 10px !important;
          }

          tr {
            page-break-inside: avoid;
          }
        }

        @media screen {
          .print-only {
            display: none;
          }
        }
      `}</style>

      <main className="min-h-screen bg-slate-50">
        {/* HEADER */}

        <div className="no-print border-b bg-white">
          <div className="mx-auto max-w-7xl px-5 py-5">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600"
            >
              <ArrowLeft
                size={16}
              />
              Dashboard
            </Link>

            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                Accounting
              </p>

              <h1 className="mt-1 text-2xl font-bold text-slate-900">
                Profit & Loss
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Income and expenses for the selected period.
              </p>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-5 py-5">
          {/* ERROR */}

          {error && (
            <div className="no-print mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* FILTER */}

          <section className="no-print rounded-2xl border bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Date From
                </label>

                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(
                      e.target.value
                    );
                    setViewed(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Date To
                </label>

                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(
                      e.target.value
                    );
                    setViewed(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={
                    handleView
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
                >
                  <Search
                    size={16}
                  />
                  View
                </button>

                <button
                  type="button"
                  onClick={
                    handleClear
                  }
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </section>

          {/* REPORT */}

          {viewed && (
            <section className="pl-print mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
              {/* PRINT HEADER */}

              <div className="print-only mb-5 text-center">
                <h1 className="text-xl font-bold text-black">
                  {schoolName ||
                    "School"}
                </h1>

                <h2 className="mt-1 text-lg font-bold text-black">
                  PROFIT & LOSS
                </h2>

                <p className="mt-1 text-sm text-black">
                  Period:{" "}
                  {formatDate(
                    dateFrom
                  )}{" "}
                  to{" "}
                  {formatDate(
                    dateTo
                  )}
                </p>
              </div>

              {/* TOP */}

              <div className="no-print border-b px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Profit & Loss
                    </h2>

                    <p className="text-xs text-slate-500">
                      {formatDate(
                        dateFrom
                      )}{" "}
                      to{" "}
                      {formatDate(
                        dateTo
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={
                        handlePrint
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Printer
                        size={16}
                      />
                      Print
                    </button>

                    <button
                      type="button"
                      onClick={
                        handlePrint
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download
                        size={16}
                      />
                      PDF
                    </button>

                    <button
                      type="button"
                      onClick={
                        handleExcel
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <FileSpreadsheet
                        size={16}
                      />
                      Excel
                    </button>

                    <button
                      type="button"
                      onClick={
                        loadPage
                      }
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw
                        size={15}
                      />
                      Refresh
                    </button>
                  </div>
                </div>
              </div>

              {/* SUMMARY */}

              <div className="grid grid-cols-3 divide-x border-b bg-slate-50">
                <SummaryBox
                  title="Total Income"
                  value={money(
                    totalIncome
                  )}
                />

                <SummaryBox
                  title="Total Expenses"
                  value={money(
                    totalExpenses
                  )}
                />

                <SummaryBox
                  title={
                    isProfit
                      ? "Net Profit"
                      : "Net Loss"
                  }
                  value={money(
                    Math.abs(
                      netProfit
                    )
                  )}
                />
              </div>

              {/* =================================================
                  INCOME
              ================================================= */}

              <div className="border-b">
                <div className="border-b bg-emerald-50 px-5 py-3">
                  <h3 className="font-bold text-emerald-800">
                    Income
                  </h3>
                </div>

                {incomeRows.length ===
                0 ? (
                  <div className="px-5 py-6 text-sm text-slate-500">
                    No income recorded for this period.
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Code
                        </th>

                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Account
                        </th>

                        <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">
                          Amount
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y">
                      {incomeRows.map(
                        (row) => (
                          <tr
                            key={
                              row.id
                            }
                          >
                            <td className="px-5 py-3 text-sm text-slate-500">
                              {row.code ||
                                "—"}
                            </td>

                            <td className="px-5 py-3 font-medium text-slate-900">
                              {row.name}
                            </td>

                            <td className="px-5 py-3 text-right font-semibold text-emerald-700">
                              {money(
                                row.amount
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>

                    <tfoot>
                      <tr className="border-t bg-slate-50">
                        <td
                          colSpan={
                            2
                          }
                          className="px-5 py-3 text-right font-bold"
                        >
                          Total Income
                        </td>

                        <td className="px-5 py-3 text-right font-bold text-emerald-700">
                          {money(
                            totalIncome
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {/* =================================================
                  EXPENSES
              ================================================= */}

              <div className="border-b">
                <div className="border-b bg-red-50 px-5 py-3">
                  <h3 className="font-bold text-red-800">
                    Expenses
                  </h3>
                </div>

                {expenseRows.length ===
                0 ? (
                  <div className="px-5 py-6 text-sm text-slate-500">
                    No expenses recorded for this period.
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Code
                        </th>

                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Account
                        </th>

                        <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">
                          Amount
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y">
                      {expenseRows.map(
                        (row) => (
                          <tr
                            key={
                              row.id
                            }
                          >
                            <td className="px-5 py-3 text-sm text-slate-500">
                              {row.code ||
                                "—"}
                            </td>

                            <td className="px-5 py-3 font-medium text-slate-900">
                              {row.name}
                            </td>

                            <td className="px-5 py-3 text-right font-semibold text-red-700">
                              {money(
                                row.amount
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>

                    <tfoot>
                      <tr className="border-t bg-slate-50">
                        <td
                          colSpan={
                            2
                          }
                          className="px-5 py-3 text-right font-bold"
                        >
                          Total Expenses
                        </td>

                        <td className="px-5 py-3 text-right font-bold text-red-700">
                          {money(
                            totalExpenses
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {/* =================================================
                  NET PROFIT / LOSS
              ================================================= */}

              <div
                className={`px-5 py-5 ${
                  isProfit
                    ? "bg-emerald-50"
                    : "bg-red-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-wide text-slate-500">
                      {isProfit
                        ? "Net Profit"
                        : "Net Loss"}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      Total Income − Total Expenses
                    </p>
                  </div>

                  <p
                    className={`text-2xl font-bold ${
                      isProfit
                        ? "text-emerald-700"
                        : "text-red-700"
                    }`}
                  >
                    {money(
                      Math.abs(
                        netProfit
                      )
                    )}
                  </p>
                </div>
              </div>

              {/* PRINT FOOTER */}

              <div className="print-only mt-8 border-t border-gray-300 pt-3 text-xs">
                <div className="flex justify-between">
                  <span>
                    Generated from SchoolFlow
                  </span>

                  <span>
                    Profit & Loss
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>

        {loading && (
          <div className="no-print fixed bottom-5 right-5 flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-lg">
            <Loader2
              size={16}
              className="animate-spin"
            />
            Loading Profit & Loss...
          </div>
        )}
      </main>
    </>
  );
}

function SummaryBox({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {title}
      </p>

      <p className="mt-1 text-base font-bold text-slate-900">
        {value}
      </p>
    </div>
  );
}