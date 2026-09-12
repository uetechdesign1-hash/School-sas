"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentSchoolId } from "@/lib/supabase/current-school";

const supabase = createClient();

type BookType = "cash" | "bank";

type AccountOption = {
id: string;
name: string;
code: string | null;
account_type: BookType;
is_active: boolean;
};

type BookRow = {
journal_entry_id: string;
school_id: string;
entry_id: string;
entry_date: string;
entry_type: string;
reference_type: string | null;
reference_id: string | null;
entry_description: string | null;
journal_line_id: string;
account_id: string;
account_code: string;
account_name: string;
debit: number;
credit: number;
cash_in?: number;
cash_out?: number;
bank_in?: number;
bank_out?: number;
line_description: string | null;
created_at: string;
};

type Summary = {
opening_balance: number;
cash_in?: number;
cash_out?: number;
bank_in?: number;
bank_out?: number;
closing_balance: number;
};

function money(value: number) {
return new Intl.NumberFormat("en-IN", {
style: "currency",
currency: "INR",
maximumFractionDigits: 2,
}).format(value || 0);
}

function dateFormat(value: string) {
if (!value) return "-";

return new Date(value).toLocaleDateString("en-IN", {
day: "2-digit",
month: "short",
year: "numeric",
});
}

function getToday() {
return new Date().toISOString().split("T")[0];
}

function getMonthStart() {
const d = new Date();

d.setDate(1);

return d.toISOString().split("T")[0];
}

export default function CashBankClient() {
const [book, setBook] = useState<BookType>("cash");

const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
const [selectedAccountId, setSelectedAccountId] = useState("");

const [fromDate, setFromDate] = useState(getMonthStart());

const [toDate, setToDate] = useState(getToday());

const [search, setSearch] = useState("");

const [rows, setRows] = useState<BookRow[]>([]);

const [summary, setSummary] = useState<Summary | null>(null);

const [loading, setLoading] = useState(true);

const [error, setError] = useState("");

async function loadBook() {
try {
setLoading(true);
setError("");

const schoolId = await getCurrentSchoolId();

    const { data: accountData, error: accountError } = await supabase
      .from("accounts")
      .select("id, name, code, account_type, is_active")
      .eq("school_id", schoolId)
      .eq("account_type", book)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (accountError) throw accountError;

    const loadedAccounts = (accountData || []) as AccountOption[];
    setAccountOptions(loadedAccounts);

    if (
      selectedAccountId &&
      !loadedAccounts.some((account) => account.id === selectedAccountId)
    ) {
      setSelectedAccountId("");
    }

  if (!fromDate || !toDate) {
    setError("Please select both From Date and To Date.");
    setRows([]);
    setSummary(null);
    return;
  }

  if (fromDate > toDate) {
    setError("From Date cannot be later than To Date.");
    setRows([]);
    setSummary(null);
    return;
  }

  const view = book === "cash" ? "cash_book" : "bank_book";

  const rpc =
    book === "cash"
      ? "get_cash_book_summary"
      : "get_bank_book_summary";

  const { data, error: viewError } = await supabase
    .from(view)
    .select("*")
    .eq("school_id", schoolId)
    .gte("entry_date", fromDate)
    .lte("entry_date", toDate)
    .order("entry_date", {
      ascending: true,
    })
    .order("created_at", {
      ascending: true,
    });

  if (viewError) {
    throw viewError;
  }

  const {
    data: summaryResult,
    error: rpcError,
  } = await supabase.rpc(rpc, {
    p_from_date: fromDate,
    p_to_date: toDate,
  });

  if (rpcError) {
    throw rpcError;
  }

  let loadedRows = (data || []) as BookRow[];

    const referenceIds = Array.from(
      new Set(
        loadedRows
          .map((row) => row.reference_id)
          .filter(Boolean) as string[],
      ),
    );

    if (referenceIds.length > 0) {
      const { data: paymentData, error: paymentError } = await supabase
        .from("fee_payments")
        .select("id, receipt_number, student_id")
        .eq("school_id", schoolId)
        .in("id", referenceIds);

      if (paymentError) throw paymentError;

      const paymentMap = new Map(
        (paymentData || []).map((payment: any) => [
          payment.id as string,
          {
            receiptNumber: payment.receipt_number as string | null,
            studentId: payment.student_id as string | null,
          },
        ]),
      );

      const studentIds = Array.from(
        new Set(
          (paymentData || [])
            .map((payment: any) => payment.student_id)
            .filter(Boolean) as string[],
        ),
      );

      const studentMap = new Map<
        string,
        { name: string; classId: string | null }
      >();

      if (studentIds.length > 0) {
        const { data: studentData, error: studentError } = await supabase
          .from("students")
          .select("id, first_name, middle_name, last_name, class_id")
          .eq("school_id", schoolId)
          .in("id", studentIds);

        if (studentError) throw studentError;

        for (const student of studentData || []) {
          const name = [
            student.first_name,
            student.middle_name,
            student.last_name,
          ]
            .filter(Boolean)
            .join(" ")
            .trim();

          studentMap.set(student.id, {
            name: name || "Student",
            classId: student.class_id || null,
          });
        }
      }

      const classIds = Array.from(
        new Set(
          Array.from(studentMap.values())
            .map((student) => student.classId)
            .filter(Boolean) as string[],
        ),
      );

      const classMap = new Map<string, string>();

      if (classIds.length > 0) {
        const { data: classData, error: classError } = await supabase
          .from("classes")
          .select("id, name")
          .eq("school_id", schoolId)
          .in("id", classIds);

        if (classError) throw classError;

        for (const item of classData || []) {
          classMap.set(item.id, item.name);
        }
      }

      loadedRows = loadedRows.map((row) => {
        const payment = row.reference_id
          ? paymentMap.get(row.reference_id)
          : undefined;

        const student = payment?.studentId
          ? studentMap.get(payment.studentId)
          : undefined;

        const className = student?.classId
          ? classMap.get(student.classId) || ""
          : "";

        return {
          ...row,
          receipt_number: payment?.receiptNumber || null,
          student_name: student?.name || null,
          class_name: className || null,
          particulars_display:
            student?.name && className
              ? `${student.name} • ${className}`
              : student?.name || null,
        };
      });
    }

    setRows(loadedRows);

  const rawSummary = Array.isArray(summaryResult)
    ? summaryResult[0]
    : summaryResult;

  let openingBalance = Number(
    rawSummary?.opening_balance ?? 0
  );

  // When a specific Cash/Bank account is selected, calculate that
  // account's opening balance independently so switching accounts
  // also switches the balance figures correctly.
  if (selectedAccountId) {
    const { data: openingRows, error: openingError } = await supabase
      .from(view)
      .select("cash_in, cash_out, bank_in, bank_out, debit, credit")
      .eq("school_id", schoolId)
      .eq("account_id", selectedAccountId)
      .lt("entry_date", fromDate);

    if (openingError) throw openingError;

    openingBalance = (openingRows || []).reduce((sum: number, row: any) => {
      const incoming =
        book === "cash"
          ? Number(row.cash_in ?? row.debit ?? 0)
          : Number(row.bank_in ?? row.debit ?? 0);
      const outgoing =
        book === "cash"
          ? Number(row.cash_out ?? row.credit ?? 0)
          : Number(row.bank_out ?? row.credit ?? 0);

      return sum + incoming - outgoing;
    }, 0);
  }

  const cashIn = Number(
    rawSummary?.cash_in ?? 0
  );

  const cashOut = Number(
    rawSummary?.cash_out ?? 0
  );

  const bankIn = Number(
    rawSummary?.bank_in ?? 0
  );

  const bankOut = Number(
    rawSummary?.bank_out ?? 0
  );

  const closingBalance =
    rawSummary?.closing_balance !== undefined &&
    rawSummary?.closing_balance !== null
      ? Number(rawSummary.closing_balance)
      : openingBalance +
        (book === "cash" ? cashIn : bankIn) -
        (book === "cash" ? cashOut : bankOut);

  setSummary({
    opening_balance: openingBalance,
    cash_in: cashIn,
    cash_out: cashOut,
    bank_in: bankIn,
    bank_out: bankOut,
    closing_balance: closingBalance,
  });
} catch (err: any) {
  console.error("Cash/Bank Book Error:", err);

  setError(
    err?.message ||
      "Unable to load accounting data."
  );

  setRows([]);
  setSummary(null);
} finally {
  setLoading(false);
}
}

useEffect(() => {
const requestedBook = new URLSearchParams(
  window.location.search,
).get("book");

if (requestedBook === "cash" || requestedBook === "bank") {
  const timer = window.setTimeout(
    () => setBook(requestedBook),
    0,
  );

  return () => window.clearTimeout(timer);
}
}, []);

useEffect(() => {
loadBook();
}, [book, fromDate, toDate, selectedAccountId]);

const filteredRows = useMemo(() => {
const q = search.trim().toLowerCase();

if (!q) {
  return rows;
}

return rows.filter((row) => {
  if (selectedAccountId && row.account_id !== selectedAccountId) {
    return false;
  }

  return (
    row.entry_id
      ?.toLowerCase()
      .includes(q) ||
    row.entry_description
      ?.toLowerCase()
      .includes(q) ||
    row.line_description
      ?.toLowerCase()
      .includes(q) ||
    row.account_name
      ?.toLowerCase()
      .includes(q) ||
    row.reference_type
      ?.toLowerCase()
      .includes(q) ||
    row.receipt_number
      ?.toLowerCase()
      .includes(q) ||
    row.student_name
      ?.toLowerCase()
      .includes(q) ||
    row.class_name
      ?.toLowerCase()
      .includes(q)
  );
});
}, [rows, search, selectedAccountId]);

/*

* IMPORTANT:
* Totals are calculated from ALL transactions.
* Search only filters what is displayed.
  */

const totalIn = filteredRows.reduce((sum, row) => {
const amount =
book === "cash"
? Number(row.cash_in ?? row.debit ?? 0)
: Number(row.bank_in ?? row.debit ?? 0);

return sum + amount;

}, 0);

const totalOut = filteredRows.reduce((sum, row) => {
const amount =
book === "cash"
? Number(row.cash_out ?? row.credit ?? 0)
: Number(row.bank_out ?? row.credit ?? 0);

return sum + amount;

}, 0);

const calculatedClosing =
Number(summary?.opening_balance || 0) +
totalIn -
totalOut;

function exportCSV() {
if (!filteredRows.length) {
return;
}

const header = [
  "Date",
  "Entry ID",
  "Particulars",
  "Reference",
  "Money In",
  "Money Out",
];

const data = filteredRows.map((row) => {
  const moneyIn =
    book === "cash"
      ? Number(row.cash_in || 0)
      : Number(row.bank_in || 0);

  const moneyOut =
    book === "cash"
      ? Number(row.cash_out || 0)
      : Number(row.bank_out || 0);

  return [
    row.entry_date,
    row.entry_id,
    row.receipt_number || "",
    row.line_description ||
      row.entry_description ||
      "",
    row.reference_type || "",
    moneyIn.toFixed(2),
    moneyOut.toFixed(2),
  ];
});

const csv = [header, ...data]
  .map((row) =>
    row
      .map((value) => {
        const escaped = String(value).replace(
          /"/g,
          '""'
        );

        return `"${escaped}"`;
      })
      .join(",")
  )
  .join("\n");

const blob = new Blob([csv], {
  type: "text/csv;charset=utf-8;",
});

const url = URL.createObjectURL(blob);

const a = document.createElement("a");

a.href = url;

a.download =
  book +
  "-book-" +
  fromDate +
  "-" +
  toDate +
  ".csv";

document.body.appendChild(a);

a.click();

document.body.removeChild(a);

URL.revokeObjectURL(url);
}

function printPage() {
window.print();
}

const title =
book === "cash"
? "Cash Book"
: "Bank Book";

return ( <main className="min-h-screen bg-slate-50">
  {/* HEADER */}

  <div className="border-b bg-white">

    <div className="mx-auto max-w-7xl px-6 py-6">

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

        <div>

          <div className="text-sm font-semibold text-blue-600">
            Accounting
          </div>

          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            {title}
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Simple accounting for school owners.
          </p>

        </div>

        <div className="flex gap-2">

          <button
            onClick={printPage}
            className="rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Print
          </button>

          <button
            onClick={exportCSV}
            disabled={!filteredRows.length}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>

        </div>

      </div>

    </div>

  </div>

  <div className="mx-auto max-w-7xl px-6 py-6">

    {/* SWITCHER */}

    <div className="mb-6 inline-flex rounded-xl border bg-white p-1">

      <button
        onClick={() => setBook("cash")}
        className={
          "rounded-lg px-5 py-2.5 text-sm font-semibold transition " +
          (book === "cash"
            ? "bg-blue-600 text-white"
            : "text-slate-600 hover:bg-slate-100")
        }
      >
        Cash Book
      </button>

      <button
        onClick={() => setBook("bank")}
        className={
          "rounded-lg px-5 py-2.5 text-sm font-semibold transition " +
          (book === "bank"
            ? "bg-blue-600 text-white"
            : "text-slate-600 hover:bg-slate-100")
        }
      >
        Bank Book
      </button>

    </div>

    {/* FILTERS */}

    <section className="mb-6 rounded-2xl border bg-white p-5">

      <div className="grid gap-4 md:grid-cols-4">

        <div>

          <label className="mb-1 block text-sm font-medium text-slate-700">
            From Date
          </label>

          <input
            type="date"
            value={fromDate}
            onChange={(e) =>
              setFromDate(e.target.value)
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />

        </div>

        <div>

          <label className="mb-1 block text-sm font-medium text-slate-700">
            To Date
          </label>

          <input
            type="date"
            value={toDate}
            onChange={(e) =>
              setToDate(e.target.value)
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />

        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            {book === "cash" ? "Cash Account" : "Bank Account"}
          </label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">
              All {book === "cash" ? "Cash" : "Bank"} Accounts
            </option>
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}{account.code ? ` (${account.code})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>

          <label className="mb-1 block text-sm font-medium text-slate-700">
            Search
          </label>

          <input
            type="text"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Search transaction..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />

        </div>

      </div>

    </section>

    {/* SUMMARY */}

    <div className="mb-6 grid gap-4 md:grid-cols-4">

      <Card
        title="Opening Balance"
        value={
          Number(
            summary?.opening_balance || 0
          )
        }
      />

      <Card
        title={
          book === "cash"
            ? "Cash In"
            : "Bank In"
        }
        value={totalIn}
        positive
      />

      <Card
        title={
          book === "cash"
            ? "Cash Out"
            : "Bank Out"
        }
        value={totalOut}
        negative
      />

      <Card
        title="Closing Balance"
        value={calculatedClosing}
        blue
      />

    </div>

    {/* ERROR */}

    {error && (

      <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">

        <div className="font-semibold">
          Unable to load accounting data
        </div>

        <div className="mt-1">
          {error}
        </div>

      </div>

    )}

    {/* RECONCILIATION */}

    <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">

      <span className="font-semibold">
        Balance check:
      </span>{" "}

      {money(
        Number(
          summary?.opening_balance || 0
        )
      )}{" "}

      opening +{" "}

      {money(totalIn)}{" "}

      in −{" "}

      {money(totalOut)}{" "}

      out ={" "}

      <span className="font-bold text-blue-700">
        {money(calculatedClosing)}
      </span>
      .

      {summary &&
      Number(summary.closing_balance || 0) !==
        calculatedClosing ? (
        <span className="ml-2 text-red-600">
          Summary RPC differs from the transaction total.
        </span>
      ) : null}

    </div>

    {/* TABLE */}

    <section className="overflow-hidden rounded-2xl border bg-white">

      <div className="flex items-center justify-between border-b px-5 py-4">

        <div>

          <h2 className="font-semibold text-slate-900">
            Transactions
          </h2>

          <p className="text-xs text-slate-500">
            {filteredRows.length} entries
          </p>

        </div>

        <button
          onClick={loadBook}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>

      </div>

      {loading ? (

        <div className="p-12 text-center">

          <div className="text-sm text-slate-500">
            Loading accounting data...
          </div>

        </div>

      ) : filteredRows.length === 0 ? (

        <div className="p-12 text-center">

          <h3 className="font-semibold text-slate-900">
            No transactions
          </h3>

          <p className="mt-1 text-sm text-slate-500">
            Accounting entries will appear here automatically.
          </p>

        </div>

      ) : (

        <div className="overflow-x-auto">

          <table className="w-full min-w-[900px]">

            <thead className="bg-slate-50">

              <tr>

                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                  Date
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                  Entry
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                  Receipt No.
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">
                  Particulars
                </th>

                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                  In
                </th>

                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                  Out
                </th>

                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                  Balance
                </th>

              </tr>

            </thead>

            <tbody className="divide-y">

              {filteredRows.map(
                (row) => {

                  const inAmount =
                    book === "cash"
                      ? Number(
                          row.cash_in || 0
                        )
                      : Number(
                          row.bank_in || 0
                        );

                  const outAmount =
                    book === "cash"
                      ? Number(
                          row.cash_out || 0
                        )
                      : Number(
                          row.bank_out || 0
                        );

                  /*
                   * Find the position of this row
                   * in the complete transaction list.
                   *
                   * This prevents search from changing
                   * the running balance.
                   */

                  const rowIndex =
                    rows.findIndex(
                      (r) =>
                        r.journal_line_id ===
                        row.journal_line_id
                    );

                  const previous =
                    Number(
                      summary?.opening_balance ||
                        0
                    ) +
                    rows
                      .filter((r) => !selectedAccountId || r.account_id === selectedAccountId)
                      .slice(
                        0,
                        Math.max(rowIndex, 0)
                      )
                      .reduce(
                        (
                          total,
                          previousRow
                        ) => {

                          const previousIn =
                            book === "cash"
                              ? Number(
                                  previousRow.cash_in ||
                                    0
                                )
                              : Number(
                                  previousRow.bank_in ||
                                    0
                                );

                          const previousOut =
                            book === "cash"
                              ? Number(
                                  previousRow.cash_out ||
                                    0
                                )
                              : Number(
                                  previousRow.bank_out ||
                                    0
                                );

                          return (
                            total +
                            previousIn -
                            previousOut
                          );
                        },
                        0
                      );

                  const balance =
                    previous +
                    inAmount -
                    outAmount;

                  return (

                    <tr
                      key={
                        row.journal_line_id
                      }
                      className="hover:bg-slate-50"
                    >

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {dateFormat(
                          row.entry_date
                        )}
                      </td>

                      <td className="px-5 py-4">

                        <span className="font-mono text-xs text-slate-500">
                          {row.entry_id
                            ? row.entry_id.slice(
                                0,
                                8
                              )
                            : "-"}
                        </span>

                      </td>

                      <td className="px-5 py-4">
                        <span className="font-mono text-xs font-semibold text-blue-700">
                          {row.receipt_number || "-"}
                        </span>
                      </td>

                      <td className="px-5 py-4">

                        <div className="font-medium text-slate-900">

                          {row.particulars_display ||
                            row.line_description ||
                            row.entry_description ||
                            "Accounting Entry"}

                        </div>

                        <div className="mt-1 text-xs text-slate-500">

                          {row.receipt_number
                            ? `Receipt No. ${row.receipt_number}`
                            : row.reference_type ||
                              row.entry_type ||
                              "-"}

                        </div>

                      </td>

                      <td className="px-5 py-4 text-right font-semibold text-emerald-600">

                        {inAmount
                          ? money(
                              inAmount
                            )
                          : "-"}

                      </td>

                      <td className="px-5 py-4 text-right font-semibold text-red-600">

                        {outAmount
                          ? money(
                              outAmount
                            )
                          : "-"}

                      </td>

                      <td className="px-5 py-4 text-right font-bold text-slate-900">

                        {money(balance)}

                      </td>

                    </tr>

                  );
                }
              )}

            </tbody>

            <tfoot className="bg-slate-50">

              <tr>

                <td
                  colSpan={3}
                  className="px-5 py-4 font-semibold"
                >
                  Period Total
                </td>

                <td className="px-5 py-4 text-right font-bold text-emerald-600">
                  {money(totalIn)}
                </td>

                <td className="px-5 py-4 text-right font-bold text-red-600">
                  {money(totalOut)}
                </td>

                <td className="px-5 py-4 text-right font-bold">
                  {money(calculatedClosing)}
                </td>

              </tr>

            </tfoot>

          </table>

        </div>

      )}

    </section>

  </div>

  {/* PRINT FOOTER */}

  <div className="mx-auto max-w-7xl px-6 pb-8 print:block">

    <div className="flex justify-end">

      <button
        onClick={printPage}
        className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Print Report
      </button>

    </div>

  </div>

</main>

);
}

function Card({
title,
value,
blue = false,
positive = false,
negative = false,
}: {
title: string;
value: number;
blue?: boolean;
positive?: boolean;
negative?: boolean;
}) {
let valueClass = "text-slate-900";

if (blue) {
valueClass = "text-blue-600";
} else if (positive) {
valueClass = "text-emerald-600";
} else if (negative) {
valueClass = "text-red-600";
}

return (
<div
  className={
    "rounded-2xl border bg-white p-5 " +
    (blue ? "border-blue-200" : "")
  }
>

  <p className="text-sm text-slate-500">
    {title}
  </p>

  <p
    className={
      "mt-2 text-2xl font-bold " +
      valueClass
    }
  >
    {money(value)}
  </p>

</div>

);
}

/*
Your structure can remain simply:

```text
src
└── app
    └── accounting
        └── cash-bank
            ├── page.tsx
            └── cash-bank-client.tsx
```

After replacing the file, stop and restart Next.js:

```powershell
Ctrl + C
npm run dev
```

The specific error:

```text
Module not found: Can't resolve '../../accounting-export'
```

will be removed because the missing import has been removed.
*/
