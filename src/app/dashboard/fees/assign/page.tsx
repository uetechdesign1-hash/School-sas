"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  annualAmount,
  assignYearFeesToStudent,
  listStudentsForClassYear,
} from "@/lib/fees/year-bill";

const supabase = createClient();

type AcademicYear = { id: string; name: string; is_current: boolean };
type SchoolClass = { id: string; name: string };
type StructureItem = {
  fee_category_id: string;
  amount: number;
  frequency: string;
  mandatory: boolean;
};
type Structure = {
  id: string;
  name: string;
  academic_year_id: string;
  class_id: string | null;
  items: StructureItem[];
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export default function AssignFeesPage() {
  const [schoolId, setSchoolId] = useState("");
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [structures, setStructures] = useState<Structure[]>([]);
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(new Map());
  const [studentCounts, setStudentCounts] = useState<Record<string, number>>({});

  const [yearId, setYearId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("school_users")
        .select("school_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("Your account is not assigned to a school.");

      const sid = membership.school_id as string;
      setSchoolId(sid);

      const [yearResult, classResult, categoryResult, structureResult] = await Promise.all([
        supabase
          .from("academic_years")
          .select("id, name, is_current")
          .eq("school_id", sid)
          .order("start_date", { ascending: false }),
        supabase
          .from("classes")
          .select("id, name")
          .eq("school_id", sid)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase.from("fee_categories").select("id, name").eq("school_id", sid),
        supabase
          .from("fee_structures")
          .select("id, name, academic_year_id, class_id, items:fee_structure_items(fee_category_id, amount, frequency, mandatory)")
          .eq("school_id", sid)
          .eq("active", true),
      ]);
      for (const result of [yearResult, classResult, categoryResult, structureResult]) {
        if (result.error) throw result.error;
      }

      const loadedYears = (yearResult.data || []) as AcademicYear[];
      setYears(loadedYears);
      setClasses((classResult.data || []) as SchoolClass[]);
      setCategoryNames(
        new Map((categoryResult.data || []).map((c: { id: string; name: string }) => [c.id, c.name])),
      );
      setStructures(
        ((structureResult.data || []) as unknown as Structure[]).map((structure) => ({
          ...structure,
          items: (structure.items || []).map((item) => ({
            ...item,
            amount: Number(item.amount || 0),
            mandatory: Boolean(item.mandatory),
          })),
        })),
      );
      setYearId((current) => current || loadedYears.find((y) => y.is_current)?.id || loadedYears[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load fee assignment data.");
    } finally {
      setLoading(false);
    }
  }

  // Student count per class for the selected year.
  useEffect(() => {
    if (!schoolId || !yearId || classes.length === 0) return;
    let cancelled = false;
    (async () => {
      const counts: Record<string, number> = {};
      for (const schoolClass of classes) {
        try {
          counts[schoolClass.id] = (await listStudentsForClassYear(supabase, schoolId, schoolClass.id, yearId)).length;
        } catch {
          counts[schoolClass.id] = 0;
        }
      }
      if (!cancelled) setStudentCounts(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId, yearId, classes]);

  const rows = useMemo(
    () =>
      classes.map((schoolClass) => {
        // Class structure first, then a structure that covers every class.
        const structure =
          structures.find((s) => s.academic_year_id === yearId && s.class_id === schoolClass.id) ||
          structures.find((s) => s.academic_year_id === yearId && s.class_id === null) ||
          null;
        const mandatory = (structure?.items || []).filter((item) => item.mandatory);
        const mandatoryTotal = mandatory.reduce((sum, item) => sum + annualAmount(item.amount, item.frequency), 0);
        return { schoolClass, structure, mandatory, mandatoryTotal };
      }),
    [classes, structures, yearId],
  );

  async function assignClass(schoolClass: SchoolClass, structure: Structure) {
    const key = schoolClass.id;
    setBusyKey(key);
    setError("");
    setSuccess("");
    try {
      const message = await runAssignment(schoolClass, structure);
      setSuccess(message);
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Unable to assign fees.");
    } finally {
      setBusyKey(null);
    }
  }

  async function assignAllClasses() {
    if (!window.confirm("Assign mandatory fees to every class that has a fee structure for this year?")) return;
    setBusyKey("all");
    setError("");
    setSuccess("");
    try {
      const messages: string[] = [];
      for (const row of rows) {
        if (!row.structure || row.mandatory.length === 0) continue;
        messages.push(await runAssignment(row.schoolClass, row.structure));
      }
      setSuccess(messages.length ? messages.join(" ") : "No class has a fee structure with mandatory fees for this year.");
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Unable to assign fees.");
    } finally {
      setBusyKey(null);
    }
  }

  async function runAssignment(schoolClass: SchoolClass, structure: Structure) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Your session expired. Sign in again.");

    const studentIds = await listStudentsForClassYear(supabase, schoolId, schoolClass.id, yearId);
    let students = 0;
    let created = 0;
    let feeLines = 0;
    let carryLines = 0;

    for (const studentId of studentIds) {
      const result = await assignYearFeesToStudent(supabase, {
        schoolId,
        studentId,
        academicYearId: yearId,
        structureId: structure.id,
        structureName: structure.name,
        items: structure.items,
        categoryNames,
        userId: user.id,
      });
      students += 1;
      if (result.createdBill) created += 1;
      feeLines += result.mandatoryLinesAdded;
      carryLines += result.carryLinesAdded;
    }

    return `${schoolClass.name}: ${students} student(s) processed, ${created} new bill(s), ${feeLines} fee line(s) added, ${carryLines} previous-year line(s) carried in.`;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">Fees</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-900">Assign Fees</h1>
            <p className="mt-1 text-sm text-slate-500">
              One click assigns every <strong>mandatory</strong> fee of the class fee structure to all active
              students of that class, and brings in unpaid fees from earlier years as
              &quot;Fee Name - Old Year&quot; lines.
            </p>
          </div>

          <Link
            href="/dashboard/fees/structure"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Manage Fee Structure
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label htmlFor="assign-year" className="text-sm font-semibold text-slate-700">
            Academic Year
          </label>
          <select
            id="assign-year"
            value={yearId}
            onChange={(event) => setYearId(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          >
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
                {year.is_current ? " (Current)" : ""}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void assignAllClasses()}
            disabled={busyKey !== null || loading}
            className="ml-auto rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busyKey === "all" ? "Assigning..." : "Assign All Classes"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>
        )}
        {success && (
          <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{success}</div>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <p className="p-10 text-center text-sm text-slate-500">Loading...</p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Class</th>
                  <th className="px-5 py-3">Students</th>
                  <th className="px-5 py-3">Fee structure</th>
                  <th className="px-5 py-3 text-right">Mandatory total</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ schoolClass, structure, mandatory, mandatoryTotal }) => (
                  <tr key={schoolClass.id}>
                    <td className="px-5 py-4 font-semibold text-slate-900">{schoolClass.name}</td>
                    <td className="px-5 py-4 text-slate-600">{studentCounts[schoolClass.id] ?? "…"}</td>
                    <td className="px-5 py-4 text-slate-600">
                      {structure ? (
                        <>
                          {structure.name}
                          <span className="block text-xs text-slate-400">
                            {mandatory.map((item) => categoryNames.get(item.fee_category_id) || "Fee").join(", ") ||
                              "No mandatory fees"}
                          </span>
                        </>
                      ) : (
                        <span className="text-amber-700">No active structure for this year</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-medium text-slate-700">{money(mandatoryTotal)}</td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        disabled={!structure || mandatory.length === 0 || busyKey !== null}
                        onClick={() => structure && void assignClass(schoolClass, structure)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
                      >
                        {busyKey === schoolClass.id ? "Assigning..." : "Assign Fees"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
