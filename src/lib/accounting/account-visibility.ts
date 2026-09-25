import { DEFAULT_ACCOUNT_TEMPLATES } from "./canonical-accounting";

/*
 * =====================================================
 * ACCOUNT VISIBILITY (selector rules)
 * =====================================================
 *
 * The accounting database seeds a complete chart of accounts for every school
 * (DEFAULT_ACCOUNT_TEMPLATES below / public.ensure_school_accounting_setup).
 * Those seeded rows must stay in the database so that historical journal
 * lines, ledgers, reconciliations and reports keep working, but a school
 * should only be offered the accounts it actually uses:
 *
 *   1. Accounts created by the school from
 *      Dashboard -> Accounting -> Accounts  (is_system = false), and
 *   2. The common accounts every school needs:
 *      Cash, Bank, Student Fees (fee income), Student Fee Receivable and
 *      Salary Payable.
 *
 * This module is a DISPLAY filter only. It never deletes, deactivates or
 * mutates accounts - hidden accounts keep their balances, history and
 * audit trail, and they still appear in Trial Balance / P&L / Balance Sheet
 * when they carry activity.
 *
 * Reports that must show every account with activity (Trial Balance,
 * Profit & Loss, Balance Sheet, Cash Book, Bank Book, reconciliation) do not
 * use this filter.
 */

export type AccountLike = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  account_type?: string | null;
  is_system?: boolean | null;
  is_active?: boolean | null;
};

/*
 * The default accounts every school needs. They are seeded with
 * is_system = true but are part of normal school accounting, so they stay
 * selectable everywhere.
 */
export const COMMON_ACCOUNT_CODES = [
  "CASH",
  "BANK",
  "STUDENT_FEES",
  "STUDENT_FEE_RECEIVABLE",
  "SALARY_PAYABLE",
] as const;

const COMMON_ACCOUNT_CODE_SET = new Set<string>(COMMON_ACCOUNT_CODES);

const SEEDED_ACCOUNT_CODE_SET = new Set<string>(
  DEFAULT_ACCOUNT_TEMPLATES.map((template) => template.code.trim().toUpperCase()),
);

const SEEDED_ACCOUNT_NAME_SET = new Set<string>(
  DEFAULT_ACCOUNT_TEMPLATES.map((template) => template.name.trim().toLowerCase()),
);

export function normaliseAccountCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function isCommonAccountCode(value: unknown) {
  return COMMON_ACCOUNT_CODE_SET.has(normaliseAccountCode(value));
}

/*
 * A seeded default account that still carries its original name (for example
 * "Utilities" or "Fixed Assets"). Renamed seeded accounts are treated as
 * school-managed accounts so a rename never hides an account the school uses.
 */
export function isSeededDefaultAccount(account: AccountLike | null | undefined) {
  if (!account) return false;

  const code = normaliseAccountCode(account.code);

  if (!SEEDED_ACCOUNT_CODE_SET.has(code)) return false;

  const name = String(account.name ?? "").trim().toLowerCase();

  if (name && !SEEDED_ACCOUNT_NAME_SET.has(name)) return false;

  return true;
}

/*
 * Should this account appear inside an accounting selector (dropdown) or an
 * account list on a transaction screen?
 */
export function isSelectableAccount(account: AccountLike | null | undefined) {
  if (!account) return false;

  // Inactive accounts are never selectable.
  if (account.is_active === false) return false;

  // Cash / Bank / Student Fees / Student Fee Receivable / Salary Payable.
  if (isCommonAccountCode(account.code)) return true;

  // Anything the school created from Dashboard -> Accounting -> Accounts.
  if (account.is_system === false) return true;

  // Untouched seeded default accounts stay out of the selectors.
  return !isSeededDefaultAccount(account);
}

export function filterSelectableAccounts<T extends AccountLike>(
  accounts: T[] | null | undefined,
): T[] {
  return (accounts ?? []).filter((account) => isSelectableAccount(account));
}

export function normaliseAccountType(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

/*
 * Filter by selector context. Keep the account types explicit so the UI never
 * has to decide what "cash" or "expense" means on its own:
 *
 *   Cash payment      -> ["cash"]
 *   Bank payment      -> ["bank"]
 *   Expense selection -> ["expense"]
 *   Payable selection -> ["payable", "liability"]
 *   Income selection  -> ["income"]
 */
export function filterSelectableAccountsByTypes<T extends AccountLike>(
  accounts: T[] | null | undefined,
  types: readonly string[],
): T[] {
  const allowed = new Set(types.map((type) => normaliseAccountType(type)));

  return filterSelectableAccounts(accounts).filter((account) =>
    allowed.has(normaliseAccountType(account.account_type)),
  );
}

export const CASH_ACCOUNT_TYPES = ["cash"] as const;
export const BANK_ACCOUNT_TYPES = ["bank"] as const;
export const CASH_BANK_ACCOUNT_TYPES = ["cash", "bank"] as const;
export const EXPENSE_ACCOUNT_TYPES = ["expense"] as const;
export const INCOME_ACCOUNT_TYPES = ["income"] as const;
export const PAYABLE_ACCOUNT_TYPES = ["payable", "liability"] as const;
export const RECEIVABLE_ACCOUNT_TYPES = ["receivable"] as const;
