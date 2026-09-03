"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Loader2,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Student = {
  id: string;
  first_name: string;
  last_name: string | null;
  admission_no: string | null;
};

type Bill = {
  id: string;
  bill_number: string;
  description: string;
  bill_date: string;
  amount: number;
  discount: number;
};

type Allocation = {
  bill_id: string;
  amount: number;
};

export default function RecordPaymentPage() {
  const params = useParams();
  const router = useRouter();

  const studentId = params.id as string;

  const supabase = createClient();

  const [student, setStudent] =
    useState<Student | null>(null);

  const [bills, setBills] =
    useState<Bill[]>([]);

  const [allocations, setAllocations] =
    useState<Allocation[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [amount, setAmount] =
    useState("");

  const [method, setMethod] =
    useState("cash");

  const [reference, setReference] =
    useState("");

  const [notes, setNotes] =
    useState("");

  const [paymentDate, setPaymentDate] =
    useState(today());

  const [selectedBill, setSelectedBill] =
    useState("");

  useEffect(() => {
    loadData();
  }, [studentId]);

  async function loadData() {
    try {
      const studentResult =
        await supabase
          .from("students")
          .select(
            "id, first_name, last_name, admission_no"
          )
          .eq("id", studentId)
          .single();

      if (studentResult.error)
        throw studentResult.error;

      const billResult =
        await supabase
          .from("student_fee_bills")
          .select(
            "id, bill_number, description, bill_date, amount, discount"
          )
          .eq("student_id", studentId)
          .eq("cancelled", false)
          .order("bill_date", {
            ascending: true,
          });

      if (billResult.error)
        throw billResult.error;

      const billIds =
        (billResult.data || []).map(
          (bill) => bill.id
        );

      let allocationData: Allocation[] =
        [];

      if (billIds.length) {
        const allocationResult =
          await supabase
            .from("fee_payment_allocations")
            .select(
              "bill_id, amount"
            )
            .in("bill_id", billIds);

        if (allocationResult.error)
          throw allocationResult.error;

        allocationData =
          allocationResult.data || [];
      }

      setStudent(studentResult.data);
      setBills(
        billResult.data || []
      );
      setAllocations(
        allocationData
      );
    } catch (err) {
      console.error(err);
      setError(
        "Unable to load payment information."
      );
    } finally {
      setLoading(false);
    }
  }

  const billBalances = useMemo(() => {
    return bills
      .map((bill) => {
        const paid =
          allocations
            .filter(
              (item) =>
                item.bill_id === bill.id
            )
            .reduce(
              (sum, item) =>
                sum +
                Number(item.amount),
              0
            );

        const total =
          Number(bill.amount) -
          Number(bill.discount || 0);

        return {
          ...bill,
          total,
          paid,
          balance: Math.max(
            total - paid,
            0
          ),
        };
      })
      .filter(
        (bill) =>
          bill.balance > 0
      );
  }, [bills, allocations]);

  const outstanding =
    billBalances.reduce(
      (sum, bill) =>
        sum + bill.balance,
      0
    );

  async function submit(
    event: FormEvent
  ) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const numericAmount =
        Number(amount);

      if (numericAmount <= 0) {
        throw new Error(
          "Payment amount must be greater than zero."
        );
      }

      if (
        numericAmount >
          outstanding
      ) {
        throw new Error(
          `Payment cannot exceed the current outstanding balance of ${formatCurrency(
            outstanding
          )}.`
        );
      }

      const { data, error } =
        await supabase.rpc(
          "record_student_fee_payment",
          {
            p_student_id: studentId,
            p_amount:
              numericAmount,
            p_payment_method:
              method,
            p_reference_number:
              reference.trim() ||
              null,
            p_notes:
              notes.trim() || null,
            p_payment_date:
              paymentDate,
            p_bill_id:
              selectedBill || null,
          }
        );

      if (error) throw error;

      if (!data?.id) {
        throw new Error(
          "Payment could not be created."
        );
      }

      router.push(
        `/dashboard/students/${studentId}/fees`
      );

      router.refresh();
    } catch (err: any) {
      console.error(err);

      setError(
        err?.message ||
          "Unable to record payment."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse">
          <div className="h-8 w-64 rounded bg-slate-200" />

          <div className="mt-6 h-96 rounded-2xl bg-white" />
        </div>
      </div>
    );
  }

  const studentName =
    `${student?.first_name || ""} ${
      student?.last_name || ""
    }`.trim();

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <Link
        href={`/dashboard/students/${studentId}/fees`}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-blue-600"
      >
        <ArrowLeft size={17} />
        Back to Fee Ledger
      </Link>

      <div className="mt-5">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Record Payment
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          {studentName}
          {student?.admission_no
            ? ` • ${student.admission_no}`
            : ""}
        </p>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 grid max-w-5xl gap-6 lg:grid-cols-[1fr_340px]">
        <form onSubmit={submit}>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <CreditCard size={20} />
              </div>

              <div>
                <h2 className="font-bold text-slate-900">
                  Payment Details
                </h2>

                <p className="text-xs text-slate-500">
                  Record money received from the parent.
                </p>
              </div>
            </div>

            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-semibold text-slate-700">
                  Payment Amount
                  <span className="ml-1 text-red-500">
                    *
                  </span>
                </label>

                <div className="relative mt-2">
                  <IndianRupee
                    size={18}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) =>
                      setAmount(
                        event.target.value
                      )
                    }
                    placeholder="5000"
                    className="w-full rounded-xl border border-slate-300 py-4 pl-11 pr-4 text-lg font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                  />
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  Outstanding:
                  <span className="ml-1 font-bold text-red-600">
                    {formatCurrency(
                      outstanding
                    )}
                  </span>
                </p>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Payment Method
                </label>

                <select
                  value={method}
                  onChange={(event) =>
                    setMethod(
                      event.target.value
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                >
                  <option value="cash">
                    Cash
                  </option>

                  <option value="upi">
                    UPI
                  </option>

                  <option value="bank">
                    Bank Transfer
                  </option>

                  <option value="card">
                    Card
                  </option>

                  <option value="cheque">
                    Cheque
                  </option>

                  <option value="other">
                    Other
                  </option>
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Payment Date
                </label>

                <div className="relative mt-2">
                  <CalendarDays
                    size={16}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(event) =>
                      setPaymentDate(
                        event.target.value
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-semibold text-slate-700">
                  Apply Payment To
                </label>

                <select
                  value={selectedBill}
                  onChange={(event) =>
                    setSelectedBill(
                      event.target.value
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                >
                  <option value="">
                    Automatically apply to oldest due bills
                  </option>

                  {billBalances.map(
                    (bill) => (
                      <option
                        key={bill.id}
                        value={bill.id}
                      >
                        {bill.bill_number} —{" "}
                        {bill.description} — Due{" "}
                        {formatCurrency(
                          bill.balance
                        )}
                      </option>
                    )
                  )}
                </select>

                <p className="mt-2 text-xs text-slate-500">
                  Leave automatic allocation selected
                  unless the parent specifically paid a
                  particular bill.
                </p>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Reference Number
                </label>

                <input
                  value={reference}
                  onChange={(event) =>
                    setReference(
                      event.target.value
                    )
                  }
                  placeholder="UPI ID / cheque number"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Notes
                </label>

                <input
                  value={notes}
                  onChange={(event) =>
                    setNotes(
                      event.target.value
                    )
                  }
                  placeholder="Optional note"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
              <Link
                href={`/dashboard/students/${studentId}/fees`}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Link>

              <button
                type="submit"
                disabled={
                  saving ||
                  outstanding <= 0
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                    Recording...
                  </>
                ) : (
                  <>
                    <CheckCircle2
                      size={17}
                    />
                    Record Payment
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Outstanding bills */}
        <aside className="h-fit overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-bold text-slate-900">
              Outstanding Bills
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              Bills that still have money due.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {billBalances.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm font-semibold text-emerald-700">
                  No outstanding bills
                </p>
              </div>
            ) : (
              billBalances.map(
                (bill) => (
                  <button
                    key={bill.id}
                    type="button"
                    onClick={() =>
                      setSelectedBill(
                        bill.id
                      )
                    }
                    className={`w-full p-5 text-left transition hover:bg-slate-50 ${
                      selectedBill === bill.id
                        ? "bg-blue-50"
                        : ""
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-400">
                      {bill.bill_number}
                    </p>

                    <p className="mt-1 font-semibold text-slate-800">
                      {bill.description}
                    </p>

                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-slate-500">
                        Due
                      </span>

                      <span className="font-bold text-red-600">
                        {formatCurrency(
                          bill.balance
                        )}
                      </span>
                    </div>
                  </button>
                )
              )
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600">
                Total Outstanding
              </span>

              <span className="text-lg font-bold text-red-600">
                {formatCurrency(
                  outstanding
                )}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function today() {
  return new Date()
    .toISOString()
    .split("T")[0];
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value || 0);
}