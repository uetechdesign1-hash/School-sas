"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  transaction_type: string | null;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
};

type TransactionEntry = {
  id: string;
  school_id: string;
  transaction_id: string;
  account_id: string;
  debit: number | string | null;
  credit: number | string | null;
  description: string | null;
};

type OpeningBalance = {
  id: string;
  school_id: string;
  account_id: string;
  balance: number | string;
  as_of_date: string;
  notes: string | null;
  created_at: string;
};

type LedgerRow = {
  id: string;
  date: string;
  transactionId: string;
  transactionType: string;
  particulars: string;
  referenceType: string;
  debit: number;
  credit: number;
  balance: number;
  balanceType: "Dr" | "Cr";
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDate(value: string) {
  if (!value) return "-";

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function safeFileName(value: string) {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function getDebitNormal(accountType?: string) {
  const type = String(accountType || "").toLowerCase();

  return ["cash", "bank", "asset", "expense"].includes(type);
}

/**
 * Returns the signed value used by the ledger:
 * Debit-normal accounts: debit - credit
 * Credit-normal accounts: credit - debit
 */
function signedMovement(
  debit: number,
  credit: number,
  debitNormal: boolean,
) {
  return debitNormal ? debit - credit : credit - debit;
}

function formatBalance(value: number, accountType?: string) {
  const debitNormal = getDebitNormal(accountType);
  const amount = Math.abs(value);

  if (amount === 0) return "₹0.00";

  const side =
    value >= 0
      ? debitNormal
        ? "Dr"
        : "Cr"
      : debitNormal
        ? "Cr"
        : "Dr";

  return `${money(amount)} ${side}`;
}

export default function LedgerPage() {
  const supabase = createClient();

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState("");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [entries, setEntries] = useState<TransactionEntry[]>([]);
  const [openingBalances, setOpeningBalances] = useState<OpeningBalance[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [viewed, setViewed] = useState(false);

  const getCurrentSchoolId = useCallback(async () => {
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError) {
      throw new Error(userError.message);
    }

    if (!userData.user) {
      throw new Error("No logged-in user found.");
    }

    // Preferred: use the same shared RPC used by the rest of the accounting pages.
    const { data: rpcSchoolId, error: rpcError } =
      await supabase.rpc("get_my_school_id");

    if (!rpcError && rpcSchoolId) {
      return String(rpcSchoolId);
    }

    // Fallback: active school membership.
    const { data: membership, error: membershipError } = await supabase
      .from("school_users")
      .select("school_id, is_active, created_at")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    if (!membership?.school_id) {
      throw new Error("No active school found.");
    }

    return String(membership.school_id);
  }, [supabase]);

  const loadSchool = useCallback(
    async (currentSchoolId: string) => {
      const { data, error: schoolError } = await supabase
        .from("schools")
        .select("id, name")
        .eq("id", currentSchoolId)
        .maybeSingle();

      if (schoolError) {
        throw new Error(`Unable to load school: ${schoolError.message}`);
      }

      setSchoolName(data?.name || "");
    },
    [supabase],
  );

  const loadAccounts = useCallback(
    async (currentSchoolId: string) => {
      const { data, error: accountsError } = await supabase
        .from("accounts")
        .select(
          `
            id,
            school_id,
            code,
            name,
            account_type,
            is_active
          `,
        )
        .eq("school_id", currentSchoolId)
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (accountsError) {
        throw new Error(
          `Unable to load accounts: ${accountsError.message}`,
        );
      }

      setAccounts((data || []) as Account[]);

      // Keep the first active account selected after the initial load.
      if (!selectedAccountId && data?.length) {
        setSelectedAccountId(String(data[0].id));
      }
    },
    [selectedAccountId, supabase],
  );

  const loadTransactions = useCallback(
    async (currentSchoolId: string) => {
      const { data, error: transactionsError } = await supabase
        .from("transactions")
        .select(
          `
            id,
            transaction_date,
            transaction_type,
            description,
            reference_type,
            reference_id,
            created_at
          `,
        )
        .eq("school_id", currentSchoolId)
        .order("transaction_date", { ascending: true })
        .order("created_at", { ascending: true });

      if (transactionsError) {
        throw new Error(
          `Unable to load transactions: ${transactionsError.message}`,
        );
      }

      setTransactions((data || []) as Transaction[]);
    },
    [supabase],
  );

  const loadTransactionEntries = useCallback(
    async (currentSchoolId: string) => {
      const { data, error: entriesError } = await supabase
        .from("transaction_entries")
        .select(
          `
            id,
            school_id,
            transaction_id,
            account_id,
            debit,
            credit,
            description
          `,
        )
        .eq("school_id", currentSchoolId);

      if (entriesError) {
        throw new Error(
          `Unable to load transaction entries: ${entriesError.message}`,
        );
      }

      setEntries((data || []) as TransactionEntry[]);
    },
    [supabase],
  );

  /**
   * IMPORTANT FIX:
   * Ledger must read saved opening_balances.
   *
   * opening_balances schema:
   * id, school_id, account_id, balance, as_of_date, notes, created_at
   */
  const loadOpeningBalances = useCallback(
    async (currentSchoolId: string) => {
      const { data, error: openingError } = await supabase
        .from("opening_balances")
        .select(
          `
            id,
            school_id,
            account_id,
            balance,
            as_of_date,
            notes,
            created_at
          `,
        )
        .eq("school_id", currentSchoolId)
        .order("as_of_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (openingError) {
        throw new Error(
          `Unable to load opening balances: ${openingError.message}`,
        );
      }

      setOpeningBalances((data || []) as OpeningBalance[]);
    },
    [supabase],
  );

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const currentSchoolId = await getCurrentSchoolId();

      setSchoolId(currentSchoolId);

      await Promise.all([
        loadSchool(currentSchoolId),
        loadAccounts(currentSchoolId),
        loadTransactions(currentSchoolId),
        loadTransactionEntries(currentSchoolId),
        loadOpeningBalances(currentSchoolId),
      ]);
    } catch (err: any) {
      console.error("LEDGER ERROR:", err);
      setError(err?.message || "Unable to load Ledger.");
    } finally {
      setLoading(false);
    }
  }, [
    getCurrentSchoolId,
    loadAccounts,
    loadOpeningBalances,
    loadSchool,
    loadTransactionEntries,
    loadTransactions,
  ]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const accountMap = useMemo(() => {
    const map = new Map<string, Account>();

    accounts.forEach((account) => {
      map.set(account.id, account);
    });

    return map;
  }, [accounts]);

  const transactionMap = useMemo(() => {
    const map = new Map<string, Transaction>();

    transactions.forEach((transaction) => {
      map.set(transaction.id, transaction);
    });

    return map;
  }, [transactions]);

  const selectedAccount =
    accountMap.get(selectedAccountId) || null;

  /**
   * FIXED OPENING BALANCE CALCULATION
   *
   * For a selected account:
   *
   * saved opening balance
   * + transactions before Date From
   * = ledger opening balance
   *
   * The opening_balances table stores a positive amount.
   * Account type determines whether that positive amount is Dr or Cr.
   */
  const openingBalance = useMemo(() => {
    if (!selectedAccountId || !dateFrom) {
      return 0;
    }

    const account = accountMap.get(selectedAccountId);

    if (!account) {
      return 0;
    }

    const debitNormal = getDebitNormal(account.account_type);

    // Pick the newest saved opening balance whose effective date
    // is on or before the ledger period.
    const savedOpening = openingBalances
      .filter(
        (row) =>
          row.account_id === selectedAccountId &&
          row.as_of_date <= dateFrom,
      )
      .sort((a, b) => {
        const dateCompare = b.as_of_date.localeCompare(a.as_of_date);

        if (dateCompare !== 0) {
          return dateCompare;
        }

        return b.created_at.localeCompare(a.created_at);
      })[0];

    let balance = 0;

    if (savedOpening) {
      const amount = Number(savedOpening.balance || 0);

      // Stored amount is positive. The account type decides the normal side.
      balance += debitNormal ? amount : amount;
    }

    // Add all transaction activity before Date From.
    entries
      .filter((entry) => entry.account_id === selectedAccountId)
      .forEach((entry) => {
        const transaction = transactionMap.get(entry.transaction_id);

        if (!transaction) {
          return;
        }

        if (transaction.transaction_date >= dateFrom) {
          return;
        }

        const debit = Number(entry.debit || 0);
        const credit = Number(entry.credit || 0);

        balance += signedMovement(debit, credit, debitNormal);
      });

    return balance;
  }, [
    accountMap,
    dateFrom,
    entries,
    openingBalances,
    selectedAccountId,
    transactionMap,
  ]);

  const ledgerRows = useMemo<LedgerRow[]>(() => {
    if (!selectedAccountId || !dateFrom || !dateTo) {
      return [];
    }

    const debitNormal = getDebitNormal(selectedAccount?.account_type);

    const filtered = entries
      .filter((entry) => entry.account_id === selectedAccountId)
      .map((entry) => ({
        entry,
        transaction: transactionMap.get(entry.transaction_id),
      }))
      .filter((item) => Boolean(item.transaction))
      .filter((item) => {
        const date = item.transaction!.transaction_date;

        return date >= dateFrom && date <= dateTo;
      })
      .sort((a, b) => {
        const dateA = a.transaction!.transaction_date;
        const dateB = b.transaction!.transaction_date;

        if (dateA !== dateB) {
          return dateA.localeCompare(dateB);
        }

        return a.transaction!.created_at.localeCompare(
          b.transaction!.created_at,
        );
      });

    let runningBalance = openingBalance;

    return filtered.map(({ entry, transaction }) => {
      const debit = Number(entry.debit || 0);
      const credit = Number(entry.credit || 0);

      runningBalance += signedMovement(
        debit,
        credit,
        debitNormal,
      );

      const balanceType: "Dr" | "Cr" =
        runningBalance >= 0
          ? debitNormal
            ? "Dr"
            : "Cr"
          : debitNormal
            ? "Cr"
            : "Dr";

      return {
        id: entry.id,
        date: transaction!.transaction_date,
        transactionId: transaction!.id,
        transactionType: transaction!.transaction_type || "-",
        particulars:
          entry.description ||
          transaction!.description ||
          "-",
        referenceType:
          transaction!.reference_type || "-",
        debit,
        credit,
        balance: Math.abs(runningBalance),
        balanceType,
      };
    });
  }, [
    dateFrom,
    dateTo,
    entries,
    openingBalance,
    selectedAccount,
    selectedAccountId,
    transactionMap,
  ]);

  const totalDebit = useMemo(
    () =>
      ledgerRows.reduce(
        (sum, row) => sum + row.debit,
        0,
      ),
    [ledgerRows],
  );

  const totalCredit = useMemo(
    () =>
      ledgerRows.reduce(
        (sum, row) => sum + row.credit,
        0,
      ),
    [ledgerRows],
  );

  const closingBalance =
    ledgerRows.length > 0
      ? ledgerRows[ledgerRows.length - 1]
      : null;

  function handleView() {
    setError("");

    if (!selectedAccountId) {
      setError("Please select an account.");
      return;
    }

    if (!dateFrom || !dateTo) {
      setError("Please select Date From and Date To.");
      return;
    }

    if (dateFrom > dateTo) {
      setError("Date From cannot be after Date To.");
      return;
    }

    setViewed(true);
  }

  function handleClear() {
    setSelectedAccountId("");
    setDateFrom(firstDayOfMonth());
    setDateTo(today());
    setViewed(false);
    setError("");
  }

  function handlePrint() {
    if (!selectedAccount || !viewed) {
      setError("Please view a ledger before printing.");
      return;
    }

    window.print();
  }

  function handlePdf() {
    if (!selectedAccount || !viewed) {
      setError("Please view a ledger before creating PDF.");
      return;
    }

    window.print();
  }

  function handleExcel() {
    if (!selectedAccount || !viewed) {
      setError("Please view a ledger before exporting.");
      return;
    }

    const rows = [
      {
        "School Name": schoolName,
        Account: selectedAccount.name,
        "Account Code": selectedAccount.code || "",
        Period: `${formatDate(dateFrom)} - ${formatDate(dateTo)}`,
      },
      {},
      {
        "Opening Balance": formatBalance(
          openingBalance,
          selectedAccount.account_type,
        ),
      },
      {},
      {
        Date: "Date",
        Particulars: "Particulars",
        Type: "Type",
        Debit: "Debit",
        Credit: "Credit",
        "Running Balance": "Running Balance",
      },
      ...ledgerRows.map((row) => ({
        Date: formatDate(row.date),
        Particulars: row.particulars,
        Type: row.transactionType,
        Debit: row.debit,
        Credit: row.credit,
        "Running Balance":
          `${row.balance.toFixed(2)} ${row.balanceType}`,
      })),
      {},
      {
        Particulars: "Total",
        Debit: totalDebit,
        Credit: totalCredit,
      },
      {},
      {
        Particulars: "Closing Balance",
        "Running Balance": closingBalance
          ? `${closingBalance.balance.toFixed(2)} ${closingBalance.balanceType}`
          : formatBalance(
              openingBalance,
              selectedAccount.account_type,
            ),
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      skipHeader: true,
    });

    worksheet["!cols"] = [
      { wch: 14 },
      { wch: 42 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
    ];

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Ledger",
    );

    const accountName = safeFileName(selectedAccount.name);

    XLSX.writeFile(
      workbook,
      `ledger-${accountName}-${dateFrom}-to-${dateTo}.xlsx`,
    );
  }

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

          .ledger-print-area {
            display: block !important;
            width: 100% !important;
            border: 0 !important;
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

          thead {
            display: table-header-group;
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
        <header className="no-print border-b bg-white">
          <div className="mx-auto max-w-7xl px-5 py-5">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-blue-600"
            >
              <ArrowLeft size={16} />
              Dashboard
            </Link>

            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                Accounting
              </p>

              <h1 className="mt-1 text-2xl font-bold text-slate-900">
                Ledger
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Account-wise transaction history and running balance.
              </p>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-5">
          {error && (
            <div className="no-print mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <section className="no-print rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Account
                </label>

                <select
                  value={selectedAccountId}
                  onChange={(e) => {
                    setSelectedAccountId(e.target.value);
                    setViewed(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Select Account</option>

                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.code ? ` (${account.code})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Date From
                </label>

                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
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
                    setDateTo(e.target.value);
                    setViewed(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleView}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
                >
                  <Search size={16} />
                  View
                </button>

                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </section>

          {viewed && (
            <section className="ledger-print-area mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="print-only mb-5">
                <div className="text-center">
                  <h1 className="text-xl font-bold text-black">
                    {schoolName || "School"}
                  </h1>

                  <h2 className="mt-1 text-lg font-bold text-black">
                    LEDGER
                  </h2>

                  <p className="mt-1 text-sm text-black">
                    Account: {selectedAccount?.name}
                    {selectedAccount?.code
                      ? ` (${selectedAccount.code})`
                      : ""}
                  </p>

                  <p className="text-sm text-black">
                    Period: {formatDate(dateFrom)} to{" "}
                    {formatDate(dateTo)}
                  </p>
                </div>
              </div>

              <div className="no-print border-b px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {selectedAccount?.name}
                    </h2>

                    <p className="text-xs text-slate-500">
                      {selectedAccount?.account_type} •{" "}
                      {formatDate(dateFrom)} to{" "}
                      {formatDate(dateTo)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handlePrint}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Printer size={16} />
                      Print
                    </button>

                    <button
                      type="button"
                      onClick={handlePdf}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download size={16} />
                      PDF
                    </button>

                    <button
                      type="button"
                      onClick={handleExcel}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <FileSpreadsheet size={16} />
                      Excel
                    </button>

                    <button
                      type="button"
                      onClick={loadPage}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw size={15} />
                      Refresh
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 divide-x border-b bg-slate-50 sm:grid-cols-4">
                <BalanceBox
                  title="Opening Balance"
                  value={formatBalance(
                    openingBalance,
                    selectedAccount?.account_type,
                  )}
                />

                <BalanceBox
                  title="Total Debit"
                  value={money(totalDebit)}
                />

                <BalanceBox
                  title="Total Credit"
                  value={money(totalCredit)}
                />

                <BalanceBox
                  title="Closing Balance"
                  value={
                    closingBalance
                      ? `${money(closingBalance.balance)} ${closingBalance.balanceType}`
                      : formatBalance(
                          openingBalance,
                          selectedAccount?.account_type,
                        )
                  }
                />
              </div>

              <div className="print-only mt-4">
                <div className="grid grid-cols-4 border border-gray-300">
                  <PrintSummary
                    title="Opening Balance"
                    value={formatBalance(
                      openingBalance,
                      selectedAccount?.account_type,
                    )}
                  />
                  <PrintSummary
                    title="Total Debit"
                    value={money(totalDebit)}
                  />
                  <PrintSummary
                    title="Total Credit"
                    value={money(totalCredit)}
                  />
                  <PrintSummary
                    title="Closing Balance"
                    value={
                      closingBalance
                        ? `${money(closingBalance.balance)} ${closingBalance.balanceType}`
                        : formatBalance(
                            openingBalance,
                            selectedAccount?.account_type,
                          )
                    }
                    last
                  />
                </div>
              </div>

              {ledgerRows.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <p className="font-semibold text-slate-900">
                    No entries found
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    No transactions were found for this account and period.
                  </p>

                  <p className="mt-2 text-xs text-slate-400">
                    Opening balance:{" "}
                    {formatBalance(
                      openingBalance,
                      selectedAccount?.account_type,
                    )}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="border-b bg-white">
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Date
                        </th>
                        <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Particulars
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
                        <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">
                          Running Balance
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y">
                      {ledgerRows.map((row) => (
                        <tr
                          key={row.id}
                          className="transition hover:bg-slate-50"
                        >
                          <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                            {formatDate(row.date)}
                          </td>

                          <td className="px-5 py-4">
                            <div className="font-medium text-slate-900">
                              {row.particulars}
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              {row.transactionId.slice(0, 8)}
                            </div>
                          </td>

                          <td className="px-5 py-4">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                              {row.transactionType}
                            </span>
                          </td>

                          <td className="px-5 py-4 text-right font-semibold text-red-600">
                            {row.debit > 0 ? money(row.debit) : "—"}
                          </td>

                          <td className="px-5 py-4 text-right font-semibold text-blue-600">
                            {row.credit > 0 ? money(row.credit) : "—"}
                          </td>

                          <td className="px-5 py-4 text-right font-bold text-slate-900">
                            {money(row.balance)}{" "}
                            <span className="text-xs text-slate-400">
                              {row.balanceType}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>

                    <tfoot>
                      <tr className="border-t bg-slate-50">
                        <td
                          colSpan={3}
                          className="px-5 py-4 text-right text-sm font-bold text-slate-700"
                        >
                          Total
                        </td>

                        <td className="px-5 py-4 text-right font-bold text-red-600">
                          {money(totalDebit)}
                        </td>

                        <td className="px-5 py-4 text-right font-bold text-blue-600">
                          {money(totalCredit)}
                        </td>

                        <td className="px-5 py-4 text-right font-bold text-emerald-600">
                          {closingBalance
                            ? `${money(closingBalance.balance)} ${closingBalance.balanceType}`
                            : formatBalance(
                                openingBalance,
                                selectedAccount?.account_type,
                              )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="print-only mt-8">
                <div className="flex justify-between border-t border-gray-300 pt-3 text-xs">
                  <span>Generated from SchoolFlow</span>
                  <span>Page 1</span>
                </div>
              </div>
            </section>
          )}
        </div>

        {loading && (
          <div className="no-print fixed bottom-5 right-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-lg">
            <Loader2 size={16} className="animate-spin" />
            Loading Ledger...
          </div>
        )}
      </main>
    </>
  );
}

function BalanceBox({
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

function PrintSummary({
  title,
  value,
  last = false,
}: {
  title: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div className={last ? "p-2" : "border-r border-gray-300 p-2"}>
      <p className="text-xs font-bold">{title}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}