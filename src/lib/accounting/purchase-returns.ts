import type { SupabaseClient } from "@supabase/supabase-js";
import {
  errorText,
  missingFunction,
} from "@/lib/supabase/postgrest-errors";

export type ReturnDraftLine = {
  billItemId: string;
  qty: string;
  purchasedQty: number;
  alreadyReturnedQty: number;
  originalAmount: number;
  alreadyReturnedAmount: number;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * The purchase-return RPCs are newer than the tables they write to, so a
 * database that has the tables but not these migrations answers every call
 * with "Could not find the function public.record_purchase_return(...) in the
 * schema cache". Translate that into the files an administrator has to apply
 * instead of showing the PostgREST wording.
 */
const RETURN_MIGRATIONS =
  "supabase/migrations/20260917120000_post_purchase_returns.sql and " +
  "supabase/migrations/20260918120000_purchase_returns_history_particulars.sql";

function purchaseReturnError(error: unknown, fallback: string): Error {
  if (missingFunction(error)) {
    return new Error(
      "Purchase returns are not enabled in this database yet. Apply " +
        `${RETURN_MIGRATIONS} (together with ` +
        "supabase/migrations/20260919120000_vendor_purchase_legacy_alignment.sql) " +
        "in the Supabase SQL editor, then try again.",
    );
  }

  return new Error(errorText(error, fallback));
}

export function returnLineAmount(line: ReturnDraftLine): number {
  const qty = Number(line.qty || 0);
  if (!Number.isFinite(qty) || qty <= 0 || line.purchasedQty <= 0) return 0;
  return round2(round2(line.originalAmount * (line.alreadyReturnedQty + qty) / line.purchasedQty)
    - line.alreadyReturnedAmount);
}

export function prepareReturnLines(lines: ReturnDraftLine[]) {
  const selected: { bill_item_id: string; quantity: number }[] = [];
  const ids = new Set<string>();
  for (const line of lines) {
    const qty = Number(line.qty || 0);
    if (!Number.isFinite(qty) || qty < 0 || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-7) {
      throw new Error("Return quantities must be non-negative with at most three decimals.");
    }
    if (qty === 0) continue;
    if (!line.billItemId || ids.has(line.billItemId)) throw new Error("Duplicate or missing bill item.");
    if (qty > line.purchasedQty - line.alreadyReturnedQty + 1e-9) {
      throw new Error("Return quantity exceeds the remaining purchased quantity.");
    }
    if (returnLineAmount(line) <= 0) throw new Error("Return line amount must be greater than zero.");
    ids.add(line.billItemId);
    selected.push({ bill_item_id: line.billItemId, quantity: qty });
  }
  if (!selected.length) throw new Error("Enter a return quantity for at least one item.");
  return selected;
}

export function returnSettlementEffect(amount: number, settlement: "credit" | "refund") {
  return { reduction: amount, refund: settlement === "refund" ? amount : 0 };
}

export async function recordPurchaseReturn(supabase: SupabaseClient, input: {
  schoolId: string; billId: string; requestId: string; returnDate: string;
  returnNumber: string; reason: string; reference: string;
  settlement: "credit" | "refund"; refundAccountId: string; lines: ReturnDraftLine[];
}) {
  const lines = prepareReturnLines(input.lines);
  if (!input.returnDate) throw new Error("Select a return date.");
  if (input.settlement === "refund" && !input.refundAccountId) {
    throw new Error("Select the Cash or Bank account receiving the refund.");
  }
  const { data, error } = await supabase.rpc("record_purchase_return", {
    p_school_id: input.schoolId, p_bill_id: input.billId, p_request_id: input.requestId,
    p_return_date: input.returnDate, p_return_number: input.returnNumber.trim() || null,
    p_reason: input.reason.trim() || null, p_reference: input.reference.trim() || null,
    p_settlement: input.settlement,
    p_refund_account_id: input.settlement === "refund" ? input.refundAccountId : null,
    p_lines: lines,
  });
  if (error) throw purchaseReturnError(error, "Unable to post the purchase return.");
  if (!data?.return_id) throw new Error("Return posting did not return a confirmation. Retry the same request.");
  return data as { return_id: string; total_amount: number; idempotent: boolean };
}

/**
 * Replaces a posted purchase return.
 *
 * The database reverses the previous accounting and stock effect first and then
 * re-posts the corrected return under the same return id, all in one
 * transaction, so the bill outstanding and every accounting particular always
 * match the latest return lines.
 */
export async function updatePurchaseReturn(supabase: SupabaseClient, input: {
  schoolId: string; returnId: string; returnDate: string;
  returnNumber: string; reason: string; reference: string;
  settlement: "credit" | "refund"; refundAccountId: string; lines: ReturnDraftLine[];
}) {
  const lines = prepareReturnLines(input.lines);
  if (!input.returnId) throw new Error("Return id is required.");
  if (!input.returnDate) throw new Error("Select a return date.");
  if (input.settlement === "refund" && !input.refundAccountId) {
    throw new Error("Select the Cash or Bank account receiving the refund.");
  }
  const { data, error } = await supabase.rpc("update_purchase_return", {
    p_school_id: input.schoolId, p_return_id: input.returnId, p_return_date: input.returnDate,
    p_return_number: input.returnNumber.trim() || null,
    p_reason: input.reason.trim() || null, p_reference: input.reference.trim() || null,
    p_settlement: input.settlement,
    p_refund_account_id: input.settlement === "refund" ? input.refundAccountId : null,
    p_lines: lines,
  });
  if (error) throw purchaseReturnError(error, "Unable to update the purchase return.");
  if (!data?.return_id) throw new Error("Return update did not return a confirmation. Refresh the page.");
  return data as { return_id: string; total_amount: number; idempotent: boolean };
}

/**
 * Deletes a posted purchase return and its accounting entry (and the refund
 * entry when the return was settled as a refund), restoring the stock it took
 * out of the inventory.
 */
export async function deletePurchaseReturn(supabase: SupabaseClient, input: {
  schoolId: string; returnId: string;
}) {
  const { data, error } = await supabase.rpc("delete_purchase_return", {
    p_school_id: input.schoolId, p_return_id: input.returnId,
  });
  if (error) throw purchaseReturnError(error, "Unable to delete the purchase return.");
  if (!data?.deleted) throw new Error("Return deletion did not return a confirmation. Refresh the page.");
  return data as { return_id: string; bill_id: string; vendor_id: string; total_amount: number; deleted: boolean };
}
