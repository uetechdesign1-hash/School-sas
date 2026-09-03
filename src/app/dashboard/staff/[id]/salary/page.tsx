"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  employee_no: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  department: string | null;
  status: string;
};

type SalaryStructure = {
  id: string;
  school_id: string;
  staff_id: string;
  effective_from: string;
  basic_salary: number;
  house_allowance: number;
  transport_allowance: number;
  medical_allowance: number;
  other_allowance: number;
  pf_deduction: number;
  tax_deduction: number;
  other_deduction: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type SalaryForm = {
  effective_from: string;
  basic_salary: string;
  house_allowance: string;
  transport_allowance: string;
  medical_allowance: string;
  other_allowance: string;
  pf_deduction: string;
  tax_deduction: string;
  other_deduction: string;
  notes: string;
};

const initialForm: SalaryForm = {
  effective_from: new Date()
    .toISOString()
    .slice(0, 10),

  basic_salary: "",
  house_allowance: "",
  transport_allowance: "",
  medical_allowance: "",
  other_allowance: "",

  pf_deduction: "",
  tax_deduction: "",
  other_deduction: "",

  notes: "",
};

export default function StaffSalaryPage() {
  const params = useParams();

  const staffId = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const [staff, setStaff] = useState<Staff | null>(
    null,
  );

  const [salaryStructures, setSalaryStructures] =
    useState<SalaryStructure[]>([]);

  const [form, setForm] =
    useState<SalaryForm>(initialForm);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (staffId) {
      void loadPage();
    }
  }, [staffId]);

  async function getSchoolId() {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.assign("/login");
      return null;
    }

    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from("school_users")
      .select("school_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership?.school_id) {
      throw new Error(
        "Your account is not assigned to an active school.",
      );
    }

    return membership.school_id as string;
  }

  async function loadPage() {
    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const schoolId = await getSchoolId();

      if (!schoolId) {
        return;
      }

      const supabase = createClient();

      const {
        data: staffData,
        error: staffError,
      } = await supabase
        .from("staff")
        .select(`
          id,
          school_id,
          employee_no,
          first_name,
          middle_name,
          last_name,
          designation,
          department,
          status
        `)
        .eq("id", staffId)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (staffError) {
        throw staffError;
      }

      if (!staffData) {
        throw new Error(
          "Staff member was not found in your school.",
        );
      }

      setStaff(staffData as Staff);

      const {
        data: salaryData,
        error: salaryError,
      } = await supabase
        .from("staff_salary_structures")
        .select(`
          id,
          school_id,
          staff_id,
          effective_from,
          basic_salary,
          house_allowance,
          transport_allowance,
          medical_allowance,
          other_allowance,
          pf_deduction,
          tax_deduction,
          other_deduction,
          notes,
          created_at,
          updated_at
        `)
        .eq("school_id", schoolId)
        .eq("staff_id", staffId)
        .order("effective_from", {
          ascending: false,
        });

      if (salaryError) {
        throw salaryError;
      }

      setSalaryStructures(
        (salaryData || []) as SalaryStructure[],
      );
    } catch (err) {
      console.error(
        "STAFF SALARY LOAD ERROR:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load salary information.",
      );
    } finally {
      setLoading(false);
    }
  }

  function updateField(
    field: keyof SalaryForm,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  const calculation = useMemo(() => {
    const basic = amount(form.basic_salary);

    const house = amount(
      form.house_allowance,
    );

    const transport = amount(
      form.transport_allowance,
    );

    const medical = amount(
      form.medical_allowance,
    );

    const otherAllowance = amount(
      form.other_allowance,
    );

    const pf = amount(form.pf_deduction);

    const tax = amount(
      form.tax_deduction,
    );

    const otherDeduction = amount(
      form.other_deduction,
    );

    const totalAllowances =
      house +
      transport +
      medical +
      otherAllowance;

    const gross =
      basic + totalAllowances;

    const totalDeductions =
      pf +
      tax +
      otherDeduction;

    const fixedNet =
      gross - totalDeductions;

    return {
      totalAllowances,
      gross,
      totalDeductions,
      fixedNet,
    };
  }, [form]);

  async function saveSalary() {
    try {
      setSaving(true);
      setError("");
      setSuccess("");

      if (!form.effective_from) {
        throw new Error(
          "Effective From date is required.",
        );
      }

      if (
        !form.basic_salary.trim() ||
        amount(form.basic_salary) <= 0
      ) {
        throw new Error(
          "Basic Salary must be greater than zero.",
        );
      }

      const schoolId = await getSchoolId();

      if (!schoolId) {
        return;
      }

      const supabase = createClient();

      const {
        data: staffCheck,
        error: staffCheckError,
      } = await supabase
        .from("staff")
        .select("id")
        .eq("id", staffId)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (staffCheckError) {
        throw staffCheckError;
      }

      if (!staffCheck) {
        throw new Error(
          "This staff member does not belong to the active school.",
        );
      }

      const {
        data: existing,
        error: existingError,
      } = await supabase
        .from("staff_salary_structures")
        .select("id")
        .eq("school_id", schoolId)
        .eq("staff_id", staffId)
        .eq(
          "effective_from",
          form.effective_from,
        )
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existing) {
        throw new Error(
          "A salary structure already exists for this employee on this effective date.",
        );
      }

      const {
        data,
        error: insertError,
      } = await supabase
        .from("staff_salary_structures")
        .insert({
          school_id: schoolId,
          staff_id: staffId,

          effective_from:
            form.effective_from,

          basic_salary:
            amount(form.basic_salary),

          house_allowance:
            amount(
              form.house_allowance,
            ),

          transport_allowance:
            amount(
              form.transport_allowance,
            ),

          medical_allowance:
            amount(
              form.medical_allowance,
            ),

          other_allowance:
            amount(
              form.other_allowance,
            ),

          pf_deduction:
            amount(
              form.pf_deduction,
            ),

          tax_deduction:
            amount(
              form.tax_deduction,
            ),

          other_deduction:
            amount(
              form.other_deduction,
            ),

          notes:
            form.notes.trim() || null,
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      setSalaryStructures(
        (current) =>
          [data as SalaryStructure, ...current].sort(
            (a, b) =>
              new Date(
                b.effective_from,
              ).getTime() -
              new Date(
                a.effective_from,
              ).getTime(),
          ),
      );

      setForm({
        ...initialForm,
        effective_from:
          form.effective_from,
      });

      setSuccess(
        "Salary structure saved successfully.",
      );
    } catch (err) {
      console.error(
        "STAFF SALARY SAVE ERROR:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to save salary structure.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteSalary(
    salary: SalaryStructure,
  ) {
    const confirmed = window.confirm(
      `Delete salary structure effective from ${formatDate(
        salary.effective_from,
      )}?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(salary.id);
      setError("");
      setSuccess("");

      const schoolId = await getSchoolId();

      if (!schoolId) {
        return;
      }

      const supabase = createClient();

      const {
        error: deleteError,
      } = await supabase
        .from("staff_salary_structures")
        .delete()
        .eq("id", salary.id)
        .eq("staff_id", staffId)
        .eq("school_id", schoolId);

      if (deleteError) {
        throw deleteError;
      }

      setSalaryStructures((current) =>
        current.filter(
          (item) => item.id !== salary.id,
        ),
      );

      setSuccess(
        "Salary structure deleted successfully.",
      );
    } catch (err) {
      console.error(
        "STAFF SALARY DELETE ERROR:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete salary structure.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

          <p className="mt-3 text-sm text-slate-500">
            Loading salary information...
          </p>
        </div>
      </div>
    );
  }

  if (error && !staff) {
    return (
      <div className="min-h-full bg-slate-50 p-4 md:p-6">
        <div className="mx-auto max-w-6xl">
          <Link
            href="/dashboard/staff"
            className="text-sm font-semibold text-blue-600"
          >
            ← Back to Staff
          </Link>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6">
            <h1 className="font-bold text-red-800">
              Unable to load salary page
            </h1>

            <p className="mt-2 text-sm text-red-700">
              {error}
            </p>

            <button
              type="button"
              onClick={() => void loadPage()}
              className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!staff) {
    return null;
  }

  const staffName = [
    staff.first_name,
    staff.middle_name,
    staff.last_name,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-6xl">

        {/* HEADER */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href={`/dashboard/staff/${staff.id}`}
              className="inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              ← Back to Staff Profile
            </Link>

            <div className="mt-4">
              <p className="text-sm text-slate-500">
                Salary Structure
              </p>

              <h1 className="mt-1 text-3xl font-bold text-slate-900">
                {staffName}
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                {staff.employee_no}
                {staff.designation
                  ? ` • ${staff.designation}`
                  : ""}
                {staff.department
                  ? ` • ${staff.department}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">
            Salary Management
          </div>
        </div>

        {/* ERROR */}
        {error && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-semibold text-red-800">
              Salary Error
            </p>

            <p className="mt-1 text-sm text-red-700">
              {error}
            </p>
          </div>
        )}

        {/* SUCCESS */}
        {success && (
          <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-5">
            <p className="font-semibold text-green-800">
              {success}
            </p>
          </div>
        )}

        {/* CURRENT SUMMARY */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Current Basic"
            value={
              salaryStructures.length
                ? money(
                    salaryStructures[0]
                      .basic_salary,
                  )
                : "Not configured"
            }
          />

          <SummaryCard
            label="Current Gross"
            value={
              salaryStructures.length
                ? money(
                    grossFromSalary(
                      salaryStructures[0],
                    ),
                  )
                : "Not configured"
            }
          />

          <SummaryCard
            label="Current Deductions"
            value={
              salaryStructures.length
                ? money(
                    deductionsFromSalary(
                      salaryStructures[0],
                    ),
                  )
                : "Not configured"
            }
          />

          <SummaryCard
            label="Current Fixed Net"
            value={
              salaryStructures.length
                ? money(
                    grossFromSalary(
                      salaryStructures[0],
                    ) -
                      deductionsFromSalary(
                        salaryStructures[0],
                      ),
                  )
                : "Not configured"
            }
          />
        </div>

        {/* SALARY FORM */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <h2 className="text-lg font-bold text-slate-900">
              Add Salary Structure
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Enter the employee's agreed salary and
              fixed allowances/deductions.
            </p>
          </div>

          <div className="p-5 md:p-6">

            {/* BASIC */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Basic Salary
              </h3>

              <div className="mt-4 grid gap-5 md:grid-cols-2">

                <Field
                  label="Effective From"
                  type="date"
                  required
                  value={
                    form.effective_from
                  }
                  onChange={(value) =>
                    updateField(
                      "effective_from",
                      value,
                    )
                  }
                />

                <MoneyField
                  label="Basic Salary"
                  required
                  value={
                    form.basic_salary
                  }
                  onChange={(value) =>
                    updateField(
                      "basic_salary",
                      value,
                    )
                  }
                />
              </div>
            </div>

            {/* ALLOWANCES */}
            <div className="mt-8">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Allowances
              </h3>

              <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-4">

                <MoneyField
                  label="House Allowance"
                  value={
                    form.house_allowance
                  }
                  onChange={(value) =>
                    updateField(
                      "house_allowance",
                      value,
                    )
                  }
                />

                <MoneyField
                  label="Transport Allowance"
                  value={
                    form.transport_allowance
                  }
                  onChange={(value) =>
                    updateField(
                      "transport_allowance",
                      value,
                    )
                  }
                />

                <MoneyField
                  label="Medical Allowance"
                  value={
                    form.medical_allowance
                  }
                  onChange={(value) =>
                    updateField(
                      "medical_allowance",
                      value,
                    )
                  }
                />

                <MoneyField
                  label="Other Allowance"
                  value={
                    form.other_allowance
                  }
                  onChange={(value) =>
                    updateField(
                      "other_allowance",
                      value,
                    )
                  }
                />
              </div>
            </div>

            {/* DEDUCTIONS */}
            <div className="mt-8">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Fixed Deductions
              </h3>

              <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-3">

                <MoneyField
                  label="PF Deduction"
                  value={
                    form.pf_deduction
                  }
                  onChange={(value) =>
                    updateField(
                      "pf_deduction",
                      value,
                    )
                  }
                />

                <MoneyField
                  label="Tax Deduction"
                  value={
                    form.tax_deduction
                  }
                  onChange={(value) =>
                    updateField(
                      "tax_deduction",
                      value,
                    )
                  }
                />

                <MoneyField
                  label="Other Deduction"
                  value={
                    form.other_deduction
                  }
                  onChange={(value) =>
                    updateField(
                      "other_deduction",
                      value,
                    )
                  }
                />
              </div>
            </div>

            {/* CALCULATION */}
            <div className="mt-8 rounded-2xl bg-slate-50 p-5">

              <h3 className="text-sm font-bold text-slate-800">
                Salary Calculation
              </h3>

              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">

                <CalculationCard
                  label="Total Allowances"
                  value={
                    calculation.totalAllowances
                  }
                />

                <CalculationCard
                  label="Gross Salary"
                  value={
                    calculation.gross
                  }
                />

                <CalculationCard
                  label="Total Deductions"
                  value={
                    calculation.totalDeductions
                  }
                />

                <CalculationCard
                  label="Fixed Net Salary"
                  value={
                    calculation.fixedNet
                  }
                  strong
                />
              </div>
            </div>

            {/* NOTES */}
            <div className="mt-8">
              <label className="block text-sm font-semibold text-slate-700">
                Notes
              </label>

              <textarea
                value={form.notes}
                onChange={(event) =>
                  updateField(
                    "notes",
                    event.target.value,
                  )
                }
                rows={4}
                placeholder="Optional salary notes..."
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>

            {/* SAVE */}
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() =>
                  void saveSalary()
                }
                disabled={saving}
                className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? "Saving..."
                  : "Save Salary Structure"}
              </button>
            </div>
          </div>
        </section>

        {/* HISTORY */}
        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-5 py-5 md:px-6">
            <h2 className="text-lg font-bold text-slate-900">
              Salary History
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Previous salary structures remain
              available when salary changes.
            </p>
          </div>

          {salaryStructures.length === 0 ? (
            <div className="p-10 text-center">

              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl font-bold text-slate-500">
                ₹
              </div>

              <p className="mt-3 font-semibold text-slate-900">
                No salary structure yet
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Add the employee's first salary
                structure above.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">

              <table className="min-w-full">

                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Effective From
                    </th>

                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Basic
                    </th>

                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Allowances
                    </th>

                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Gross
                    </th>

                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Deductions
                    </th>

                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Fixed Net
                    </th>

                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Action
                    </th>

                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">

                  {salaryStructures.map(
                    (salary, index) => {

                      const gross =
                        grossFromSalary(
                          salary,
                        );

                      const deductions =
                        deductionsFromSalary(
                          salary,
                        );

                      const allowances =
                        allowancesFromSalary(
                          salary,
                        );

                      return (
                        <tr
                          key={salary.id}
                          className="hover:bg-slate-50"
                        >

                          <td className="px-5 py-4">

                            <div className="flex items-center gap-2">

                              <span className="text-sm font-semibold text-slate-900">
                                {formatDate(
                                  salary.effective_from,
                                )}
                              </span>

                              {index === 0 && (
                                <span className="rounded-full bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700">
                                  Latest
                                </span>
                              )}

                            </div>

                          </td>

                          <td className="px-5 py-4 text-right text-sm text-slate-700">
                            {money(
                              salary.basic_salary,
                            )}
                          </td>

                          <td className="px-5 py-4 text-right text-sm text-slate-700">
                            {money(
                              allowances,
                            )}
                          </td>

                          <td className="px-5 py-4 text-right text-sm font-semibold text-slate-900">
                            {money(gross)}
                          </td>

                          <td className="px-5 py-4 text-right text-sm text-slate-700">
                            {money(
                              deductions,
                            )}
                          </td>

                          <td className="px-5 py-4 text-right text-sm font-bold text-slate-900">
                            {money(
                              gross -
                                deductions,
                            )}
                          </td>

                          <td className="px-5 py-4 text-right">

                            <button
                              type="button"
                              onClick={() =>
                                void deleteSalary(
                                  salary,
                                )
                              }
                              disabled={
                                deletingId ===
                                salary.id
                              }
                              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {deletingId ===
                              salary.id
                                ? "Deleting..."
                                : "Delete"}
                            </button>

                          </td>

                        </tr>
                      );
                    },
                  )}

                </tbody>

              </table>

            </div>
          )}
        </section>

        {/* PAYROLL NOTE */}
        <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5">

          <p className="font-semibold text-blue-900">
            Important
          </p>

          <p className="mt-1 text-sm leading-6 text-blue-800">
            This page stores the agreed salary
            structure. Attendance, holidays, paid leave
            and unpaid leave will be applied later by
            the Payroll module when calculating the
            employee's actual monthly net pay.
          </p>

        </div>

      </div>
    </div>
  );
}

/* ======================================================
   HELPERS
====================================================== */

function amount(value: string | number) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount(value));
}

function formatDate(value: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(
    `${value}T00:00:00`,
  );

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function allowancesFromSalary(
  salary: SalaryStructure,
) {
  return (
    amount(salary.house_allowance) +
    amount(salary.transport_allowance) +
    amount(salary.medical_allowance) +
    amount(salary.other_allowance)
  );
}

function grossFromSalary(
  salary: SalaryStructure,
) {
  return (
    amount(salary.basic_salary) +
    allowancesFromSalary(salary)
  );
}

function deductionsFromSalary(
  salary: SalaryStructure,
) {
  return (
    amount(salary.pf_deduction) +
    amount(salary.tax_deduction) +
    amount(salary.other_deduction)
  );
}

/* ======================================================
   UI COMPONENTS
====================================================== */

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <p className="mt-2 text-xl font-bold text-slate-900">
        {value}
      </p>

    </div>
  );
}

function CalculationCard({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div>

      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <p
        className={
          strong
            ? "mt-1 text-2xl font-bold text-slate-900"
            : "mt-1 text-xl font-semibold text-slate-800"
        }
      >
        {money(value)}
      </p>

    </div>
  );
}

/* ======================================================
   NORMAL FIELD
====================================================== */

function Field({
  label,
  required = false,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>

      <label className="block text-sm font-semibold text-slate-700">

        {label}

        {required && (
          <span className="ml-1 text-red-500">
            *
          </span>
        )}

      </label>

      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      />

    </div>
  );
}

/* ======================================================
   MONEY FIELD
====================================================== */

function MoneyField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div>

      <label className="block text-sm font-semibold text-slate-700">

        {label}

        {required && (
          <span className="ml-1 text-red-500">
            *
          </span>
        )}

      </label>

      <div className="relative mt-2">

        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
          ₹
        </span>

        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          required={required}
          placeholder="0.00"
          onChange={(event) =>
            onChange(event.target.value)
          }
          className="w-full rounded-xl border border-slate-300 py-3 pl-9 pr-4 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />

      </div>

    </div>
  );
}