"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  FilePlus2,
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

type FeeStructure = {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  fee_type: string;
};

export default function CreateFeeBillPage() {
  const params = useParams();
  const router = useRouter();

  const studentId = params.id as string;
  const supabase = createClient();

  const [student, setStudent] =
    useState<Student | null>(null);

  const [feeStructures, setFeeStructures] =
    useState<FeeStructure[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [description, setDescription] =
    useState("");

  const [amount, setAmount] =
    useState("");

  const [discount, setDiscount] =
    useState("0");

  const [billDate, setBillDate] =
    useState(today());

  const [dueDate, setDueDate] =
    useState("");

  const [feeStructureId, setFeeStructureId] =
    useState("");

  useEffect(() => {
    loadData();
  }, [studentId]);

  async function loadData() {
    try {
      const [studentResult, structureResult] =
        await Promise.all([
          supabase
            .from("students")
            .select(
              "id, first_name, last_name, admission_no"
            )
            .eq("id", studentId)
            .single(),

          supabase
            .from("fee_structures")
            .select(
              "id, name, amount, frequency, fee_type"
            )
            .eq("is_active", true)
            .order("name"),
        ]);

      if (studentResult.error)
        throw studentResult.error;

      if (structureResult.error)
        throw structureResult.error;

      setStudent(studentResult.data);
      setFeeStructures(
        structureResult.data || []
      );
    } catch (err) {
      console.error(err);
      setError("Unable to load billing information.");
    } finally {
      setLoading(false);
    }
  }

  function selectFeeStructure(id: string) {
    setFeeStructureId(id);

    const selected =
      feeStructures.find(
        (item) => item.id === id
      );

    if (!selected) return;

    setDescription(selected.name);
    setAmount(String(selected.amount));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      const numericAmount =
        Number(amount);

      const numericDiscount =
        Number(discount || 0);

      if (!description.trim()) {
        throw new Error(
          "Please enter a fee description."
        );
      }

      if (numericAmount <= 0) {
        throw new Error(
          "Fee amount must be greater than zero."
        );
      }

      if (
        numericDiscount < 0 ||
        numericDiscount > numericAmount
      ) {
        throw new Error(
          "Please enter a valid discount."
        );
      }

      const { data, error } =
        await supabase.rpc(
          "create_student_fee_bill",
          {
            p_student_id: studentId,
            p_description:
              description.trim(),
            p_amount: numericAmount,
            p_discount:
              numericDiscount,
            p_bill_date: billDate,
            p_due_date:
              dueDate || null,
            p_fee_structure_id:
              feeStructureId || null,
          }
        );

      if (error) throw error;

      if (!data?.id) {
        throw new Error(
          "Bill was not created."
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
          "Unable to create fee bill."
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

  const finalAmount =
    Math.max(
      Number(amount || 0) -
        Number(discount || 0),
      0
    );

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
          Create Fee Bill
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

      <form
        onSubmit={submit}
        className="mt-6 max-w-3xl"
      >
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <FilePlus2 size={20} />
            </div>

            <div>
              <h2 className="font-bold text-slate-900">
                Fee Details
              </h2>

              <p className="text-xs text-slate-500">
                Create a new bill for this student.
              </p>
            </div>
          </div>

          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm font-semibold text-slate-700">
                Fee Structure
              </label>

              <select
                value={feeStructureId}
                onChange={(event) =>
                  selectFeeStructure(
                    event.target.value
                  )
                }
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
              >
                <option value="">
                  Select an existing fee structure
                </option>

                {feeStructures.map(
                  (structure) => (
                    <option
                      key={structure.id}
                      value={structure.id}
                    >
                      {structure.name} — ₹
                      {Number(
                        structure.amount
                      ).toLocaleString("en-IN")}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="text-sm font-semibold text-slate-700">
                Description
                <span className="ml-1 text-red-500">
                  *
                </span>
              </label>

              <input
                value={description}
                onChange={(event) =>
                  setDescription(
                    event.target.value
                  )
                }
                placeholder="Annual Tuition Fee 2026-27"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
              />
            </div>

            <MoneyInput
              label="Amount"
              value={amount}
              onChange={setAmount}
            />

            <MoneyInput
              label="Discount"
              value={discount}
              onChange={setDiscount}
            />

            <DateInput
              label="Bill Date"
              value={billDate}
              onChange={setBillDate}
            />

            <DateInput
              label="Due Date"
              value={dueDate}
              onChange={setDueDate}
              required={false}
            />
          </div>

          <div className="border-t border-slate-100 bg-slate-50 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600">
                Net Amount
              </span>

              <span className="text-2xl font-bold text-slate-900">
                {formatCurrency(finalAmount)}
              </span>
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
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving && (
                <Loader2
                  size={17}
                  className="animate-spin"
                />
              )}

              {saving
                ? "Creating..."
                : "Create Bill"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-sm font-semibold text-slate-700">
        {label}
      </label>

      <div className="relative mt-2">
        <IndianRupee
          size={16}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
        />

        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(event) =>
            onChange(event.target.value)
          }
          className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
        />
      </div>
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-sm font-semibold text-slate-700">
        {label}
      </label>

      <div className="relative mt-2">
        <CalendarDays
          size={16}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
        />

        <input
          type="date"
          required={required}
          value={value}
          onChange={(event) =>
            onChange(event.target.value)
          }
          className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50"
        />
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