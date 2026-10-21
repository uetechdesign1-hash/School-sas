"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  IndianRupee,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Student = {
  id: string;
  admission_no: string;
  roll_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  class_id: string | null;
  section_id: string | null;
  status: string;
  academic_year_id: string | null;
};

type SchoolClass = {
  id: string;
  name: string;
  display_order: number;
};

type Section = {
  id: string;
  class_id: string;
  name: string;
};

type AcademicYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type FeeBill = {
  id: string;
  student_id: string;
  academic_year_id: string | null;
  bill_date: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  balance_amount: number | null;
  status?: string | null;
};

type FeePaymentRow = {
  bill_id: string | null;
  amount: number | null;
};

type FeeBillItem = {
  id: string;
  bill_id: string;
  fee_structure_id: string | null;
  fee_category_id: string | null;
  description: string | null;
};

type FeeAllocation = {
  fee_bill_item_id: string | null;
  amount: number;
};

type FeeConcession = {
  student_id: string;
  bill_id: string | null;
  amount: number;
};

type StructureRow = {
  id: string;
  academic_year_id: string;
  class_id: string;
};

type StructureItem = {
  fee_structure_id: string;
  fee_category_id: string | null;
};

type EnrollmentRow = {
  student_id: string;
  academic_year_id: string;
  class_id: string | null;
  section_id: string | null;
};

type ReportCategory = {
  key: string;
  label: string;
};

type ReportRow = {
  studentId: string;
  name: string;
  className: string;
  sectionName: string;
  assigned: number;
  paid: Record<string, number>;
  concession: number;
  total: number;
  pending: number;
};

type ReportData = {
  categories: ReportCategory[];
  rows: ReportRow[];
  totals: { assigned: number; paid: Record<string, number>; concession: number; total: number; pending: number };
};

// Supabase builders are thenable and can be paged with .range(). Kept
// structural so this helper works with the untyped browser client.
type PagedQuery = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>;
};

async function fetchAll(query: PagedQuery, pageSize = 1000) {
  const rows: unknown[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const batch = data || [];
    rows.push(...batch);

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(round2(value));
}

function getStudentName(student: Student) {
  return [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(" ");
}

function safeFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "fee-structure"
  );
}

export default function FeeStructureReportPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-sm text-slate-500">
          Loading fee structure report...
        </div>
      }
    >
      <FeeStructureReport />
    </Suspense>
  );
}

function FeeStructureReport() {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [categoryNames, setCategoryNames] = useState<Map<string, string>>(
    new Map(),
  );

  // Raw fee rows kept in state so every filter runs client-side.
  const [bills, setBills] = useState<FeeBill[]>([]);
  const [billItems, setBillItems] = useState<FeeBillItem[]>([]);
  const [allocations, setAllocations] = useState<FeeAllocation[]>([]);
  const [concessions, setConcessions] = useState<FeeConcession[]>([]);
  const [payments, setPayments] = useState<FeePaymentRow[]>([]);
  const [structures, setStructures] = useState<StructureRow[]>([]);
  const [structureItems, setStructureItems] = useState<StructureItem[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);

  const [classId, setClassId] = useState(searchParams.get("classId") || "all");
  const [sectionId, setSectionId] = useState(
    searchParams.get("sectionId") || "all",
  );
  const [yearId, setYearId] = useState(searchParams.get("yearId") || "");

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadReport() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.assign("/login");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("school_users")
        .select("school_id, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        throw new Error("Your account is not assigned to a school.");
      }

      const schoolId = membership.school_id;

      const [
        studentsResult,
        classesResult,
        sectionsResult,
        yearsResult,
        categoriesResult,
        structuresResult,
        structureItemsResult,
      ] = await Promise.all([
        supabase
          .from("students")
          .select(
            "id, admission_no, roll_no, first_name, middle_name, last_name, class_id, section_id, status, academic_year_id",
          )
          .eq("school_id", schoolId)
          .order("created_at", { ascending: true }),

        supabase
          .from("classes")
          .select("id, name, display_order")
          .eq("school_id", schoolId)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true }),

        supabase
          .from("sections")
          .select("id, class_id, name")
          .eq("school_id", schoolId)
          .order("name", { ascending: true }),

        supabase
          .from("academic_years")
          .select("id, name, start_date, end_date, is_current")
          .eq("school_id", schoolId)
          .order("start_date", { ascending: false }),

        supabase
          .from("fee_categories")
          .select("id, name")
          .eq("school_id", schoolId),

        supabase
          .from("fee_structures")
          .select("id, academic_year_id, class_id")
          .eq("school_id", schoolId),

        supabase
          .from("fee_structure_items")
          .select("fee_structure_id, fee_category_id")
          .eq("school_id", schoolId),
      ]);

      if (studentsResult.error) throw studentsResult.error;
      if (classesResult.error) throw classesResult.error;
      if (sectionsResult.error) throw sectionsResult.error;
      if (yearsResult.error) throw yearsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      if (structuresResult.error) throw structuresResult.error;
      if (structureItemsResult.error) throw structureItemsResult.error;

      // The big fee tables are paged so schools with many students are not
      // cut off by the default row cap.
      const [billRows, itemRows, allocationRows, concessionRows, paymentRows, enrollmentResult] =
        await Promise.all([
          fetchAll(
            supabase
              .from("fee_bills")
              .select("id, student_id, academic_year_id, bill_date, total_amount, paid_amount, balance_amount, status")
              .eq("school_id", schoolId)
              .order("id", { ascending: true }),
          ),
          fetchAll(
            supabase
              .from("fee_bill_items")
              .select(
                "id, bill_id, fee_structure_id, fee_category_id, description",
              )
              .eq("school_id", schoolId)
              .order("id", { ascending: true }),
          ),
          fetchAll(
            supabase
              .from("fee_payment_allocations")
              .select("fee_bill_item_id, amount")
              .eq("school_id", schoolId)
              .order("id", { ascending: true }),
          ),
          fetchAll(
            supabase
              .from("fee_concessions")
              .select("student_id, bill_id, amount")
              .eq("school_id", schoolId)
              .order("id", { ascending: true }),
          ),
          fetchAll(
            supabase
              .from("fee_payments")
              .select("bill_id, amount")
              .eq("school_id", schoolId)
              .order("id", { ascending: true }),
          ),
          // Optional history table: older schools may not have it yet.
          supabase
            .from("student_enrollments")
            .select("student_id, academic_year_id, class_id, section_id")
            .eq("school_id", schoolId),
        ]);

      const loadedYears = (yearsResult.data || []) as AcademicYear[];
      const loadedClasses = (classesResult.data || []) as SchoolClass[];

      // Bills saved without an academic year belong to the year whose dates
      // contain the bill date (same rule as the Students list).
      const normalizedBills = (billRows as FeeBill[]).map((bill) => ({
        ...bill,
        academic_year_id:
          bill.academic_year_id ||
          loadedYears.find(
            (year) =>
              bill.bill_date &&
              String(bill.bill_date) >= year.start_date &&
              String(bill.bill_date) <= year.end_date,
          )?.id ||
          null,
      }));

      setStudents((studentsResult.data || []) as Student[]);
      setClasses(loadedClasses);
      setSections((sectionsResult.data || []) as Section[]);
      setAcademicYears(loadedYears);
      setCategoryNames(
        new Map(
          (categoriesResult.data || []).map((item) => [
            item.id as string,
            item.name as string,
          ]),
        ),
      );
      setStructures((structuresResult.data || []) as StructureRow[]);
      setStructureItems((structureItemsResult.data || []) as StructureItem[]);
      setBills(normalizedBills);
      setBillItems(itemRows as FeeBillItem[]);
      setAllocations(allocationRows as FeeAllocation[]);
      setConcessions(concessionRows as FeeConcession[]);
      setPayments(paymentRows as FeePaymentRow[]);
      setEnrollments(
        enrollmentResult.error
          ? []
          : ((enrollmentResult.data || []) as EnrollmentRow[]),
      );

      setYearId((current) => {
        if (current && loadedYears.some((year) => year.id === current)) {
          return current;
        }
        return (
          loadedYears.find((year) => year.is_current)?.id ||
          loadedYears[0]?.id ||
          ""
        );
      });

      setClassId((current) => {
        if (current === "all") return current;
        return loadedClasses.some((item) => item.id === current)
          ? current
          : "all";
      });
    } catch (loadError) {
      console.error("FEE STRUCTURE REPORT ERROR:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the fee structure report.",
      );
    } finally {
      setLoading(false);
    }
  }

  const classMap = useMemo(
    () => new Map(classes.map((item) => [item.id, item])),
    [classes],
  );

  const sectionMap = useMemo(
    () => new Map(sections.map((item) => [item.id, item])),
    [sections],
  );

  const filteredSections = useMemo(() => {
    if (classId === "all") return sections;
    return sections.filter((section) => section.class_id === classId);
  }, [sections, classId]);

  // A section chosen for another class (or deep-linked in the URL) is treated
  // as "All Sections" instead of resetting state from an effect.
  const activeSectionId =
    sectionId !== "all" &&
    filteredSections.some((section) => section.id === sectionId)
      ? sectionId
      : "all";

  const report = useMemo<ReportData>(() => {
    const empty: ReportData = {
      categories: [],
      rows: [],
      totals: { assigned: 0, paid: {}, concession: 0, total: 0, pending: 0 },
    };

    const year = academicYears.find((item) => item.id === yearId);
    if (!year) return empty;

    // Class history per year, with the same fallbacks as the Students list:
    // enrollment -> class of the fee structure the bill was built from ->
    // the student's current class (current year only).
    const enrollmentMap = new Map<
      string,
      { class_id: string | null; section_id: string | null }
    >();
    for (const row of enrollments) {
      enrollmentMap.set(`${row.student_id}|${row.academic_year_id}`, {
        class_id: row.class_id,
        section_id: row.section_id,
      });
    }

    const structureClass = new Map<string, string>();
    for (const structure of structures) {
      if (structure.class_id) {
        structureClass.set(structure.id, structure.class_id);
      }
    }

    const billById = new Map<string, FeeBill>();
    for (const bill of bills) billById.set(bill.id, bill);

    const billClassByYear = new Map<string, string>();
    for (const item of billItems) {
      if (!item.fee_structure_id) continue;
      const classOfStructure = structureClass.get(item.fee_structure_id);
      if (!classOfStructure) continue;
      const bill = billById.get(item.bill_id);
      if (!bill || !bill.academic_year_id) continue;
      const key = `${bill.student_id}|${bill.academic_year_id}`;
      if (!billClassByYear.has(key)) billClassByYear.set(key, classOfStructure);
    }

    const placementOf = (
      student: Student,
    ): { class_id: string | null; section_id: string | null } | null => {
      const enrollment = enrollmentMap.get(`${student.id}|${year.id}`);
      if (enrollment) return enrollment;
      const derivedClass = billClassByYear.get(`${student.id}|${year.id}`);
      if (derivedClass) return { class_id: derivedClass, section_id: null };
      if (student.academic_year_id === year.id || year.is_current) {
        return { class_id: student.class_id, section_id: student.section_id };
      }
      return null;
    };

    const visible: Array<{
      student: Student;
      placement: { class_id: string | null; section_id: string | null };
    }> = [];
    for (const student of students) {
      const placement = placementOf(student);
      if (!placement) continue;
      if (classId !== "all" && placement.class_id !== classId) continue;
      if (activeSectionId !== "all" && placement.section_id !== activeSectionId)
        continue;
      visible.push({ student, placement });
    }

    visible.sort((a, b) => {
      const classOrderA = a.placement.class_id
        ? classMap.get(a.placement.class_id)?.display_order ?? 999
        : 999;
      const classOrderB = b.placement.class_id
        ? classMap.get(b.placement.class_id)?.display_order ?? 999
        : 999;
      if (classOrderA !== classOrderB) return classOrderA - classOrderB;

      const sectionNameA = a.placement.section_id
        ? sectionMap.get(a.placement.section_id)?.name || ""
        : "";
      const sectionNameB = b.placement.section_id
        ? sectionMap.get(b.placement.section_id)?.name || ""
        : "";
      if (sectionNameA !== sectionNameB) {
        return sectionNameA.localeCompare(sectionNameB);
      }

      const rollCompare = String(a.student.roll_no ?? "").localeCompare(
        String(b.student.roll_no ?? ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      if (rollCompare !== 0) return rollCompare;

      return getStudentName(a.student).localeCompare(getStudentName(b.student));
    });

    // Bills of the selected academic year for the shown students only.
    const visibleIds = new Set(visible.map((entry) => entry.student.id));
    const studentById = new Map(students.map((student) => [student.id, student]));
    const studentOfBill = new Map<string, string>();
    const assignedByStudent = new Map<string, number>();
    const billedPaidByStudent = new Map<string, number>();
    const pendingByStudent = new Map<string, number>();
    for (const bill of bills) {
      if ((bill.status || "").toLowerCase() === "cancelled") continue;
      if (bill.academic_year_id !== year.id) continue;
      if (!visibleIds.has(bill.student_id)) continue;
      studentOfBill.set(bill.id, bill.student_id);
      assignedByStudent.set(
        bill.student_id,
        round2((assignedByStudent.get(bill.student_id) || 0) + Number(bill.total_amount || 0)),
      );
      billedPaidByStudent.set(
        bill.student_id,
        round2((billedPaidByStudent.get(bill.student_id) || 0) + Number(bill.paid_amount || 0)),
      );
      if (
        studentById.get(bill.student_id)?.status?.toLowerCase() === "active" &&
        (bill.status || "").toLowerCase() !== "carried_forward"
      ) {
        pendingByStudent.set(
          bill.student_id,
          round2((pendingByStudent.get(bill.student_id) || 0) + Math.max(Number(bill.balance_amount || 0), 0)),
        );
      }
    }

    const receiptPaidByStudent = new Map<string, number>();
    for (const payment of payments) {
      if (!payment.bill_id) continue;
      const studentId = studentOfBill.get(payment.bill_id);
      if (!studentId) continue;
      receiptPaidByStudent.set(
        studentId,
        round2((receiptPaidByStudent.get(studentId) || 0) + Number(payment.amount || 0)),
      );
    }
    const paidTotalByStudent = new Map(billedPaidByStudent);
    for (const [studentId, receiptTotal] of receiptPaidByStudent) {
      paidTotalByStudent.set(studentId, receiptTotal);
    }

    const keyOfItem = (item: FeeBillItem) =>
      item.fee_category_id
        ? `c:${item.fee_category_id}`
        : `d:${(item.description || "other fee").trim().toLowerCase()}`;

    const itemById = new Map<string, FeeBillItem>();
    const labelByKey = new Map<string, string>();
    const usedKeys = new Set<string>();

    for (const item of billItems) {
      if (!studentOfBill.has(item.bill_id)) continue;
      itemById.set(item.id, item);
      const key = keyOfItem(item);
      usedKeys.add(key);
      const label = item.fee_category_id
        ? categoryNames.get(item.fee_category_id) ||
          item.description?.trim() ||
          "Fee"
        : item.description?.trim() || "Other Fee";
      if (!labelByKey.has(key)) labelByKey.set(key, label);
    }

    // Before any bill exists, fall back to the categories configured in the
    // year's fee structures so the report still shows what will be charged.
    if (usedKeys.size === 0) {
      const yearStructureIds = new Set(
        structures
          .filter(
            (structure) =>
              structure.academic_year_id === year.id &&
              (classId === "all" || structure.class_id === classId),
          )
          .map((structure) => structure.id),
      );
      for (const item of structureItems) {
        if (!yearStructureIds.has(item.fee_structure_id)) continue;
        if (!item.fee_category_id) continue;
        const key = `c:${item.fee_category_id}`;
        usedKeys.add(key);
        if (!labelByKey.has(key)) {
          labelByKey.set(
            key,
            categoryNames.get(item.fee_category_id) || "Fee",
          );
        }
      }
    }

    const categories: ReportCategory[] = Array.from(usedKeys)
      .map((key) => ({ key, label: labelByKey.get(key) || "Fee" }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Payments received per student per fee category for this year.
    // Payments are summed across the year: 2000 in June + 2000 in August
    // shows 4000. Categories without any payment show 0.
    const paidByStudent = new Map<string, Record<string, number>>();
    for (const allocation of allocations) {
      if (!allocation.fee_bill_item_id) continue;
      const item = itemById.get(allocation.fee_bill_item_id);
      if (!item) continue;
      const studentId = studentOfBill.get(item.bill_id);
      if (!studentId) continue;
      const key = keyOfItem(item);
      const bucket = paidByStudent.get(studentId) || {};
      bucket[key] = (bucket[key] || 0) + Number(allocation.amount || 0);
      paidByStudent.set(studentId, bucket);
    }

    const unallocatedByStudent = new Map<string, number>();
    for (const [studentId, paidTotal] of paidTotalByStudent) {
      const allocatedTotal = Object.values(paidByStudent.get(studentId) || {}).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      const unallocated = round2(Math.max(paidTotal - allocatedTotal, 0));
      if (unallocated > 0) unallocatedByStudent.set(studentId, unallocated);
    }
    if (unallocatedByStudent.size > 0) {
      categories.push({ key: "__unallocated__", label: "Other / Unallocated" });
      for (const [studentId, amount] of unallocatedByStudent) {
        const bucket = paidByStudent.get(studentId) || {};
        bucket.__unallocated__ = amount;
        paidByStudent.set(studentId, bucket);
      }
    }

    // Concessions given for this year's bills, per student.
    const concessionByStudent: Record<string, number> = {};
    for (const concession of concessions) {
      if (!concession.bill_id) continue;
      const studentId = studentOfBill.get(concession.bill_id);
      if (!studentId) continue;
      concessionByStudent[studentId] =
        (concessionByStudent[studentId] || 0) + Number(concession.amount || 0);
    }

    const rows: ReportRow[] = visible.map(({ student, placement }) => {
      const bucket = paidByStudent.get(student.id) || {};
      const paid: Record<string, number> = {};
      let paidTotal = 0;

      for (const category of categories) {
        paid[category.key] = round2(bucket[category.key] || 0);
        paidTotal += paid[category.key];
      }

      const concession = round2(concessionByStudent[student.id] || 0);

      return {
        studentId: student.id,
        name: getStudentName(student),
        className:
          (placement.class_id
            ? classMap.get(placement.class_id)?.name
            : undefined) || "—",
        sectionName:
          (placement.section_id
            ? sectionMap.get(placement.section_id)?.name
            : undefined) || "—",
        assigned: round2(assignedByStudent.get(student.id) || 0),
        paid,
        concession,
        total: round2(paidTotalByStudent.get(student.id) ?? paidTotal),
        pending: round2(pendingByStudent.get(student.id) || 0),
      };
    });

    const totals: ReportData["totals"] = {
      assigned: 0,
      paid: {},
      concession: 0,
      total: 0,
      pending: 0,
    };
    for (const category of categories) totals.paid[category.key] = 0;
    for (const row of rows) {
      for (const category of categories) {
        totals.paid[category.key] = round2(
          totals.paid[category.key] + row.paid[category.key],
        );
      }
      totals.concession = round2(totals.concession + row.concession);
      totals.assigned = round2(totals.assigned + row.assigned);
      totals.total = round2(totals.total + row.total);
      totals.pending = round2(totals.pending + row.pending);
    }

    return { categories, rows, totals };
  }, [
    students,
    academicYears,
    categoryNames,
    bills,
    billItems,
    allocations,
    concessions,
    payments,
    structures,
    structureItems,
    enrollments,
    yearId,
    classId,
    activeSectionId,
    classMap,
    sectionMap,
  ]);

  const selectedYear = useMemo(
    () => academicYears.find((item) => item.id === yearId) || null,
    [academicYears, yearId],
  );

  const classLabel =
    classId === "all" ? "All Classes" : classMap.get(classId)?.name || "All Classes";
  const sectionLabel =
    activeSectionId === "all"
      ? "All Sections"
      : sectionMap.get(activeSectionId)?.name || "All Sections";
  const yearLabel = selectedYear?.name || "—";

  function buildExportTable() {
    const headers = [
      "SI",
      "Name",
      "Class",
      "Section",
      "Fee Assigned",
      ...report.categories.map((category) => category.label),
      "Concession",
      "Total",
      "Pending Fee",
    ];

    // Columns after index 3 (SI, Name, Class, Section) are numeric.
    const numericFrom = 4;

    const rows: Array<Array<string | number>> = report.rows.map(
      (row, index) => [
        index + 1,
        row.name,
        row.className,
        row.sectionName,
        round2(row.assigned),
        ...report.categories.map((category) => round2(row.paid[category.key])),
        round2(row.concession),
        round2(row.total),
        round2(row.pending),
      ],
    );

    const totalsRow: Array<string | number> = [
      "",
      "Total",
      "",
      "",
      round2(report.totals.assigned),
      ...report.categories.map((category) =>
        round2(report.totals.paid[category.key]),
      ),
      round2(report.totals.concession),
      round2(report.totals.total),
      round2(report.totals.pending),
    ];

    return { headers, rows, totalsRow, numericFrom };
  }

  function ensureExportable() {
    if (report.rows.length === 0) {
      setError("No students are available for the selected filters.");
      return false;
    }
    return true;
  }

  function exportExcel() {
    if (!ensureExportable()) return;

    const { headers, rows, totalsRow } = buildExportTable();

    const aoa: Array<Array<string | number>> = [
      ["Fee Structure Report"],
      [
        `Academic Year: ${yearLabel}`,
        `Class: ${classLabel}`,
        `Section: ${sectionLabel}`,
      ],
      [`Generated: ${new Date().toLocaleString("en-IN")}`],
      [],
      headers,
      ...rows,
      totalsRow,
    ];

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet["!cols"] = headers.map((header, index) => ({
      wch: Math.max(
        header.length + 2,
        8,
        ...rows.map((row) => String(row[index] ?? "").length + 2),
      ),
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Fee Structure");
    XLSX.writeFile(
      workbook,
      `${safeFileName(
        `fee-structure-${yearLabel}-${classLabel}-${sectionLabel}`,
      )}.xlsx`,
    );
  }

  function exportPdf() {
    if (!ensureExportable()) return;

    const { headers, rows, totalsRow, numericFrom } = buildExportTable();

    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const left = 8;
    const top = 10;
    const usableWidth = pageWidth - left * 2;

    const weights = headers.map((_, index) => {
      if (index === 0) return 0.5; // SI
      if (index === 1) return 1.55; // Name
      if (index === 2) return 1.15; // Class
      if (index === 3) return 0.95; // Section
      if (index === headers.length - 1) return 1.05; // Pending Fee
      if (index === headers.length - 2) return 1.05; // Total
      if (index === headers.length - 3) return 1; // Concession
      if (index === 4) return 1.15; // Fee Assigned
      return 1.05; // fee categories
    });
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    const widths = weights.map((weight) => (usableWidth * weight) / weightSum);

    const xs: number[] = [];
    let cursor = left;
    for (const width of widths) {
      xs.push(cursor);
      cursor += width;
    }

    const title = `Fee Structure Report - ${yearLabel}`;
    const subtitle = `Class: ${classLabel} | Section: ${sectionLabel} | Students: ${report.rows.length} | Amounts in INR | Generated: ${new Date().toLocaleString("en-IN")}`;
    const cellFont = headers.length > 14 ? 5.5 : headers.length > 10 ? 6 : 6.5;
    const lineHeight = 3.2;

    let y = top;

    const drawTitle = (compact = false) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(compact ? 10 : 13);
      pdf.text(title, left, y);
      y += compact ? 5 : 6.5;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(subtitle, left, y);
      y += compact ? 5 : 6.5;
    };

    const drawHeader = () => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(cellFont);
      headers.forEach((header, index) => {
        const label = header.toUpperCase();
        if (index >= numericFrom) {
          pdf.text(label, xs[index] + widths[index] - 1, y, { align: "right" });
        } else {
          pdf.text(label, xs[index], y);
        }
      });
      y += 2.5;
      pdf.setDrawColor(120);
      pdf.line(left, y, pageWidth - left, y);
      y += 4;
      pdf.setFont("helvetica", "normal");
    };

    const drawRow = (cells: Array<string | number>, bold = false) => {
      const fontSize = bold ? cellFont + 0.4 : cellFont;
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(fontSize);

      const texts = cells.map((cell, index) =>
        pdf.splitTextToSize(
          typeof cell === "number" ? formatAmount(cell) : String(cell ?? "—"),
          Math.max(widths[index] - 2, 6),
        ) as string[],
      );

      const rowHeight =
        Math.max(...texts.map((lines) => lines.length), 1) * lineHeight + 2;

      if (y + rowHeight > pageHeight - 10) {
        pdf.addPage();
        y = top;
        drawTitle(true);
        drawHeader();
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        pdf.setFontSize(fontSize);
      }

      texts.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => {
          const yPos = y + lineIndex * lineHeight + 3.4;
          if (index >= numericFrom) {
            pdf.text(line, xs[index] + widths[index] - 1, yPos, {
              align: "right",
            });
          } else {
            pdf.text(line, xs[index], yPos);
          }
        });
      });

      y += rowHeight;
      pdf.setDrawColor(222);
      pdf.line(left, y, pageWidth - left, y);
      pdf.setFont("helvetica", "normal");
    };

    drawTitle();
    drawHeader();
    for (const row of rows) drawRow(row);
    drawRow(totalsRow, true);

    pdf.save(
      `${safeFileName(
        `fee-structure-${yearLabel}-${classLabel}-${sectionLabel}`,
      )}.pdf`,
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              href="/dashboard/students"
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft size={16} />
              Back to Students
            </Link>

            <h1 className="mt-2 text-3xl font-bold text-slate-900">
              Fee Structure
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              How much every student has paid in each fee category for the
              selected academic year, after concessions.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportExcel}
              disabled={loading || report.rows.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileSpreadsheet size={16} />
              Export Excel
            </button>

            <button
              type="button"
              onClick={exportPdf}
              disabled={loading || report.rows.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileText size={16} />
              Export PDF
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSectionId("all");
              }}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">All Classes</option>
              {classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.name}
                </option>
              ))}
            </select>

            <select
              value={activeSectionId}
              onChange={(event) => setSectionId(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">
                {classId === "all"
                  ? "All Sections"
                  : "All Sections in Selected Class"}
              </option>
              {filteredSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>

            <select
              value={yearId}
              onChange={(event) => setYearId(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              <option value="">Select Academic Year</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                  {year.is_current ? " (Current)" : ""}
                </option>
              ))}
            </select>

            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <IndianRupee size={15} className="mr-2 text-slate-400" />
              {report.rows.length} student{report.rows.length === 1 ? "" : "s"}{" "}
              • {report.categories.length} fee categor
              {report.categories.length === 1 ? "y" : "ies"}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-semibold text-red-800">
              Unable to load the fee structure report
            </p>

            <p className="mt-1 text-sm text-red-700">{error}</p>

            <button
              type="button"
              onClick={() => void loadReport()}
              className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Try Again
            </button>
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

              <p className="mt-3 text-sm text-slate-500">
                Loading fee structure...
              </p>
            </div>
          ) : !yearId ? (
            <div className="p-10 text-center">
              <h2 className="text-lg font-bold text-slate-900">
                Select an academic year
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Choose the academic year above to see fee collections per
                student and fee category.
              </p>
            </div>
          ) : report.rows.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
                🧾
              </div>

              <h2 className="mt-4 text-lg font-bold text-slate-900">
                No students found
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                No students match the selected class, section and academic year.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      SI
                    </th>

                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Name
                    </th>

                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Class
                    </th>

                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Section
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-blue-700">
                      Fee Assigned
                    </th>

                    {report.categories.map((category) => (
                      <th
                        key={category.key}
                        className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {category.label}
                      </th>
                    ))}

                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-purple-600">
                      Concession
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700">
                      Total
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-amber-700">
                      Pending Fee
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {report.rows.map((row, index) => (
                    <tr
                      key={row.studentId}
                      className="transition hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 text-slate-400">{index + 1}</td>

                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {row.name}
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {row.className}
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {row.sectionName}
                      </td>

                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-blue-800">
                        {formatAmount(row.assigned)}
                      </td>

                      {report.categories.map((category) => (
                        <td
                          key={category.key}
                          className={
                            "px-4 py-3 text-right tabular-nums " +
                            (row.paid[category.key]
                              ? "font-semibold text-slate-900"
                              : "text-slate-400")
                          }
                        >
                          {formatAmount(row.paid[category.key])}
                        </td>
                      ))}

                      <td className="px-4 py-3 text-right tabular-nums text-purple-700">
                        {formatAmount(row.concession)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                        {formatAmount(row.total)}
                      </td>

                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-800">
                        {formatAmount(row.pending)}
                      </td>
                    </tr>
                  ))}
                </tbody>

                <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600"
                    >
                      Total ({report.rows.length} student
                      {report.rows.length === 1 ? "" : "s"})
                    </td>

                    <td className="px-4 py-3 text-right font-bold tabular-nums text-blue-800">
                      {formatAmount(report.totals.assigned)}
                    </td>

                    {report.categories.map((category) => (
                      <td
                        key={category.key}
                        className="px-4 py-3 text-right font-bold tabular-nums text-slate-900"
                      >
                        {formatAmount(report.totals.paid[category.key])}
                      </td>
                    ))}

                    <td className="px-4 py-3 text-right font-bold tabular-nums text-purple-700">
                      {formatAmount(report.totals.concession)}
                    </td>

                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                      {formatAmount(report.totals.total)}
                    </td>

                    <td className="px-4 py-3 text-right font-bold tabular-nums text-amber-800">
                      {formatAmount(report.totals.pending)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <p className="mt-3 text-xs leading-5 text-slate-500">
          Each fee category cell shows everything received from that student in
          that category during {yearLabel} — multiple payments are added
          together (for example ₹2,000 in June + ₹2,000 in August shows
          ₹4,000), and categories with no payment show 0. The Concession column
          lists the concession given for the year. Fee Assigned is the bill
          total after concessions, Total is the amount actually paid, and
          Pending Fee is the remaining collectible balance. Inactive students
          keep their payment history and show no collectible pending fee.
        </p>
      </div>
    </div>
  );
}











