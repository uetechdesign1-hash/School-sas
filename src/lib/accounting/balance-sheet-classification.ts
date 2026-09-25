/*
 * =====================================================
 * BALANCE SHEET ACCOUNT CLASSIFICATION
 * =====================================================
 *
 * Single source of truth for which side of the accounting equation
 *
 *     Assets = Liabilities + Equity
 *
 * an account belongs to. It is deliberately TYPE based (never name based),
 * so every account created by a school lands in the right section without
 * the report having to special case individual accounts such as
 * "Vendor Payables".
 *
 * The chart of accounts (see the accounts page / DB check constraint) uses:
 *
 *     cash, bank, receivable, asset   -> debit normal  -> ASSET
 *     payable, liability              -> credit normal -> LIABILITY
 *     equity                          -> credit normal -> EQUITY
 *     income, expense                 -> P&L only, never Balance Sheet
 *
 * IMPORTANT: a "payable" account is a LIABILITY. Reports that only accept
 * the literal type "liability" silently drop every payable account and the
 * Balance Sheet then fails to balance.
 */

export type BalanceSheetSection =
  | "asset"
  | "liability"
  | "equity"
  | "profit-loss";

/*
 * Debit-normal accounts: they carry a positive (debit) balance and are
 * reported under Assets.
 */
export const ASSET_ACCOUNT_TYPES = [
  "asset",
  "cash",
  "bank",
  "receivable",
] as const;

/*
 * Credit-normal accounts reported under Liabilities.
 *
 * "payable" MUST stay here - Vendor Payables, Salary Payables,
 * Other Payables and Loan Payables are all seeded with this type.
 */
export const LIABILITY_ACCOUNT_TYPES = [
  "liability",
  "payable",
] as const;

/*
 * Credit-normal accounts reported under Equity.
 */
export const EQUITY_ACCOUNT_TYPES = ["equity"] as const;

/*
 * Income / expense accounts belong to the Profit & Loss statement only.
 * They are folded into "Current Period Profit" on the Balance Sheet.
 */
export const PROFIT_LOSS_ACCOUNT_TYPES = [
  "income",
  "expense",
] as const;

export function normaliseAccountType(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function includesType(types: readonly string[], type: string) {
  return types.includes(type);
}

/*
 * Maps an account_type (in any casing) to its Balance Sheet section.
 *
 * Returns "profit-loss" for P&L accounts and null for empty/unknown types
 * so callers can skip them instead of mis-filing them.
 */
export function getBalanceSheetSection(
  accountType: unknown
): BalanceSheetSection | null {
  const type = normaliseAccountType(accountType);

  if (!type) return null;

  if (includesType(ASSET_ACCOUNT_TYPES, type)) return "asset";

  if (includesType(LIABILITY_ACCOUNT_TYPES, type)) return "liability";

  if (includesType(EQUITY_ACCOUNT_TYPES, type)) return "equity";

  if (includesType(PROFIT_LOSS_ACCOUNT_TYPES, type)) {
    return "profit-loss";
  }

  /*
   * Generic safety net for future / custom categories such as
   * "tax_payable", "current_liability" or "trade_payable": anything
   * explicitly named as a payable or a liability is a liability.
   *
   * No Profit & Loss type contains these words, so this can never pull an
   * income or expense account onto the Balance Sheet.
   */
  if (
    type.includes("payable") ||
    type.includes("liability") ||
    type.includes("liabilit")
  ) {
    return "liability";
  }

  return null;
}

/*
 * Does this account belong on the Balance Sheet at all?
 * (i.e. it is not a pure income/expense account)
 */
export function isBalanceSheetAccount(accountType: unknown) {
  const section = getBalanceSheetSection(accountType);

  return (
    section === "asset" ||
    section === "liability" ||
    section === "equity"
  );
}

/*
 * Which side does a positive opening balance sit on?
 *
 *   asset / liability / equity -> as declared by the section
 *   income / expense           -> debit fallback (openings are ignored
 *                                 by the Balance Sheet anyway)
 */
export function openingBalanceSide(
  accountType: unknown
): "debit" | "credit" {
  const section = getBalanceSheetSection(accountType);

  if (section === "asset") return "debit";

  if (
    section === "liability" ||
    section === "equity"
  ) {
    return "credit";
  }

  return "debit";
}
