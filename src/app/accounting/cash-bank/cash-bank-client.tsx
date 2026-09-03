"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type BookType = "cash" | "bank";

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

  return new Date(value).toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
}

function getToday() {
  return new Date()
    .toISOString()
    .split("T")[0];
}

function getMonthStart() {
  const d = new Date();

  d.setDate(1);

  return d
    .toISOString()
    .split("T")[0];
}

export default function CashBankClient() {
  const [book, setBook] =
    useState<BookType>("cash");

  const [fromDate, setFromDate] =
    useState(getMonthStart());

  const [toDate, setToDate] =
    useState(getToday());

  const [search, setSearch] =
    useState("");

  const [rows, setRows] =
    useState<BookRow[]>([]);

  const [summary, setSummary] =
    useState<Summary | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  async function loadBook() {
    try {
      setLoading(true);
      setError("");

      const view =
        book === "cash"
          ? "cash_book"
          : "bank_book";

      const rpc =
        book === "cash"
          ? "get_cash_book_summary"
          : "get_bank_book_summary";

      const { data, error: viewError } =
        await supabase
          .from(view)
          .select("*")
          .gte(
            "entry_date",
            fromDate
          )
          .lte(
            "entry_date",
            toDate
          )
          .order(
            "entry_date",
            {
              ascending: true,
            }
          )
          .order(
            "created_at",
            {
              ascending: true,
            }
          );

      if (viewError) {
        throw viewError;
      }

      const {
        data: summaryResult,
        error: rpcError,
      } = await supabase.rpc(
        rpc,
        {
          p_from_date: fromDate,
          p_to_date: toDate,
        }
      );

      if (rpcError) {
        throw rpcError;
      }

      setRows(
        (data || []) as BookRow[]
      );

      // Normalize the RPC response. The opening balance must come from the
      // accounting summary, not from the period's transaction movements.
      const rawSummary = Array.isArray(summaryResult)
        ? summaryResult[0]
        : summaryResult;

      setSummary({
        opening_balance: Number(rawSummary?.opening_balance ?? 0),
        cash_in: Number(rawSummary?.cash_in ?? 0),
        cash_out: Number(rawSummary?.cash_out ?? 0),
        bank_in: Number(rawSummary?.bank_in ?? 0),
        bank_out: Number(rawSummary?.bank_out ?? 0),
        closing_balance: Number(
          rawSummary?.closing_balance ??
            Number(rawSummary?.opening_balance ?? 0) +
              Number(
                book === "cash"
                  ? rawSummary?.cash_in ?? 0
                  : rawSummary?.bank_in ?? 0
              ) -
              Number(
                book === "cash"
                  ? rawSummary?.cash_out ?? 0
                  : rawSummary?.bank_out ?? 0
              )
        ),
      });

    } catch (err: any) {

      console.error(err);

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
    loadBook();
  }, [
    book,
    fromDate,
    toDate,
  ]);

  const filteredRows =
    useMemo(() => {

      const q =
        search
          .trim()
          .toLowerCase();

      if (!q) {
        return rows;
      }

      return rows.filter(
        (row) =>
          row.entry_id
            .toLowerCase()
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
            .includes(q)
      );

    }, [
      rows,
      search,
    ]);

  // IMPORTANT: Period totals come from ALL loaded transactions, not the
  // search-filtered rows. Search only filters what is displayed.
  const totalIn = rows.reduce(
    (sum, row) =>
      sum +
      Number(
        book === "cash"
          ? row.cash_in ?? row.debit ?? 0
          : row.bank_in ?? row.debit ?? 0
      ),
    0
  );

  const totalOut = rows.reduce(
    (sum, row) =>
      sum +
      Number(
        book === "cash"
          ? row.cash_out ?? row.credit ?? 0
          : row.bank_out ?? row.credit ?? 0
      ),
    0
  );

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

    const data =
      filteredRows.map(
        (row) => {

          const moneyIn =
            book === "cash"
              ? Number(
                  row.cash_in || 0
                )
              : Number(
                  row.bank_in || 0
                );

          const moneyOut =
            book === "cash"
              ? Number(
                  row.cash_out || 0
                )
              : Number(
                  row.bank_out || 0
                );

          return [
            row.entry_date,
            row.entry_id,
            row.line_description ||
              row.entry_description ||
              "",
            row.reference_type || "",
            moneyIn.toFixed(2),
            moneyOut.toFixed(2),
          ];

        }
      );

    const csv =
      [header, ...data]
        .map((row) => {
          return row
            .map((value) => {
              const escaped = String(value).replace(/"/g, '""');
              return '"' + escaped + '"';
            })
            .join(",");
        })
        .join("\n");

    const blob =
      new Blob(
        [csv],
        {
          type:
            "text/csv;charset=utf-8;",
        }
      );

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement("a");

    a.href = url;

    a.download =
      book +
      "-book-" +
      fromDate +
      "-" +
      toDate +
      ".csv";

    a.click();

    URL.revokeObjectURL(url);
  }

  const title =
    book === "cash"
      ? "Cash Book"
      : "Bank Book";

  return (
    <main className="min-h-screen bg-slate-50">

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

            <button
              onClick={exportCSV}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={
                !filteredRows.length
              }
            >
              Export CSV
            </button>

          </div>

        </div>

      </div>


      <div className="mx-auto max-w-7xl px-6 py-6">


        {/* SWITCHER */}

        <div className="mb-6 inline-flex rounded-xl border bg-white p-1">

          <button
            onClick={() =>
              setBook("cash")
            }
            className={
              "rounded-lg px-5 py-2.5 text-sm font-semibold " +
              (book === "cash"
                ? "bg-blue-600 text-white"
                : "text-slate-600")
            }
          >
            Cash Book
          </button>

          <button
            onClick={() =>
              setBook("bank")
            }
            className={
              "rounded-lg px-5 py-2.5 text-sm font-semibold " +
              (book === "bank"
                ? "bg-blue-600 text-white"
                : "text-slate-600")
            }
          >
            Bank Book
          </button>

        </div>


        {/* FILTERS */}

        <section className="mb-6 rounded-2xl border bg-white p-5">

          <div className="grid gap-4 md:grid-cols-3">

            <div>

              <label className="mb-1 block text-sm font-medium text-slate-700">
                From Date
              </label>

              <input
                type="date"
                value={fromDate}
                onChange={(e) =>
                  setFromDate(
                    e.target.value
                  )
                }
                className="w-full rounded-lg border px-3 py-2.5"
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
                  setToDate(
                    e.target.value
                  )
                }
                className="w-full rounded-lg border px-3 py-2.5"
              />

            </div>


            <div>

              <label className="mb-1 block text-sm font-medium text-slate-700">
                Search
              </label>

              <input
                type="text"
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
                placeholder="Search transaction..."
                className="w-full rounded-lg border px-3 py-2.5"
              />

            </div>

          </div>

        </section>


        {/* SUMMARY */}

        <div className="mb-6 grid gap-4 md:grid-cols-4">

          <Card
            title="Opening Balance"
            value={
              summary?.opening_balance ||
              0
            }
          />

          <Card
            title={
              book === "cash"
                ? "Cash In"
                : "Bank In"
            }
            value={totalIn}
          />

          <Card
            title={
              book === "cash"
                ? "Cash Out"
                : "Bank Out"
            }
            value={totalOut}
          />

          <Card
            title="Closing Balance"
            value={
              Number(summary?.opening_balance || 0) +
              totalIn -
              totalOut
            }
            blue
          />

        </div>


        {/* ERROR */}

        {error && (

          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>

        )}


        {/* RECONCILIATION */}

        <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">
          <span className="font-semibold">Balance check:</span>{" "}
          {money(Number(summary?.opening_balance || 0))} opening +{" "}
          {money(totalIn)} in − {money(totalOut)} out ={" "}
          <span className="font-bold text-blue-700">
            {money(
              Number(summary?.opening_balance || 0) +
                totalIn -
                totalOut
            )}
          </span>
          .
          {Number(summary?.closing_balance || 0) !==
          Number(summary?.opening_balance || 0) +
            totalIn -
            totalOut ? (
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
              className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
            >
              Refresh
            </button>

          </div>


          {loading ? (

            <div className="p-12 text-center text-sm text-slate-500">
              Loading...
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
                    (row, index) => {

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

                      // Running balance is an accounting balance. It must
                      // not change when the user searches/filter-displays rows.
                      const rowIndex = rows.findIndex(
                        (r) => r.journal_line_id === row.journal_line_id
                      );

                      const previous =
                        Number(summary?.opening_balance || 0) +
                        rows
                          .slice(0, Math.max(rowIndex, 0))
                          .reduce((total, previousRow) => {
                            const i =
                              book === "cash"
                                ? Number(previousRow.cash_in || 0)
                                : Number(previousRow.bank_in || 0);

                            const o =
                              book === "cash"
                                ? Number(previousRow.cash_out || 0)
                                : Number(previousRow.bank_out || 0);

                            return total + i - o;
                          }, 0);

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
                              {row.entry_id.slice(
                                0,
                                8
                              )}
                            </span>

                          </td>


                          <td className="px-5 py-4">

                            <div className="font-medium text-slate-900">

                              {row.line_description ||
                                row.entry_description ||
                                "Accounting Entry"}

                            </div>

                            <div className="mt-1 text-xs text-slate-500">

                              {row.reference_type ||
                                row.entry_type}

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

                            {money(
                              balance
                            )}

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
                      {money(
                        Number(
                          summary?.opening_balance ||
                            0
                        ) +
                          totalIn -
                          totalOut
                      )}
                    </td>

                  </tr>

                </tfoot>

              </table>

            </div>

          )}

        </section>

      </div>

    </main>
  );
}


function Card({
  title,
  value,
  blue = false,
}: {
  title: string;
  value: number;
  blue?: boolean;
}) {

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
          (blue
            ? "text-blue-600"
            : "text-slate-900")
        }
      >
        {money(value)}
      </p>

    </div>

  );
}