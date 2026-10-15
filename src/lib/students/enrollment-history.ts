import type { createClient } from "@/lib/supabase/client";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

/**
 * PostgREST `in.()` filters travel in the request URL, so a few hundred UUIDs
 * push the query string past proxy URL limits ("Bad Request" 400) — receipt
 * history can hand these loaders 600+ student/bill ids. Kept local because
 * this module is imported directly by tests/academic-year-history.test.mjs
 * under plain Node, which cannot resolve the `@/` alias for a shared helper.
 */
const ID_BATCH_SIZE = 100;

async function selectInIdBatches<TRow>(
  supabase: SupabaseBrowserClient,
  runBatch: (
    batch: string[],
  ) => PromiseLike<{ data: TRow[] | null; error?: { message: string } | null }>,
  ids: string[],
): Promise<{ data: TRow[] | null; error: { message: string } | null }> {
  const uniqueIds = Array.from(new Set(ids));
  const rows: TRow[] = [];

  for (let index = 0; index < uniqueIds.length; index += ID_BATCH_SIZE) {
    const { data, error } = await runBatch(
      uniqueIds.slice(index, index + ID_BATCH_SIZE),
    );
    if (error) return { data: null, error };
    rows.push(...(data || []));
  }

  return { data: rows, error: null };
}

export type EnrollmentLabel = {
  academicYearId: string;
  academicYearName: string;
  className: string;
  sectionName: string;
};

export function enrollmentKey(studentId: string, academicYearId: string) {
  return `${studentId}|${academicYearId}`;
}

/**
 * Returns the class/section each student belonged to in each academic year.
 *
 * A student who was in Class 1 in 2025-2026 and promoted to Class 2 for
 * 2026-2027 has two rows, so old receipts and bills keep showing Class 1.
 * If the student_enrollments table is not available (migration not applied)
 * an empty map is returned and callers fall back to the student's current class.
 */
export async function loadEnrollmentLabels(
  supabase: SupabaseBrowserClient,
  schoolId: string,
  studentIds: string[],
): Promise<Map<string, EnrollmentLabel>> {
  const result = new Map<string, EnrollmentLabel>();
  const ids = Array.from(new Set(studentIds.filter(Boolean)));
  if (!schoolId || ids.length === 0) return result;

  // Batched: receipt history can pass 600+ student ids, which overflows the
  // URL limit for a single `in.()` filter ("Bad Request" 400).
  const { data: rows, error } = await selectInIdBatches(
    supabase,
    (batch) =>
      supabase
        .from("student_enrollments")
        .select("student_id, academic_year_id, class_id, section_id")
        .eq("school_id", schoolId)
        .in("student_id", batch),
    ids,
  );

  if (error || !rows?.length) return result;

  const classIds = Array.from(new Set(rows.map((r) => r.class_id).filter(Boolean))) as string[];
  const sectionIds = Array.from(new Set(rows.map((r) => r.section_id).filter(Boolean))) as string[];
  const yearIds = Array.from(new Set(rows.map((r) => r.academic_year_id).filter(Boolean))) as string[];

  const [classes, sections, years] = await Promise.all([
    classIds.length
      ? supabase.from("classes").select("id, name").in("id", classIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    sectionIds.length
      ? supabase.from("sections").select("id, name").in("id", sectionIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    yearIds.length
      ? supabase.from("academic_years").select("id, name").in("id", yearIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const className = new Map((classes.data || []).map((c) => [c.id, c.name]));
  const sectionName = new Map((sections.data || []).map((s) => [s.id, s.name]));
  const yearName = new Map((years.data || []).map((y) => [y.id, y.name]));

  for (const row of rows) {
    result.set(enrollmentKey(row.student_id, row.academic_year_id), {
      academicYearId: row.academic_year_id,
      academicYearName: String(yearName.get(row.academic_year_id) ?? ""),
      className: row.class_id ? String(className.get(row.class_id) ?? "") : "",
      sectionName: row.section_id ? String(sectionName.get(row.section_id) ?? "") : "",
    });
  }

  return result;
}

export type BillRef = {
  id: string;
  student_id: string;
  academic_year_id: string | null;
};

/**
 * Class/section label for each bill, based on the academic year of the bill.
 *
 * Priority:
 *  1. student_enrollments row for (student, bill year)
 *  2. the class of the fee structure the bill was created from. This works
 *     even for students promoted before enrollment history existed, because
 *     a 2025-2026 bill was built from the Class 1 fee structure.
 * Returns no entry when neither is known; callers then fall back to the
 * student's current class.
 */
export async function loadBillClassLabels(
  supabase: SupabaseBrowserClient,
  schoolId: string,
  bills: BillRef[],
): Promise<Map<string, EnrollmentLabel>> {
  const result = new Map<string, EnrollmentLabel>();
  const withYear = bills.filter((bill) => bill.id && bill.student_id && bill.academic_year_id);
  if (!schoolId || withYear.length === 0) return result;

  const enrollments = await loadEnrollmentLabels(
    supabase,
    schoolId,
    withYear.map((bill) => bill.student_id),
  );

  const missing: BillRef[] = [];
  for (const bill of withYear) {
    const label = enrollments.get(enrollmentKey(bill.student_id, bill.academic_year_id as string));
    if (label?.className) result.set(bill.id, label);
    else missing.push(bill);
  }
  if (missing.length === 0) return result;

  // Batched: bill lists from receipt history can hold 600+ ids.
  const { data: items } = await selectInIdBatches(
    supabase,
    (batch) =>
      supabase
        .from("fee_bill_items")
        .select("bill_id, fee_structure_id")
        .eq("school_id", schoolId)
        .in("bill_id", batch)
        .not("fee_structure_id", "is", null),
    missing.map((bill) => bill.id),
  );

  const structureIds = Array.from(
    new Set((items || []).map((item) => item.fee_structure_id).filter(Boolean)),
  ) as string[];
  if (structureIds.length === 0) return result;

  const { data: structures } = await supabase
    .from("fee_structures")
    .select("id, class_id")
    .eq("school_id", schoolId)
    .in("id", structureIds);

  const classIdByStructure = new Map<string, string>();
  for (const structure of structures || []) {
    if (structure.class_id) classIdByStructure.set(structure.id, structure.class_id);
  }
  const classIds = Array.from(new Set(classIdByStructure.values()));
  if (classIds.length === 0) return result;

  const yearIds = Array.from(new Set(missing.map((bill) => bill.academic_year_id as string)));
  const [classes, years] = await Promise.all([
    supabase.from("classes").select("id, name").in("id", classIds),
    supabase.from("academic_years").select("id, name").in("id", yearIds),
  ]);
  const classNameById = new Map<string, string>(
    (classes.data || []).map((c: { id: string; name: string }) => [c.id, c.name]),
  );
  const yearNameById = new Map<string, string>(
    (years.data || []).map((y: { id: string; name: string }) => [y.id, y.name]),
  );

  const classIdByBill = new Map<string, string>();
  for (const item of items || []) {
    const classId = item.fee_structure_id ? classIdByStructure.get(item.fee_structure_id) : undefined;
    if (classId && !classIdByBill.has(item.bill_id)) classIdByBill.set(item.bill_id, classId);
  }

  for (const bill of missing) {
    const classId = classIdByBill.get(bill.id);
    const className = classId ? classNameById.get(classId) : undefined;
    if (!className) continue;
    result.set(bill.id, {
      academicYearId: bill.academic_year_id as string,
      academicYearName: yearNameById.get(bill.academic_year_id as string) || "",
      className,
      sectionName: "",
    });
  }

  return result;
}
