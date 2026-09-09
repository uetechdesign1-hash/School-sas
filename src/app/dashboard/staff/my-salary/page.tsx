"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  employee_no: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  department: string | null;
};

type SalaryStructure = {
  id: string;
  effective_from: string;
  basic_salary: number | null;
  house_allowance: number | null;
  transport_allowance: number | null;
  medical_allowance: number | null;
  other_allowance: number | null;
  pf_deduction: number | null;
  tax_deduction: number | null;
  other_deduction: number | null;
  notes: string | null;
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function amount(value: number | null | undefined) {
  return Number(value || 0);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function staffName(staff: Staff) {
  return [
    staff.first_name,
    staff.middle_name,
    staff.last_name,
  ]
    .filter(Boolean)
    .join(" ") || "Staff Member";
}

function SalaryRow({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{money(value)}</span>
    </div>
  );
}

export default function MySalaryPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [salary, setSalary] = useState<SalaryStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSalary() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.push("/login");
          return;
        }

        const { data: staffRow, error: staffError } = await supabase
          .from("staff")
          .select(
            "id, employee_no, first_name, middle_name, last_name, designation, department",
          )
          .eq("user_id", user.id)
          .maybeSingle();

        if (staffError) throw staffError;
        if (!staffRow) {
          throw new Error("Your login is not linked to a staff member.");
        }

        setStaff(staffRow as Staff);

        const { data: salaryRow, error: salaryError } = await supabase
          .from("staff_salary_structures")
          .select(
            "id, effective_from, basic_salary, house_allowance, transport_allowance, medical_allowance, other_allowance, pf_deduction, tax_deduction, other_deduction, notes",
          )
          .eq("staff_id", staffRow.id)
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (salaryError) throw salaryError;
        setSalary(salaryRow as SalaryStructure | null);
      } catch (loadError) {
        console.error("MY SALARY LOAD ERROR:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load your salary.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadSalary();
  }, [router, supabase]);

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          Loading salary...
        </div>
      </div>
    );
  }

  if (error || !staff) {
    return (
      <div className="min-h-full bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-red-50 p-6">
          <h1 className="font-semibold text-red-800">Unable to load salary</h1>
          <p className="mt-2 text-sm text-red-700">
            {error || "Your staff profile could not be found."}
          </p>
        </div>
      </div>
    );
  }

  const allowances =
    amount(salary?.house_allowance) +
    amount(salary?.transport_allowance) +
    amount(salary?.medical_allowance) +
    amount(salary?.other_allowance);
  const deductions =
    amount(salary?.pf_deduction) +
    amount(salary?.tax_deduction) +
    amount(salary?.other_deduction);
  const gross = amount(salary?.basic_salary) + allowances;

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">My Salary</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {staffName(staff)}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {staff.employee_no || "Staff member"}
            {staff.designation ? ` • ${staff.designation}` : ""}
            {staff.department ? ` • ${staff.department}` : ""}
          </p>
        </div>

        {!salary ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="font-semibold text-amber-900">Salary not configured</h2>
            <p className="mt-2 text-sm text-amber-800">
              Your administrator has not added a salary structure yet.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <Summary label="Basic Salary" value={money(salary.basic_salary)} />
              <Summary label="Gross Salary" value={money(gross)} />
              <Summary label="Fixed Net Salary" value={money(gross - deductions)} />
            </div>

            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Salary Structure</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Effective from {formatDate(salary.effective_from)}
                  </p>
                </div>
                <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                  Latest
                </span>
              </div>

              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Earnings
                  </h3>
                  <SalaryRow label="Basic salary" value={salary.basic_salary} />
                  <SalaryRow label="House allowance" value={salary.house_allowance} />
                  <SalaryRow label="Transport allowance" value={salary.transport_allowance} />
                  <SalaryRow label="Medical allowance" value={salary.medical_allowance} />
                  <SalaryRow label="Other allowance" value={salary.other_allowance} />
                  <SalaryRow label="Gross salary" value={gross} />
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Deductions
                  </h3>
                  <SalaryRow label="PF deduction" value={salary.pf_deduction} />
                  <SalaryRow label="Tax deduction" value={salary.tax_deduction} />
                  <SalaryRow label="Other deduction" value={salary.other_deduction} />
                  <SalaryRow label="Total deductions" value={deductions} />
                  <SalaryRow label="Fixed net salary" value={gross - deductions} />
                </div>
              </div>

              {salary.notes && (
                <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                  <span className="font-semibold text-slate-800">Notes: </span>
                  {salary.notes}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
