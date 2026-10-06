import type { SupabaseClient } from "@supabase/supabase-js";

export type InventoryFeeBillLine = {
  id: string;
  school_id: string;
  bill_id: string;
  description: string;
  amount: number;
  discount: number;
  net_amount: number;
};

export async function attachInventorySaleToFeeBill(
  supabase: SupabaseClient,
  schoolId: string,
  saleId: string,
  billId: string,
) {
  const { data: existingLines, error: existingError } = await supabase
    .from("fee_bill_items")
    .select("id,description")
    .eq("school_id", schoolId)
    .eq("bill_id", billId)
    .eq("inventory_sale_id", saleId);
  if (existingError) throw existingError;
  if (existingLines?.length) {
    return {
      descriptions: existingLines.map((line) => line.description as string),
      lines: [] as InventoryFeeBillLine[],
      total: 0,
    };
  }

  const { data: sale, error: saleError } = await supabase
    .from("student_book_sales")
    .select("student_id")
    .eq("school_id", schoolId)
    .eq("id", saleId)
    .single();
  if (saleError) throw saleError;

  const { data: saleLines, error: saleLinesError } = await supabase
    .from("student_book_sale_items")
    .select("inventory_item_id,quantity,unit_price,line_total")
    .eq("school_id", schoolId)
    .eq("sale_id", saleId);
  if (saleLinesError) throw saleLinesError;
  if (!saleLines?.length) {
    throw new Error("The inventory sale has no item details to attach to this bill.");
  }

  const itemIds = [...new Set(saleLines.map((line) => line.inventory_item_id))];
  const { data: inventoryRows, error: inventoryError } = await supabase
    .from("inventory_items")
    .select("id,name,size,unit")
    .eq("school_id", schoolId)
    .in("id", itemIds);
  if (inventoryError) throw inventoryError;

  const inventoryById = new Map((inventoryRows || []).map((item) => [item.id, item]));
  const descriptions = saleLines.map((line) => {
    const item = inventoryById.get(line.inventory_item_id);
    const name = item?.name || "Inventory item";
    return `${name}${item?.size ? ` (${item.size})` : ""} × ${line.quantity} ${item?.unit || "pcs"}`;
  });
  const amounts = saleLines.map((line) =>
    Math.round(Number(line.line_total || Number(line.quantity) * Number(line.unit_price)) * 100) / 100,
  );
  const total = amounts.reduce((sum, amount) => sum + amount, 0);

  const { data: bill, error: billError } = await supabase
    .from("fee_bills")
    .select("student_id,subtotal,total_amount,balance_amount,paid_amount")
    .eq("id", billId)
    .eq("school_id", schoolId)
    .single();
  if (billError) throw billError;
  if (!sale.student_id || sale.student_id !== bill.student_id) {
    throw new Error("The inventory sale and fee bill must belong to the same student.");
  }

  const { data: insertedLines, error: insertError } = await supabase
    .from("fee_bill_items")
    .insert(
      saleLines.map((line, index) => ({
        school_id: schoolId,
        bill_id: billId,
        description: descriptions[index],
        amount: amounts[index],
        discount: 0,
        net_amount: amounts[index],
        inventory_sale_id: saleId,
      })),
    )
    .select("id,school_id,bill_id,description,amount,discount,net_amount");
  if (insertError) throw insertError;

  const { error: updateError } = await supabase
    .from("fee_bills")
    .update({
      subtotal: Number(bill.subtotal || 0) + total,
      total_amount: Number(bill.total_amount || 0) + total,
      balance_amount: Number(bill.balance_amount || 0) + total,
      status: Number(bill.paid_amount || 0) > 0 ? "partial" : "unpaid",
      updated_at: new Date().toISOString(),
    })
    .eq("id", billId)
    .eq("school_id", schoolId);
  if (updateError) throw updateError;

  return {
    descriptions,
    lines: (insertedLines || []) as InventoryFeeBillLine[],
    total,
  };
}
