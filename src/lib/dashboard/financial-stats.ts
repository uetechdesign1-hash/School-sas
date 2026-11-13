import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadFinancialStats(
  supabase: SupabaseClient,
  schoolId: string,
  monthStartDate: string,
  nextMonthStartDate: string,
  feesEnabled: boolean,
) {
  if (!feesEnabled) return { feeCollection: 0, expenses: 0 };

  const [paymentResult, expenseResult] = await Promise.all([
    supabase
      .from("fee_payments")
      .select("amount")
      .eq("school_id", schoolId)
      .gte("payment_date", monthStartDate)
      .lt("payment_date", nextMonthStartDate),
    supabase
      .from("expenses")
      .select("amount")
      .eq("school_id", schoolId)
      .gte("expense_date", monthStartDate)
      .lt("expense_date", nextMonthStartDate),
  ]);
  if (paymentResult.error) throw paymentResult.error;
  if (expenseResult.error) throw expenseResult.error;

  return {
    feeCollection: (paymentResult.data || []).reduce(
      (total, row) => total + Number(row.amount || 0),
      0,
    ),
    expenses: (expenseResult.data || []).reduce(
      (total, row) => total + Number(row.amount || 0),
      0,
    ),
  };
}
