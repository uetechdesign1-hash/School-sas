"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  IndianRupee,
  Loader2,
  Printer,
  XCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  employee_no: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  department: string | null;
  joining_date: string | null;
  status: string | null;
};

type PayrollRun = {
  id: string;
  school_id: string;
  month: number;
  year: number;
  status: string;
  total_staff: number | null;
  total_gross: number | null;
  total_deductions: number | null;
  total_lop: number | null;
  total_net: number | null;
  created_at: string | null;
  updated_at: string | null;
  finalized_at: string | null;
};

type PayrollItem = {
  id: string;
  payroll_run_id: string;
  employee_id: string | null;
  staff_id: string | null;
  salary_structure_id: string | null;

  basic_salary: number | null;
  allowances: number | null;
  deductions: number | null;
  net_salary: number | null;

  paid_amount: number | null;
  paid: boolean | null;

  working_days: number | null;
  paid_leave_days: number | null;
  unpaid_days: number | null;
  payable_days: number | null;

  gross_salary: number | null;
  lop_amount: number | null;

  pf_deduction: number | null;
  tax_deduction: number | null;
  other_deduction: number | null;
  total_deductions: number | null;

  status: string | null;
  notes: string | null;
};

type Payslip = {
  run: PayrollRun;
  item: PayrollItem;
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function staffName(staff: Staff) {
  return [
    staff.first_name,
    staff.middle_name,
    staff.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function monthName(month: number) {
  return new Date(
    2000,
    month - 1,
    1
  ).toLocaleDateString("en-IN", {
    month: "long",
  });
}

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusLabel(value: string | null) {
  return String(value || "draft")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) =>
      c.toUpperCase()
    );
}

export default function StaffPayslipsPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const staffId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [staff, setStaff] =
    useState<Staff | null>(null);

  const [schoolName, setSchoolName] =
    useState("School");

  const [payslips, setPayslips] =
    useState<Payslip[]>([]);

  const [selected, setSelected] =
    useState<Payslip | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function loadPayslips() {
      try {
        setLoading(true);
        setError("");

        const {
          data: {
            user,
          },
        } =
          await supabase.auth.getUser();

        if (!user) {
          window.location.href =
            "/login";
          return;
        }

        if (!staffId) {
          throw new Error("Staff member was not specified.");
        }

        /* ==========================================
           VERIFY ADMIN / OWNER SCHOOL ACCESS
           ========================================== */

        const { data: membership, error: membershipError } = await supabase
          .from("school_users")
          .select("school_id, role, is_active")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (membershipError) throw membershipError;

        if (!membership?.school_id) {
          throw new Error("Your account is not assigned to an active school.");
        }

        const role = String(membership.role || "").toLowerCase();
        if (role !== "owner" && role !== "admin") {
          throw new Error("Only the school owner or admin can view staff payslips.");
        }

        /* ==========================================
           FIND SELECTED STAFF
           ========================================== */

        const { data: staffRow, error: staffError } = await supabase
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
            joining_date,
            status
          `)
          .eq("id", staffId)
          .eq("school_id", membership.school_id)
          .maybeSingle();

        if (staffError) throw staffError;
        if (!staffRow) throw new Error("Staff member was not found.");

        setStaff(staffRow as Staff);

        /* ==========================================
           LOAD SCHOOL NAME
           ========================================== */

        const { data: schoolRow } = await supabase
          .from("schools")
          .select("*")
          .eq("id", staffRow.school_id)
          .maybeSingle();

        const schoolRecord = (schoolRow || {}) as Record<
          string,
          unknown
        >;

        const resolvedSchoolName =
          String(
            schoolRecord.name ||
              schoolRecord.school_name ||
              schoolRecord.title ||
              "School"
          ).trim() || "School";

        setSchoolName(resolvedSchoolName);

        /* ==========================================
           LOAD PAYROLL RUNS
           ========================================== */

        const {
          data: runRows,
          error: runError,
        } =
          await supabase
            .from("payroll_runs")
            .select(
              `
                id,
                school_id,
                month,
                year,
                status,
                total_staff,
                total_gross,
                total_deductions,
                total_lop,
                total_net,
                created_at,
                updated_at,
                finalized_at
              `
            )
            .eq(
              "school_id",
              staffRow.school_id
            )
            .order(
              "year",
              {
                ascending: false,
              }
            )
            .order(
              "month",
              {
                ascending: false,
              }
            );

        if (runError) {
          throw runError;
        }

        const runs =
          (runRows || []) as PayrollRun[];

        if (runs.length === 0) {
          setPayslips([]);
          return;
        }

        /* ==========================================
           LOAD PAYROLL ITEMS FOR THIS STAFF
           ========================================== */

        const {
          data: itemRows,
          error: itemError,
        } =
          await supabase
            .from("payroll_items")
            .select(
              `
                id,
                payroll_run_id,
                employee_id,
                staff_id,
                salary_structure_id,
                basic_salary,
                allowances,
                deductions,
                net_salary,
                paid_amount,
                paid,
                working_days,
                paid_leave_days,
                unpaid_days,
                payable_days,
                gross_salary,
                lop_amount,
                pf_deduction,
                tax_deduction,
                other_deduction,
                total_deductions,
                status,
                notes
              `
            )
            .eq(
              "school_id",
              staffRow.school_id
            )
            .eq(
              "staff_id",
              staffRow.id
            );

        if (itemError) {
          throw itemError;
        }

        const items =
          (itemRows || []) as PayrollItem[];

        /* ==========================================
           COMBINE RUN + ITEM
           ========================================== */

        const result: Payslip[] = [];

        for (const item of items) {
          const run = runs.find(
            (candidate) =>
              candidate.id ===
              item.payroll_run_id
          );

          if (!run) continue;

          result.push({
            run,
            item,
          });
        }

        result.sort(
          (a, b) => {
            const first =
              Number(a.run.year) * 100 +
              Number(a.run.month);

            const second =
              Number(b.run.year) * 100 +
              Number(b.run.month);

            return second - first;
          }
        );

        setPayslips(result);

        if (result.length > 0) {
          setSelected(result[0]);
        }
      } catch (err: any) {
        console.error(
          "STAFF PAYSLIPS ERROR:",
          err
        );

        setError(
          err?.message ||
            "Unable to load payslips."
        );
      } finally {
        setLoading(false);
      }
    }

    loadPayslips();
  }, [supabase, staffId]);

  function printPayslip() {
    window.print();
  }

  if (loading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2
            className="animate-spin"
            size={18}
          />
          Loading payslips...
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="p-6">
        <div className="mx-auto max-w-5xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 sm:p-6 lg:p-8">

      <div className="mx-auto max-w-6xl">

        {/* HEADER */}

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

          <div>
            <p className="text-sm text-slate-500">
Staff Management
            </p>

            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Staff Payslip
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              {staff
                ? staffName(staff)
                : "Staff Member"}
            </p>
          </div>

          <div className="no-print flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push(`/dashboard/staff/${staffId}`)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ← Back to Staff
            </button>

          {selected && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={printPayslip}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Printer size={16} />
                Print
              </button>

              <button
                type="button"
                onClick={printPayslip}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                title="Choose Save as PDF in the print window"
              >
                <Download size={16} />
                Download PDF
              </button>
            </div>
          )}
          </div>

        </div>

        {payslips.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">

            <FileText className="mx-auto h-12 w-12 text-slate-300" />

            <h2 className="mt-4 text-lg font-bold text-slate-900">
              No payslips available
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Payslips will appear here after payroll is created for you.
            </p>

          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[330px_1fr]">

            {/* PAYSLIP LIST */}

            <section className="no-print rounded-2xl border border-slate-200 bg-white shadow-sm">

              <div className="border-b border-slate-200 p-5">

                <h2 className="font-bold text-slate-900">
                  Payroll History
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  {payslips.length} payslip
                  {payslips.length === 1
                    ? ""
                    : "s"}
                </p>

              </div>

              <div className="divide-y divide-slate-100">

                {payslips.map(
                  (payslip) => {
                    const active =
                      selected?.item.id ===
                      payslip.item.id;

                    return (
                      <button
                        type="button"
                        key={
                          payslip.item.id
                        }
                        onClick={() =>
                          setSelected(
                            payslip
                          )
                        }
                        className={`w-full p-5 text-left transition ${
                          active
                            ? "bg-blue-50"
                            : "hover:bg-slate-50"
                        }`}
                      >

                        <div className="flex items-center justify-between gap-3">

                          <div>

                            <p className="font-semibold text-slate-900">
                              {monthName(
                                Number(
                                  payslip.run.month
                                )
                              )}{" "}
                              {
                                payslip.run
                                  .year
                              }
                            </p>

                            <p className="mt-1 text-xs text-slate-500">
                              {statusLabel(
                                payslip.run.status
                              )}
                            </p>

                          </div>

                          <p className="font-bold text-slate-900">
                            {money(
                              payslip.item
                                .net_salary
                            )}
                          </p>

                        </div>

                      </button>
                    );
                  }
                )}

              </div>

            </section>

            {/* PAYSLIP */}

            {selected && (
              <section className="print-area overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

                {/* PAYSLIP HEADER */}

                <div className="border-b border-slate-200 bg-slate-50 p-6 sm:p-8">

                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">

                    <div>

                      <div className="flex items-center gap-3">

                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white">
                          <IndianRupee
                            size={21}
                          />
                        </div>

                        <div>

                          <p className="text-base font-black uppercase tracking-wide text-slate-900">
                            {schoolName}
                          </p>
                          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-600">
                            School Salary Statement
                          </p>

                          <h2 className="text-xl font-bold text-slate-900">
                            Salary Payslip
                          </h2>

                        </div>

                      </div>

                    </div>

                    <div className="text-left sm:text-right">

                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Pay Period
                      </p>

                      <p className="mt-1 text-lg font-bold text-slate-900">
                        {monthName(
                          Number(
                            selected.run
                              .month
                          )
                        )}{" "}
                        {
                          selected.run
                            .year
                        }
                      </p>

                      <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-700">
                        {statusLabel(
                          selected.run
                            .status
                        )}
                      </span>

                    </div>

                  </div>

                </div>

                {/* EMPLOYEE */}

                <div className="border-b border-slate-200 p-6 sm:p-8">

                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                    Employee Information
                  </h3>

                  <div className="mt-5 grid gap-5 sm:grid-cols-2">

                    <div>
                      <p className="text-xs text-slate-400">
                        Employee
                      </p>

                      <p className="mt-1 font-semibold text-slate-900">
                        {staff
                          ? staffName(
                              staff
                            )
                          : "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-400">
                        Employee No.
                      </p>

                      <p className="mt-1 font-semibold text-slate-900">
                        {staff?.employee_no ||
                          "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-400">
                        Designation
                      </p>

                      <p className="mt-1 font-semibold text-slate-900">
                        {staff?.designation ||
                          "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-slate-400">
                        Department
                      </p>

                      <p className="mt-1 font-semibold text-slate-900">
                        {staff?.department ||
                          "—"}
                      </p>
                    </div>

                  </div>

                </div>

                {/* ATTENDANCE */}

                <div className="border-b border-slate-200 p-6 sm:p-8">

                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                    Attendance & Leave
                  </h3>

                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">

                    <Stat
                      label="Working Days"
                      value={
                        selected.item
                          .working_days
                      }
                    />

                    <Stat
                      label="Paid Leave"
                      value={
                        selected.item
                          .paid_leave_days
                      }
                    />

                    <Stat
                      label="Unpaid"
                      value={
                        selected.item
                          .unpaid_days
                      }
                    />

                    <Stat
                      label="Payable Days"
                      value={
                        selected.item
                          .payable_days
                      }
                    />

                    <Stat
                      label="LOP"
                      value={money(
                        selected.item
                          .lop_amount
                      )}
                    />

                  </div>

                </div>

                {/* EARNINGS */}

                <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-2">

                  <SalaryBox title="Earnings">

                    <SalaryRow
                      label="Basic Salary"
                      value={money(
                        selected.item
                          .basic_salary
                      )}
                    />

                    <SalaryRow
                      label="Allowances"
                      value={money(
                        selected.item
                          .allowances
                      )}
                    />

                    <SalaryRow
                      label="Gross Salary"
                      value={money(
                        selected.item
                          .gross_salary
                      )}
                      strong
                    />

                  </SalaryBox>

                  <SalaryBox title="Deductions">

                    <SalaryRow
                      label="PF"
                      value={money(
                        selected.item
                          .pf_deduction
                      )}
                    />

                    <SalaryRow
                      label="Tax"
                      value={money(
                        selected.item
                          .tax_deduction
                      )}
                    />

                    <SalaryRow
                      label="Other"
                      value={money(
                        selected.item
                          .other_deduction
                      )}
                    />

                    <SalaryRow
                      label="LOP"
                      value={money(
                        selected.item
                          .lop_amount
                      )}
                    />

                    <SalaryRow
                      label="Total Deductions"
                      value={money(
                        selected.item
                          .total_deductions
                      )}
                      strong
                    />

                  </SalaryBox>

                </div>

                {/* NET */}

                <div className="mx-6 mb-6 rounded-2xl bg-blue-50 p-6 sm:mx-8">

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

                    <div>

                      <p className="text-sm font-semibold text-blue-700">
                        Net Salary
                      </p>

                      <p className="mt-1 text-xs text-blue-600">
                        Amount payable for this payroll period
                      </p>

                    </div>

                    <p className="text-3xl font-black text-blue-700">
                      {money(
                        selected.item
                          .net_salary
                      )}
                    </p>

                  </div>

                </div>

                {/* PAYMENT */}

                <div className="border-t border-slate-200 p-6 sm:p-8">

                  <div className="grid gap-5 sm:grid-cols-3">

                    <div className="flex items-center gap-3">

                      {selected.item.paid ? (
                        <CheckCircle2 className="text-emerald-600" />
                      ) : (
                        <Clock3 className="text-amber-500" />
                      )}

                      <div>

                        <p className="text-xs text-slate-400">
                          Payment Status
                        </p>

                        <p className="font-semibold text-slate-800">
                          {selected.item
                            .paid
                            ? "Paid"
                            : "Pending"}

                        </p>

                      </div>

                    </div>

                    <div>

                      <p className="text-xs text-slate-400">
                        Paid Amount
                      </p>

                      <p className="mt-1 font-semibold text-slate-800">
                        {money(
                          selected.item
                            .paid_amount
                        )}
                      </p>

                    </div>

                    <div>

                      <p className="text-xs text-slate-400">
                        Payroll Created
                      </p>

                      <p className="mt-1 font-semibold text-slate-800">
                        {formatDate(
                          selected.run
                            .created_at
                        )}
                      </p>

                    </div>

                  </div>

                  {selected.item.notes && (
                    <div className="mt-6 rounded-xl bg-slate-50 p-4">

                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Payroll Notes
                      </p>

                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {selected.item.notes}
                      </p>

                    </div>
                  )}

                </div>

                <div className="border-t border-slate-200 px-6 py-3 text-center text-[10px] text-slate-400">
                  {schoolName} • Salary Payslip • Generated from SchoolFlow
                </div>

              </section>
            )}

          </div>
        )}

      </div>

      {/* PRINT STYLES */}

      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 8mm;
        }

        @media print {
          html,
          body {
            width: 210mm !important;
            min-height: 297mm !important;
            background: white !important;
          }

          body {
            margin: 0 !important;
            padding: 0 !important;
          }

          .no-print,
          header,
          nav,
          aside {
            display: none !important;
          }

          main {
            display: block !important;
            width: 100% !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          main > div {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .print-area {
            display: block !important;
            width: 100% !important;
            max-width: none !important;
            min-height: 0 !important;
            margin: 0 !important;
            border: 1px solid #cbd5e1 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            overflow: visible !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .print-area > div {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .print-area .p-6 {
            padding: 12px !important;
          }

          .print-area .p-8 {
            padding: 14px !important;
          }

          .print-area .mx-6 {
            margin-left: 14px !important;
            margin-right: 14px !important;
          }

          .print-area .mx-8 {
            margin-left: 14px !important;
            margin-right: 14px !important;
          }

          .print-area .mb-6 {
            margin-bottom: 10px !important;
          }

          .print-area .mt-5 {
            margin-top: 8px !important;
          }

          .print-area .mt-6 {
            margin-top: 10px !important;
          }

          .print-area .py-4 {
            padding-top: 7px !important;
            padding-bottom: 7px !important;
          }

          .print-area .p-5 {
            padding: 10px !important;
          }

          .print-area .gap-6 {
            gap: 12px !important;
          }

          .print-area .gap-5 {
            gap: 10px !important;
          }

          .print-area .gap-3 {
            gap: 7px !important;
          }

          .print-area .text-3xl {
            font-size: 22px !important;
            line-height: 1.1 !important;
          }

          .print-area .text-xl {
            font-size: 16px !important;
            line-height: 1.2 !important;
          }

          .print-area .text-lg {
            font-size: 14px !important;
            line-height: 1.2 !important;
          }

          .print-area .text-sm {
            font-size: 10px !important;
            line-height: 1.35 !important;
          }

          .print-area .text-xs {
            font-size: 8px !important;
            line-height: 1.25 !important;
          }

          .print-area .text-base {
            font-size: 14px !important;
            line-height: 1.2 !important;
          }

          .print-area .rounded-2xl,
          .print-area .rounded-xl {
            border-radius: 4px !important;
          }
        }
      `}</style>

    </main>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number | string | null | undefined;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-lg font-bold text-slate-900">
        {value === null ||
        value === undefined
          ? "—"
          : value}
      </p>
    </div>
  );
}

function SalaryBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">

      <div className="bg-slate-50 px-5 py-4">
        <h3 className="font-bold text-slate-900">
          {title}
        </h3>
      </div>

      <div className="divide-y divide-slate-100 px-5">
        {children}
      </div>

    </div>
  );
}

function SalaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">

      <span
        className={
          strong
            ? "font-bold text-slate-900"
            : "text-sm text-slate-600"
        }
      >
        {label}
      </span>

      <span
        className={
          strong
            ? "font-bold text-slate-900"
            : "text-sm font-semibold text-slate-700"
        }
      >
        {value}
      </span>

    </div>
  );
}