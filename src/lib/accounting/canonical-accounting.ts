import type { SupabaseClient } from "@supabase/supabase-js";

export type AccountingLine = {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
};

export type JournalEntryPostInput = {
  schoolId: string;
  fiscalYearId: string;
  entryDate: string;
  description: string;
  entryType:
    | "GENERAL"
    | "OPENING"
    | "PAYMENT"
    | "RECEIPT"
    | "CONTRA"
    | "ADJUSTMENT"
    | "CLOSING";
  sourceModule: string;
  sourceTable: string;
  sourceRecordId?: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdBy?: string | null;
  lines: AccountingLine[];
};

export type DefaultAccountTemplate = {
  code: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "income" | "expense" | "cash" | "bank" | "receivable" | "payable";
};

export const DEFAULT_ACCOUNT_TEMPLATES: DefaultAccountTemplate[] = [
  { code: "CASH", name: "Cash", account_type: "cash" },
  { code: "BANK", name: "Bank", account_type: "bank" },
  { code: "STUDENT_FEE_RECEIVABLE", name: "Student Fee Receivable", account_type: "receivable" },
  { code: "OTHER_RECEIVABLES", name: "Other Receivables", account_type: "receivable" },
  { code: "FIXED_ASSETS", name: "Fixed Assets", account_type: "asset" },
  { code: "SALARY_PAYABLE", name: "Salary Payable", account_type: "payable" },
  { code: "OTHER_PAYABLES", name: "Other Payables", account_type: "payable" },
  { code: "VENDOR_PAYABLES", name: "Vendor Payables", account_type: "payable" },
  { code: "LOAN_PAYABLES", name: "Loan Payables", account_type: "payable" },
  { code: "CAPITAL", name: "Capital / Owner Equity", account_type: "equity" },
  { code: "RETAINED_EARNINGS", name: "Retained Earnings", account_type: "equity" },
  { code: "STUDENT_FEES", name: "Student Fees", account_type: "income" },
  { code: "OTHER_INCOME", name: "Other Income", account_type: "income" },
  { code: "TRANSPORT_FEES", name: "Transport Fees", account_type: "income" },
  { code: "INTEREST_INCOME", name: "Interest Income", account_type: "income" },
  { code: "SALARY_EXPENSE", name: "Salary Expense", account_type: "expense" },
  { code: "PAYROLL_EXPENSE", name: "Payroll Expense", account_type: "expense" },
  { code: "MAINTENANCE", name: "Maintenance", account_type: "expense" },
  { code: "UTILITIES", name: "Utilities", account_type: "expense" },
  { code: "TRANSPORT_FUEL", name: "Transport / Fuel", account_type: "expense" },
  { code: "BUILDING_MAINTENANCE", name: "Building Maintenance", account_type: "expense" },
  { code: "OFFICE_EXPENSE", name: "Office Expenses", account_type: "expense" },
  { code: "ACADEMIC_EXPENSE", name: "Academic Expenses", account_type: "expense" },
];

/*
 * The canonical fiscal year runs April 1 - March 31, matching the SQL
 * ensure_school_accounting_setup helper. For a date in Jan-Mar the fiscal
 * year began on April 1 of the previous calendar year; for Apr-Dec it began
 * on April 1 of the same calendar year.
 */
function fiscalYearStart(date = new Date()) {
  const y =
    date.getFullYear() - (date.getMonth() + 1 < 4 ? 1 : 0);
  return `${y}-04-01`;
}

function fiscalYearEnd(date = new Date()) {
  const y =
    date.getFullYear() + (date.getMonth() + 1 < 4 ? 0 : 1);
  return `${y}-03-31`;
}

export async function ensureSchoolAccountingSetup(
  supabase: SupabaseClient,
  schoolId: string,
  options?: { fiscalYearName?: string; startDate?: string; endDate?: string },
) {
  const fiscalYearName =
    options?.fiscalYearName ??
    `${fiscalYearStart().slice(0, 4)}-${fiscalYearEnd().slice(2, 4)}`;

  const startDate = options?.startDate ?? fiscalYearStart();
  const endDate = options?.endDate ?? fiscalYearEnd();

  let fiscalYearId: string | null = null;

  const { data: existingFiscalYear, error: fiscalYearError } = await supabase
    .from("fiscal_years")
    .select("id, name")
    .eq("school_id", schoolId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fiscalYearError) {
    throw new Error(fiscalYearError.message);
  }

  if (existingFiscalYear?.id) {
    fiscalYearId = existingFiscalYear.id;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("fiscal_years")
      .insert({
        school_id: schoolId,
        name: fiscalYearName,
        start_date: startDate,
        end_date: endDate,
        is_closed: false,
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    fiscalYearId = inserted.id;
  }

  const accountCodes = DEFAULT_ACCOUNT_TEMPLATES.map((template) => template.code);

  // Load all accounts for this school so we can reuse an existing account
  // when its name already exists under a different code. The accounts table
  // has a unique constraint on (school_id, name), so checking only by code
  // can otherwise cause a duplicate-name error.
  const { data: existingAccounts, error: existingAccountsError } = await supabase
    .from("accounts")
    .select("id, code, name, account_type, is_active")
    .eq("school_id", schoolId);

  if (existingAccountsError) {
    throw new Error(existingAccountsError.message);
  }

  const existingByCode = new Map(
    (existingAccounts ?? []).map((account) => [account.code, account]),
  );

  const existingByName = new Map(
    (existingAccounts ?? []).map((account) => [
      String(account.name || "").trim().toLowerCase(),
      account,
    ]),
  );

  const accountMap: Record<string, string> = {};
  const missingTemplates: DefaultAccountTemplate[] = [];

  for (const template of DEFAULT_ACCOUNT_TEMPLATES) {
    const byCode = existingByCode.get(template.code);

    if (byCode?.id) {
      accountMap[template.code] = byCode.id;
      continue;
    }

    const byName = existingByName.get(template.name.trim().toLowerCase());

    if (byName?.id) {
      // Reuse the existing named account instead of attempting an insert
      // that would violate accounts_school_id_name_key.
      accountMap[template.code] = byName.id;
      continue;
    }

    missingTemplates.push(template);
  }

  if (missingTemplates.length > 0) {
    const { data: insertedAccounts, error: insertAccountsError } = await supabase
      .from("accounts")
      .insert(
        missingTemplates.map((template) => ({
          school_id: schoolId,
          code: template.code,
          name: template.name,
          account_type: template.account_type,
          is_system: true,
          is_active: true,
        })),
      )
      .select("id, code, name, account_type");

    if (insertAccountsError) {
      throw new Error(insertAccountsError.message);
    }

    for (const account of insertedAccounts ?? []) {
      accountMap[account.code] = account.id;
    }
  }

  return {
    schoolId,
    fiscalYearId: fiscalYearId!,
    accountMap,
  };
}

export async function getExistingJournalForSource(
  supabase: SupabaseClient,
  schoolId: string,
  sourceModule: string,
  sourceTable: string,
  sourceRecordId: string,
) {
  if (!sourceRecordId) return null;

  const { data, error } = await supabase
    .from("accounting_events")
    .select("id, journal_entry_id")
    .eq("school_id", schoolId)
    .eq("source_module", sourceModule)
    .eq("source_table", sourceTable)
    .eq("source_record_id", sourceRecordId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.journal_entry_id) {
    return null;
  }

  const { data: journalEntry, error: journalEntryError } = await supabase
    .from("journal_entries")
    .select("id, entry_number, entry_date, description")
    .eq("id", data.journal_entry_id)
    .maybeSingle();

  if (journalEntryError) {
    throw journalEntryError;
  }

  return {
    id: data.id,
    journalEntryId: data.journal_entry_id,
    journalEntry,
    idempotent: true,
  };
}

export async function postCanonicalJournalEntry(
  supabase: SupabaseClient,
  input: JournalEntryPostInput,
) {
  if (!input.lines.length) {
    throw new Error("Journal entry requires at least one line.");
  }

  const totalDebit = input.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = input.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);

  if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    throw new Error(
      `Journal entry is not balanced. Debit total: ${totalDebit.toFixed(2)}, Credit total: ${totalCredit.toFixed(2)}.`,
    );
  }

  if (input.sourceRecordId) {
    const existing = await getExistingJournalForSource(
      supabase,
      input.schoolId,
      input.sourceModule,
      input.sourceTable,
      input.sourceRecordId,
    );

    if (existing) {
      return {
        idempotent: true,
        journalEntryId: existing.journalEntryId,
        journalEntry: existing.journalEntry,
      };
    }
  }

  const { data, error } = await supabase.rpc("create_journal_entry", {
    p_school_id: input.schoolId,
    p_fiscal_year_id: input.fiscalYearId,
    p_entry_date: input.entryDate,
    p_description: input.description,
    p_entry_type: input.entryType,
    p_source_module: input.sourceModule,
    p_source_table: input.sourceTable,
    p_source_record_id: input.sourceRecordId ?? null,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
    p_created_by: input.createdBy ?? null,
    p_lines: input.lines.map((line) => ({
      accountId: line.accountId,
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      description: line.description ?? "",
    })),
  });

  if (error) {
    throw error;
  }

  return {
    idempotent: Boolean(data?.idempotent),
    journalEntryId: data?.journal_entry_id,
    journalEntry: data,
  };
}

export async function postFeeCollectionJournal(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    fiscalYearId: string;
    entryDate: string;
    sourceRecordId: string;
    paymentAccountId: string;
    feeReceivableAccountId: string;
    amount: number;
    createdBy?: string | null;
  },
) {
  return postCanonicalJournalEntry(supabase, {
    schoolId: input.schoolId,
    fiscalYearId: input.fiscalYearId,
    entryDate: input.entryDate,
    description: "Student fee collection",
    entryType: "RECEIPT",
    sourceModule: "fees",
    sourceTable: "fee_payments",
    sourceRecordId: input.sourceRecordId,
    referenceType: "fee_payment",
    referenceId: input.sourceRecordId,
    createdBy: input.createdBy ?? null,
    lines: [
      {
        accountId: input.paymentAccountId,
        debit: Number(input.amount || 0),
        credit: 0,
        description: "Fee payment received",
      },
      {
        accountId: input.feeReceivableAccountId,
        debit: 0,
        credit: Number(input.amount || 0),
        description: "Fee receivable cleared",
      },
    ],
  });
}

export async function postPayrollAccrualJournal(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    fiscalYearId: string;
    entryDate: string;
    sourceRecordId: string;
    salaryExpenseAccountId: string;
    salaryPayableAccountId: string;
    amount: number;
    createdBy?: string | null;
  },
) {
  return postCanonicalJournalEntry(supabase, {
    schoolId: input.schoolId,
    fiscalYearId: input.fiscalYearId,
    entryDate: input.entryDate,
    description: "Payroll accrual",
    entryType: "GENERAL",
    sourceModule: "payroll",
    sourceTable: "payroll_runs",
    sourceRecordId: input.sourceRecordId,
    referenceType: "payroll",
    referenceId: input.sourceRecordId,
    createdBy: input.createdBy ?? null,
    lines: [
      {
        accountId: input.salaryExpenseAccountId,
        debit: Number(input.amount || 0),
        credit: 0,
        description: "Payroll expense",
      },
      {
        accountId: input.salaryPayableAccountId,
        debit: 0,
        credit: Number(input.amount || 0),
        description: "Salary payable accrual",
      },
    ],
  });
}

export async function postSalaryPaymentJournal(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    fiscalYearId: string;
    entryDate: string;
    sourceRecordId: string;
    salaryPayableAccountId: string;
    paymentAccountId: string;
    amount: number;
    createdBy?: string | null;
  },
) {
  return postCanonicalJournalEntry(supabase, {
    schoolId: input.schoolId,
    fiscalYearId: input.fiscalYearId,
    entryDate: input.entryDate,
    description: "Salary payment",
    entryType: "PAYMENT",
    sourceModule: "salary_payment",
    sourceTable: "salary_payments",
    sourceRecordId: input.sourceRecordId,
    referenceType: "salary_payment",
    referenceId: input.sourceRecordId,
    createdBy: input.createdBy ?? null,
    lines: [
      {
        accountId: input.salaryPayableAccountId,
        debit: Number(input.amount || 0),
        credit: 0,
        description: "Salary payable cleared",
      },
      {
        accountId: input.paymentAccountId,
        debit: 0,
        credit: Number(input.amount || 0),
        description: "Cash / bank disbursement",
      },
    ],
  });
}

export async function postExpenseJournal(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    fiscalYearId: string;
    entryDate: string;
    sourceRecordId: string;
    expenseAccountId: string;
    paymentAccountId: string;
    amount: number;
    createdBy?: string | null;
  },
) {
  return postCanonicalJournalEntry(supabase, {
    schoolId: input.schoolId,
    fiscalYearId: input.fiscalYearId,
    entryDate: input.entryDate,
    description: "Expense booking",
    entryType: "GENERAL",
    sourceModule: "expenses",
    sourceTable: "expenses",
    sourceRecordId: input.sourceRecordId,
    referenceType: "expense",
    referenceId: input.sourceRecordId,
    createdBy: input.createdBy ?? null,
    lines: [
      {
        accountId: input.expenseAccountId,
        debit: Number(input.amount || 0),
        credit: 0,
        description: "Expense recognized",
      },
      {
        accountId: input.paymentAccountId,
        debit: 0,
        credit: Number(input.amount || 0),
        description: "Expense settled from cash or bank",
      },
    ],
  });
}

export async function postContraJournal(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    fiscalYearId: string;
    entryDate: string;
    sourceRecordId: string;
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    createdBy?: string | null;
  },
) {
  return postCanonicalJournalEntry(supabase, {
    schoolId: input.schoolId,
    fiscalYearId: input.fiscalYearId,
    entryDate: input.entryDate,
    description: "Contra transfer",
    entryType: "CONTRA",
    sourceModule: "contra",
    sourceTable: "contra_entries",
    sourceRecordId: input.sourceRecordId,
    referenceType: "contra",
    referenceId: input.sourceRecordId,
    createdBy: input.createdBy ?? null,
    lines: [
      {
        accountId: input.toAccountId,
        debit: Number(input.amount || 0),
        credit: 0,
        description: "Funds moved out",
      },
      {
        accountId: input.fromAccountId,
        debit: 0,
        credit: Number(input.amount || 0),
        description: "Funds moved in",
      },
    ],
  });
}

export async function postOpeningBalanceJournal(
  supabase: SupabaseClient,
  input: {
    schoolId: string;
    fiscalYearId: string;
    entryDate: string;
    sourceRecordId: string;
    accountId: string;
    balance: number;
    openingEquityAccountId: string;
    createdBy?: string | null;
  },
) {
  const amount = Number(input.balance || 0);
  if (!amount) {
    return null;
  }

  const debit = amount > 0 ? amount : 0;
  const credit = amount < 0 ? Math.abs(amount) : 0;

  return postCanonicalJournalEntry(supabase, {
    schoolId: input.schoolId,
    fiscalYearId: input.fiscalYearId,
    entryDate: input.entryDate,
    description: "Opening balance",
    entryType: "OPENING",
    sourceModule: "opening_balance",
    sourceTable: "opening_balances",
    sourceRecordId: input.sourceRecordId,
    referenceType: "opening_balance",
    referenceId: input.sourceRecordId,
    createdBy: input.createdBy ?? null,
    lines: [
      {
        accountId: input.accountId,
        debit,
        credit: 0,
        description: "Opening balance",
      },
      {
        accountId: input.openingEquityAccountId,
        debit: 0,
        credit,
        description: "Opening balance equity entry",
      },
    ],
  });
}

export function buildLegacyCompatibilitySummary() {
  return {
    status: "compatibility-only",
    legacyTables: ["transactions", "transaction_entries"],
    canonicalTables: ["journal_entries", "journal_lines", "accounts", "opening_balances", "accounting_events"],
    rule: "Reports must read canonical accounting data only; legacy tables are retained for historical compatibility and reconciliation only.",
  };
}
