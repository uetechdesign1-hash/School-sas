import type { createClient } from "@/lib/supabase/client";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

export const CARRY_FORWARD_NOTE_PREFIX = "[[fee-category-carry-forward:v1]]";

export type CarriedFeeLine = {
  fee_category_id: string | null;
  category_name: string;
  academic_year_name: string;
  amount: number;
};

export function parseCarryForwardLines(notes?: string | null): CarriedFeeLine[] | null {
  if (!notes?.startsWith(CARRY_FORWARD_NOTE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(notes.slice(CARRY_FORWARD_NOTE_PREFIX.length)) as {
      items?: CarriedFeeLine[];
    };
    if (!Array.isArray(parsed.items)) return null;
    return parsed.items.filter(
      (item) =>
        typeof item.category_name === "string" &&
        typeof item.academic_year_name === "string" &&
        Number.isFinite(Number(item.amount)) &&
        Number(item.amount) > 0,
    );
  } catch {
    return null;
  }
}

async function resolveOldFeeCategoryId(supabase: SupabaseBrowserClient, schoolId: string) {
  const { data: existing, error } = await supabase
    .from("fee_categories")
    .select("id")
    .eq("school_id", schoolId)
    .ilike("name", "Old Fee")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Unable to load the Old Fee category: ${error.message}`);
  if (existing?.id) return existing.id as string;

  const { data: created, error: createError } = await supabase
    .from("fee_categories")
    .insert({
      school_id: schoolId,
      name: "Old Fee",
      description: "Previous-year fee carried forward",
      default_frequency: "one_time",
      is_active: true,
    })
    .select("id")
    .single();
  if (createError) throw new Error(`Unable to create the Old Fee category: ${createError.message}`);
  return created.id as string;
}

export type CarryForwardBillRows = {
  recordIds: string[];
  total: number;
  rows: Array<{
    school_id: string;
    bill_id: string;
    fee_structure_id: null;
    fee_category_id: string;
    description: string;
    fee_type: string;
    amount: number;
    discount: number;
    net_amount: number;
  }>;
};

/**
 * Fee-bill lines for every pending carry-forward of a student in a year.
 * Each line is named "<Category> - <Old Year>", e.g. "Tuition Fee - 2025-2026".
 */
export async function buildPendingCarryForwardRows(
  supabase: SupabaseBrowserClient,
  schoolId: string,
  studentId: string,
  academicYearId: string,
  billId: string,
): Promise<CarryForwardBillRows> {
  const empty: CarryForwardBillRows = { recordIds: [], total: 0, rows: [] };

  const { data: records, error } = await supabase
    .from("fee_carry_forwards")
    .select("id, source_bill_id, amount, notes")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .eq("to_academic_year_id", academicYearId)
    .eq("status", "pending");
  if (error) throw new Error(`Unable to load previous-year carry-forward: ${error.message}`);
  if (!records?.length) return empty;

  // Fallback year name for records that have no category snapshot.
  const sourceBillIds = records.map((r) => r.source_bill_id).filter(Boolean) as string[];
  const yearNameByBill = new Map<string, string>();
  if (sourceBillIds.length) {
    const { data: sourceBills } = await supabase
      .from("fee_bills")
      .select("id, academic_year_id")
      .in("id", sourceBillIds);
    const yearIds = Array.from(
      new Set((sourceBills || []).map((b) => b.academic_year_id).filter(Boolean)),
    ) as string[];
    if (yearIds.length) {
      const { data: years } = await supabase.from("academic_years").select("id, name").in("id", yearIds);
      const yearName = new Map<string, string>((years || []).map((y: { id: string; name: string }) => [y.id, y.name]));
      for (const b of sourceBills || []) {
        if (b.academic_year_id) yearNameByBill.set(b.id, yearName.get(b.academic_year_id) || "");
      }
    }
  }

  const lines: CarriedFeeLine[] = records.flatMap((record) => {
    const snapshot = parseCarryForwardLines(record.notes);
    if (snapshot?.length) return snapshot;
    const amount = Math.max(Number(record.amount || 0), 0);
    if (amount <= 0) return [];
    return [
      {
        fee_category_id: null,
        category_name: "Old Fee",
        academic_year_name:
          (record.source_bill_id && yearNameByBill.get(record.source_bill_id)) || "Previous Year",
        amount,
      },
    ];
  });
  if (!lines.length) return empty;

  const oldFeeCategoryId = lines.some((line) => !line.fee_category_id)
    ? await resolveOldFeeCategoryId(supabase, schoolId)
    : null;

  const rows = lines.map((line) => ({
    school_id: schoolId,
    bill_id: billId,
    fee_structure_id: null as null,
    fee_category_id: (line.fee_category_id || oldFeeCategoryId) as string,
    description: `${line.category_name} - ${line.academic_year_name}`,
    fee_type: "one_time",
    amount: Number(line.amount),
    discount: 0,
    net_amount: Number(line.amount),
  }));

  return {
    recordIds: records.map((r) => r.id as string),
    total: rows.reduce((sum, row) => sum + row.amount, 0),
    rows,
  };
}

/** True for lines such as "Tuition Fee - 2025-2026" created from carry-forward. */
export function isCarryForwardDescription(description?: string | null) {
  return /\s-\s\d{4}\s*[-–\/]\s*\d{2,4}\s*$/.test(String(description || ""));
}
