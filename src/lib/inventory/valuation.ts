import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Inventory valuation — Weighted Average Cost (WAC)
 *
 * Single canonical costing method for the whole app. Every stock movement
 * (purchase in, purchase return out, sale out) is recorded through this
 * module so the running quantity and weighted average cost stay consistent
 * and auditable in inventory_stock_movements.
 *
 * Rules:
 *  - purchase (+qty at purchase cost): newAvg = (qty*avg + inQty*cost) / (qty+inQty)
 *  - issue (-qty): COGS = qty * currentAvg; avg unchanged
 *  - opening balance: treated as a purchase at opening_unit_cost
 *  - issuing below zero is blocked (business rule: no negative inventory)
 */

export type StockRow = {
  id: string;
  quantity: number;
  unit_cost: number;
  balance_quantity: number;
  balance_unit_cost: number;
  movement_type: string;
};

export type AppliedMovement = {
  movementId: string;
  inventoryItemId: string;
  refId: string | null;
  quantity: number; // signed
  unitCost: number;
  totalCost: number;
  balanceQuantity: number;
  balanceUnitCost: number;
};

export class InventoryError extends Error {}

export type MovementInput = {
  inventoryItemId: string;
  movementDate: string;
  movementType:
    | "purchase"
    | "purchase_return"
    | "sale"
    | "sale_return"
    | "adjustment";
  quantity: number; // signed
  unitCost?: number; // required for inbound movements
  refTable?: string | null;
  refId?: string | null;
  notes?: string | null;
};

const round4 = (n: number) => Math.round(Number(n || 0) * 10000) / 10000;
const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

function round3(n: number) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

/*
 * Apply a batch of movements for one inventory item, reading the current
 * running balance from the latest movement row. RLS scopes every read to
 * the caller's school; the caller supplies the school id for the insert.
 */
export async function applyStockMovements(
  supabase: SupabaseClient,
  schoolId: string,
  movements: MovementInput[],
): Promise<AppliedMovement[]> {
  if (movements.length === 0) return [];

  // Group by item, preserving order.
  const byItem = new Map<string, MovementInput[]>();
  for (const movement of movements) {
    const list = byItem.get(movement.inventoryItemId) ?? [];
    list.push(movement);
    byItem.set(movement.inventoryItemId, list);
  }

  const applied: AppliedMovement[] = [];

  for (const [itemId, itemMovements] of byItem) {
    const { data: last, error: lastError } = await supabase
      .from("inventory_stock_movements")
      .select(
        "id, movement_type, quantity, unit_cost, balance_quantity, balance_unit_cost",
      )
      .eq("school_id", schoolId)
      .eq("inventory_item_id", itemId)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) throw lastError;

    // A movement row that exists for this item means the opening balance was
    // already recorded; otherwise seed from the item's opening fields.
    let balanceQty = 0;
    let balanceCost = 0;

    if (last) {
      balanceQty = Number(last.balance_quantity || 0);
      balanceCost = Number(last.balance_unit_cost || 0);
    } else {
      const { data: item, error: itemError } = await supabase
        .from("inventory_items")
        .select("opening_quantity, opening_unit_cost")
        .eq("id", itemId)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (itemError) throw itemError;
      if (!item) throw new InventoryError("Inventory item not found.");

      balanceQty = Number(item.opening_quantity || 0);
      balanceCost = Number(item.opening_unit_cost || 0);

      if (balanceQty > 0) {
        const { data: openingInserted, error: openingError } = await supabase
          .from("inventory_stock_movements")
          .insert({
            school_id: schoolId,
            inventory_item_id: itemId,
            movement_date: itemMovements[0].movementDate,
            movement_type: "adjustment" as const,
            quantity: balanceQty,
            unit_cost: round4(balanceCost),
            total_cost: round2(balanceQty * balanceCost),
            balance_quantity: round3(balanceQty),
            balance_unit_cost: round4(balanceCost),
            ref_table: "inventory_items",
            ref_id: itemId,
            notes: "Opening balance",
          })
          .select("id")
          .single();

        if (openingError) throw openingError;
        applied.push({
          movementId: openingInserted.id,
          inventoryItemId: itemId,
          refId: itemId,
          quantity: balanceQty,
          unitCost: round4(balanceCost),
          totalCost: round2(balanceQty * balanceCost),
          balanceQuantity: round3(balanceQty),
          balanceUnitCost: round4(balanceCost),
        });
      }
    }

    for (const movement of itemMovements) {
      const qty = Number(movement.quantity || 0);
      if (qty === 0) continue;

      const isInbound = qty > 0;
      let unitCost = Number(movement.unitCost || 0);
      let newQty = balanceQty;
      let newCost = balanceCost;

      if (isInbound) {
        if (!(unitCost >= 0)) {
          throw new InventoryError(
            "Inbound movements require a unit cost of zero or more.",
          );
        }

        const totalValue = balanceQty * balanceCost + qty * unitCost;
        newQty = round3(balanceQty + qty);
        newCost = newQty > 0 ? round4(totalValue / newQty) : 0;
      } else {
        const outQty = Math.abs(qty);

        if (outQty > balanceQty + 1e-9) {
          throw new InventoryError(
            `Not enough stock. Available ${balanceQty}, requested ${outQty}. Negative inventory is not allowed.`,
          );
        }

        // Issues are valued at the current weighted average.
        unitCost = round4(balanceCost);
        newQty = round3(balanceQty - outQty);
        newCost = balanceCost;
      }

      const totalCost = round2(Math.abs(qty) * unitCost);

      const { data: inserted, error: insertError } = await supabase
        .from("inventory_stock_movements")
        .insert({
          school_id: schoolId,
          inventory_item_id: itemId,
          movement_date: movement.movementDate,
          movement_type: movement.movementType,
          quantity: qty,
          unit_cost: round4(unitCost),
          total_cost: totalCost,
          balance_quantity: round3(newQty),
          balance_unit_cost: round4(newCost),
          ref_table: movement.refTable ?? null,
          ref_id: movement.refId ?? null,
          notes: movement.notes ?? null,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      applied.push({
        movementId: inserted.id,
        inventoryItemId: itemId,
        refId: movement.refId ?? null,
        quantity: qty,
        unitCost: round4(unitCost),
        totalCost,
        balanceQuantity: round3(newQty),
        balanceUnitCost: round4(newCost),
      });

      balanceQty = round3(newQty);
      balanceCost = round4(newCost);
    }
  }

  return applied;
}

export type StockSummaryItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
  openingQuantity: number;
  purchases: number;
  purchaseReturns: number;
  sales: number;
  saleReturns: number;
  closingQuantity: number;
  avgCost: number;
  stockValue: number;
};

/*
 * Per-item stock summary derived from the movement ledger:
 * opening + purchases - purchase returns - sales + sale returns = closing.
 */
export async function getStockSummary(
  supabase: SupabaseClient,
  schoolId: string,
): Promise<StockSummaryItem[]> {
  const [itemsResult, movementsResult] = await Promise.all([
    supabase
      .from("inventory_items")
      .select(
        "id, name, category, unit, opening_quantity, opening_unit_cost, is_active",
      )
      .eq("school_id", schoolId)
      .order("name"),
    supabase
      .from("inventory_stock_movements")
      .select(
        "inventory_item_id, movement_type, quantity, total_cost, balance_quantity, balance_unit_cost",
      )
      .eq("school_id", schoolId)
      // Ordered so the last row per item is genuinely the latest movement;
      // the closing balance below is read from that row.
      .order("movement_date", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (movementsResult.error) throw movementsResult.error;

  const movementsByItem = new Map<string, StockRow[]>();
  for (const row of movementsResult.data ?? []) {
    const list = movementsByItem.get(row.inventory_item_id) ?? [];
    list.push(row as unknown as StockRow);
    movementsByItem.set(row.inventory_item_id, list);
  }

  return (itemsResult.data ?? []).map((item) => {
    const rows = movementsByItem.get(item.id) ?? [];
    const sum = (type: string) =>
      rows
        .filter((row) => row.movement_type === type)
        .reduce((acc, row) => acc + Number(row.quantity || 0), 0);

    const opening = Number(item.opening_quantity || 0);
    const last = rows[rows.length - 1];

    const closingQuantity =
      rows.length > 0
        ? Number(last?.balance_quantity || 0)
        : opening;
    const avgCost =
      rows.length > 0
        ? Number(last?.balance_unit_cost || 0)
        : Number(item.opening_unit_cost || 0);

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      isActive: item.is_active,
      openingQuantity: opening,
      purchases: sum("purchase"),
      purchaseReturns: Math.abs(sum("purchase_return")),
      sales: Math.abs(sum("sale")),
      saleReturns: sum("sale_return"),
      closingQuantity,
      avgCost,
      stockValue: round2(closingQuantity * avgCost),
    };
  });
}
