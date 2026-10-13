import type { createClient } from "@/lib/supabase/client";
import {
  CARRY_FORWARD_NOTE_PREFIX,
  buildPendingCarryForwardRows,
  isCarryForwardDescription,
  type CarriedFeeLine,
} from "@/lib/fees/carry-forward";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

const FREQUENCY_MULTIPLIER: Record<string, number> = {
  one_time: 1,
  annual: 1,
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
};

export function annualAmount(amount: number, frequency: string) {
  return Math.max(Number(amount) || 0, 0) * (FREQUENCY_MULTIPLIER[frequency] || 1);
}

/** "Tuition Fee - 2024-2025" -> { base: "Tuition Fee", year: "2024-2025" } */
function splitCarryDescription(description: string, fallbackYear: string) {
  const match = description.match(/^(.*?)\s-\s(\d{4}\s*[-–/]\s*\d{2,4})\s*$/);
  if (match) return { base: match[1].trim(), year: match[2].trim() };
  return { base: description || "Fee", year: fallbackYear };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Makes sure every unpaid bill of an EARLIER academic year has a carry-forward
 * record into `targetYearId`, split category by category
 * (e.g. Tuition 1000 + Bus 1000). Safe to call repeatedly.
 * Returns how many carry-forward records were created.
 */
export async function ensureCarryForwardRecords(
  supabase: SupabaseBrowserClient,
  schoolId: string,
  studentId: string,
  targetYearId: string,
): Promise<number> {
  const { data: years, error: yearsError } = await supabase
    .from("academic_years")
    .select("id, name, start_date")
    .eq("school_id", schoolId);
  if (yearsError) throw new Error(`Unable to load academic years: ${yearsError.message}`);

  const target = (years || []).find((year) => year.id === targetYearId);
  if (!target) return 0;
  const earlier = (years || []).filter((year) => year.start_date < target.start_date);
  if (earlier.length === 0) return 0;
  const yearName = new Map<string, string>(earlier.map((year) => [year.id as string, year.name as string]));

  const { data: oldBills, error: billsError } = await supabase
    .from("fee_bills")
    .select("id, academic_year_id, balance_amount, status")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .in("academic_year_id", earlier.map((year) => year.id as string))
    .gt("balance_amount", 0.005);
  if (billsError) throw new Error(`Unable to load previous-year bills: ${billsError.message}`);

  const unpaid = (oldBills || []).filter((bill) => bill.status !== "cancelled");
  if (unpaid.length === 0) return 0;

  const { data: existing, error: existingError } = await supabase
    .from("fee_carry_forwards")
    .select("source_bill_id")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .in("source_bill_id", unpaid.map((bill) => bill.id as string));
  if (existingError) throw new Error(`Unable to check carry-forward records: ${existingError.message}`);
  const alreadyCarried = new Set((existing || []).map((row) => row.source_bill_id as string));

  let created = 0;
  for (const bill of unpaid) {
    if (alreadyCarried.has(bill.id as string)) continue;
    const outstanding = round2(Math.max(Number(bill.balance_amount || 0), 0));
    const sourceYear = yearName.get(bill.academic_year_id as string) || "Previous Year";

    const { data: items } = await supabase
      .from("fee_bill_items")
      .select("id, fee_category_id, description, amount, discount, net_amount")
      .eq("school_id", schoolId)
      .eq("bill_id", bill.id);

    const itemIds = (items || []).map((item) => item.id as string);
    const paidByItem = new Map<string, number>();
    if (itemIds.length) {
      const { data: allocations } = await supabase
        .from("fee_payment_allocations")
        .select("fee_bill_item_id, amount")
        .eq("school_id", schoolId)
        .in("fee_bill_item_id", itemIds);
      for (const allocation of allocations || []) {
        if (!allocation.fee_bill_item_id) continue;
        paidByItem.set(
          allocation.fee_bill_item_id,
          (paidByItem.get(allocation.fee_bill_item_id) || 0) + Number(allocation.amount || 0),
        );
      }
    }

    let lines: CarriedFeeLine[] = (items || []).flatMap((item) => {
      const net = Number(item.net_amount ?? Number(item.amount || 0) - Number(item.discount || 0));
      const remaining = round2(net - (paidByItem.get(item.id as string) || 0));
      if (remaining <= 0.005) return [];
      const { base, year } = splitCarryDescription(String(item.description || "Fee"), sourceYear);
      return [{
        fee_category_id: (item.fee_category_id as string | null) || null,
        category_name: base,
        academic_year_name: year,
        amount: remaining,
      }];
    });

    // Line balances must add up to the bill balance.
    const lineTotal = lines.reduce((sum, line) => sum + line.amount, 0);
    if (lineTotal > outstanding + 0.005 && lineTotal > 0) {
      const ratio = outstanding / lineTotal;
      lines = lines.map((line) => ({ ...line, amount: round2(line.amount * ratio) }));
    } else if (outstanding - lineTotal > 0.005) {
      lines = [
        ...lines,
        {
          fee_category_id: null,
          category_name: lineTotal === 0 ? "Unallocated fee balance" : "Other outstanding fee",
          academic_year_name: sourceYear,
          amount: round2(outstanding - lineTotal),
        },
      ];
    }
    lines = lines.filter((line) => line.amount > 0.005);
    if (lines.length === 0) continue;

    const { error } = await supabase.rpc("create_fee_carry_forward", {
      p_school_id: schoolId,
      p_student_id: studentId,
      p_source_bill_id: bill.id,
      p_to_academic_year_id: targetYearId,
      p_amount: outstanding,
      p_notes: `${CARRY_FORWARD_NOTE_PREFIX}${JSON.stringify({ items: lines })}`,
    });
    if (error) throw new Error(`Unable to carry forward ${sourceYear} balance: ${error.message}`);
    created += 1;
  }
  return created;
}

/**
 * Adds pending carry-forward as "<Category> - <Old Year>" lines to the
 * student's bill for the year, marks them applied and recalculates the bill.
 * Returns the number of lines added.
 */
export async function applyCarryForwardToBill(
  supabase: SupabaseBrowserClient,
  schoolId: string,
  studentId: string,
  academicYearId: string,
  billId: string,
): Promise<number> {
  const carry = await buildPendingCarryForwardRows(supabase, schoolId, studentId, academicYearId, billId);
  if (carry.rows.length === 0) return 0;

  const { error: insertError } = await supabase.from("fee_bill_items").insert(carry.rows);
  if (insertError) throw new Error(`Unable to add previous-year fees to the bill: ${insertError.message}`);

  const { error: applyError } = await supabase
    .from("fee_carry_forwards")
    .update({ target_bill_id: billId, status: "applied" })
    .eq("school_id", schoolId)
    .in("id", carry.recordIds);
  if (applyError) throw new Error(`Unable to mark carry-forward as applied: ${applyError.message}`);

  const { error: recalcError } = await supabase.rpc("recalculate_fee_bill", { p_bill_id: billId });
  if (recalcError) throw new Error(`Unable to recalculate the bill: ${recalcError.message}`);
  return carry.rows.length;
}

export type StructureFeeItem = {
  fee_category_id: string;
  amount: number;
  frequency: string;
  mandatory: boolean;
};

export type AssignResult = {
  createdBill: boolean;
  mandatoryLinesAdded: number;
  carryLinesAdded: number;
};

/**
 * ONE student, ONE academic year:
 *  - creates the year's bill if it does not exist
 *  - adds the structure's missing MANDATORY fees (e.g. Tuition 8000, Bus 4000)
 *  - carries earlier-year dues in as "Tuition Fee - 2025-2026" lines
 *  - recalculates the bill so outstanding = this year's fees + old dues
 */
export async function assignYearFeesToStudent(
  supabase: SupabaseBrowserClient,
  args: {
    schoolId: string;
    studentId: string;
    academicYearId: string;
    structureId: string;
    structureName: string;
    items: StructureFeeItem[];
    categoryNames: Map<string, string>;
    userId: string;
  },
): Promise<AssignResult> {
  const { schoolId, studentId, academicYearId, structureId, structureName, items, categoryNames, userId } = args;
  const mandatory = items.filter((item) => item.mandatory);
  const today = new Date().toISOString().slice(0, 10);

  await ensureCarryForwardRecords(supabase, schoolId, studentId, academicYearId);

  const { data: existing, error: billLoadError } = await supabase
    .from("fee_bills")
    .select("id")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .eq("academic_year_id", academicYearId)
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle();
  if (billLoadError) throw new Error(`Could not check existing student bills: ${billLoadError.message}`);

  let billId = existing?.id as string | undefined;
  let createdBill = false;
  if (!billId) {
    const { data: bill, error: createError } = await supabase
      .from("fee_bills")
      .insert({
        school_id: schoolId,
        student_id: studentId,
        academic_year_id: academicYearId,
        bill_number: `BILL-${today.replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        bill_date: today,
        due_date: null,
        status: "unpaid",
        subtotal: 0,
        discount: 0,
        late_fee: 0,
        total_amount: 0,
        paid_amount: 0,
        balance_amount: 0,
        notes: `Mandatory fees from ${structureName}`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (createError || !bill?.id) throw new Error(createError?.message || "Unable to create student fee bill.");
    billId = bill.id as string;
    createdBill = true;
  }

  const { data: currentLines, error: lineLoadError } = await supabase
    .from("fee_bill_items")
    .select("fee_category_id, description")
    .eq("school_id", schoolId)
    .eq("bill_id", billId);
  if (lineLoadError) throw new Error(`Could not check assigned fees: ${lineLoadError.message}`);

  // "Tuition Fee - 2025-2026" is old money, not this year's Tuition Fee.
  const haveThisYear = new Set(
    (currentLines || [])
      .filter((line) => !isCarryForwardDescription(line.description))
      .map((line) => line.fee_category_id as string),
  );
  const missing = mandatory.filter((item) => !haveThisYear.has(item.fee_category_id));

  if (missing.length) {
    const rows = missing.map((item) => {
      const amount = annualAmount(item.amount, item.frequency);
      return {
        school_id: schoolId,
        bill_id: billId,
        fee_structure_id: structureId,
        fee_category_id: item.fee_category_id,
        description: categoryNames.get(item.fee_category_id) || "Fee",
        fee_type: item.frequency,
        amount,
        discount: 0,
        net_amount: amount,
      };
    });
    const { error: insertError } = await supabase.from("fee_bill_items").insert(rows);
    if (insertError) {
      if (createdBill) await supabase.from("fee_bills").delete().eq("id", billId).eq("school_id", schoolId);
      throw new Error(`Could not add mandatory fees to student bill: ${insertError.message}`);
    }
    const { error: recalcError } = await supabase.rpc("recalculate_fee_bill", { p_bill_id: billId });
    if (recalcError) throw new Error(`Could not recalculate student bill: ${recalcError.message}`);
  }

  const carryLinesAdded = await applyCarryForwardToBill(supabase, schoolId, studentId, academicYearId, billId);

  return { createdBill, mandatoryLinesAdded: missing.length, carryLinesAdded };
}

/** Active students of a class (or every class) for an academic year. */
export async function listStudentsForClassYear(
  supabase: SupabaseBrowserClient,
  schoolId: string,
  classId: string | null,
  academicYearId: string,
): Promise<string[]> {
  const ids = new Set<string>();

  let current = supabase
    .from("students")
    .select("id")
    .eq("school_id", schoolId)
    .eq("status", "active")
    .eq("academic_year_id", academicYearId);
  if (classId) current = current.eq("class_id", classId);
  const { data: currentRows, error } = await current;
  if (error) throw new Error(`Students could not be loaded: ${error.message}`);
  for (const row of currentRows || []) ids.add(row.id as string);

  let enrolled = supabase
    .from("student_enrollments")
    .select("student_id")
    .eq("school_id", schoolId)
    .eq("academic_year_id", academicYearId);
  if (classId) enrolled = enrolled.eq("class_id", classId);
  const { data: enrolledRows, error: enrolledError } = await enrolled;
  if (!enrolledError && enrolledRows?.length) {
    const { data: active } = await supabase
      .from("students")
      .select("id")
      .eq("school_id", schoolId)
      .eq("status", "active")
      .in("id", enrolledRows.map((row) => row.student_id as string));
    for (const row of active || []) ids.add(row.id as string);
  }

  return Array.from(ids);
}
