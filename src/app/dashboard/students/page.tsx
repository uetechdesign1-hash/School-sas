"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckSquare,
  ChevronRight,
  GraduationCap,
  IndianRupee,
  Loader2,
  Square,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type StudentStatus =
  | "active"
  | "inactive"
  | "transferred"
  | "completed"
  | "alumni";

type Student = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  admission_no: string;
  roll_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  gender: "male" | "female" | "other" | null;
  class_id: string | null;
  section_id: string | null;
  status: StudentStatus;
  photo_url: string | null;
  city: string | null;
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

type PromotionForm = {
  targetAcademicYearId: string;
  targetClassId: string;
  targetSectionId: string;
};

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);

  const [outstandingFees, setOutstandingFees] = useState<Record<string, number>>(
    {},
  );

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [classId, setClassId] = useState("all");
  const [sectionId, setSectionId] = useState("all");

  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionStudentIds, setPromotionStudentIds] = useState<string[]>([]);
  const [promoting, setPromoting] = useState(false);
  const [promotionError, setPromotionError] = useState("");

  const [promotionForm, setPromotionForm] = useState<PromotionForm>({
    targetAcademicYearId: "",
    targetClassId: "",
    targetSectionId: "",
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadStudents();
  }, []);

  async function loadStudents() {
    try {
      setLoading(true);
      setError("");

      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.assign("/login");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("school_users")
        .select("school_id, role, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membership) {
        throw new Error("Your account is not assigned to a school.");
      }

      const schoolId = membership.school_id;

      const [
        studentsResult,
        classesResult,
        sectionsResult,
        yearsResult,
        feeStructuresResult,
        feeStructureItemsResult,
        feeBillsResult,
        feeBillItemsResult,
        feeConcessionsResult,
        carryForwardsResult,
      ] = await Promise.all([
        supabase
          .from("students")
          .select(
            `
              id,
              school_id,
              academic_year_id,
              admission_no,
              roll_no,
              first_name,
              middle_name,
              last_name,
              gender,
              class_id,
              section_id,
              status,
              photo_url,
              city
            `,
          )
          .eq("school_id", schoolId)
          .order("created_at", { ascending: false }),

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

        // Fee structures provide the expected charge before a bill exists.
        // Once a current-year bill exists, the bill is the canonical current
        // charge because it also contains student-specific optional fees and
        // any applied previous-year carry-forward.
        supabase
          .from("fee_structures")
          .select("id, academic_year_id, class_id, active")
          .eq("school_id", schoolId)
          .eq("active", true),

        supabase
          .from("fee_structure_items")
          .select("id, fee_structure_id, amount, mandatory")
          .eq("school_id", schoolId),

        supabase
          .from("fee_bills")
          .select("id, student_id, academic_year_id, total_amount, paid_amount, balance_amount")
          .eq("school_id", schoolId),

        supabase
          .from("fee_bill_items")
          .select("bill_id, fee_structure_id, amount, net_amount")
          .eq("school_id", schoolId),

        supabase
          .from("fee_concessions")
          .select("student_id, bill_id, amount")
          .eq("school_id", schoolId),

        supabase
          .from("fee_carry_forwards")
          .select("student_id, to_academic_year_id, amount, status")
          .eq("school_id", schoolId)
          .eq("status", "pending"),
      ]);

      if (studentsResult.error) {
        throw studentsResult.error;
      }

      if (classesResult.error) {
        throw classesResult.error;
      }

      if (sectionsResult.error) {
        throw sectionsResult.error;
      }

      if (yearsResult.error) {
        throw yearsResult.error;
      }

      if (feeStructuresResult.error) {
        throw feeStructuresResult.error;
      }

      if (feeStructureItemsResult.error) {
        throw feeStructureItemsResult.error;
      }

      if (feeBillsResult.error) {
        throw feeBillsResult.error;
      }

      if (feeBillItemsResult.error) {
        throw feeBillItemsResult.error;
      }

      if (feeConcessionsResult.error) {
        throw feeConcessionsResult.error;
      }

      if (carryForwardsResult.error) {
        throw carryForwardsResult.error;
      }

      const loadedStudents = (studentsResult.data || []) as Student[];
      const loadedClasses = (classesResult.data || []) as SchoolClass[];
      const loadedSections = (sectionsResult.data || []) as Section[];
      const loadedYears = (yearsResult.data || []) as AcademicYear[];

      const feeMap: Record<string, number> = {};

      const currentYear =
        loadedYears.find((year) => year.is_current) || null;

      // Fee Management is the source of truth for the current charge.
      // Only mandatory items are included automatically. Optional items are
      // student-specific and remain represented by an existing current-year
      // bill when one has been assigned.
      const structures = (feeStructuresResult.data || []) as Array<{
        id: string;
        academic_year_id: string;
        class_id: string;
        active: boolean;
      }>;

      const structureItems = (feeStructureItemsResult.data || []) as Array<{
        id: string;
        fee_structure_id: string;
        amount: number;
        mandatory: boolean;
      }>;

      const bills = (feeBillsResult.data || []) as Array<{
        id: string;
        student_id: string;
        academic_year_id: string | null;
        total_amount: number;
        paid_amount: number;
      }>;

      const concessions = (feeConcessionsResult.data || []) as Array<{
        student_id: string;
        bill_id: string | null;
        amount: number;
      }>;

      const carryForwards = (carryForwardsResult.data || []) as Array<{
        student_id: string;
        to_academic_year_id: string;
        amount: number;
        status: string;
      }>;

      const currentStructures = new Map<string, { id: string }>();
      if (currentYear) {
        for (const structure of structures) {
          if (structure.academic_year_id !== currentYear.id) continue;
          if (!currentStructures.has(structure.class_id)) {
            currentStructures.set(structure.class_id, { id: structure.id });
          }
        }
      }

      const mandatoryTotalByStructure = new Map<string, number>();
      for (const item of structureItems) {
        if (!item.mandatory) continue;
        mandatoryTotalByStructure.set(
          item.fee_structure_id,
          (mandatoryTotalByStructure.get(item.fee_structure_id) || 0) +
            Math.max(Number(item.amount || 0), 0),
        );
      }

      // IMPORTANT: use the bill's canonical paid_amount for the current
      // academic year. The Fee Ledger displays fee_bills.paid_amount, so the
      // Students list must use the same source of truth. Counting raw
      // fee_payments here can miss a payment when its bill linkage is stale,
      // null, or not present in the currently loaded bill set.
      /*
       * CANONICAL OUTSTANDING:
       * The Student Fee page uses fee_bills.balance_amount after
       * concessions/payments are recalculated. Do not rebuild the balance
       * from total_amount - concession - paid_amount here because that can
       * subtract a concession twice or miss student-specific bill items.
       *
       * For students who do not yet have a current-year bill, keep the
       * existing fee-structure fallback so the Students list can still show
       * the configured expected fee.
       */
      const balanceByStudent = new Map<string, number>();

      for (const bill of bills) {
        if (!currentYear || bill.academic_year_id !== currentYear.id) continue;

        balanceByStudent.set(
          bill.student_id,
          (balanceByStudent.get(bill.student_id) || 0) +
            Math.max(Number(bill.balance_amount || 0), 0),
        );
      }

      for (const student of loadedStudents) {
        if (!currentYear || !student.class_id) {
          feeMap[student.id] = 0;
          continue;
        }

        const structure = currentStructures.get(student.class_id);
        const configuredCurrentFee = structure
          ? mandatoryTotalByStructure.get(structure.id) || 0
          : 0;

        const hasCurrentYearBill = bills.some(
          (bill) =>
            bill.student_id === student.id &&
            bill.academic_year_id === currentYear.id,
        );

        feeMap[student.id] = hasCurrentYearBill
          ? Math.max(balanceByStudent.get(student.id) || 0, 0)
          : Math.max(configuredCurrentFee, 0);
      }

      setStudents(loadedStudents);
      setClasses(loadedClasses);
      setSections(loadedSections);
      setAcademicYears(loadedYears);
      setOutstandingFees(feeMap);
      setSelectedStudentIds([]);
    } catch (loadError) {
      console.error("STUDENTS ERROR:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load students.",
      );
    } finally {
      setLoading(false);
    }
  }

  const classMap = useMemo(() => {
    return new Map(classes.map((item) => [item.id, item]));
  }, [classes]);

  const sectionMap = useMemo(() => {
    return new Map(sections.map((item) => [item.id, item]));
  }, [sections]);

  const filteredSections = useMemo(() => {
    if (classId === "all") {
      return sections;
    }

    return sections.filter((section) => section.class_id === classId);
  }, [sections, classId]);

  useEffect(() => {
    if (
      sectionId !== "all" &&
      !filteredSections.some((section) => section.id === sectionId)
    ) {
      setSectionId("all");
    }
  }, [filteredSections, sectionId]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return students.filter((student) => {
      const fullName = [
        student.first_name,
        student.middle_name,
        student.last_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query ||
        fullName.includes(query) ||
        student.admission_no.toLowerCase().includes(query) ||
        (student.roll_no || "").toLowerCase().includes(query);

      const matchesStatus =
        status === "all" || student.status === status;

      const matchesClass =
        classId === "all" || student.class_id === classId;

      const matchesSection =
        sectionId === "all" || student.section_id === sectionId;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesClass &&
        matchesSection
      );
    });
  }, [students, search, status, classId, sectionId]);

  const activeCount = students.filter(
    (student) => student.status === "active",
  ).length;

  const inactiveCount = students.filter(
    (student) => student.status === "inactive",
  ).length;

  const currentAcademicYear = useMemo(() => {
    return academicYears.find((year) => year.is_current) || null;
  }, [academicYears]);

  const targetAcademicYearOptions = useMemo(() => {
    if (!currentAcademicYear) {
      return academicYears;
    }

    return academicYears.filter(
      (year) => year.id !== currentAcademicYear.id,
    );
  }, [academicYears, currentAcademicYear]);

  const promotionSections = useMemo(() => {
    if (!promotionForm.targetClassId) {
      return [];
    }

    return sections.filter(
      (section) => section.class_id === promotionForm.targetClassId,
    );
  }, [sections, promotionForm.targetClassId]);

  const selectedStudents = useMemo(() => {
    const selected = new Set(promotionStudentIds);
    return students.filter((student) => selected.has(student.id));
  }, [students, promotionStudentIds]);

  const selectedFilteredCount = filteredStudents.filter((student) =>
    selectedStudentIds.includes(student.id),
  ).length;

  const allFilteredSelected =
    filteredStudents.length > 0 &&
    selectedFilteredCount === filteredStudents.length;

  function toggleStudentSelection(studentId: string) {
    setSelectedStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredStudents.map((student) => student.id));
      setSelectedStudentIds((current) =>
        current.filter((id) => !filteredIds.has(id)),
      );
      return;
    }

    setSelectedStudentIds((current) => {
      const merged = new Set(current);
      for (const student of filteredStudents) {
        merged.add(student.id);
      }
      return Array.from(merged);
    });
  }

  function clearSelection() {
    setSelectedStudentIds([]);
  }

  function openPromotion(studentIds: string[]) {
    if (studentIds.length === 0) {
      return;
    }

    setPromotionError("");
    setPromotionStudentIds(studentIds);

    const defaultTargetYear =
      targetAcademicYearOptions[0]?.id || "";

    setPromotionForm({
      targetAcademicYearId: defaultTargetYear,
      targetClassId: "",
      targetSectionId: "",
    });

    setPromotionOpen(true);
  }

  function closePromotion() {
    setPromotionOpen(false);
    setPromotionStudentIds([]);
    setPromotionError("");
  }

  async function promoteStudents() {
    if (promotionStudentIds.length === 0) {
      return;
    }

    if (!currentAcademicYear) {
      setPromotionError(
        "No current academic year is configured for this school.",
      );
      return;
    }

    if (!promotionForm.targetAcademicYearId) {
      setPromotionError("Please select the target academic year.");
      return;
    }

    if (promotionForm.targetAcademicYearId === currentAcademicYear.id) {
      setPromotionError(
        "Target academic year must be different from the current academic year.",
      );
      return;
    }

    if (!promotionForm.targetClassId) {
      setPromotionError("Please select the target class.");
      return;
    }

    if (!promotionForm.targetSectionId) {
      setPromotionError("Please select the target section.");
      return;
    }

    const invalidStudents = selectedStudents.filter(
      (student) =>
        student.status !== "active" ||
        student.academic_year_id !== currentAcademicYear.id,
    );

    if (invalidStudents.length > 0) {
      setPromotionError(
        `${invalidStudents.length} selected student(s) are not active students in the current academic year.`,
      );
      return;
    }

    try {
      setPromoting(true);
      setPromotionError("");

      const supabase = createClient();

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

      if (membershipError) {
        throw membershipError;
      }

      if (!membership) {
        throw new Error("Your account is not assigned to a school.");
      }

      const { error: promotionErrorResult } = await supabase.rpc(
        "promote_students",
        {
          p_school_id: membership.school_id,
          p_from_academic_year_id: currentAcademicYear.id,
          p_to_academic_year_id: promotionForm.targetAcademicYearId,
          p_to_class_id: promotionForm.targetClassId,
          p_to_section_id: promotionForm.targetSectionId,
          p_student_ids: promotionStudentIds,
        },
      );

      if (promotionErrorResult) {
        throw promotionErrorResult;
      }

      closePromotion();
      clearSelection();
      await loadStudents();
    } catch (promotionErrorResult) {
      console.error("PROMOTION ERROR:", promotionErrorResult);
      setPromotionError(
        promotionErrorResult instanceof Error
          ? promotionErrorResult.message
          : "Unable to promote selected students.",
      );
    } finally {
      setPromoting(false);
    }
  }

  async function deleteStudent(student: Student) {
    const confirmed = window.confirm(
      `Delete ${getStudentName(student)}? This action cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const supabase = createClient();

      const { error: deleteError } = await supabase
        .from("students")
        .delete()
        .eq("id", student.id)
        .eq("school_id", student.school_id);

      if (deleteError) {
        throw deleteError;
      }

      setStudents((current) =>
        current.filter((item) => item.id !== student.id),
      );

      setSelectedStudentIds((current) =>
        current.filter((id) => id !== student.id),
      );
    } catch (deleteError) {
      console.error("DELETE STUDENT ERROR:", deleteError);

      alert(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete student.",
      );
    }
  }

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setClassId("all");
    setSectionId("all");
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">School Management</p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Students
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Manage students, outstanding fees and academic promotion.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {selectedStudentIds.length > 0 && (
              <button
                type="button"
                onClick={() => openPromotion(selectedStudentIds)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
              >
                <ArrowRight size={17} />
                Promote {selectedStudentIds.length} Student
                {selectedStudentIds.length === 1 ? "" : "s"}
              </button>
            )}

            <Link
              href="/dashboard/students/new"
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              + Add Student
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat title="Total Students" value={students.length} />
          <Stat title="Active" value={activeCount} />
          <Stat title="Inactive" value={inactiveCount} />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, admission no. or roll no."
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />

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
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              disabled={classId === "all" && sections.length === 0}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
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
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="transferred">Transferred</option>
              <option value="completed">Completed</option>
              <option value="alumni">Alumni</option>
            </select>
          </div>

          {(search ||
            status !== "all" ||
            classId !== "all" ||
            sectionId !== "all") && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Showing {filteredStudents.length} of {students.length} students
              </p>

              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>

        {selectedStudentIds.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-emerald-900">
                {selectedStudentIds.length} student
                {selectedStudentIds.length === 1 ? "" : "s"} selected
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                Select Promote to move them to the next academic year, class and
                section.
              </p>
            </div>

            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex items-center justify-center rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Clear Selection
            </button>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-semibold text-red-800">Unable to load students</p>

            <p className="mt-1 text-sm text-red-700">{error}</p>

            <button
              type="button"
              onClick={() => void loadStudents()}
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
                Loading students...
              </p>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
                👨‍🎓
              </div>

              <h2 className="mt-4 text-lg font-bold text-slate-900">
                No students found
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {students.length === 0
                  ? "Add your first student to get started."
                  : "Try changing your search or filters."}
              </p>

              {students.length === 0 ? (
                <Link
                  href="/dashboard/students/new"
                  className="mt-5 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
                >
                  + Add Student
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-5 rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700"
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="w-12 px-4 py-4 text-center">
                      <button
                        type="button"
                        onClick={toggleSelectAllFiltered}
                        title={
                          allFilteredSelected
                            ? "Clear visible selection"
                            : "Select all visible students"
                        }
                        className="inline-flex items-center justify-center rounded-lg p-1 text-slate-500 hover:bg-slate-200 hover:text-blue-600"
                      >
                        {allFilteredSelected ? (
                          <CheckSquare size={19} />
                        ) : (
                          <Square size={19} />
                        )}
                      </button>
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Student
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Admission No.
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Roll No.
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Class
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Section
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Gender
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Status
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Outstanding Fee
                    </th>

                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredStudents.map((student) => {
                    const schoolClass = student.class_id
                      ? classMap.get(student.class_id)
                      : null;

                    const section = student.section_id
                      ? sectionMap.get(student.section_id)
                      : null;

                    const outstanding = outstandingFees[student.id] || 0;
                    const selected = selectedStudentIds.includes(student.id);

                    return (
                      <tr
                        key={student.id}
                        className={
                          selected
                            ? "bg-emerald-50/50 transition hover:bg-emerald-50"
                            : "transition hover:bg-slate-50"
                        }
                      >
                        <td className="px-4 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => toggleStudentSelection(student.id)}
                            title={selected ? "Unselect student" : "Select student"}
                            className="inline-flex items-center justify-center rounded-lg p-1 text-slate-500 hover:bg-slate-200 hover:text-blue-600"
                          >
                            {selected ? (
                              <CheckSquare
                                size={19}
                                className="text-emerald-600"
                              />
                            ) : (
                              <Square size={19} />
                            )}
                          </button>
                        </td>

                        <td className="px-5 py-4">
                          <Link
                            href={`/dashboard/students/${student.id}`}
                            className="flex items-center gap-3"
                          >
                            {student.photo_url ? (
                              <img
                                src={student.photo_url}
                                alt=""
                                className="h-10 w-10 rounded-xl object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 font-bold text-blue-600">
                                {student.first_name.charAt(0).toUpperCase()}
                              </div>
                            )}

                            <div>
                              <p className="font-semibold text-slate-900">
                                {getStudentName(student)}
                              </p>

                              <p className="text-xs text-slate-500">
                                {student.city || "No city"}
                              </p>
                            </div>
                          </Link>
                        </td>

                        <td className="px-5 py-4 text-sm font-medium text-slate-700">
                          {student.admission_no}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {student.roll_no || "—"}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {schoolClass?.name || "—"}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {section?.name || "—"}
                        </td>

                        <td className="px-5 py-4 text-sm capitalize text-slate-600">
                          {student.gender || "—"}
                        </td>

                        <td className="px-5 py-4">
                          <StatusBadge status={student.status} />
                        </td>

                        <td className="px-5 py-4">
                          {outstanding > 0 ? (
                            <Link
                              href={`/dashboard/students/${student.id}/fees`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-100"
                              title="Open student fee ledger"
                            >
                              <IndianRupee size={14} />
                              {formatINR(outstanding)}
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5 text-sm font-bold text-green-700">
                              <Check size={14} />
                              Paid
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openPromotion([student.id])}
                              disabled={
                                student.status !== "active" ||
                                !currentAcademicYear ||
                                student.academic_year_id !== currentAcademicYear.id
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                              title={
                                student.status !== "active"
                                  ? "Only active students can be promoted"
                                  : student.academic_year_id !==
                                      currentAcademicYear?.id
                                    ? "Student is not in the current academic year"
                                    : "Promote student"
                              }
                            >
                              <ArrowRight size={14} />
                              Promote
                            </button>

                            <Link
                              href={`/dashboard/students/${student.id}`}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              View
                            </Link>

                            <Link
                              href={`/dashboard/students/${student.id}`}
                              className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                            >
                              Edit
                            </Link>

                            <button
                              type="button"
                              onClick={() => void deleteStudent(student)}
                              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {promotionOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <GraduationCap size={22} />
                    </div>

                    <div>
                      <h2 className="text-xl font-bold text-slate-900">
                        Promote Students
                      </h2>

                      <p className="mt-1 text-sm text-slate-500">
                        {promotionStudentIds.length} student
                        {promotionStudentIds.length === 1 ? "" : "s"} selected
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closePromotion}
                  disabled={promoting}
                  className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-5 p-6">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Current Academic Year
                  </p>

                  <p className="mt-1 font-bold text-slate-900">
                    {currentAcademicYear?.name || "Not configured"}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    Previous-year enrollment history will remain preserved.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">
                    Target Academic Year
                  </label>

                  <select
                    value={promotionForm.targetAcademicYearId}
                    onChange={(event) =>
                      setPromotionForm((current) => ({
                        ...current,
                        targetAcademicYearId: event.target.value,
                      }))
                    }
                    disabled={promoting}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="">Select academic year</option>

                    {targetAcademicYearOptions.map((year) => (
                      <option key={year.id} value={year.id}>
                        {year.name}
                        {year.is_current ? " (Current)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-slate-700">
                      Target Class
                    </label>

                    <select
                      value={promotionForm.targetClassId}
                      onChange={(event) =>
                        setPromotionForm((current) => ({
                          ...current,
                          targetClassId: event.target.value,
                          targetSectionId: "",
                        }))
                      }
                      disabled={promoting}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    >
                      <option value="">Select class</option>

                      {classes.map((schoolClass) => (
                        <option key={schoolClass.id} value={schoolClass.id}>
                          {schoolClass.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-slate-700">
                      Target Section
                    </label>

                    <select
                      value={promotionForm.targetSectionId}
                      onChange={(event) =>
                        setPromotionForm((current) => ({
                          ...current,
                          targetSectionId: event.target.value,
                        }))
                      }
                      disabled={
                        promoting || !promotionForm.targetClassId
                      }
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:bg-slate-100"
                    >
                      <option value="">Select section</option>

                      {promotionSections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Users size={17} className="text-slate-400" />
                      <p className="text-sm font-bold text-slate-800">
                        Students to promote
                      </p>
                    </div>

                    <span className="text-xs font-semibold text-slate-400">
                      {selectedStudents.length}
                    </span>
                  </div>

                  <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto">
                    {selectedStudents.map((student) => (
                      <div
                        key={student.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {getStudentName(student)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {student.admission_no} ·{" "}
                            {student.class_id
                              ? classMap.get(student.class_id)?.name || "—"
                              : "—"}{" "}
                            ·{" "}
                            {student.section_id
                              ? sectionMap.get(student.section_id)?.name || "—"
                              : "—"}
                          </p>
                        </div>

                        <Check size={17} className="shrink-0 text-emerald-600" />
                      </div>
                    ))}
                  </div>
                </div>

                {promotionError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-semibold text-red-800">
                      Promotion failed
                    </p>
                    <p className="mt-1 text-sm text-red-700">
                      {promotionError}
                    </p>
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closePromotion}
                    disabled={promoting}
                    className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => void promoteStudents()}
                    disabled={promoting}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {promoting ? (
                      <>
                        <Loader2 size={17} className="animate-spin" />
                        Promoting...
                      </>
                    ) : (
                      <>
                        <ArrowRight size={17} />
                        Confirm Promotion
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatINR(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function getStudentName(student: Student) {
  return [
    student.first_name,
    student.middle_name,
    student.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function StatusBadge({ status }: { status: StudentStatus }) {
  const styles: Record<StudentStatus, string> = {
    active: "bg-green-50 text-green-700 border-green-200",
    inactive: "bg-slate-100 text-slate-600 border-slate-200",
    transferred: "bg-yellow-50 text-yellow-700 border-yellow-200",
    completed: "bg-blue-50 text-blue-700 border-blue-200",
    alumni: "bg-purple-50 text-purple-700 border-purple-200",
  };

  return (
    <span
      className={
        "rounded-full border px-3 py-1 text-xs font-semibold capitalize " +
        styles[status]
      }
    >
      {status}
    </span>
  );
}

function Stat({
  title,
  value,
}: {
  title: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>

      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
