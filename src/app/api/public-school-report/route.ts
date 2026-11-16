import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const SAMPLE_SCHOOL_ID = "04776fe4-d13d-45bb-8b75-43f2f1fdc7c5";

export const dynamic = "force-dynamic";

function indiaDateParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { year: Number(value("year")), month: Number(value("month")), day: value("day") };
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return Response.json({ error: "Report preview is unavailable." }, { status: 503 });
  }

  try {
    const supabase = createSupabaseClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { year, month, day } = indiaDateParts();
    const today = `${year}-${String(month).padStart(2, "0")}-${day}`;
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextMonthDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const historyStart = new Date(Date.UTC(year, month - 6, 1)).toISOString().slice(0, 10);

    const [schoolResult, studentsResult, staffResult, classesResult, attendanceResult, feesResult, expensesResult] =
      await Promise.all([
        supabase.from("schools").select("name, status").eq("id", SAMPLE_SCHOOL_ID).maybeSingle(),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", SAMPLE_SCHOOL_ID),
        supabase.from("staff").select("id", { count: "exact", head: true }).eq("school_id", SAMPLE_SCHOOL_ID),
        supabase.from("classes").select("id", { count: "exact", head: true }).eq("school_id", SAMPLE_SCHOOL_ID),
        supabase.from("student_attendance").select("status").eq("school_id", SAMPLE_SCHOOL_ID).eq("attendance_date", today),
        supabase.from("fee_payments").select("amount, payment_date").eq("school_id", SAMPLE_SCHOOL_ID).gte("payment_date", historyStart).lt("payment_date", nextMonthDate),
        supabase.from("expenses").select("amount, expense_date").eq("school_id", SAMPLE_SCHOOL_ID).gte("expense_date", historyStart).lt("expense_date", nextMonthDate),
      ]);

    const results = [schoolResult, studentsResult, staffResult, classesResult, attendanceResult, feesResult, expensesResult];
    const failed = results.some((result) => result.error);
    if (failed || !schoolResult.data || schoolResult.data.status === "suspended") {
      return Response.json({ error: "Report preview is unavailable." }, { status: 404 });
    }

    const attendanceRows = attendanceResult.data || [];
    const attendanceScore = attendanceRows.reduce((total, row) => {
      const status = String(row.status || "").toLowerCase();
      if (status === "present" || status === "late") return total + 1;
      if (status === "half_day") return total + 0.5;
      return total;
    }, 0);

    const sumAmounts = (rows: { amount: number | string | null }[] | null) =>
      (rows || []).reduce((total, row) => total + Number(row.amount || 0), 0);
    const currentMonthFees = (feesResult.data || []).filter((row) => row.payment_date >= monthStart);
    const currentMonthExpenses = (expensesResult.data || []).filter((row) => row.expense_date >= monthStart);
    const monthly = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 6 + index, 1));
      const key = date.toISOString().slice(0, 7);
      return {
        key,
        label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(date),
        fees: sumAmounts((feesResult.data || []).filter((row) => row.payment_date?.slice(0, 7) === key)),
        expenses: sumAmounts((expensesResult.data || []).filter((row) => row.expense_date?.slice(0, 7) === key)),
      };
    });

    return Response.json(
      {
        schoolName: schoolResult.data.name,
        students: studentsResult.count || 0,
        staff: staffResult.count || 0,
        classes: classesResult.count || 0,
        attendance: attendanceRows.length ? Math.round((attendanceScore / attendanceRows.length) * 100) : null,
        feeCollection: sumAmounts(currentMonthFees),
        expenses: sumAmounts(currentMonthExpenses),
        monthly,
        monthLabel: new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "Asia/Kolkata" }).format(new Date()),
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } },
    );
  } catch (error) {
    console.error("PUBLIC REPORT PREVIEW ERROR:", error);
    return Response.json({ error: "Report preview is unavailable." }, { status: 500 });
  }
}
