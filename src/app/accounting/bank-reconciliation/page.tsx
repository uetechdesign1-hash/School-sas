"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  CheckSquare,
  Square,
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

type BankRow = {
  id: string;
  date: string;
  description: string;
  type: string;
  moneyIn: number;
  moneyOut: number;
  checked: boolean;
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
 * Positive balance for the normal side:
 *   Debit-normal account  = debit - credit
 *   Credit-normal account = credit - debit
 */
function signedMovement(
  debit: number,
  credit: number,
  debitNormal: boolean,
) {
  return debitNormal ? debit - credit : credit - debit;
}

export default function BankReconciliationPage() {
  const supabase = createClient();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [entries, setEntries] = useState<TransactionEntry[]>([]);
  const [openingBalances, setOpeningBalances] = useState<OpeningBalance[]>([]);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState("");

  const [bankAccountId, setBankAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [statementClosing, setStatementClosing] = useState("");

  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [viewed, setViewed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const getCurrentSchoolId = useCallback(async () => {
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError) {
      throw new Error(userError.message);
    }

    if (!userData.user) {
      throw new Error("No logged-in user found.");
    }

    const { data: rpcSchoolId, error: rpcError } =
      await supabase.rpc("get_my_school_id");

    if (!rpcError && rpcSchoolId) {
      return String(rpcSchoolId);
    }

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

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const currentSchoolId = await getCurrentSchoolId();
      setSchoolId(currentSchoolId);

      const [
        schoolResult,
        accountsResult,
        transactionsResult,
        entriesResult,
        openingResult,
      ] = await Promise.all([
        supabase
          .from("schools")
          .select("id, name")
          .eq("id", currentSchoolId)
          .maybeSingle(),

        supabase
          .from("accounts")
          .select(
            "id, school_id, code, name, account_type, is_active",
          )
          .eq("school_id", currentSchoolId)
          .eq("is_active", true)
          .order("name", { ascending: true }),

        supabase
          .from("transactions")
          .select(
            "id, transaction_date, transaction_type, description, reference_type, reference_id, created_at",
          )
          .eq("school_id", currentSchoolId)
          .order("transaction_date", { ascending: true })
          .order("created_at", { ascending: true }),

        supabase
          .from("transaction_entries")
          .select(
            "id, school_id, transaction_id, account_id, debit, credit, description",
          )
          .eq("school_id", currentSchoolId),

        supabase
          .from("opening_balances")
          .select(
            "id, school_id, account_id, balance, as_of_date, notes, created_at",
          )
          .eq("school_id", currentSchoolId)
          .order("as_of_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      if (schoolResult.error) {
        throw new Error(schoolResult.error.message);
      }

      if (accountsResult.error) {
        throw new Error(
          `Unable to load accounts: ${accountsResult.error.message}`,
        );
      }

      if (transactionsResult.error) {
        throw new Error(
          `Unable to load transactions: ${transactionsResult.error.message}`,
        );
      }

      if (entriesResult.error) {
        throw new Error(
          `Unable to load transaction entries: ${entriesResult.error.message}`,
        );
      }

      if (openingResult.error) {
        throw new Error(
          `Unable to load opening balances: ${openingResult.error.message}`,
        );
      }

      setSchoolName(schoolResult.data?.name || "");
      setAccounts((accountsResult.data || []) as Account[]);
      setTransactions((transactionsResult.data || []) as Transaction[]);
      setEntries((entriesResult.data || []) as TransactionEntry[]);
      setOpeningBalances((openingResult.data || []) as OpeningBalance[]);

      const bankAccounts = (accountsResult.data || []).filter(
        (account: Account) =>
          account.is_active &&
          String(account.account_type).toLowerCase() === "bank",
      );

      if (
        !bankAccountId ||
        !bankAccounts.some((account) => account.id === bankAccountId)
      ) {
        setBankAccountId(bankAccounts[0]?.id || "");
      }
    } catch (err: any) {
      console.error("BANK RECONCILIATION LOAD ERROR:", err);
      setError(
        err?.message || "Unable to load Bank Reconciliation.",
      );
    } finally {
      setLoading(false);
    }
  }, [bankAccountId, getCurrentSchoolId, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const bankAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.is_active &&
          String(account.account_type).toLowerCase() === "bank",
      ),
    [accounts],
  );

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

  const selectedBank = accountMap.get(bankAccountId) || null;

  /**
   * FIX:
   * Opening balance comes from opening_balances, not from zero.
   *
   * For Main Bank in the user's current test:
   * Opening Balance = ₹10,000 Dr.
   */
  const openingBalance = useMemo(() => {
    if (!bankAccountId || !dateFrom) return 0;

    const saved = openingBalances
      .filter(
        (row) =>
          row.account_id === bankAccountId &&
          row.as_of_date <= dateFrom,
      )
      .sort((a, b) => {
        const dateCompare = b.as_of_date.localeCompare(
          a.as_of_date,
        );

        if (dateCompare !== 0) return dateCompare;

        return b.created_at.localeCompare(a.created_at);
      })[0];

    let balance = saved ? Number(saved.balance || 0) : 0;

    // Add bank transactions before the reconciliation period.
    entries
      .filter((entry) => entry.account_id === bankAccountId)
      .forEach((entry) => {
        const transaction = transactionMap.get(entry.transaction_id);

        if (!transaction) return;

        if (transaction.transaction_date >= dateFrom) return;

        balance +=
          Number(entry.debit || 0) -
          Number(entry.credit || 0);
      });

    return balance;
  }, [
    bankAccountId,
    dateFrom,
    entries,
    openingBalances,
    transactionMap,
  ]);

  const bankRows = useMemo<BankRow[]>(() => {
    if (!bankAccountId || !dateFrom || !dateTo) {
      return [];
    }

    return entries
      .filter((entry) => entry.account_id === bankAccountId)
      .map((entry) => {
        const transaction = transactionMap.get(entry.transaction_id);

        if (!transaction) return null;

        return {
          entry,
          transaction,
        };
      })
      .filter(
        (
          item,
        ): item is {
          entry: TransactionEntry;
          transaction: Transaction;
        } => Boolean(item),
      )
      .filter(({ transaction }) => {
        return (
          transaction.transaction_date >= dateFrom &&
          transaction.transaction_date <= dateTo
        );
      })
      .sort((a, b) => {
        const dateCompare =
          a.transaction.transaction_date.localeCompare(
            b.transaction.transaction_date,
          );

        if (dateCompare !== 0) return dateCompare;

        return a.transaction.created_at.localeCompare(
          b.transaction.created_at,
        );
      })
      .map(({ entry, transaction }) => ({
        id: entry.id,
        date: transaction.transaction_date,
        description:
          entry.description ||
          transaction.description ||
          "Bank transaction",
        type: transaction.transaction_type || "-",
        moneyIn: Number(entry.debit || 0),
        moneyOut: Number(entry.credit || 0),
        checked: checkedIds.includes(entry.id),
      }));
  }, [
    bankAccountId,
    checkedIds,
    dateFrom,
    dateTo,
    entries,
    transactionMap,
  ]);

  // Transactions already appearing on the bank statement.
  // Checked = cleared, so only unchecked rows remain in
  // Deposits in Transit / Outstanding Payments.
  const checkedRows = useMemo(
    () => bankRows.filter((row) => row.checked),
    [bankRows],
  );

  const moneyIn = useMemo(
    () =>
      bankRows.reduce(
        (sum, row) => sum + row.moneyIn,
        0,
      ),
    [bankRows],
  );

  const moneyOut = useMemo(
    () =>
      bankRows.reduce(
        (sum, row) => sum + row.moneyOut,
        0,
      ),
    [bankRows],
  );

  const bookClosing = openingBalance + moneyIn - moneyOut;

  /*
   * IMPORTANT:
   * A checked row means the transaction HAS appeared on the bank
   * statement (cleared/reconciled).
   *
   * Therefore only UNCHECKED book transactions are timing
   * differences:
   *   - Money In  -> Deposit in Transit
   *   - Money Out -> Outstanding Payment
   */
  const unclearedRows = useMemo(
    () => bankRows.filter((row) => !row.checked),
    [bankRows],
  );

  const depositInTransit = useMemo(
    () =>
      unclearedRows.reduce(
        (sum, row) => sum + row.moneyIn,
        0,
      ),
    [unclearedRows],
  );

  const outstandingPayments = useMemo(
    () =>
      unclearedRows.reduce(
        (sum, row) => sum + row.moneyOut,
        0,
      ),
    [unclearedRows],
  );

  const statementBalance =
    statementClosing === ""
      ? null
      : Number(statementClosing || 0);

  /**
   * Bank reconciliation formula:
   *
   * A checked transaction has already appeared on the bank statement,
   * so it must NOT be added/subtracted as a reconciliation adjustment.
   *
   * Only uncleared book transactions are timing differences:
   *
   * Adjusted statement balance
   * = statement closing
   * + deposits in transit
   * - outstanding payments
   *
   * Difference:
   * = adjusted statement balance - bank book closing
   */
  const adjustedStatementBalance =
    statementBalance === null
      ? null
      : statementBalance +
        depositInTransit -
        outstandingPayments;

  const difference =
    adjustedStatementBalance === null
      ? null
      : adjustedStatementBalance - bookClosing;

  const isReconciled =
    difference !== null &&
    Math.abs(difference) < 0.01;

  function toggleRow(id: string) {
    setCheckedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function selectAll() {
    setCheckedIds(bankRows.map((row) => row.id));
  }

  function clearChecks() {
    setCheckedIds([]);
  }

  function handleView() {
    setError("");

    if (!bankAccountId) {
      setError("Please select a bank account.");
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
    setDateFrom(firstDayOfMonth());
    setDateTo(today());
    setStatementClosing("");
    setCheckedIds([]);
    setViewed(false);
    setError("");
  }

  function handlePrint() {
    if (!viewed) {
      setError("Please click View before printing.");
      return;
    }

    window.print();
  }

  function handlePdf() {
    if (!viewed) {
      setError("Please click View before creating PDF.");
      return;
    }

    window.print();
  }

  function handleExcel() {
    if (!viewed || !selectedBank) {
      setError("Please click View before exporting.");
      return;
    }

    const rows = [
      {
        School: schoolName,
        "Bank Account": selectedBank.name,
        Code: selectedBank.code || "",
        "Date From": dateFrom,
        "Date To": dateTo,
      },
      {},
      {
        "Opening Balance": openingBalance,
        "Money In": moneyIn,
        "Money Out": moneyOut,
        "Bank Book Closing": bookClosing,
        "Statement Closing":
          statementBalance === null ? "" : statementBalance,
        "Deposit In Transit": depositInTransit,
        "Outstanding Payments": outstandingPayments,
        "Adjusted Statement Balance":
          adjustedStatementBalance === null
            ? ""
            : adjustedStatementBalance,
        Difference: difference === null ? "" : difference,
        Status: isReconciled ? "RECONCILED" : "PENDING",
      },
      {},
      {
        Date: "Date",
        Description: "Description",
        Type: "Type",
        "Money In": "Money In",
        "Money Out": "Money Out",
        Status: "Status",
      },
      ...bankRows.map((row) => ({
        Date: formatDate(row.date),
        Description: row.description,
        Type: row.type,
        "Money In": row.moneyIn,
        "Money Out": row.moneyOut,
        Status: row.checked ? "Cleared" : "Pending",
      })),
    ];

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      skipHeader: true,
    });

    worksheet["!cols"] = [
      { wch: 14 },
      { wch: 48 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
    ];

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Bank Reconciliation",
    );

    XLSX.writeFile(
      workbook,
      `bank-reconciliation-${safeFileName(
        selectedBank.name,
      )}-${dateFrom}-to-${dateTo}.xlsx`,
    );
  }

  return (
    <>
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm;
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

          .print-area {
            display: block !important;
            border: 0 !important;
            box-shadow: none !important;
            width: 100% !important;
          }

          table {
            width: 100% !important;
            border-collapse: collapse !important;
          }

          th,
          td {
            border: 1px solid #d1d5db !important;
            padding: 6px !important;
            font-size: 9px !important;
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
              className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600"
            >
              <ArrowLeft size={16} />
              Dashboard
            </Link>

            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                Accounting
              </p>

              <h1 className="mt-1 text-2xl font-bold text-slate-900">
                Bank Reconciliation
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Match the bank book with the actual bank statement.
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
            <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr_1fr_1.1fr_auto] xl:items-end">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Bank Account
                </label>

                <select
                  value={bankAccountId}
                  onChange={(e) => {
                    setBankAccountId(e.target.value);
                    setCheckedIds([]);
                    setViewed(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Select Bank Account</option>

                  {bankAccounts.map((account) => (
                    <option
                      key={account.id}
                      value={account.id}
                    >
                      {account.name}
                      {account.code
                        ? ` (${account.code})`
                        : ""}
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
                    setCheckedIds([]);
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
                    setCheckedIds([]);
                    setViewed(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Statement Closing Balance
                </label>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={statementClosing}
                  onChange={(e) => {
                    setStatementClosing(e.target.value);
                    setViewed(false);
                  }}
                  placeholder="Enter bank statement closing"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleView}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
                >
                  <Search size={16} />
                  View
                </button>

                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </section>

          {viewed && selectedBank && (
            <section className="print-area mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="print-only mb-5">
                <div className="text-center">
                  <h1 className="text-xl font-bold text-black">
                    {schoolName || "School"}
                  </h1>

                  <h2 className="mt-1 text-lg font-bold text-black">
                    BANK RECONCILIATION
                  </h2>

                  <p className="text-sm">
                    {selectedBank.name}
                    {selectedBank.code
                      ? ` (${selectedBank.code})`
                      : ""}
                  </p>

                  <p className="text-sm">
                    {formatDate(dateFrom)} to{" "}
                    {formatDate(dateTo)}
                  </p>
                </div>
              </div>

              <div className="no-print border-b px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Bank Reconciliation
                    </h2>

                    <p className="text-xs text-slate-500">
                      {selectedBank.name}
                      {selectedBank.code
                        ? ` • ${selectedBank.code}`
                        : ""}{" "}
                      • {formatDate(dateFrom)} to{" "}
                      {formatDate(dateTo)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handlePrint}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Printer size={16} />
                      Print
                    </button>

                    <button
                      type="button"
                      onClick={handlePdf}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download size={16} />
                      PDF
                    </button>

                    <button
                      type="button"
                      onClick={handleExcel}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <FileSpreadsheet size={16} />
                      Excel
                    </button>

                    <button
                      type="button"
                      onClick={loadData}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw size={15} />
                      Refresh
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 divide-x border-b bg-slate-50 md:grid-cols-5">
                <Summary
                  title="Opening Balance"
                  value={money(openingBalance)}
                />

                <Summary
                  title="Money In"
                  value={money(moneyIn)}
                />

                <Summary
                  title="Money Out"
                  value={money(moneyOut)}
                />

                <Summary
                  title="Bank Book Closing"
                  value={money(bookClosing)}
                />

                <Summary
                  title="Statement Closing"
                  value={
                    statementBalance === null
                      ? "—"
                      : money(statementBalance)
                  }
                />
              </div>

              <div className="border-b bg-white px-5 py-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Statement Balance Required
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      Tick transactions that have appeared on
                      the bank statement.
                    </p>
                  </div>

                  <span className="text-xs font-semibold text-slate-500">
                    {bankRows.length} transactions in period
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <InfoBox
                    title="Deposits in Transit"
                    value={money(depositInTransit)}
                    description="Book deposits not yet appearing on statement"
                  />

                  <InfoBox
                    title="Outstanding Payments"
                    value={money(outstandingPayments)}
                    description="Book payments not yet appearing on statement"
                  />

                  <InfoBox
                    title="Adjusted Statement Balance"
                    value={
                      adjustedStatementBalance === null
                        ? "Enter statement balance"
                        : money(adjustedStatementBalance)
                    }
                    description="Statement + deposits − outstanding"
                  />
                </div>

                <div
                  className={`mt-4 rounded-xl border px-4 py-3 ${
                    statementBalance === null
                      ? "border-amber-200 bg-amber-50"
                      : isReconciled
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-red-200 bg-red-50"
                  }`}
                >
                  {statementBalance === null ? (
                    <p className="text-sm font-semibold text-amber-700">
                      Enter the actual closing balance from the bank
                      statement.
                    </p>
                  ) : isReconciled ? (
                    <div className="flex items-center gap-2 text-emerald-700">
                      <Check size={18} />
                      <div>
                        <p className="font-bold">
                          RECONCILED
                        </p>
                        <p className="text-xs">
                          Difference: ₹0.00
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="font-bold text-red-700">
                        NOT RECONCILED
                      </p>

                      <p className="mt-1 text-xs text-red-600">
                        Difference: {money(difference || 0)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="no-print flex items-center justify-between border-b bg-slate-50 px-5 py-3">
                <div>
                  <h3 className="font-bold text-slate-900">
                    Bank Transactions
                  </h3>

                  <p className="text-xs text-slate-500">
                    Select transactions that match the bank
                    statement.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Select All
                  </button>

                  <button
                    type="button"
                    onClick={clearChecks}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Clear Checks
                  </button>
                </div>
              </div>

              {bankRows.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <p className="font-semibold text-slate-900">
                    No bank transactions found
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    There are no transactions for this bank and
                    date range.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="border-b bg-white">
                        <th className="w-14 px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-400">
                          ✓
                        </th>

                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Date
                        </th>

                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Description
                        </th>

                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                          Type
                        </th>

                        <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">
                          Money In
                        </th>

                        <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">
                          Money Out
                        </th>

                        <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-400">
                          Status
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y">
                      {bankRows.map((row) => (
                        <tr
                          key={row.id}
                          className={
                            row.checked
                              ? "bg-emerald-50/50"
                              : "hover:bg-slate-50"
                          }
                        >
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                toggleRow(row.id)
                              }
                              aria-label={
                                row.checked
                                  ? "Uncheck transaction"
                                  : "Check transaction"
                              }
                              className="inline-flex rounded-lg p-1 text-blue-600 hover:bg-blue-50"
                            >
                              {row.checked ? (
                                <CheckSquare size={19} />
                              ) : (
                                <Square size={19} />
                              )}
                            </button>
                          </td>

                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                            {formatDate(row.date)}
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">
                              {row.description}
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              {row.id.slice(0, 8)}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                              {row.type}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                            {row.moneyIn > 0
                              ? money(row.moneyIn)
                              : "—"}
                          </td>

                          <td className="px-4 py-3 text-right font-semibold text-red-600">
                            {row.moneyOut > 0
                              ? money(row.moneyOut)
                              : "—"}
                          </td>

                          <td className="px-4 py-3 text-center">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                row.checked
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {row.checked
                                ? "Cleared"
                                : "Pending"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>

                    <tfoot>
                      <tr className="border-t bg-slate-50">
                        <td
                          colSpan={4}
                          className="px-4 py-4 text-right text-sm font-bold text-slate-700"
                        >
                          Period Total
                        </td>

                        <td className="px-4 py-4 text-right font-bold text-emerald-600">
                          {money(moneyIn)}
                        </td>

                        <td className="px-4 py-4 text-right font-bold text-red-600">
                          {money(moneyOut)}
                        </td>

                        <td className="px-4 py-4 text-center font-bold text-slate-700">
                          {checkedRows.length}/{bankRows.length}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="print-only mt-5">
                <div className="grid grid-cols-4 border border-gray-300">
                  <PrintBox
                    title="Opening Balance"
                    value={money(openingBalance)}
                  />

                  <PrintBox
                    title="Bank Book Closing"
                    value={money(bookClosing)}
                  />

                  <PrintBox
                    title="Statement Closing"
                    value={
                      statementBalance === null
                        ? "Not entered"
                        : money(statementBalance)
                    }
                  />

                  <PrintBox
                    title="Difference"
                    value={
                      difference === null
                        ? "Not calculated"
                        : money(difference)
                    }
                    last
                  />
                </div>
              </div>
            </section>
          )}
        </div>

        {loading && (
          <div className="no-print fixed bottom-5 right-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-lg">
            <Loader2 size={16} className="animate-spin" />
            Loading Bank Reconciliation...
          </div>
        )}
      </main>
    </>
  );
}

function Summary({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="px-4 py-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {title}
      </p>

      <p className="mt-1 font-bold text-slate-900">
        {value}
      </p>
    </div>
  );
}

function InfoBox({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {title}
      </p>

      <p className="mt-1 font-bold text-slate-900">
        {value}
      </p>

      <p className="mt-1 text-xs text-slate-500">
        {description}
      </p>
    </div>
  );
}

function PrintBox({
  title,
  value,
  last = false,
}: {
  title: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={
        last
          ? "p-3"
          : "border-r border-gray-300 p-3"
      }
    >
      <p className="text-xs font-bold">{title}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}