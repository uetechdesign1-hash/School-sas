"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  XCircle,
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

type TrialRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
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

function fileName(value: string) {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function openingBalanceSide(accountType: string) {
  const type = String(accountType || "").toLowerCase();

  if (
    type === "liability" ||
    type === "payable" ||
    type === "equity" ||
    type === "income"
  ) {
    return "credit" as const;
  }

  return "debit" as const;
}

function getLatestOpeningBalances(
  openingBalances: OpeningBalance[],
  accounts: Account[],
  dateFrom: string
) {
  const accountTypes = new Map(
    accounts.map((account) => [
      account.id,
      account.account_type,
    ])
  );

  const latest = new Map<string, OpeningBalance>();

  const sorted = [...openingBalances].sort((a, b) =>
    b.as_of_date.localeCompare(a.as_of_date)
  );

  for (const opening of sorted) {
    if (opening.as_of_date > dateFrom) {
      continue;
    }

    if (!accountTypes.has(opening.account_id)) {
      continue;
    }

    if (!latest.has(opening.account_id)) {
      latest.set(opening.account_id, opening);
    }
  }

  return latest;
}

export default function TrialBalancePage() {
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

    const {
      data: rpcSchoolId,
      error: rpcError,
    } = await supabase.rpc(
      "get_my_school_id"
    );

    if (!rpcError && rpcSchoolId) {
      return rpcSchoolId as string;
    }

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

      setSchoolId(currentSchoolId);

      const [
        schoolResult,
        accountResult,
        transactionResult,
        entryResult,
        openingBalanceResult,
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
          "TRIAL BALANCE transaction_entries ERROR:",
          entryResult.error
        );

        throw new Error(
          `Unable to load transaction entries: ${entryResult.error.message}`
        );
      }

      if (openingBalanceResult.error) {
        console.error(
          "TRIAL BALANCE opening_balances ERROR:",
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
        "TRIAL BALANCE ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to load Trial Balance."
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
   * TRIAL BALANCE
   * =====================================================
   */

  const rows =
    useMemo<TrialRow[]>(() => {
      const totals =
        new Map<
          string,
          {
            debit: number;
            credit: number;
          }
        >();

      // ---------------------------------------------------
      // 1. Start with the latest saved opening balance
      //    on or before the selected Date From.
      // ---------------------------------------------------
      const latestOpening =
        getLatestOpeningBalances(
          openingBalances,
          accounts,
          dateFrom
        );

      for (const account of accounts) {
        const opening =
          latestOpening.get(account.id);

        if (!opening) {
          continue;
        }

        const amount = Number(
          opening.balance || 0
        );

        if (!Number.isFinite(amount) || amount === 0) {
          continue;
        }

        const current =
          totals.get(account.id) || {
            debit: 0,
            credit: 0,
          };

        if (
          openingBalanceSide(
            account.account_type
          ) === "credit"
        ) {
          current.credit += amount;
        } else {
          current.debit += amount;
        }

        totals.set(
          account.id,
          current
        );
      }

      // ---------------------------------------------------
      // 2. Add all transaction movements inside the
      //    selected period.
      // ---------------------------------------------------
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

      // ---------------------------------------------------
      // 3. Convert each account to its net Trial Balance
      //    side. This preserves the correct balance after
      //    opening balance + current-period movements.
      // ---------------------------------------------------
      const result: TrialRow[] = [];

      for (const account of accounts) {
        const total =
          totals.get(account.id);

        const debit =
          total?.debit || 0;

        const credit =
          total?.credit || 0;

        const net =
          debit - credit;

        if (
          Math.abs(net) <
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
          debit:
            net > 0 ? net : 0,
          credit:
            net < 0
              ? Math.abs(net)
              : 0,
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
      openingBalances,
      transactionMap,
      dateFrom,
      dateTo,
    ]);

  /*
   * =====================================================
   * TOTALS
   * =====================================================
   */

  const totalDebit =
    rows.reduce(
      (sum, row) =>
        sum + row.debit,
      0
    );

  const totalCredit =
    rows.reduce(
      (sum, row) =>
        sum + row.credit,
      0
    );

  const difference =
    Math.abs(
      totalDebit -
        totalCredit
    );

  const balanced =
    difference < 0.005;

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
          "Trial Balance",
      },
      {
        Period:
          `${formatDate(
            dateFrom
          )} - ${formatDate(
            dateTo
          )}`,
      },
      {
        "Opening Balances":
          "Included through selected Date From",
      },
      {},
      {
        "Account Code":
          "Account Code",
        Account:
          "Account",
        Type:
          "Type",
        Debit:
          "Debit",
        Credit:
          "Credit",
      },
    ];

    for (const row of rows) {
      excelRows.push({
        "Account Code":
          row.code,
        Account:
          row.name,
        Type:
          row.type,
        Debit:
          row.debit,
        Credit:
          row.credit,
      });
    }

    excelRows.push({});

    excelRows.push({
      Account:
        "TOTAL",
      Debit:
        totalDebit,
      Credit:
        totalCredit,
    });

    excelRows.push({
      Account:
        "Difference",
      Credit:
        difference,
    });

    excelRows.push({
      Account:
        "Status",
      Credit:
        balanced
          ? "BALANCED"
          : "NOT BALANCED",
    });

    const worksheet =
      XLSX.utils.json_to_sheet(
        excelRows,
        {
          skipHeader: true,
        }
      );

    worksheet["!cols"] = [
      { wch: 18 },
      { wch: 40 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
    ];

    const workbook =
      XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Trial Balance"
    );

    XLSX.writeFile(
      workbook,
      `trial-balance-${dateFrom}-to-${dateTo}.xlsx`
    );
  }

  /*
   * =====================================================
   * UI
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

          .trial-print {
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
                Trial Balance
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Verify total debit and credit before preparing final accounts.
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
            <section className="trial-print mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
              {/* PRINT HEADER */}

              <div className="print-only mb-5 text-center">
                <h1 className="text-xl font-bold text-black">
                  {schoolName ||
                    "School"}
                </h1>

                <h2 className="mt-1 text-lg font-bold text-black">
                  TRIAL BALANCE
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

              {/* REPORT TOP */}

              <div className="no-print border-b px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Trial Balance
                    </h2>

                    <p className="text-xs text-slate-500">
                      {formatDate(
                        dateFrom
                      )}{" "}
                      to{" "}
                      {formatDate(
                        dateTo
                      )}
                      {" • "}
                      Opening balances included
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

              {/* STATUS */}

              <div
                className={`border-b px-5 py-4 ${
                  balanced
                    ? "bg-emerald-50"
                    : "bg-red-50"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {balanced ? (
                      <CheckCircle2
                        size={25}
                        className="text-emerald-600"
                      />
                    ) : (
                      <XCircle
                        size={25}
                        className="text-red-600"
                      />
                    )}

                    <div>
                      <p
                        className={`font-bold ${
                          balanced
                            ? "text-emerald-800"
                            : "text-red-800"
                        }`}
                      >
                        {balanced
                          ? "BALANCED"
                          : "NOT BALANCED"}
                      </p>

                      <p className="text-xs text-slate-600">
                        Difference:{" "}
                        {money(
                          difference
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs font-semibold uppercase text-slate-400">
                      Difference
                    </p>

                    <p
                      className={`text-xl font-bold ${
                        balanced
                          ? "text-emerald-700"
                          : "text-red-700"
                      }`}
                    >
                      {money(
                        difference
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* SUMMARY */}

              <div className="grid grid-cols-3 divide-x border-b bg-slate-50">
                <SummaryBox
                  title="Accounts"
                  value={String(
                    rows.length
                  )}
                />

                <SummaryBox
                  title="Total Debit"
                  value={money(
                    totalDebit
                  )}
                />

                <SummaryBox
                  title="Total Credit"
                  value={money(
                    totalCredit
                  )}
                />
              </div>

              {/* TABLE */}

              {rows.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <p className="font-semibold text-slate-900">
                    No accounting entries found
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    No opening balances or transactions were found for this period.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[750px]">
                    <thead>
                      <tr className="border-b bg-white">
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Code
                        </th>

                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Account
                        </th>

                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Type
                        </th>

                        <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">
                          Debit
                        </th>

                        <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">
                          Credit
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y">
                      {rows.map(
                        (row) => (
                          <tr
                            key={
                              row.id
                            }
                            className="hover:bg-slate-50"
                          >
                            <td className="px-5 py-4 text-sm text-slate-500">
                              {row.code ||
                                "—"}
                            </td>

                            <td className="px-5 py-4 font-semibold text-slate-900">
                              {row.name}
                            </td>

                            <td className="px-5 py-4">
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                                {row.type}
                              </span>
                            </td>

                            <td className="px-5 py-4 text-right font-semibold text-red-600">
                              {row.debit >
                              0
                                ? money(
                                    row.debit
                                  )
                                : "—"}
                            </td>

                            <td className="px-5 py-4 text-right font-semibold text-blue-600">
                              {row.credit >
                              0
                                ? money(
                                    row.credit
                                  )
                                : "—"}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>

                    <tfoot>
                      <tr className="border-t bg-slate-50">
                        <td
                          colSpan={
                            3
                          }
                          className="px-5 py-4 text-right font-bold text-slate-700"
                        >
                          Total
                        </td>

                        <td className="px-5 py-4 text-right font-bold text-red-600">
                          {money(
                            totalDebit
                          )}
                        </td>

                        <td className="px-5 py-4 text-right font-bold text-blue-600">
                          {money(
                            totalCredit
                          )}
                        </td>
                      </tr>

                      <tr>
                        <td
                          colSpan={
                            3
                          }
                          className="px-5 py-3 text-right font-semibold text-slate-600"
                        >
                          Difference
                        </td>

                        <td
                          colSpan={
                            2
                          }
                          className={`px-5 py-3 text-right font-bold ${
                            balanced
                              ? "text-emerald-600"
                              : "text-red-600"
                          }`}
                        >
                          {money(
                            difference
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* PRINT FOOTER */}

              <div className="print-only mt-8 border-t border-gray-300 pt-3 text-xs">
                <div className="flex justify-between">
                  <span>
                    Generated from SchoolFlow
                  </span>

                  <span>
                    Trial Balance
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
            Loading Trial Balance...
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