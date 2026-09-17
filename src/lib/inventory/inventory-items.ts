import type { SupabaseClient } from "@supabase/supabase-js";
import { applyStockMovements } from "@/lib/inventory/valuation";

/*
 * CRUD for the resale inventory master (inventory_items) plus the manual stock
 * adjustment that writes through the single canonical movement ledger.
 * Opening stock is stored on the item itself; applyStockMovements materialises
 * it as the first movement row the first time the item is touched.
 */

export type InventoryCategory = "books" | "uniform" | "other";

export type InventoryItemRecord = {
  id: string;
  school_id: string;
  name: string;
  category: InventoryCategory;
  unit: string;
  opening_quantity: number;
  opening_unit_cost: number;
  is_active: boolean;
  notes: string | null;
};

export type InventoryItemInput = {
  schoolId: string;
  name: string;
  category: InventoryCategory;
  unit: string;
  openingQuantity: number;
  openingUnitCost: number;
  notes: string | null;
  createdBy: string | null;
};

export type InventoryMovementRecord = {
  id: string;
  movement_date: string;
  movement_type: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  balance_quantity: number;
  balance_unit_cost: number;
  notes: string | null;
  ref_table: string | null;
};

const round2 = (value: number) =>
  Math.round(Number(value || 0) * 100) / 100;

const round4 = (value: number) =>
  Math.round(Number(value || 0) * 10000) / 10000;

export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategory, string> = {
  books: "Books",
  uniform: "Uniform",
  other: "Other resale",
};

export async function listInventoryItems(
  supabase: SupabaseClient,
  schoolId: string,
): Promise<InventoryItemRecord[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select(
      "id, school_id, name, category, unit, opening_quantity, opening_unit_cost, is_active, notes",
    )
    .eq("school_id", schoolId)
    .order("name");

  if (error) throw error;

  return (data ?? []) as InventoryItemRecord[];
}

export async function listStockMovements(
  supabase: SupabaseClient,
  schoolId: string,
  inventoryItemId: string,
  limit = 100,
): Promise<InventoryMovementRecord[]> {
  const { data, error } = await supabase
    .from("inventory_stock_movements")
    .select(
      "id, movement_date, movement_type, quantity, unit_cost, total_cost, balance_quantity, balance_unit_cost, notes, ref_table",
    )
    .eq("school_id", schoolId)
    .eq("inventory_item_id", inventoryItemId)
    .order("movement_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []) as InventoryMovementRecord[];
}

export async function createInventoryItem(
  supabase: SupabaseClient,
  input: InventoryItemInput,
) {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Item name is required.");
  }

  if (Number(input.openingQuantity) < 0) {
    throw new Error("Opening quantity cannot be negative.");
  }

  if (Number(input.openingUnitCost) < 0) {
    throw new Error("Opening unit cost cannot be negative.");
  }

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      school_id: input.schoolId,
      name,
      category: input.category,
      unit: input.unit.trim() || "pcs",
      opening_quantity: round4(input.openingQuantity),
      opening_unit_cost: round4(input.openingUnitCost),
      notes: input.notes,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (error) {
    if (String(error.message || "").includes("duplicate key")) {
      throw new Error("An item with this name already exists.");
    }

    throw error;
  }

  return String(data.id);
}

/*
 * Opening quantity/cost may only be edited while the item has no movement
 * rows, otherwise changing them would silently rewrite history. Later
 * corrections go through a stock adjustment instead.
 */
export async function updateInventoryItem(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    itemId: string;
    name: string;
    category: InventoryCategory;
    unit: string;
    openingQuantity: number;
    openingUnitCost: number;
    notes: string | null;
  },
) {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Item name is required.");
  }

  const [countResult, itemResult] = await Promise.all([
    supabase
      .from("inventory_stock_movements")
      .select("id", { count: "exact", head: true })
      .eq("school_id", input.schoolId)
      .eq("inventory_item_id", input.itemId),
    supabase
      .from("inventory_items")
      .select("opening_quantity, opening_unit_cost")
      .eq("id", input.itemId)
      .eq("school_id", input.schoolId)
      .maybeSingle(),
  ]);

  if (countResult.error) throw countResult.error;
  if (itemResult.error) throw itemResult.error;

  const hasMovements = Number(countResult.count || 0) > 0;

  if (hasMovements) {
    // Once stock has moved, the opening figures are history. Comparing them
    // against the stored row stops an edit from quietly restating it.
    const stored = itemResult.data;

    const openingChanged =
      round4(input.openingQuantity) !==
        round4(Number(stored?.opening_quantity || 0)) ||
      round4(input.openingUnitCost) !==
        round4(Number(stored?.opening_unit_cost || 0));

    if (openingChanged) {
      throw new Error(
        "This item already has stock movements, so its opening quantity and cost are locked. Use a stock adjustment instead.",
      );
    }
  }

  const { error } = await supabase
    .from("inventory_items")
    .update({
      name,
      category: input.category,
      unit: input.unit.trim() || "pcs",
      opening_quantity: hasMovements
        ? undefined
        : round4(input.openingQuantity),
      opening_unit_cost: hasMovements
        ? undefined
        : round4(input.openingUnitCost),
      notes: input.notes,
    })
    .eq("id", input.itemId)
    .eq("school_id", input.schoolId);

  if (error) {
    if (String(error.message || "").includes("duplicate key")) {
      throw new Error("An item with this name already exists.");
    }

    throw error;
  }
}

export async function setInventoryItemActive(
  supabase: SupabaseClient,
  schoolId: string,
  itemId: string,
  isActive: boolean,
) {
  const { error } = await supabase
    .from("inventory_items")
    .update({ is_active: isActive })
    .eq("id", itemId)
    .eq("school_id", schoolId);

  if (error) throw error;
}

/*
 * Manual stock correction. An increase carries a unit cost (it re-values the
 * average); a decrease is valued at the current weighted average, exactly like
 * a sale, so the ledger stays internally consistent.
 */
export async function applyStockAdjustment(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    itemId: string;
    adjustmentDate: string;
    direction: "increase" | "decrease";
    quantity: number;
    unitCost: number;
    notes: string | null;
  },
) {
  const quantity = Math.abs(Number(input.quantity || 0));

  if (!(quantity > 0)) {
    throw new Error("Adjustment quantity must be greater than zero.");
  }

  const signedQuantity =
    input.direction === "increase" ? quantity : -quantity;

  if (input.direction === "increase" && Number(input.unitCost) < 0) {
    throw new Error("Unit cost cannot be negative.");
  }

  const applied = await applyStockMovements(supabase, input.schoolId, [
    {
      inventoryItemId: input.itemId,
      movementDate: input.adjustmentDate,
      movementType: "adjustment",
      quantity: signedQuantity,
      unitCost:
        input.direction === "increase" ? round4(input.unitCost) : undefined,
      refTable: "inventory_items",
      refId: input.itemId,
      notes: input.notes || "Manual stock adjustment",
    },
  ]);

  const movement = applied.find(
    (row) => row.inventoryItemId === input.itemId && row.refId === input.itemId,
  );

  return {
    balanceQuantity: movement?.balanceQuantity || 0,
    balanceUnitCost: movement?.balanceUnitCost || 0,
    totalCost: round2(movement?.totalCost || 0),
  };
}
