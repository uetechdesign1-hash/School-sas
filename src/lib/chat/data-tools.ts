/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * =========================================================
 * EduNexa Data Assistant - Secure Read-Only Data Tools
 * =========================================================
 *
 * LAYER 2 of the EduNexa assistant.
 *
 * Every function here is READ-ONLY and is forced to run as
 * the currently authenticated user via the existing Supabase
 * session. All queries are scoped to the school_id that was
 * resolved server-side from the session - NEVER from the
 * browser/chat request.
 *
 * There are no generic query tools. The assistant can only
 * call the explicitly listed functions below, and each one
 * reads fixed, existing tables/views/RPCs that the EduNexa
 * pages already use. No dynamic table names, no raw SQL.
 *
 * Reused existing sources:
 *   - get_my_school_id() / school_users        (auth+school)
 *   - fee_bills, fee_bill_items, fee_categories,
 *     fee_payments, fee_payment_allocations   (fee ledger)
 *   - get_receipt_history() RPC                (receipts)
 *   - cash_book / bank_book views              (cash & bank)
 *   - payroll_runs, payroll_items              (payroll)
 *   - staff_salary_structures                  (salary)
 *   - staff_monthly_attendance                 (attendance)
 *   - journal_entries / journal_lines          (ledger/P&L)
 *   - expenses / expense_categories            (expenses)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ChatAnswer } from "./knowledge-base";

/* =========================================================
   TYPES
   ========================================================= */

export type DataContext = {
  supabase: SupabaseClient;
  schoolId: string;
  schoolName: string;
};

export type NamedMatch =
  | { status: "ok"; id: string; label: string }
  | { status: "not_found" }
  | { status: "ambiguous"; options: string[] };

type RawRecord = Record<string, unknown>;

function row<V>(record: RawRecord, key: string): V | null {
  const value = record[key];
  return value == null ? null : (value as V);
}

/* =========================================================
   FORMATTING HELPERS (same conventions as the app pages)
   ========================================================= */

export function inr(value: unknown): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function appToday(): string {
  return new Date().toISOString().split("T")[0];
}

export function appDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const parsed = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function cleanFeeCategory(description: string): string {
  return (description || "").replace(/^Fee Management\s*-\s*/i, "");
}

function norm(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fullName(record: RawRecord): string {
  return [record.first_name, record.middle_name, record.last_name]
    .filter(Boolean)
    .map(String)
    .join(" ")
    .trim();
}

/* =========================================================
   SECURITY GUARD
   The chat layer must never run SQL or accept table names.
   Anything that looks like a raw query attempt is refused
   before any data access happens.
   ========================================================= */

const SQL_ATTEMPT_PATTERN =
  /\b(select|insert\s+into|delete\s+from|update\s+\w+\s+set|drop\s+table|drop\s+database|alter\s+table|truncate\s+table|union\s+(all\s+)?select|create\s+table|exec(ute)?\s*\()\b/i;

export function looksLikeSqlAttempt(message: string): boolean {
  const text = (message || "").trim();
  if (text.length < 6) return false;
  if (SQL_ATTEMPT_PATTERN.test(text)) return true;
  // "show me everything from the fee_payments table"-style probing.
  if (/\btable\b/i.test(text) && /\bfrom\b|\brows\b|\bcontents\b/i.test(text)) {
    return true;
  }
  return false;
}

export function sqlRefusalAnswer(): ChatAnswer {
  return {
    kind: "fallback",
    text: "I can't run queries or database commands. I can only answer questions about your school's data in plain language — for example \"What is Varshini's outstanding?\" or \"How much fee did we collect today?\".",
  };
}

/* =========================================================
   AUTH + SCHOOL CONTEXT
   Reuses the exact existing mechanism every EduNexa page
   uses: authenticated user -> get_my_school_id() RPC ->
   school_users fallback. The school id ALWAYS comes from
   the server session, never from the browser request.
   ========================================================= */

export async function resolveDataContext(
  supabase: SupabaseClient,
): Promise<DataContext | null> {
  const { data: userData } = await supabase.auth.getUser();

  const user = userData?.user;
  if (!user) return null;

  // 1. Central school-detection RPC (same as every page).
  let schoolId: string | null = null;

  const { data: rpcSchoolId } = await supabase.rpc("get_my_school_id");

  if (rpcSchoolId) {
    schoolId = String(rpcSchoolId);
  }

  // 2. Fallback: active school membership (same as every page).
  if (!schoolId) {
    const { data: membership } = await supabase
      .from("school_users")
      .select("school_id, is_active, created_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membership?.school_id) {
      schoolId = String(membership.school_id);
    }
  }

  if (!schoolId) return null;

  const { data: school } = await supabase
    .from("schools")
    .select("id, name")
    .eq("id", schoolId)
    .maybeSingle();

  return {
    supabase,
    schoolId,
    schoolName: school?.name || "your school",
  };
}

/* =========================================================
   DATE RANGES
   Same day-string conventions the app already uses
   (toISOString().split("T")[0]).
   ========================================================= */

export type DateRange = {
  label: string;
  from: string;
  to: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function ymd(date: Date): string {
  return date.toISOString().split("T")[0];
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthRange(year: number, month: number): DateRange {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-${String(
    daysInMonth(year, month),
  ).padStart(2, "0")}`;
  const label = new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  return { label, from, to };
}

/**
 * Understands: today, yesterday, this month, last month,
 * this year, "september 2026" and
 * "from 1 september to 12 september" / "1 sep to 12 sep".
 * Returns null when no date expression is present.
 */
export function parseDateRange(text: string): DateRange | null {
  const t = norm(text);
  const now = new Date();
  const today = ymd(now);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (/\btoday\b/.test(t)) {
    return { label: "Today", from: today, to: today };
  }

  if (/\byesterday\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const day = ymd(d);
    return { label: "Yesterday", from: day, to: day };
  }

  if (/\blast month\b/.test(t)) {
    const year = currentMonth === 1 ? currentYear - 1 : currentYear;
    const month = currentMonth === 1 ? 12 : currentMonth - 1;
    const range = monthRange(year, month);
    if (range.to > today) range.to = today;
    return { ...range, label: `Last month (${range.label})` };
  }

  if (/\bthis month\b|\bcurrent month\b/.test(t)) {
    const range = monthRange(currentYear, currentMonth);
    range.to = today;
    return { ...range, label: `This month (${range.label})` };
  }

  if (/\bthis year\b/.test(t) && !/\bthis academic year\b/.test(t)) {
    return {
      label: `This year (${currentYear})`,
      from: `${currentYear}-01-01`,
      to: today,
    };
  }

  // "from 1 sep to 12 sep" / "from 1 september to 12 september 2026"
  const spanMatch = t.match(
    /(?:from\s+)?(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+(20\d{2}))?\s*(?:to|-|until|till)\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+(20\d{2}))?/,
  );

  if (spanMatch) {
    const fromDay = Number(spanMatch[1]);
    const fromMonth = MONTHS[spanMatch[2]] || currentMonth;
    const fromYear = spanMatch[3] ? Number(spanMatch[3]) : currentYear;
    const toDay = Number(spanMatch[4]);
    const toMonth = MONTHS[spanMatch[5]] || fromMonth;
    const toYear = spanMatch[6]
      ? Number(spanMatch[6])
      : toMonth < fromMonth
        ? fromYear + 1
        : fromYear;

    const from = `${fromYear}-${String(fromMonth).padStart(2, "0")}-${String(
      Math.min(fromDay, daysInMonth(fromYear, fromMonth)),
    ).padStart(2, "0")}`;
    const to = `${toYear}-${String(toMonth).padStart(2, "0")}-${String(
      Math.min(toDay, daysInMonth(toYear, toMonth)),
    ).padStart(2, "0")}`;

    const label = `${appDate(from)} – ${appDate(to)}`;
    return { label, from: from <= to ? from : to, to: from <= to ? to : from };
  }

  // "september 2026" / "sep 2026" -> that whole month
  const monthMatch = t.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(20\d{2})\b/,
  );

  if (monthMatch) {
    const month = MONTHS[monthMatch[1]] || currentMonth;
    const year = Number(monthMatch[2]);
    const range = monthRange(year, month);
    if (year === currentYear && month === currentMonth) range.to = today;
    return range;
  }

  return null;
}

/**
 * Resolve "this academic year" against the school's own
 * academic_years table (is_current = true), exactly like the
 * Receipt page does.
 */
export async function resolveAcademicYearRange(
  ctx: DataContext,
): Promise<DateRange | null> {
  const { data } = await ctx.supabase
    .from("academic_years")
    .select("id, name, start_date, end_date, is_current")
    .eq("school_id", ctx.schoolId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const start = String(data.start_date || "");
  const end = String(data.end_date || "");
  if (!start || !end) return null;

  const today = appToday();
  return {
    label: `This academic year (${data.name || ""})`.trim(),
    from: start,
    to: end < today ? end : today,
  };
}

/* =========================================================
   ENTITY RESOLUTION
   Names are resolved against the CURRENT school only, so a
   student from another school can never be matched.
   Ambiguous names return the candidates so the assistant
   can ask the user to clarify.
   ========================================================= */

type StudentRow = {
  id: string;
  school_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  admission_no: string;
  class_id: string | null;
  section_id: string | null;
};

export type StudentInfo = {
  id: string;
  name: string;
  admissionNo: string;
  className: string;
  classId: string | null;
};

async function loadClassNames(
  ctx: DataContext,
  classIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (classIds.length === 0) return map;

  const { data } = await ctx.supabase
    .from("classes")
    .select("id, name")
    .eq("school_id", ctx.schoolId)
    .in("id", classIds);

  for (const row of (data || []) as RawRecord[]) {
    map.set(String(row.id), String(row.name || ""));
  }
  return map;
}

export function studentLabel(
  student: StudentInfo,
  admissionNo: string,
): string {
  const parts = [student.name];
  if (student.className) parts.push(student.className);
  if (admissionNo) parts.push(`Adm. ${admissionNo}`);
  return parts.filter(Boolean).join(" — ");
}

/**
 * Match a student by name inside the current school.
 * - Full-name match wins over partial match.
 * - A single candidate resolves directly.
 * - Multiple candidates return status "ambiguous" so the
 *   assistant asks which one the user means.
 */
export async function resolveStudent(
  ctx: DataContext,
  rawName: string,
): Promise<NamedMatch & { student?: StudentInfo; admissionNo?: string }> {
  const search = norm(rawName).replace(/\b(student|pupil)\b/g, "").trim();
  if (!search) return { status: "not_found" };

  const { data, error } = await ctx.supabase
    .from("students")
    .select(
      "id, school_id, first_name, middle_name, last_name, admission_no, class_id, section_id",
    )
    .eq("school_id", ctx.schoolId)
    .limit(2000);

  if (error || !data) return { status: "not_found" };

  const candidates = (data || []).map((record) => {
    const row = record as RawRecord;
    return {
      id: String(row.id),
      name: fullName(row),
      admissionNo: String(row.admission_no || ""),
      classId: row.class_id ? String(row.class_id) : null,
    };
  });

  const exact = candidates.filter((c) => norm(c.name) === search);
  const starts = candidates.filter(
    (c) => !exact.includes(c) && norm(c.name).startsWith(search),
  );
  const includes = candidates.filter(
    (c) =>
      !exact.includes(c) &&
      !starts.includes(c) &&
      (norm(c.name).includes(search) ||
        c.admissionNo.toLowerCase() === search),
  );

  const matches = exact.length > 0 ? exact : starts.length > 0 ? starts : includes;

  if (matches.length === 0) return { status: "not_found" };

  if (matches.length === 1) {
    const classNames = await loadClassNames(
      ctx,
      matches.map((m) => m.classId).filter(Boolean) as string[],
    );
    const match = matches[0];
    const info: StudentInfo = {
      id: match.id,
      name: match.name,
      admissionNo: match.admissionNo,
      className: match.classId ? classNames.get(match.classId) || "" : "",
      classId: match.classId,
    };
    return {
      status: "ok",
      id: match.id,
      label: studentLabel(info, match.admissionNo),
      student: info,
      admissionNo: match.admissionNo,
    };
  }

  // Ambiguous — list each candidate with class so the user can pick.
  const classNames = await loadClassNames(
    ctx,
    matches.map((m) => m.classId).filter(Boolean) as string[],
  );

  return {
    status: "ambiguous",
    options: matches.slice(0, 5).map((m) =>
      [
        m.name,
        m.classId ? classNames.get(m.classId) || "Class" : "Class",
        m.admissionNo ? `Adm. ${m.admissionNo}` : "",
      ]
        .filter(Boolean)
        .join(" — "),
    ),
  };
}

export async function resolveStudentById(
  ctx: DataContext,
  studentId: string,
): Promise<StudentInfo | null> {
  const { data } = await ctx.supabase
    .from("students")
    .select(
      "id, school_id, first_name, middle_name, last_name, admission_no, class_id",
    )
    .eq("id", studentId)
    .eq("school_id", ctx.schoolId)
    .maybeSingle();

  if (!data) return null;
  const row = data as RawRecord;
  const classId = row.class_id ? String(row.class_id) : null;
  let className = "";
  if (classId) {
    const names = await loadClassNames(ctx, [classId]);
    className = names.get(classId) || "";
  }
  return {
    id: String(row.id),
    name: fullName(row),
    admissionNo: String(row.admission_no || ""),
    classId,
    className,
  };
}

/* ------------------------- STAFF ------------------------- */

export type StaffMatch = {
  id: string;
  name: string;
  employeeNo: string;
  designation: string;
};

export async function resolveStaff(
  ctx: DataContext,
  rawName: string,
): Promise<NamedMatch & { staff?: StaffMatch }> {
  const search = norm(rawName)
    .replace(/\b(staff|teacher|sir|madam)\b/g, "")
    .trim();
  if (!search) return { status: "not_found" };

  const { data, error } = await ctx.supabase
    .from("staff")
    .select(
      "id, school_id, employee_no, first_name, middle_name, last_name, designation, status",
    )
    .eq("school_id", ctx.schoolId)
    .limit(1000);

  if (error || !data) return { status: "not_found" };

  const candidates = (data || [])
    .map((record) => {
      const row = record as RawRecord;
      return {
        id: String(row.id),
        name: fullName(row),
        employeeNo: String(row.employee_no || ""),
        designation: row.designation ? String(row.designation) : "",
      };
    })
    .filter((c) => c.name);

  const exact = candidates.filter((c) => norm(c.name) === search);
  const starts = candidates.filter(
    (c) => !exact.includes(c) && norm(c.name).startsWith(search),
  );
  const includes = candidates.filter(
    (c) =>
      !exact.includes(c) && !starts.includes(c) && norm(c.name).includes(search),
  );

  const matches = exact.length > 0 ? exact : starts.length > 0 ? starts : includes;

  if (matches.length === 0) return { status: "not_found" };

  if (matches.length === 1) {
    const match = matches[0];
    return {
      status: "ok",
      id: match.id,
      label: [
        match.name,
        match.designation,
        match.employeeNo ? `Emp. ${match.employeeNo}` : "",
      ]
        .filter(Boolean)
        .join(" — "),
      staff: match,
    };
  }

  return {
    status: "ambiguous",
    options: matches
      .slice(0, 5)
      .map((m) =>
        [m.name, m.designation, m.employeeNo ? `Emp. ${m.employeeNo}` : ""]
          .filter(Boolean)
          .join(" — "),
      ),
  };
}

/* ------------------------- CASH / BANK ACCOUNTS ------------------------- */

export type BookAccount = {
  id: string;
  name: string;
  accountType: string; // 'cash' | 'bank'
};

export async function loadBookAccounts(
  ctx: DataContext,
  bookType: "cash" | "bank" | "both",
): Promise<BookAccount[]> {
  let query = ctx.supabase
    .from("accounts")
    .select("id, school_id, name, account_type, is_active")
    .eq("school_id", ctx.schoolId)
    .eq("is_active", true);

  if (bookType !== "both") {
    query = query.eq("account_type", bookType);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data || [])
    .filter((record) =>
      ["cash", "bank"].includes(
        String((record as RawRecord).account_type || "").toLowerCase(),
      ),
    )
    .map((record) => {
      const row = record as RawRecord;
      return {
        id: String(row.id),
        name: String(row.name || ""),
        accountType: String(row.account_type || "").toLowerCase(),
      };
    });
}

/** Resolve "SBI", "HDFC", "Main Cash", "Office Cash" etc. */
export async function resolveBookAccount(
  ctx: DataContext,
  rawName: string,
  bookType: "cash" | "bank" | "both",
): Promise<{ account: BookAccount | null; ambiguous: string[] }> {
  const accounts = await loadBookAccounts(ctx, bookType);
  if (accounts.length === 0) return { account: null, ambiguous: [] };

  const search = norm(rawName);
  if (!search) {
    // No account named — if exactly one account exists, use it.
    if (accounts.length === 1) return { account: accounts[0], ambiguous: [] };
    return { account: null, ambiguous: accounts.map((a) => a.name) };
  }

  const exact = accounts.filter((a) => norm(a.name) === search);
  const starts = accounts.filter(
    (a) => !exact.includes(a) && norm(a.name).startsWith(search),
  );
  const includes = accounts.filter(
    (a) =>
      !exact.includes(a) && !starts.includes(a) && norm(a.name).includes(search),
  );

  const matches = exact.length > 0 ? exact : starts.length > 0 ? starts : includes;

  if (matches.length === 1) return { account: matches[0], ambiguous: [] };
  if (matches.length > 1) {
    return { account: null, ambiguous: matches.map((a) => a.name) };
  }

  // Not matched directly — if there's only one account of the requested
  // book type it is the natural answer.
  const sameBook = accounts.filter(
    (a) => bookType === "both" || a.accountType === bookType,
  );
  if (sameBook.length === 1) return { account: sameBook[0], ambiguous: [] };

  return { account: null, ambiguous: [] };
}

/* ------------------------- FEE CATEGORIES ------------------------- */

export async function loadFeeCategoryNames(
  ctx: DataContext,
): Promise<Map<string, string>> {
  const { data } = await ctx.supabase
    .from("fee_categories")
    .select("id, name, school_id")
    .eq("school_id", ctx.schoolId);

  const map = new Map<string, string>();
  for (const record of (data || []) as RawRecord[]) {
    map.set(String(record.id), String(record.name || ""));
  }
  return map;
}

/* =========================================================
   FEE TOOLS (READ-ONLY)
   Business rules mirror the existing Student Fees page and
   Receipt page exactly:
     - fee_bills.balance_amount is the canonical outstanding
       (maintained by recalculate_fee_bill / record_fee_payment)
     - per-item paid = sum(fee_payment_allocations.amount) for
       that fee_bill_item_id
     - item net = net_amount (already excludes item discount)
     - fee_concessions reduce the bill total (bill-level)
     - one receipt (fee_payments row) can contain allocations
       across multiple fee categories
   ========================================================= */

type BillRow = RawRecord;
type ItemRow = RawRecord;

export type StudentFeeLedger = {
  bills: Array<{
    id: string;
    billNumber: string;
    billDate: string;
    status: string;
    total: number;
    paid: number;
    balance: number;
    concession: number;
    items: Array<{
      id: string;
      description: string;
      categoryId: string | null;
      categoryName: string;
      gross: number;
      net: number;
      paid: number;
      balance: number;
    }>;
  }>;
  totalOutstanding: number;
};

/**
 * Loads the complete fee ledger for one student (school-scoped)
 * using the same tables the Student Fees page loads.
 */
export async function loadStudentFeeLedger(
  ctx: DataContext,
  studentId: string,
): Promise<StudentFeeLedger | null> {
  const { data: bills, error: billError } = await ctx.supabase
    .from("fee_bills")
    .select(
      "id, school_id, student_id, bill_number, bill_date, due_date, status, subtotal, discount, total_amount, paid_amount, balance_amount",
    )
    .eq("school_id", ctx.schoolId)
    .eq("student_id", studentId)
    .order("bill_date", { ascending: false });

  if (billError) return null;
  const billRows = (bills || []) as BillRow[];
  if (billRows.length === 0) return null;

  const billIds = billRows.map((b) => String(b.id));

  const [itemsRes, allocRes, concessionRes] = await Promise.all([
    ctx.supabase
      .from("fee_bill_items")
      .select(
        "id, school_id, bill_id, fee_category_id, description, amount, discount, net_amount",
      )
      .eq("school_id", ctx.schoolId)
      .in("bill_id", billIds),
    ctx.supabase
      .from("fee_payment_allocations")
      .select("id, school_id, bill_id, payment_id, amount, fee_bill_item_id")
      .eq("school_id", ctx.schoolId)
      .in("bill_id", billIds),
    ctx.supabase
      .from("fee_concessions")
      .select("id, bill_id, amount, reason")
      .eq("school_id", ctx.schoolId)
      .eq("student_id", studentId),
  ]);

  const itemRows = (itemsRes.data || []) as ItemRow[];
  const allocRows = (allocRes.data || []) as RawRecord[];
  const concessionRows = (concessionRes.data || []) as RawRecord[];

  // Paid per fee_bill_item (category-accurate, from allocations).
  const paidByItem = new Map<string, number>();
  for (const allocation of allocRows) {
    const itemId = row<string>(allocation, "fee_bill_item_id");
    if (!itemId) continue;
    paidByItem.set(
      itemId,
      (paidByItem.get(itemId) || 0) + Number(allocation.amount || 0),
    );
  }

  const concessionByBill = new Map<string, number>();
  for (const concession of concessionRows) {
    const billId = row<string>(concession, "bill_id");
    if (!billId) continue;
    concessionByBill.set(
      billId,
      (concessionByBill.get(billId) || 0) + Number(concession.amount || 0),
    );
  }

  const categoryNames = await loadFeeCategoryNames(ctx);

  let totalOutstanding = 0;
  const ledgerBills = billRows.map((bill) => {
    const billId = String(bill.id);
    const concession = concessionByBill.get(billId) || 0;

    const billItems = itemRows
      .filter((item) => String(item.bill_id) === billId)
      .map((item) => {
        const gross = Number(item.amount || 0);
        const net = Number(item.net_amount ?? gross);
        const paid = paidByItem.get(String(item.id)) || 0;
        const balance = Math.max(net - paid, 0);
        const categoryId = item.fee_category_id
          ? String(item.fee_category_id)
          : null;
        return {
          id: String(item.id),
          description: cleanFeeCategory(String(item.description || "")),
          categoryId,
          categoryName: categoryId
            ? categoryNames.get(categoryId) ||
              cleanFeeCategory(String(item.description || ""))
            : cleanFeeCategory(String(item.description || "")),
          gross,
          net,
          paid,
          balance,
        };
      });

    totalOutstanding += Number(bill.balance_amount || 0);

    return {
      id: billId,
      billNumber: String(bill.bill_number || ""),
      billDate: String(bill.bill_date || ""),
      status: String(bill.status || ""),
      total: Number(bill.total_amount || 0),
      paid: Number(bill.paid_amount || 0),
      balance: Number(bill.balance_amount || 0),
      concession,
      items: billItems,
    };
  });

  return { bills: ledgerBills, totalOutstanding };
}

/* ------------------------- TOOL 1 & 2 ------------------------- */

/**
 * TOOL 1: getStudentFeeSummary
 * TOOL 2: getStudentOutstanding
 * Canonical outstanding = fee_bills.balance_amount (the same
 * number the Student Fees page shows).
 */
export async function getStudentOutstanding(
  ctx: DataContext,
  student: StudentInfo,
): Promise<ChatAnswer> {
  const ledger = await loadStudentFeeLedger(ctx, student.id);

  if (!ledger) {
    return {
      kind: "fallback",
      text: `${student.name} does not have a fee bill yet.`,
    };
  }

  const outstanding = ledger.totalOutstanding;
  const openBills = ledger.bills.filter((b) => b.balance > 0.005);

  if (outstanding <= 0.005) {
    return {
      kind: "fallback",
      text: `${student.name}${student.className ? ` — ${student.className}` : ""} has no outstanding fees. All bills are fully paid. 🎉`,
    };
  }

  // Category-wise breakdown from open bills (item balance).
  const byCategory = new Map<string, number>();
  for (const bill of openBills) {
    for (const item of bill.items) {
      if (item.balance <= 0) continue;
      byCategory.set(
        item.categoryName,
        (byCategory.get(item.categoryName) || 0) + item.balance,
      );
    }
  }

  const lines = Array.from(byCategory.entries()).map(
    ([name, amount]) => `• ${name}: ${inr(amount)}`,
  );

  const billLines = openBills.map(
    (b) => `• ${b.billNumber || "Bill"} (${appDate(b.billDate)}): ${inr(b.balance)} due`,
  );

  return {
    kind: "guide",
    title: `${student.name}${student.className ? ` — ${student.className}` : ""}`,
    text: `Outstanding fees: ${inr(outstanding)}`,
    steps: [
      ...(lines.length > 0 ? ["Breakdown by fee category:", ...lines] : []),
      ...(billLines.length > 0 ? ["Open bills:", ...billLines] : []),
    ],
    tips: [
      ...(openBills.some((b) => b.concession > 0)
        ? [
            `A concession of ${inr(openBills.reduce((sum, b) => sum + b.concession, 0))} has already been applied to these bills.`,
          ]
        : []),
      "Collect the balance from the Fee Receipts page (Receipt → Student Fee).",
    ],
    href: `/dashboard/students/${student.id}/fees`,
    pageLabel: "Open Student Fees",
  };
}

/* __APPEND7__ */