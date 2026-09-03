"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Save,
  Trash2,
  Wallet,
  Lock,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  employee_no: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  status: string;
  joining_date: string | null;
};

type Salary = {
  id: string;
  staff_id: string;
  basic_salary: number;
  house_allowance: number;
  transport_allowance: number;
  medical_allowance: number;
  other_allowance: number;
  allowances: number;
  gross_salary: number;
  deductions: number;
  net_salary: number;
  raw: Record<string, unknown>;
};

type Row = {
  staff: Staff;
  salary: Salary | null;
  worked: number;
  paidLeave: number;
  holiday: number;
  unpaid: number;
  payable: number;
  gross: number;
  deductions: number;
  net: number;
  expanded: boolean;
};

type PayrollRun = {
  id: string;
  school_id: string;
  month: number;
  year: number;
  status: string;
  total_staff: number;
  total_gross: number;
  total_deductions: number;
  total_lop: number;
  total_net: number;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
  finalized_by: string | null;
};

const supabase = createClient();

function money(v: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(v || 0));
}

function monthText(month: string) {
  const d = new Date(`${month}-01T00:00:00`);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function staffName(s: Staff) {
  return [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" ");
}

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function firstNumber(row: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    if (k in row && n(row[k]) !== 0) return n(row[k]);
  }
  return 0;
}

function normalizeSalary(raw: Record<string, unknown>, staffId: string): Salary {
  const basic = firstNumber(raw, [
    "basic_salary",
    "basic",
    "base_salary",
  ]);

  // Salary structures may store the allowances separately instead of keeping
  // gross_salary up to date. Always include the real allowance columns.
  const house = firstNumber(raw, [
    "house_allowance",
    "housing_allowance",
    "hra",
  ]);
  const transport = firstNumber(raw, [
    "transport_allowance",
    "transport",
    "ta",
  ]);
  const medical = firstNumber(raw, [
    "medical_allowance",
    "medical",
    "ma",
  ]);
  const other = firstNumber(raw, [
    "other_allowance",
    "other_allowances",
    "other",
  ]);

  const allowances = house + transport + medical + other;
  const componentGross = basic + allowances;

  const storedGross = firstNumber(raw, [
    "gross_salary",
    "monthly_gross",
    "gross_pay",
    "gross_amount",
  ]);

  // If the stored gross is stale (for example only equal to basic salary),
  // use the component total. If it is higher, preserve the higher configured
  // gross because it may include an additional allowance column.
  const gross = Math.max(storedGross, componentGross);

  const storedTotalDeductions = firstNumber(raw, [
    "total_deductions",
    "monthly_deductions",
    "deduction_total",
  ]);

  const componentDeductions =
    firstNumber(raw, ["pf_deduction", "pf", "provident_fund"]) +
    firstNumber(raw, ["tax_deduction", "tax", "tds"]) +
    firstNumber(raw, ["other_deduction", "other_deductions"]);

  const genericDeductions = firstNumber(raw, ["deductions"]);
  const deductions =
    storedTotalDeductions ||
    (componentDeductions > 0 ? componentDeductions : genericDeductions);

  const net = Math.max(gross - deductions, 0);

  return {
    id: String(raw.id || `${staffId}-salary`),
    staff_id: staffId,
    basic_salary: basic,
    house_allowance: house,
    transport_allowance: transport,
    medical_allowance: medical,
    other_allowance: other,
    allowances,
    gross_salary: gross,
    deductions,
    net_salary: net,
    raw,
  };
}
function calculate(
  salary: Salary | null,
  workingDays: number,
  worked: number,
  paidLeave: number,
  holiday: number,
) {
  if (!salary) {
    return { payable: 0, unpaid: workingDays, gross: 0, deductions: 0, net: 0 };
  }

  const wd = Math.max(0, n(workingDays));
  const w = Math.max(0, n(worked));
  const p = Math.max(0, n(paidLeave));
  const h = Math.max(0, n(holiday));

  const payable = Math.min(wd, w + p + h);
  const unpaid = Math.max(wd - payable, 0);

  const gross = wd > 0 ? salary.gross_salary * (payable / wd) : salary.gross_salary;
  const deductions = salary.deductions;
  const net = Math.max(gross - deductions, 0);

  return { payable, unpaid, gross, deductions, net };
}

export default function PayrollPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [workingDays, setWorkingDays] = useState(31);
  const [schoolId, setSchoolId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [savedRun, setSavedRun] = useState<PayrollRun | null>(null);
  const [editing, setEditing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");

  const locked = savedRun?.status === "prepared" || savedRun?.status === "finalized";

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          staff: a.staff + 1,
          gross: a.gross + r.gross,
          deductions: a.deductions + r.deductions,
          lop: a.lop + (r.salary && workingDays > 0
            ? r.salary.gross_salary * (r.unpaid / workingDays)
            : 0),
          net: a.net + r.net,
        }),
        { staff: 0, gross: 0, deductions: 0, lop: 0, net: 0 },
      ),
    [rows, workingDays],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${staffName(r.staff)} ${r.staff.employee_no} ${r.staff.designation || ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) {
        window.location.assign("/login");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("school_users")
        .select("school_id")
        .eq("user_id", auth.user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership?.school_id) throw new Error("No active school was found.");

      const sid = membership.school_id as string;
      setSchoolId(sid);

      const [year, monthNumber] = month.split("-").map(Number);
      const defaultDays = daysInMonth(month);

      const { data: attendance, error: attendanceError } = await supabase
        .from("staff_monthly_attendance")
        .select(
          "staff_id, working_days, worked_days, paid_leave, unpaid_leave, school_holidays",
        )
        .eq("school_id", sid)
        .eq("month", month);

      if (attendanceError) throw new Error(`Attendance: ${attendanceError.message}`);

      const attendanceMap = new Map<string, Record<string, unknown>>();
      for (const a of (attendance || []) as Record<string, unknown>[]) {
        if (a.staff_id) attendanceMap.set(String(a.staff_id), a);
      }

      const { data: runData, error: runError } = await supabase
        .from("payroll_runs")
        .select(
          "id, school_id, month, year, status, total_staff, total_gross, total_deductions, total_lop, total_net, created_at, updated_at, finalized_at, finalized_by",
        )
        .eq("school_id", sid)
        .eq("month", monthNumber)
        .eq("year", year)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (runError) throw new Error(`Payroll run: ${runError.message}`);

      const run = runData
        ? ({
            ...runData,
            month: n(runData.month),
            year: n(runData.year),
            total_staff: n(runData.total_staff),
            total_gross: n(runData.total_gross),
            total_deductions: n(runData.total_deductions),
            total_lop: n(runData.total_lop),
            total_net: n(runData.total_net),
          } as PayrollRun)
        : null;

      setSavedRun(run);
      setEditing(!run || run.status !== "prepared");

      let savedItems: Record<string, Record<string, unknown>> = {};
      if (run?.id) {
        const { data, error } = await supabase
          .from("payroll_items")
          .select(
            "id, payroll_run_id, employee_id, staff_id, salary_structure_id, working_days, paid_leave_days, unpaid_days, payable_days, gross_salary, lop_amount, pf_deduction, tax_deduction, other_deduction, total_deductions, net_salary, status, notes",
          )
          .eq("school_id", sid)
          .eq("payroll_run_id", run.id);

        if (error) throw new Error(`Payroll items: ${error.message}`);

        for (const item of (data || []) as Record<string, unknown>[]) {
          const id = item.staff_id || item.employee_id;
          if (id) savedItems[String(id)] = item;
        }
      }

      const { data: staffData, error: staffError } = await supabase
        .from("staff")
        .select(
          "id, school_id, employee_no, first_name, middle_name, last_name, designation, status, joining_date",
        )
        .eq("school_id", sid)
        .eq("status", "active")
        .order("first_name", { ascending: true });

      if (staffError) throw new Error(`Staff: ${staffError.message}`);

      const { data: salaryData, error: salaryError } = await supabase
        .from("staff_salary_structures")
        .select("*")
        .eq("school_id", sid);

      if (salaryError) throw new Error(`Salary structure: ${salaryError.message}`);

      const salaryMap = new Map<string, Salary>();
      for (const raw of (salaryData || []) as Record<string, unknown>[]) {
        const id = raw.staff_id || raw.employee_id;
        if (!id) continue;
        const salary = normalizeSalary(raw, String(id));
        if (raw.is_active !== false) salaryMap.set(String(id), salary);
      }

      const firstSaved = Object.values(savedItems)[0];
      const firstAttendance = attendance?.[0] as Record<string, unknown> | undefined;
      const initialWorkingDays =
        n(firstSaved?.working_days) ||
        n(firstAttendance?.working_days) ||
        defaultDays;

      setWorkingDays(initialWorkingDays);

      const nextRows: Row[] = ((staffData || []) as Staff[]).map((s) => {
        const salary = salaryMap.get(s.id) || null;
        const att = attendanceMap.get(s.id);
        const saved = savedItems[s.id];

        const wd = n(saved?.working_days) || n(att?.working_days) || initialWorkingDays;
        const paid = saved
          ? n(saved.paid_leave_days)
          : n(att?.paid_leave);
        const holiday = saved
          ? n(saved.school_holidays)
          : n(att?.school_holidays);

        // Saved payroll rows keep the user's attendance edits. Salary amounts
        // are always recalculated from the current Salary Structure so a stale
        // payroll item cannot hide an allowance that exists in the structure.
        const worked = saved
          ? Math.max(
              0,
              wd -
                n(saved.paid_leave_days) -
                n(saved.unpaid_days) -
                n(saved.school_holidays),
            )
          : n(att?.worked_days) ||
            Math.max(wd - paid - n(att?.unpaid_leave), 0);

        const result = calculate(salary, wd, worked, paid, holiday);

        return {
          staff: s,
          salary,
          worked,
          paidLeave: paid,
          holiday,
          unpaid: result.unpaid,
          payable: result.payable,
          gross: result.gross,
          deductions: result.deductions,
          net: result.net,
          expanded: false,
        };
      });

      setRows(nextRows);
    } catch (e) {
      console.error("PAYROLL LOAD ERROR", e);
      setError(e instanceof Error ? e.message : "Unable to load Payroll.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void loadPayroll();
  }, [loadPayroll]);

  function updateRow(
    staffId: string,
    key: "worked" | "paidLeave" | "holiday",
    value: number,
  ) {
    if (locked) return;

    setRows((current) =>
      current.map((r) => {
        if (r.staff.id !== staffId) return r;

        const next = {
          worked: key === "worked" ? value : r.worked,
          paidLeave: key === "paidLeave" ? value : r.paidLeave,
          holiday: key === "holiday" ? value : r.holiday,
        };

        const result = calculate(
          r.salary,
          workingDays,
          next.worked,
          next.paidLeave,
          next.holiday,
        );

        return {
          ...r,
          ...next,
          unpaid: result.unpaid,
          payable: result.payable,
          gross: result.gross,
          deductions: result.deductions,
          net: result.net,
        };
      }),
    );
  }

  function changeMonth(value: string) {
    setMonth(value);
    setWorkingDays(daysInMonth(value));
  }

  async function savePayroll(): Promise<PayrollRun | null> {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!schoolId || !month) throw new Error("Select a payroll month.");
      if (!rows.length) throw new Error("No active staff found.");

      if (locked) throw new Error("This payroll has already been prepared and is locked.");

      for (const r of rows) {
        if (!r.salary) {
          throw new Error(`${staffName(r.staff)} does not have a Salary Structure.`);
        }

        if (
          r.worked < 0 ||
          r.paidLeave < 0 ||
          r.holiday < 0 ||
          r.worked + r.paidLeave + r.holiday > workingDays
        ) {
          throw new Error(
            `Invalid attendance for ${staffName(r.staff)}. Worked + paid leave + holiday cannot exceed ${workingDays}.`,
          );
        }
      }

      const [year, monthNumber] = month.split("-").map(Number);
      const now = new Date().toISOString();

      /*
       * IMPORTANT:
       * The real database has payroll_runs(month, year) and payroll_items.
       * It does NOT have payroll_monthly_runs/payroll_monthly_items.
       *
       * We deliberately SELECT first, then UPDATE or INSERT.
       * This avoids depending on a missing UNIQUE constraint for
       * (school_id, month, year).
       */
      let run: PayrollRun | null = null;

      const { data: existing, error: existingError } = await supabase
        .from("payroll_runs")
        .select(
          "id, school_id, month, year, status, total_staff, total_gross, total_deductions, total_lop, total_net, created_at, updated_at, finalized_at, finalized_by",
        )
        .eq("school_id", schoolId)
        .eq("month", monthNumber)
        .eq("year", year)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing?.status === "prepared" || existing?.status === "finalized") {
        throw new Error("This payroll has already been prepared/finalized and cannot be edited.");
      }

      const runPayload = {
        school_id: schoolId,
        month: monthNumber,
        year,
        status: "draft",
        total_staff: totals.staff,
        total_gross: Number(totals.gross.toFixed(2)),
        total_deductions: Number(totals.deductions.toFixed(2)),
        total_lop: Number(totals.lop.toFixed(2)),
        total_net: Number(totals.net.toFixed(2)),
        updated_at: now,
      };

      if (existing?.id) {
        const { data, error } = await supabase
          .from("payroll_runs")
          .update(runPayload)
          .eq("id", existing.id)
          .eq("school_id", schoolId)
          .select(
            "id, school_id, month, year, status, total_staff, total_gross, total_deductions, total_lop, total_net, created_at, updated_at, finalized_at, finalized_by",
          )
          .single();

        if (error) throw new Error(`Unable to update payroll run: ${error.message}`);
        run = data as PayrollRun;
      } else {
        const { data, error } = await supabase
          .from("payroll_runs")
          .insert({
            ...runPayload,
            created_at: now,
          })
          .select(
            "id, school_id, month, year, status, total_staff, total_gross, total_deductions, total_lop, total_net, created_at, updated_at, finalized_at, finalized_by",
          )
          .single();

        if (error) throw new Error(`Unable to create payroll run: ${error.message}`);
        run = data as PayrollRun;
      }

      if (!run?.id) throw new Error("Payroll run was not returned after saving.");

      /*
       * payroll_items.employee_id is NOT nullable and references
       * employees.id.
       *
       * The Payroll screen is driven by the staff table, so keep Staff and
       * Employee identities separate. If an employee row is missing, create
       * the corresponding employee record using the SAME UUID as staff.id.
       *
       * This is safe because we first look for an existing employee and only
       * create one when there is no match. We never invent a foreign key.
       *
       * We resolve before deleting existing payroll items so a failed sync
       * cannot destroy an already-saved payroll.
       */
      /*
       * payroll_items.employee_id is NOT NULL and references employees.id.
       *
       * REAL employees schema:
       *   id, school_id, user_id, employee_code, name, designation,
       *   joining_date, phone, email, monthly_salary, bank_account,
       *   ifsc_code, status, created_at
       *
       * There is NO employee_no and NO staff_id column on employees.
       *
       * Staff.employee_no maps to Employees.employee_code.
       */
      const { data: employeeRows, error: employeeLookupError } = await supabase
        .from("employees")
        .select(
          "id, school_id, user_id, employee_code, name, designation, joining_date, phone, email, monthly_salary, bank_account, ifsc_code, status, created_at",
        )
        .eq("school_id", schoolId);

      if (employeeLookupError) {
        throw new Error(
          `Unable to load employee records for payroll: ${employeeLookupError.message}`,
        );
      }

      const employeeForStaff = new Map<string, Record<string, unknown>>();
      const syncedEmployees: Record<string, unknown>[] = [
        ...((employeeRows || []) as Record<string, unknown>[]),
      ];

      for (const staffMember of rows.map((r) => r.staff)) {
        const employeeCode = String(staffMember.employee_no || "").trim();
        const fullName = staffName(staffMember).trim();

        /*
         * Match the Staff master to Employee master using the real schema.
         * Employee code is the stable cross-table identifier in this schema.
         */
        let employee = syncedEmployees.find((candidate) => {
          return (
            String(candidate.employee_code || "").trim() === employeeCode
          );
        });

        /*
         * A code may be blank in older data. Only then allow a cautious
         * same-name match within this school.
         */
        if (!employee && !employeeCode) {
          employee = syncedEmployees.find((candidate) => {
            return (
              String(candidate.name || "").trim().toLowerCase() ===
              fullName.toLowerCase()
            );
          });
        }

        if (!employee?.id) {
          /*
           * Create the missing Employee using ONLY columns that actually
           * exist in the user's employees table.
           */
          const monthlySalary = Number(
            (
              rows.find((r) => r.staff.id === staffMember.id)?.salary
                ?.gross_salary || 0
            ).toFixed(2),
          );

          const employeePayload = {
            school_id: schoolId,
            employee_code: employeeCode || null,
            name: fullName || employeeCode || "Staff",
            designation: staffMember.designation || null,
            joining_date: staffMember.joining_date || null,
            phone: null,
            email: null,
            monthly_salary: monthlySalary,
            status: staffMember.status || "active",
          };

          const { data: createdEmployee, error: createEmployeeError } =
            await supabase
              .from("employees")
              .insert(employeePayload)
              .select(
                "id, school_id, user_id, employee_code, name, designation, joining_date, phone, email, monthly_salary, bank_account, ifsc_code, status, created_at",
              )
              .single();

          if (createEmployeeError) {
            /*
             * A duplicate employee_code can happen if another request
             * created it between lookup and insert. Re-read using the
             * REAL employee_code column.
             */
            let existingAfterInsert: Record<string, unknown> | null = null;
            let rereadError: { message: string } | null = null;

            if (employeeCode) {
              const reread = await supabase
                .from("employees")
                .select(
                  "id, school_id, user_id, employee_code, name, designation, joining_date, phone, email, monthly_salary, bank_account, ifsc_code, status, created_at",
                )
                .eq("school_id", schoolId)
                .eq("employee_code", employeeCode)
                .limit(1)
                .maybeSingle();

              existingAfterInsert =
                (reread.data as Record<string, unknown> | null) || null;
              rereadError = reread.error
                ? { message: reread.error.message }
                : null;
            }

            if (rereadError || !existingAfterInsert?.id) {
              throw new Error(
                `Unable to create/sync employee for ${fullName} (${employeeCode || "no employee code"}): ${createEmployeeError.message}`,
              );
            }

            employee = existingAfterInsert;
          } else {
            employee = createdEmployee as Record<string, unknown>;
            syncedEmployees.push(employee);
          }
        }

        if (!employee?.id) {
          throw new Error(
            `Unable to resolve employee record for ${fullName} (${employeeCode || "no employee code"}).`,
          );
        }

        employeeForStaff.set(staffMember.id, employee);
      }

      /*
       * IMPORTANT:
       * Resolve all employee IDs BEFORE deleting old payroll items.
       * A failed employee sync therefore cannot destroy a saved payroll.
       */
      const { error: deleteError } = await supabase
        .from("payroll_items")
        .delete()
        .eq("payroll_run_id", run.id)
        .eq("school_id", schoolId);

      if (deleteError) {
        throw new Error(`Unable to replace payroll items: ${deleteError.message}`);
      }

      const items = rows.map((r) => ({
        school_id: schoolId,
        payroll_run_id: run!.id,
        employee_id: String(employeeForStaff.get(r.staff.id)!.id),
        staff_id: r.staff.id,

        salary_structure_id: r.salary?.id || null,
        basic_salary: Number((r.salary?.basic_salary || 0).toFixed(2)),
        allowances: Number((r.salary?.allowances || 0).toFixed(2)),
        deductions: Number(r.deductions.toFixed(2)),
        net_salary: Number(r.net.toFixed(2)),
        paid_amount: 0,
        paid: false,
        working_days: Number(workingDays),
        paid_leave_days: Number(r.paidLeave),
        unpaid_days: Number(r.unpaid),
        payable_days: Number(r.payable),
        gross_salary: Number(r.gross.toFixed(2)),
        lop_amount: Number(
          (workingDays > 0 && r.salary
            ? r.salary.gross_salary * (r.unpaid / workingDays)
            : 0
          ).toFixed(2),
        ),
        pf_deduction: 0,
        tax_deduction: 0,
        other_deduction: Number(r.deductions.toFixed(2)),
        total_deductions: Number(r.deductions.toFixed(2)),
        status: "draft",
        notes: `Offline attendance: ${r.worked} worked, ${r.paidLeave} paid leave, ${r.holiday} holiday, ${r.unpaid} unpaid.`,
      }));

      /*
       * employee_id is the real employees.id value. staff_id remains the
       * Staff UUID used by attendance/salary data.
       */
      const { error: itemError } = await supabase
        .from("payroll_items")
        .insert(items);

      if (itemError) {
        throw new Error(`Unable to save payroll items: ${itemError.message}`);
      }

      setSavedRun(run);
      setEditing(false);
      setSuccess(`Payroll saved for ${monthText(month)}. You can edit it again before payment.`);
      return run;
    } catch (e) {
      console.error("SAVE PAYROLL ERROR", e);
      setError(e instanceof Error ? e.message : "Unable to save Payroll.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function deletePayroll() {
    if (!savedRun?.id || !schoolId) {
      setError("There is no saved payroll to delete.");
      return;
    }

    if (locked) {
      setError("Prepared payroll cannot be deleted. Reverse the accounting payment first.");
      return;
    }

    if (!window.confirm(`Delete the saved payroll for ${monthText(month)}? This does not delete Attendance or Salary Structure.`)) {
      return;
    }

    setDeleting(true);
    setError("");
    setSuccess("");

    try {
      const { error: itemError } = await supabase
        .from("payroll_items")
        .delete()
        .eq("payroll_run_id", savedRun.id)
        .eq("school_id", schoolId);

      if (itemError) throw new Error(`Unable to delete payroll items: ${itemError.message}`);

      const { error: runError } = await supabase
        .from("payroll_runs")
        .delete()
        .eq("id", savedRun.id)
        .eq("school_id", schoolId);

      if (runError) throw new Error(`Unable to delete payroll run: ${runError.message}`);

      setSavedRun(null);
      setEditing(true);
      await loadPayroll();
      setSuccess(`Saved payroll for ${monthText(month)} was deleted. Attendance and salary data were kept.`);
    } catch (e) {
      console.error("DELETE PAYROLL ERROR", e);
      setError(e instanceof Error ? e.message : "Unable to delete Payroll.");
    } finally {
      setDeleting(false);
    }
  }

  async function preparePayment() {
    setError("");
    setSuccess("");

    if (!schoolId) {
      setError("Current school could not be determined.");
      return;
    }

    if (!savedRun?.id) {
      setError("Save Monthly Payroll first.");
      return;
    }

    if (editing) {
      setError("Save your changes before preparing Salary Payment.");
      return;
    }

    setPreparing(true);

    try {
      /*
       * IMPORTANT RECOVERY FLOW
       *
       * Your screenshot is the exact case where the previous attempt already
       * prepared this payroll. The old code then blocked the button with:
       *
       *   if (locked) "This payroll has already been prepared."
       *
       * That made "Continue Salary Payment" useless.
       *
       * A prepared payroll is NOT a completed payment. It means the salary
       * expense/payable journal already exists. We must find that journal and
       * continue to the Payment screen.
       */

      const payrollAmount = Number(
        totals.net.toFixed(2),
      );

      if (payrollAmount <= 0) {
        throw new Error(
          "There is no positive net payroll amount.",
        );
      }

      let transactionId: string | null = null;
      let transactionNumber: string | null = null;
      let payableAccountId: string | null = null;
      let payableAccountName = "Salary Payable";
      let expenseAccountId: string | null = null;
      let expenseAccountName = "Salary Expense";

      /*
       * Check whether this payroll has already been paid.
       * A settlement payment uses reference_type = "payment" and
       * reference_id = payroll_run_id.
       */
      const {
        data: existingSettlement,
        error: settlementCheckError,
      } = await supabase
        .from("transactions")
        .select("id, transaction_number")
        .eq("school_id", schoolId)
        .eq("transaction_type", "expense")
        .eq("reference_type", "payment")
        .eq("reference_id", savedRun.id)
        .limit(1)
        .maybeSingle();

      if (settlementCheckError) {
        throw new Error(
          `Unable to check payroll payment status: ${settlementCheckError.message}`,
        );
      }

      if (existingSettlement?.id) {
        throw new Error(
          `This payroll has already been paid${
            existingSettlement.transaction_number
              ? ` — ${existingSettlement.transaction_number}`
              : ""
          }.`,
        );
      }

      /*
       * If the payroll is already prepared, recover the existing
       * Salary Expense -> Salary Payable journal instead of calling
       * prepare_payroll_accounting again.
       */
      if (locked || savedRun.status === "prepared") {
        const {
          data: preparedTransaction,
          error: preparedTransactionError,
        } = await supabase
          .from("transactions")
          .select(
            "id, transaction_number, transaction_date, description",
          )
          .eq("school_id", schoolId)
          .eq("transaction_type", "expense")
          .eq("reference_type", "payroll")
          .eq("reference_id", savedRun.id)
          .order("created_at", {
            ascending: false,
          })
          .limit(1)
          .maybeSingle();

        if (preparedTransactionError) {
          throw new Error(
            `Unable to recover the prepared salary journal: ${preparedTransactionError.message}`,
          );
        }

        if (!preparedTransaction?.id) {
          throw new Error(
            "This payroll is marked Prepared, but its Salary Expense / Salary Payable journal was not found. Do not prepare it again; check the accounting records first.",
          );
        }

        transactionId =
          preparedTransaction.id;
        transactionNumber =
          preparedTransaction.transaction_number ||
          null;

        const {
          data: preparedEntries,
          error: preparedEntriesError,
        } = await supabase
          .from("transaction_entries")
          .select(
            "account_id, debit, credit",
          )
          .eq("school_id", schoolId)
          .eq(
            "transaction_id",
            preparedTransaction.id,
          );

        if (preparedEntriesError) {
          throw new Error(
            `Unable to recover salary journal entries: ${preparedEntriesError.message}`,
          );
        }

        const accountIds =
          (preparedEntries || [])
            .map(
              (entry) =>
                entry.account_id,
            )
            .filter(Boolean);

        if (!accountIds.length) {
          throw new Error(
            "The prepared salary journal has no accounting entries.",
          );
        }

        const {
          data: preparedAccounts,
          error: preparedAccountsError,
        } = await supabase
          .from("accounts")
          .select(
            "id, name, account_type",
          )
          .eq(
            "school_id",
            schoolId,
          )
          .in(
            "id",
            accountIds,
          );

        if (preparedAccountsError) {
          throw new Error(
            `Unable to recover salary accounts: ${preparedAccountsError.message}`,
          );
        }

        for (const account of
          preparedAccounts || []) {
          const entry =
            (preparedEntries || [])
              .find(
                (item) =>
                  item.account_id ===
                  account.id,
              );

          if (!entry) {
            continue;
          }

          if (
            Number(entry.credit || 0) >
              0 &&
            (account.account_type ===
              "payable" ||
              account.account_type ===
                "liability")
          ) {
            payableAccountId =
              account.id;
            payableAccountName =
              account.name;
          }

          if (
            Number(entry.debit || 0) >
              0 &&
            account.account_type ===
              "expense"
          ) {
            expenseAccountId =
              account.id;
            expenseAccountName =
              account.name;
          }
        }

        if (!payableAccountId) {
          throw new Error(
            "Salary Payable account could not be recovered from the prepared journal.",
          );
        }
      } else {
        /*
         * First-time preparation:
         *
         *   Dr Salary / Wages Expense
         *   Cr Salary Payable
         *
         * The RPC is responsible for creating this journal and changing
         * the payroll status to prepared.
         */
        const {
          data,
          error,
        } = await supabase.rpc(
          "prepare_payroll_accounting",
          {
            p_payroll_run_id:
              savedRun.id,
          },
        );

        if (error) {
          throw new Error(
            `Unable to prepare salary accounting: ${error.message}`,
          );
        }

        if (!data?.success) {
          throw new Error(
            "Salary payroll accounting was not completed.",
          );
        }

        transactionId =
          data.transaction_id ||
          null;
        transactionNumber =
          data.transaction_number ||
          null;
        payableAccountId =
          data.payable_account_id ||
          null;
        payableAccountName =
          data.payable_account_name ||
          "Salary Payable";
        expenseAccountId =
          data.expense_account_id ||
          null;
        expenseAccountName =
          data.expense_account_name ||
          "Salary Expense";
      }

      if (!transactionId) {
        throw new Error(
          "Salary accounting transaction could not be determined.",
        );
      }

      if (!payableAccountId) {
        throw new Error(
          "Salary Payable account could not be determined.",
        );
      }

      const payload = {
        source: "payroll",
        school_id: schoolId,
        payroll_run_id: savedRun.id,
        payroll_month: month,
        amount: payrollAmount,
        particulars:
          `Salary Payroll - ${monthText(month)}`,
        reference:
          `PAYROLL-${month}`,
        staff_count:
          totals.staff,

        accounting_transaction_id:
          transactionId,
        accounting_transaction_number:
          transactionNumber,

        payable_account_id:
          payableAccountId,
        payable_account_name:
          payableAccountName,

        expense_account_id:
          expenseAccountId,
        expense_account_name:
          expenseAccountName,

        accounting_status:
          "payable_created",
      };

      try {
        window.sessionStorage.setItem(
          "schoolflow_payroll_payment",
          JSON.stringify(payload),
        );
      } catch {
        // Session storage is only a convenience bridge.
      }

      /*
       * Keep the local UI state synchronized. Do NOT create another
       * payroll journal when the payroll is already prepared.
       */
      if (
        savedRun.status !==
        "prepared"
      ) {
        setSavedRun({
          ...savedRun,
          status: "prepared",
          updated_at:
            new Date().toISOString(),
        });
      }

      setEditing(false);

      /*
       * This is the actual existing Accounting Payment route.
       *
       * Payroll settlement will post:
       *   Dr Salary Payable
       *   Cr Cash/Bank
       */
      const paymentUrl =
        `/accounting/payment?source=payroll` +
        `&run_id=${encodeURIComponent(
          savedRun.id,
        )}` +
        `&month=${encodeURIComponent(
          month,
        )}` +
        `&amount=${encodeURIComponent(
          payrollAmount.toFixed(2),
        )}` +
        `&particulars=${encodeURIComponent(
          payload.particulars,
        )}` +
        `&reference=${encodeURIComponent(
          payload.reference,
        )}` +
        `&payable_account_id=${encodeURIComponent(
          payableAccountId,
        )}` +
        `&accounting_transaction_id=${encodeURIComponent(
          transactionId,
        )}`;

      window.location.assign(
        paymentUrl,
      );
    } catch (e) {
      console.error(
        "PREPARE PAYROLL ERROR",
        e,
      );

      setError(
        e instanceof Error
          ? e.message
          : "Unable to prepare Salary Payment.",
      );
    } finally {
      setPreparing(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600"
            >
              <ArrowLeft size={16} />
              Dashboard
            </Link>

            <div className="mt-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
                <Calculator size={22} />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900">Payroll</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Offline attendance → monthly salary → payment
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadPayroll()}
            disabled={loading || saving || preparing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Payroll error</p>
              <p className="mt-1">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <p>{success}</p>
          </div>
        )}

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Payroll Month
              </label>
              <input
                type="month"
                value={month}
                onChange={(e) => changeMonth(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Working Days
              </label>
              <input
                type="number"
                min={1}
                value={workingDays}
                disabled={locked}
                onChange={(e) => {
                  const value = Math.max(1, n(e.target.value));
                  setWorkingDays(value);
                  setRows((current) =>
                    current.map((r) => {
                      const result = calculate(r.salary, value, r.worked, r.paidLeave, r.holiday);
                      return { ...r, worked: Math.min(r.worked, value), unpaid: result.unpaid, payable: result.payable, gross: result.gross, deductions: result.deductions, net: result.net };
                    }),
                  );
                }}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold outline-none focus:border-blue-500 disabled:bg-slate-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Status
              </label>
              <div className="flex h-[42px] items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold">
                {locked ? (
                  <span className="inline-flex items-center gap-2 text-slate-600">
                    <Lock size={15} /> Prepared & Locked
                  </span>
                ) : savedRun ? (
                  <span className="text-emerald-700">Saved</span>
                ) : (
                  <span className="text-amber-700">Not Saved</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Staff" value={String(totals.staff)} />
            <Stat label="Gross" value={money(totals.gross)} />
            <Stat label="LOP" value={money(totals.lop)} />
            <Stat label="Net Payroll" value={money(totals.net)} highlight />
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">Staff & Monthly Attendance</p>
              <p className="text-xs text-slate-500">
                Add/edit Salary and enter offline Attendance for any staff member without leaving the payroll workflow.
              </p>
            </div>
            <Link
              href="/dashboard/staff"
              className="text-xs font-bold text-blue-700 hover:underline"
            >
              Open Staff →
            </Link>
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff name, employee number or designation..."
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
          />
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-bold text-slate-900">Monthly Payroll</h2>
              <p className="mt-1 text-xs text-slate-500">
                Salary comes from each staff member's Salary Structure. Attendance and leave come from Offline Attendance.
                Paid leave and holidays are payable; unpaid days reduce salary.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {savedRun && !locked && !editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(true);
                    setError("");
                    setSuccess("");
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700"
                >
                  <Pencil size={15} /> Edit Payroll
                </button>
              )}

              {savedRun && !locked && (
                <button
                  type="button"
                  onClick={() => void deletePayroll()}
                  disabled={deleting || saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 disabled:opacity-50"
                >
                  {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  Delete
                </button>
              )}

              {!locked && editing && (
                <button
                  type="button"
                  onClick={() => void savePayroll()}
                  disabled={saving || loading}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? "Saving..." : "Save Payroll"}
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-14 text-sm text-slate-500">
              <Loader2 size={22} className="mr-2 animate-spin" />
              Loading staff, salary and attendance...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-14 text-center text-sm text-slate-500">No active staff found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {["Staff", "Working", "Worked", "Paid Leave", "Holiday", "Unpaid", "Payable", "Gross", "Deductions", "Net", "Action"].map((h) => (
                      <th key={h} className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((r) => (
                    <tr key={r.staff.id} className="hover:bg-slate-50">
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-900">{staffName(r.staff)}</div>
                        <div className="text-xs text-slate-500">
                          {r.staff.employee_no} · {r.staff.designation || "No designation"}
                        </div>
                        {!r.salary && (
                          <span className="mt-1 inline-block text-xs font-semibold text-red-600">
                            Salary Structure Missing — click Add Salary
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-center font-semibold">{workingDays}</td>

                      <DayInput
                        value={r.worked}
                        disabled={!editing || locked || !r.salary}
                        max={workingDays}
                        onChange={(v) => updateRow(r.staff.id, "worked", v)}
                      />

                      <DayInput
                        value={r.paidLeave}
                        disabled={!editing || locked || !r.salary}
                        max={workingDays}
                        onChange={(v) => updateRow(r.staff.id, "paidLeave", v)}
                      />

                      <DayInput
                        value={r.holiday}
                        disabled={!editing || locked || !r.salary}
                        max={workingDays}
                        onChange={(v) => updateRow(r.staff.id, "holiday", v)}
                      />

                      <td className="px-4 py-4 text-center font-bold text-red-600">{r.unpaid}</td>
                      <td className="px-4 py-4 text-center font-bold">{r.payable}</td>
                      <td className="px-4 py-4 text-right font-semibold">{r.salary ? money(r.gross) : "—"}</td>
                      <td className="px-4 py-4 text-right">{r.salary ? money(r.deductions) : "—"}</td>
                      <td className="px-4 py-4 text-right font-bold text-blue-700">{r.salary ? money(r.net) : "—"}</td>

                      <td className="px-4 py-4">
                        <div className="flex min-w-[210px] flex-wrap items-center justify-center gap-2">
                          <Link
                            href={`/dashboard/staff/${r.staff.id}/salary`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            title="Add or edit salary structure"
                          >
                            <Pencil size={13} />
                            {r.salary ? "Edit Salary" : "Add Salary"}
                          </Link>

                          <Link
                            href={`/dashboard/staff/${r.staff.id}/attendance`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                            title="Enter offline attendance and leave"
                          >
                            Attendance
                          </Link>

                          {r.salary && (
                            <button
                              type="button"
                              onClick={() =>
                                setRows((current) =>
                                  current.map((x) =>
                                    x.staff.id === r.staff.id
                                      ? { ...x, expanded: !x.expanded }
                                      : x,
                                  ),
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                              title="Show salary details"
                            >
                              {r.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              Details
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredRows.map(
                    (r) =>
                      r.expanded &&
                      r.salary && (
                        <tr key={`${r.staff.id}-details`} className="bg-slate-50">
                          <td colSpan={11} className="px-5 py-4">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <Detail label="Basic" value={money(r.salary.basic_salary)} />
                              <Detail label="House" value={money(r.salary.house_allowance)} />
                              <Detail label="Transport" value={money(r.salary.transport_allowance)} />
                              <Detail label="Medical" value={money(r.salary.medical_allowance)} />
                              <Detail label="Other Allowance" value={money(r.salary.other_allowance)} />
                              <Detail label="Total Allowances" value={money(r.salary.allowances)} />
                              <Detail label="Gross Monthly" value={money(r.salary.gross_salary)} />
                              <Detail label="Fixed Deductions" value={money(r.salary.deductions)} />
                              <Detail label="Calculated Net" value={money(r.net)} />
                            </div>
                          </td>
                        </tr>
                      ),
                  )}
                </tbody>

                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="px-4 py-4 font-bold">TOTAL</td>
                    <td colSpan={6} />
                    <td className="px-4 py-4 text-right font-bold">{money(totals.gross)}</td>
                    <td className="px-4 py-4 text-right font-bold">{money(totals.deductions)}</td>
                    <td className="px-4 py-4 text-right text-lg font-bold text-blue-700">{money(totals.net)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <section className="mt-5 rounded-2xl border border-blue-200 bg-white shadow-sm">
          <div className="border-b border-blue-100 bg-blue-50/60 px-5 py-4">
            <h2 className="font-bold text-slate-900">Payment Preparation</h2>
            <p className="mt-1 text-xs text-slate-500">
              If you have unsaved changes, this button saves them automatically, creates Salary Payable, then opens Accounting Payment.
            </p>
          </div>

          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Amount to Pay</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">{money(totals.net)}</p>
              <p className="mt-1 text-sm text-slate-500">{monthText(month)}</p>
            </div>

            <button
              type="button"
              onClick={() => void preparePayment()}
              disabled={
                loading ||
                saving ||
                preparing ||
                totals.net <= 0
              }
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {preparing ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} />}
              {preparing
                ? "Preparing..."
                : locked
                  ? "Continue Salary Payment"
                  : editing
                    ? "Save & Prepare Salary Payment"
                    : "Prepare Salary Payment"}
            </button>
          </div>
        </section>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
          <strong className="text-slate-700">Accounting:</strong> the final payment is handed to the existing
          Accounting Payment flow, which should create the <code>transactions</code> and
          <code>transaction_entries</code> records used by Cash Book, Bank Book, Ledger and reports.
        </div>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-blue-200 bg-blue-50/50" : "border-slate-200 bg-slate-50"}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${highlight ? "text-blue-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-bold text-slate-900">{value}</p>
    </div>
  );
}

function DayInput({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <td className="px-4 py-4">
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Math.max(0, Math.min(max, n(e.target.value)));
          onChange(v);
        }}
        className="mx-auto block w-20 rounded-lg border border-slate-300 px-2 py-2 text-center text-sm font-semibold outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
      />
    </td>
  );
}
