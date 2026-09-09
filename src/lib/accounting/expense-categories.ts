import type { SupabaseClient } from "@supabase/supabase-js";

export const BUILT_IN_EXPENSE_CATEGORIES = ["Fee", "Salary"] as const;

export async function ensureBuiltInExpenseCategories(
  supabase: SupabaseClient,
  schoolId: string,
) {
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, school_id, name")
    .eq("school_id", schoolId)
    .in("name", [...BUILT_IN_EXPENSE_CATEGORIES]);

  if (error) throw error;

  const existing = new Map(
    (data || []).map((category) => [category.name.toLowerCase(), category]),
  );

  const missing = BUILT_IN_EXPENSE_CATEGORIES.filter(
    (name) => !existing.has(name.toLowerCase()),
  );

  if (missing.length > 0) {
    const { data: created, error: createError } = await supabase
      .from("expense_categories")
      .insert(missing.map((name) => ({ school_id: schoolId, name })))
      .select("id, school_id, name");

    if (createError) throw createError;

    for (const category of created || []) {
      existing.set(category.name.toLowerCase(), category);
    }
  }

  return existing;
}
