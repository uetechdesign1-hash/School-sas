import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureSchoolAccountingSetup,
  postBookSaleJournal,
  postCogsJournal,
  INVENTORY_CATEGORY_ACCOUNTS,
} from "@/lib/accounting/canonical-accounting";
import {
  applyStockMovements,
  getStockSummary,
  InventoryError,
} from "@/lib/inventory/valuation";

/*
 * Selling resale inventory to a student.
 *
 *   Dr Cash/Bank or Other Receivables   (selling price)
 *       Cr Book / Uniform / Other Sales
 *   Dr Book / Uniform / Other COGS      (cost)
 *       Cr Book / Uniform / Other Inventory
 *
 * Two separate journal entries are posted, both keyed to the sale record so
 * a retry, a double click or a re-render cannot post them twice. Inventory is
 * always relieved at the weighted average COST, never at the selling price.
 */

export type InvoiceCategory = "books" | "uniform" | "other";

export type BookSaleLineInput = {
  inventoryItemId: string;
  quantity: number;
  unitPrice: number;
};

export type BookSalePaymentMode = "cash" | "bank" | "receivable";

export type BookSaleInput = {
  schoolId: string;
  saleDate: string;
  studentId: string | null;
  saleNumber: string | null;
  paymentMode: BookSalePaymentMode;
  paymentAccountId: string | null;
  receivableAccountId: string | null;
  notes: string | null;
  createdBy: string | null;
  lines: BookSaleLineInput[];
};

export type BookSaleResult = {
  saleId: string;
  saleNumber: string | null;
  totalAmount: number;
  cogsAmount: number;
  salesJournalEntryId: string | null;
  cogsJournalEntryId: string | null;
};

const round2 = (value: number) =>
  Math.round(Number(value || 0) * 100) / 100;

const round3 = (value: number) =>
  Math.round(Number(value || 0) * 1000) / 1000;

/* A stable, human readable sale number so the unique index guards retries. */
export function generateSaleNumber(date: string) {
  const stamp = String(date || "").replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();

  return `BS-${stamp}-${suffix}`;
}

export function asInvoiceCategory(
  value: string | null | undefined,
): InvoiceCategory {
  return value === "books" || value === "uniform" ? value : "other";
}

export function categoryAccounts(category: InvoiceCategory) {
  return INVENTORY_CATEGORY_ACCOUNTS[category];
}

export function lineAmount(line: BookSaleLineInput) {
  return round2(Number(line.quantity || 0) * Number(line.unitPrice || 0));
}

export function saleTotal(lines: BookSaleLineInput[]) {
  return round2(lines.reduce((sum, line) => sum + lineAmount(line), 0));
}

export function validateSaleLines(lines: BookSaleLineInput[]) {
  if (lines.length === 0) {
    throw new Error("Add at least one item to the sale.");
  }

  for (const line of lines) {
    if (!line.inventoryItemId) {
      throw new Error("Select an inventory item on every line.");
    }

    if (!(Number(line.quantity) > 0)) {
      throw new Error("Quantity must be greater than zero on every line.");
    }

    if (Number(line.unitPrice) < 0) {
      throw new Error("Selling price cannot be negative.");
    }
  }
}

/*
 * Several lines can reference the same item. Stock is moved once per item and
 * the returned weighted average cost is applied to every line of that item,
 * because the average can only change on an inbound movement.
 */
export type AggregatedItem = {
  inventoryItemId: string;
  quantity: number;
  revenue: number;
  category: InvoiceCategory;
};

export function aggregateByItem(
  lines: BookSaleLineInput[],
  categoryByItemId: Map<string, string>,
): AggregatedItem[] {
  const byItem = new Map<string, AggregatedItem>();

  for (const line of lines) {
    const quantity = Number(line.quantity || 0);
    const revenue = lineAmount(line);
    const existing = byItem.get(line.inventoryItemId);

    if (existing) {
      existing.quantity = round3(existing.quantity + quantity);
      existing.revenue = round2(existing.revenue + revenue);
      continue;
    }

    byItem.set(line.inventoryItemId, {
      inventoryItemId: line.inventoryItemId,
      quantity,
      revenue,
      category: asInvoiceCategory(
        categoryByItemId.get(line.inventoryItemId),
      ),
    });
  }

  return [...byItem.values()];
}

/*
 * Fails before anything is written when the requested quantity exceeds the
 * closing stock of an item. Negative inventory is never allowed.
 */
export async function assertStockAvailable(
  supabase: SupabaseClient,
  schoolId: string,
  requested: AggregatedItem[],
) {
  const summary = await getStockSummary(supabase, schoolId);
  const stockById = new Map(summary.map((item) => [item.id, item]));

  for (const item of requested) {
    const stock = stockById.get(item.inventoryItemId);

    if (!stock) {
      throw new InventoryError("Inventory item not found for this school.");
    }

    if (item.quantity > stock.closingQuantity + 1e-9) {
      throw new InventoryError(
        `Not enough stock for ${stock.name}. Available ${stock.closingQuantity}, requested ${item.quantity}.`,
      );
    }
  }

  return stockById;
}
/*
 * Records one student sale end to end:
 *   header -> stock issue -> lines -> revenue journal -> COGS journal
 * and returns the ids of everything it created. If any step fails the partial
 * write is undone, because the browser client cannot open a DB transaction.
 */
export async function saveStudentBookSale(
  supabase: SupabaseClient,
  input: BookSaleInput,
): Promise<BookSaleResult> {
  validateSaleLines(input.lines);

  const total = saleTotal(input.lines);

  if (!(total > 0)) {
    throw new Error("Sale total must be greater than zero.");
  }

  const setup = await ensureSchoolAccountingSetup(supabase, input.schoolId);
  const accountMap = setup.accountMap;

  const needsPaymentAccount =
    input.paymentMode === "cash" || input.paymentMode === "bank";

  let debitAccountId = "";

  if (needsPaymentAccount) {
    if (!input.paymentAccountId) {
      throw new Error(
        "Select the cash or bank account that received the money.",
      );
    }

    const { data: paymentAccount, error: paymentAccountError } = await supabase
      .from("accounts")
      .select("id, account_type, is_active")
      .eq("id", input.paymentAccountId)
      .eq("school_id", input.schoolId)
      .maybeSingle();

    if (paymentAccountError) throw paymentAccountError;

    if (
      !paymentAccount ||
      !["cash", "bank"].includes(paymentAccount.account_type) ||
      !paymentAccount.is_active
    ) {
      throw new Error(
        "Select an active cash or bank account that belongs to this school.",
      );
    }

    debitAccountId = paymentAccount.id;
  } else {
    const receivable =
      input.receivableAccountId || accountMap.OTHER_RECEIVABLES || "";

    if (!receivable) {
      throw new Error(
        "The Other Receivables account is missing. Please run accounting setup first.",
      );
    }

    // Book sale money owed by a student stays in Other Receivables so the
    // student fee receivable balance is never affected by a book sale.
    debitAccountId = receivable;
  }

  const itemIds = [
    ...new Set(input.lines.map((line) => line.inventoryItemId)),
  ];

  const { data: itemRows, error: itemError } = await supabase
    .from("inventory_items")
    .select("id, name, category")
    .eq("school_id", input.schoolId)
    .in("id", itemIds);

  if (itemError) throw itemError;

  if ((itemRows ?? []).length !== itemIds.length) {
    throw new InventoryError(
      "One or more selected inventory items are not part of this school.",
    );
  }

  const categoryByItemId = new Map(
    (itemRows ?? []).map((row) => [String(row.id), String(row.category)]),
  );

  const aggregated = aggregateByItem(input.lines, categoryByItemId);

  // Refuse to oversell before anything is written.
  await assertStockAvailable(supabase, input.schoolId, aggregated);

  const saleNumber = input.saleNumber || generateSaleNumber(input.saleDate);

  const { data: saleRow, error: saleError } = await supabase
    .from("student_book_sales")
    .insert({
      school_id: input.schoolId,
      student_id: input.studentId,
      sale_number: saleNumber,
      sale_date: input.saleDate,
      total_amount: total,
      cogs_amount: 0,
      payment_mode: input.paymentMode,
      payment_account_id: needsPaymentAccount ? input.paymentAccountId : null,
      receivable_account_id: needsPaymentAccount ? null : debitAccountId,
      notes: input.notes,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (saleError) {
    if (String(saleError.message || "").includes("duplicate key")) {
      throw new Error(
        "This sale has already been recorded. Refresh and try again.",
      );
    }

    throw saleError;
  }

  if (!saleRow?.id) {
    throw new Error("The sale could not be saved.");
  }

  const saleId = String(saleRow.id);

  try {
    // Stock leaves at the weighted average cost; the returned movement is the
    // authoritative cost of this sale.
    const applied = await applyStockMovements(
      supabase,
      input.schoolId,
      aggregated.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        movementDate: input.saleDate,
        movementType: "sale" as const,
        quantity: -item.quantity,
        refTable: "student_book_sales",
        refId: saleId,
        notes: `Sale ${saleNumber}`,
      })),
    );

    // Only the movements carrying this sale's id are ours; the opening
    // balance seed uses the item id as its reference.
    const costByItem = new Map<
      string,
      { unitCost: number; totalCost: number }
    >();

    for (const movement of applied) {
      if (movement.refId !== saleId) continue;

      const previous = costByItem.get(movement.inventoryItemId);

      costByItem.set(movement.inventoryItemId, {
        unitCost: movement.unitCost,
        totalCost: round2((previous?.totalCost || 0) + movement.totalCost),
      });
    }

    const cogsAmount = round2(
      aggregated.reduce(
        (sum, item) =>
          sum + (costByItem.get(item.inventoryItemId)?.totalCost || 0),
        0,
      ),
    );

    const { error: linesError } = await supabase
      .from("student_book_sale_items")
      .insert(
        input.lines.map((line) => ({
          school_id: input.schoolId,
          sale_id: saleId,
          inventory_item_id: line.inventoryItemId,
          quantity: Number(line.quantity),
          unit_price: Number(line.unitPrice),
          unit_cost: costByItem.get(line.inventoryItemId)?.unitCost || 0,
          line_total: lineAmount(line),
        })),
      );

    if (linesError) throw linesError;

    const salesByCategory = new Map<InvoiceCategory, number>();

    for (const item of aggregated) {
      salesByCategory.set(
        item.category,
        round2((salesByCategory.get(item.category) || 0) + item.revenue),
      );
    }

    const salesLines = [...salesByCategory]
      .filter(([, amount]) => amount > 0)
      .map(([category, amount]) => ({
        accountId: accountMap[categoryAccounts(category).sales],
        amount,
        description: `${categoryLabel(category)} sales`,
      }));

    if (salesLines.some((line) => !line.accountId)) {
      throw new Error(
        "A sales revenue account is missing. Please run accounting setup first.",
      );
    }

    const salesEntry = await postBookSaleJournal(supabase, {
      schoolId: input.schoolId,
      fiscalYearId: setup.fiscalYearId,
      entryDate: input.saleDate,
      sourceRecordId: saleId,
      debitAccountId,
      salesLines,
      totalAmount: total,
      createdBy: input.createdBy,
      saleReference: saleNumber,
    });

    const cogsByCategory = new Map<InvoiceCategory, number>();

    for (const item of aggregated) {
      const cost = costByItem.get(item.inventoryItemId)?.totalCost || 0;

      cogsByCategory.set(
        item.category,
        round2((cogsByCategory.get(item.category) || 0) + cost),
      );
    }

    const cogsLines = [...cogsByCategory]
      .filter(([, amount]) => amount > 0)
      .map(([category, amount]) => ({
        cogsAccountId: accountMap[categoryAccounts(category).cogs],
        inventoryAccountId: accountMap[categoryAccounts(category).inventory],
        amount,
        description: `Cost of ${categoryLabel(category)} sold`,
      }));

    if (
      cogsLines.some(
        (line) => !line.cogsAccountId || !line.inventoryAccountId,
      )
    ) {
      throw new Error(
        "A COGS or inventory account is missing. Please run accounting setup first.",
      );
    }

    const cogsEntry = await postCogsJournal(supabase, {
      schoolId: input.schoolId,
      fiscalYearId: setup.fiscalYearId,
      entryDate: input.saleDate,
      sourceRecordId: saleId,
      cogsLines,
      totalCost: cogsAmount,
      createdBy: input.createdBy,
      saleReference: saleNumber,
    });

    const { error: updateError } = await supabase
      .from("student_book_sales")
      .update({
        cogs_amount: cogsAmount,
        journal_entry_id: salesEntry?.journalEntryId || null,
        cogs_journal_entry_id: cogsEntry?.journalEntryId || null,
      })
      .eq("id", saleId)
      .eq("school_id", input.schoolId);

    if (updateError) throw updateError;

    return {
      saleId,
      saleNumber,
      totalAmount: total,
      cogsAmount,
      salesJournalEntryId: salesEntry?.journalEntryId || null,
      cogsJournalEntryId: cogsEntry?.journalEntryId || null,
    };
  } catch (error) {
    await supabase
      .from("inventory_stock_movements")
      .delete()
      .eq("school_id", input.schoolId)
      .eq("ref_id", saleId)
      .eq("ref_table", "student_book_sales");

    await supabase
      .from("student_book_sales")
      .delete()
      .eq("id", saleId)
      .eq("school_id", input.schoolId);

    throw error;
  }
}

function categoryLabel(category: InvoiceCategory) {
  if (category === "books") return "Book";
  if (category === "uniform") return "Uniform";

  return "Other";
}
