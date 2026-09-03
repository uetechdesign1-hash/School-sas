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

type OpeningBalance = {
  id: string;
  school_id: string;
  account_id: string;
  balance: number | string | null;
  as_of_date: string;
  notes: string | null;
};

type BalanceRow = {
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

  return new Date(`${value}T00:00:00`).toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export default function BalanceSheetPage() {
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

  const [openingBalances, setOpeningBalances] =
    useState<OpeningBalance[]>([]);

  const [dateFrom, setDateFrom] =
    useState(firstDayOfFinancialYear());

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
    } = await supabase.auth.getUser();

    if (userError) {
      throw new Error(userError.message);
    }

    if (!userData.user) {
      throw new Error(
        "No logged-in user found."
      );
    }

    /*
     * Preferred:
     * get_my_school_id()
     */

    const {
      data: rpcSchoolId,
      error: rpcError,
    } = await supabase.rpc(
      "get_my_school_id"
    );

    if (!rpcError && rpcSchoolId) {
      return rpcSchoolId as string;
    }

    /*
     * Fallback:
     * school_users
     */

    const {
      data: membership,
      error: membershipError,
    } = await supabase
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
        openingBalanceResult,
      ] = await Promise.all([
        supabase
          .from("schools")
          .select(
            "id, name"
          )
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

        supabase
          .from("opening_balances")
          .select(
            `
              id,
              school_id,
              account_id,
              balance,
              as_of_date,
              notes
            `
          )
          .eq(
            "school_id",
            currentSchoolId
          )
          .order("as_of_date", {
            ascending: false,
          }),
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
          "BALANCE SHEET transaction_entries ERROR:",
          entryResult.error
        );

        throw new Error(
          `Unable to load transaction entries: ${entryResult.error.message}`
        );
      }

      if (openingBalanceResult.error) {
        console.error(
          "BALANCE SHEET opening_balances ERROR:",
          openingBalanceResult.error
        );

        throw new Error(
          `Unable to load opening balances: ${openingBalanceResult.error.message}`
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

      setOpeningBalances(
        (openingBalanceResult.data ||
          []) as OpeningBalance[]
      );
    } catch (err: any) {
      console.error(
        "BALANCE SHEET ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to load Balance Sheet."
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
   * MAPS
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

  const accountMap =
    useMemo(() => {
      const map =
        new Map<
          string,
          Account
        >();

      for (const account of accounts) {
        map.set(
          account.id,
          account
        );
      }

      return map;
    }, [accounts]);

  /*
   * =====================================================
   * ACCOUNT BALANCES
   *
   * Balance Sheet is AS OF Date To.
   *
   * Includes:
   *   - latest opening balance on/before Date To
   *   - all posted transactions up to Date To
   *
   * Asset:
   *   Debit - Credit
   *
   * Liability:
   *   Credit - Debit
   *
   * Equity:
   *   Credit - Debit
   * =====================================================
   */

  const accountBalances =
    useMemo(() => {
      const totals =
        new Map<
          string,
          {
            debit: number;
            credit: number;
          }
        >();

      /*
       * 1. Opening balances
       *
       * opening_balances contains the school's opening
       * position as of a date such as 31-03-2026.
       *
       * For a Balance Sheet, the latest opening balance
       * for each account on/before Date To is included.
       */
      const latestOpeningByAccount =
        new Map<string, OpeningBalance>();

      for (const opening of openingBalances) {
        if (
          !opening.as_of_date ||
          opening.as_of_date > dateTo
        ) {
          continue;
        }

        const existing =
          latestOpeningByAccount.get(
            opening.account_id
          );

        if (
          !existing ||
          opening.as_of_date >
            existing.as_of_date
        ) {
          latestOpeningByAccount.set(
            opening.account_id,
            opening
          );
        }
      }

      for (const opening of latestOpeningByAccount.values()) {
        const account =
          accountMap.get(opening.account_id);

        if (!account) {
          continue;
        }

        const type =
          account.account_type.toLowerCase();

        /*
         * Opening Balance screen stores positive
         * amounts and determines the side from the
         * account type.
         *
         * Balance Sheet accounts only:
         *   asset/cash/bank  -> Debit
         *   liability/equity/payable -> Credit
         *
         * Income/expense are deliberately ignored.
         */
        const amount = Number(
          opening.balance || 0
        );

        if (
          !Number.isFinite(amount) ||
          Math.abs(amount) < 0.000001
        ) {
          continue;
        }

        if (
          type === "asset" ||
          type === "cash" ||
          type === "bank"
        ) {
          const current =
            totals.get(opening.account_id) || {
              debit: 0,
              credit: 0,
            };

          current.debit += amount;

          totals.set(
            opening.account_id,
            current
          );
        } else if (
          type === "liability" ||
          type === "equity" ||
          type === "payable"
        ) {
          const current =
            totals.get(opening.account_id) || {
              debit: 0,
              credit: 0,
            };

          current.credit += amount;

          totals.set(
            opening.account_id,
            current
          );
        }
      }

      /*
       * 2. Posted transactions up to Date To
       */
      for (const entry of entries) {
        const transaction =
          transactionMap.get(
            entry.transaction_id
          );

        if (!transaction) {
          continue;
        }

        if (
          transaction.transaction_date >
          dateTo
        ) {
          continue;
        }

        const current =
          totals.get(entry.account_id) || {
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

      return totals;
    }, [
      entries,
      transactionMap,
      dateTo,
      openingBalances,
      accountMap,
    ]);

  /*
   * =====================================================
   * ASSETS
   *
   * IMPORTANT:
   *
   * asset + cash + bank
   *
   * are all Balance Sheet assets.
   *
   * We KEEP the original account_type values.
   * =====================================================
   */

  const assetRows =
    useMemo<BalanceRow[]>(() => {
      const result: BalanceRow[] =
        [];

      for (const account of accounts) {
        const type =
          account.account_type.toLowerCase();

        /*
         * THIS IS THE IMPORTANT FIX.
         */

        if (
          type !== "asset" &&
          type !== "cash" &&
          type !== "bank"
        ) {
          continue;
        }

        const total =
          accountBalances.get(
            account.id
          );

        const debit =
          Number(
            total?.debit || 0
          );

        const credit =
          Number(
            total?.credit || 0
          );

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
          type,
          amount,
        });
      }

      result.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );

      return result;
    }, [
      accounts,
      accountBalances,
    ]);

  /*
   * =====================================================
   * LIABILITIES
   * =====================================================
   */

  const liabilityRows =
    useMemo<BalanceRow[]>(() => {
      const result: BalanceRow[] =
        [];

      for (const account of accounts) {
        const type =
          account.account_type.toLowerCase();

        if (
          type !== "liability"
        ) {
          continue;
        }

        const total =
          accountBalances.get(
            account.id
          );

        const debit =
          Number(
            total?.debit || 0
          );

        const credit =
          Number(
            total?.credit || 0
          );

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
          type,
          amount,
        });
      }

      result.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );

      return result;
    }, [
      accounts,
      accountBalances,
    ]);

  /*
   * =====================================================
   * EQUITY
   * =====================================================
   */

  const equityRows =
    useMemo<BalanceRow[]>(() => {
      const result: BalanceRow[] =
        [];

      for (const account of accounts) {
        const type =
          account.account_type.toLowerCase();

        if (
          type !== "equity"
        ) {
          continue;
        }

        const total =
          accountBalances.get(
            account.id
          );

        const debit =
          Number(
            total?.debit || 0
          );

        const credit =
          Number(
            total?.credit || 0
          );

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
          type,
          amount,
        });
      }

      result.sort(
        (a, b) =>
          a.name.localeCompare(
            b.name
          )
      );

      return result;
    }, [
      accounts,
      accountBalances,
    ]);

  /*
   * =====================================================
   * CURRENT PERIOD PROFIT / LOSS
   *
   * Date From -> Date To
   * =====================================================
   */

  const currentPeriodProfit =
    useMemo(() => {
      let income = 0;
      let expenses = 0;

      for (const entry of entries) {
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

        const account =
          accountMap.get(
            entry.account_id
          );

        if (!account) {
          continue;
        }

        const type =
          account.account_type.toLowerCase();

        if (
          type === "income"
        ) {
          income +=
            Number(
              entry.credit || 0
            ) -
            Number(
              entry.debit || 0
            );
        }

        if (
          type === "expense"
        ) {
          expenses +=
            Number(
              entry.debit || 0
            ) -
            Number(
              entry.credit || 0
            );
        }
      }

      return (
        income - expenses
      );
    }, [
      entries,
      accountMap,
      transactionMap,
      dateFrom,
      dateTo,
    ]);

  /*
   * =====================================================
   * TOTALS
   * =====================================================
   */

  const totalAssets =
    assetRows.reduce(
      (sum, row) =>
        sum + row.amount,
      0
    );

  const totalLiabilities =
    liabilityRows.reduce(
      (sum, row) =>
        sum + row.amount,
      0
    );

  const totalEquity =
    equityRows.reduce(
      (sum, row) =>
        sum + row.amount,
      0
    );

  const totalEquityIncludingProfit =
    totalEquity +
    currentPeriodProfit;

  const totalLiabilitiesAndEquity =
    totalLiabilities +
    totalEquityIncludingProfit;

  const difference =
    totalAssets -
    totalLiabilitiesAndEquity;

  const balanced =
    Math.abs(difference) <
    0.005;

  /*
   * =====================================================
   * VIEW
   * =====================================================
   */

  function handleView() {
    setError("");

    if (
      !dateFrom ||
      !dateTo
    ) {
      setError(
        "Please select Date From and Date To."
      );
      return;
    }

    if (
      dateFrom > dateTo
    ) {
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
   * PRINT
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

    const rows: any[] =
      [];

    rows.push({
      "School Name":
        schoolName,
    });

    rows.push({
      Report:
        "Balance Sheet",
    });

    rows.push({
      "As of":
        formatDate(dateTo),
    });

    rows.push({
      "Opening balances":
        "Included through the latest opening balance on or before the report date",
    });

    rows.push({});

    /*
     * ASSETS
     */

    rows.push({
      Section:
        "ASSETS",
      "Account Code":
        "Account Code",
      Account:
        "Account",
      Amount:
        "Amount",
    });

    for (const row of assetRows) {
      rows.push({
        Section:
          "Asset",
        "Account Code":
          row.code,
        Account:
          row.name,
        Amount:
          row.amount,
      });
    }

    rows.push({
      Section:
        "TOTAL ASSETS",
      Amount:
        totalAssets,
    });

    rows.push({});

    /*
     * LIABILITIES
     */

    rows.push({
      Section:
        "LIABILITIES",
      "Account Code":
        "Account Code",
      Account:
        "Account",
      Amount:
        "Amount",
    });

    for (const row of liabilityRows) {
      rows.push({
        Section:
          "Liability",
        "Account Code":
          row.code,
        Account:
          row.name,
        Amount:
          row.amount,
      });
    }

    rows.push({
      Section:
        "TOTAL LIABILITIES",
      Amount:
        totalLiabilities,
    });

    rows.push({});

    /*
     * EQUITY
     */

    rows.push({
      Section:
        "EQUITY",
      "Account Code":
        "Account Code",
      Account:
        "Account",
      Amount:
        "Amount",
    });

    for (const row of equityRows) {
      rows.push({
        Section:
          "Equity",
        "Account Code":
          row.code,
        Account:
          row.name,
        Amount:
          row.amount,
      });
    }

    rows.push({
      Section:
        "Current Period Profit / Loss",
      Amount:
        currentPeriodProfit,
    });

    rows.push({
      Section:
        "TOTAL EQUITY",
      Amount:
        totalEquityIncludingProfit,
    });

    rows.push({
      Section:
        "TOTAL LIABILITIES + EQUITY",
      Amount:
        totalLiabilitiesAndEquity,
    });

    rows.push({});

    rows.push({
      Section:
        "DIFFERENCE",
      Amount:
        difference,
    });

    rows.push({
      Section:
        "STATUS",
      Amount:
        balanced
          ? "BALANCED"
          : "NOT BALANCED",
    });

    const worksheet =
      XLSX.utils.json_to_sheet(
        rows,
        {
          skipHeader: true,
        }
      );

    worksheet["!cols"] =
      [
        {
          wch: 32,
        },
        {
          wch: 18,
        },
        {
          wch: 42,
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
      "Balance Sheet"
    );

    XLSX.writeFile(
      workbook,
      `balance-sheet-${dateTo}.xlsx`
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

          .balance-sheet-print {
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
        {/* =================================================
            HEADER
        ================================================= */}

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
                Balance Sheet
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Financial position of the school as of the selected date.
              </p>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-5 py-5">
          {/* =================================================
              ERROR
          ================================================= */}

          {error && (
            <div className="no-print mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* =================================================
              FILTER
          ================================================= */}

          <section className="no-print rounded-2xl border bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Date From
                </label>

                <input
                  type="date"
                  value={
                    dateFrom
                  }
                  onChange={(e) => {
                    setDateFrom(
                      e.target.value
                    );
                    setViewed(
                      false
                    );
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
                  value={
                    dateTo
                  }
                  onChange={(e) => {
                    setDateTo(
                      e.target.value
                    );
                    setViewed(
                      false
                    );
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

          {/* =================================================
              REPORT
          ================================================= */}

          {viewed && (
            <section className="balance-sheet-print mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
              {/* PRINT HEADER */}

              <div className="print-only mb-5 text-center">
                <h1 className="text-xl font-bold text-black">
                  {schoolName ||
                    "School"}
                </h1>

                <h2 className="mt-1 text-lg font-bold text-black">
                  BALANCE SHEET
                </h2>

                <p className="mt-1 text-sm text-black">
                  As of{" "}
                  {formatDate(
                    dateTo
                  )}
                </p>
              </div>

              {/* REPORT HEADER */}

              <div className="no-print border-b px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Balance Sheet
                    </h2>

                    <p className="text-xs text-slate-500">
                      As of{" "}
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

              {/* =================================================
                  SUMMARY
              ================================================= */}

              <div className="grid grid-cols-3 divide-x border-b bg-slate-50">
                <SummaryBox
                  title="Total Assets"
                  value={money(
                    totalAssets
                  )}
                />

                <SummaryBox
                  title="Liabilities"
                  value={money(
                    totalLiabilities
                  )}
                />

                <SummaryBox
                  title="Equity"
                  value={money(
                    totalEquityIncludingProfit
                  )}
                />
              </div>

              {/* =================================================
                  BALANCE STATUS
              ================================================= */}

              <div
                className={`border-b px-5 py-3 ${
                  balanced
                    ? "bg-emerald-50"
                    : "bg-red-50"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span
                    className={`font-bold ${
                      balanced
                        ? "text-emerald-700"
                        : "text-red-700"
                    }`}
                  >
                    {balanced
                      ? "BALANCE SHEET BALANCED"
                      : "BALANCE SHEET NOT BALANCED"}
                  </span>

                  <span className="text-sm font-semibold">
                    Difference:{" "}
                    {money(
                      difference
                    )}
                  </span>
                </div>
              </div>

              {/* =================================================
                  ASSETS
              ================================================= */}

              <ReportSection
                title="Assets"
                rows={
                  assetRows
                }
                total={
                  totalAssets
                }
                emptyMessage="No asset balances found."
              />

              {/* =================================================
                  LIABILITIES
              ================================================= */}

              <ReportSection
                title="Liabilities"
                rows={
                  liabilityRows
                }
                total={
                  totalLiabilities
                }
                emptyMessage="No liability balances found."
              />

              {/* =================================================
                  EQUITY
              ================================================= */}

              <div className="border-b">
                <div className="border-b bg-blue-50 px-5 py-3">
                  <h3 className="font-bold text-blue-800">
                    Equity
                  </h3>
                </div>

                {equityRows.length ===
                  0 &&
                Math.abs(
                  currentPeriodProfit
                ) < 0.000001 ? (
                  <div className="px-5 py-6 text-sm text-slate-500">
                    No equity balances found.
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
                      {equityRows.map(
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

                            <td className="px-5 py-3 text-right font-semibold text-blue-700">
                              {money(
                                row.amount
                              )}
                            </td>
                          </tr>
                        )
                      )}

                      {Math.abs(
                        currentPeriodProfit
                      ) >=
                        0.000001 && (
                        <tr>
                          <td className="px-5 py-3 text-sm text-slate-500">
                            —
                          </td>

                          <td className="px-5 py-3 font-medium text-slate-900">
                            Current Period Profit / Loss
                          </td>

                          <td
                            className={`px-5 py-3 text-right font-semibold ${
                              currentPeriodProfit >=
                              0
                                ? "text-emerald-700"
                                : "text-red-700"
                            }`}
                          >
                            {money(
                              currentPeriodProfit
                            )}
                          </td>
                        </tr>
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
                          Total Equity
                        </td>

                        <td className="px-5 py-3 text-right font-bold text-blue-700">
                          {money(
                            totalEquityIncludingProfit
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {/* =================================================
                  FINAL TOTALS
              ================================================= */}

              <div className="grid gap-0 border-b sm:grid-cols-2">
                <div className="border-b px-5 py-5 sm:border-b-0 sm:border-r">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Total Assets
                  </p>

                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {money(
                      totalAssets
                    )}
                  </p>
                </div>

                <div className="px-5 py-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Total Liabilities + Equity
                  </p>

                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {money(
                      totalLiabilitiesAndEquity
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
                    Balance Sheet
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* LOADING */}

        {loading && (
          <div className="no-print fixed bottom-5 right-5 flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-lg">
            <Loader2
              size={16}
              className="animate-spin"
            />
            Loading Balance Sheet...
          </div>
        )}
      </main>
    </>
  );
}

/*
 * =====================================================
 * SUMMARY BOX
 * =====================================================
 */

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

/*
 * =====================================================
 * REPORT SECTION
 * =====================================================
 */

function ReportSection({
  title,
  rows,
  total,
  emptyMessage,
}: {
  title: string;
  rows: BalanceRow[];
  total: number;
  emptyMessage: string;
}) {
  return (
    <div className="border-b">
      <div className="border-b bg-slate-100 px-5 py-3">
        <h3 className="font-bold text-slate-800">
          {title}
        </h3>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-6 text-sm text-slate-500">
          {emptyMessage}
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
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-5 py-3 text-sm text-slate-500">
                  {row.code || "—"}
                </td>

                <td className="px-5 py-3 font-medium text-slate-900">
                  {row.name}
                </td>

                <td className="px-5 py-3 text-right font-semibold text-slate-900">
                  {money(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t bg-slate-50">
              <td
                colSpan={2}
                className="px-5 py-3 text-right font-bold"
              >
                Total {title}
              </td>

              <td className="px-5 py-3 text-right font-bold text-slate-900">
                {money(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}