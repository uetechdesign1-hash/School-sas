"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Eye,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ensureBuiltInExpenseCategories } from "@/lib/accounting/expense-categories";
import {
  CASH_BANK_ACCOUNT_TYPES,
  EXPENSE_ACCOUNT_TYPES,
  filterSelectableAccountsByTypes,
} from "@/lib/accounting/account-visibility";
import {
  deleteCanonicalJournalForSource,
  ensureSchoolAccountingSetup,
  postExpenseJournal,
  postSalaryPaymentJournal,
} from "@/lib/accounting/canonical-accounting";

type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type:
    | "cash"
    | "bank"
    | "income"
    | "expense"
    | "asset"
    | "liability"
    | "equity"
    | "receivable"
    | "payable";
  opening_balance: number;
  is_system: boolean;
  is_active: boolean;
};

type PayrollStaffItem = {
  employee_id: string;
  employee_no: string;
  name: string;
  designation: string;
  net_pay: number;
};

type PaymentMethod =
  | "cash"
  | "bank_transfer"
  | "upi"
  | "card"
  | "cheque"
  | "online"
  | "other";

type TransactionEntry = {
  id: string;
  transaction_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
  account_name: string;
  account_code: string | null;
};

type PaymentRow = {
  id: string;
  transaction_number: string | null;
  transaction_date: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  entries: TransactionEntry[];
};

type PaymentType = "expense" | "vendor" | "salary";

type VendorOption = {
  id: string;
  name: string;
  is_active: boolean | null;
};

type PurchaseBillOption = {
  id: string;
  vendor_id: string;
  bill_number: string | null;
  bill_date: string;
  total_amount: number;
};

type VendorPaymentRow = {
  id: string;
  payment_date: string;
  amount: number;
  vendor_id: string;
  paid_from_account_id: string | null;
  reference_number: string | null;
  notes: string | null;
  payment_method: string | null;
  journal_entry_id: string | null;
};


const PAYMENT_METHODS: {
  value: PaymentMethod;
  label: string;
}[] = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "online", label: "Online" },
  { value: "other", label: "Other" },
];

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function roundToTwo(value: number) {
  return Math.round(
    (Number(value || 0) + Number.EPSILON) * 100,
  ) / 100;
}


function getParticulars(description: string | null) {
  if (!description) return "";

  const parts = description.split(" | ");

  return parts[0] || "";
}

function getReference(description: string | null) {
  if (!description) return "";

  const part = description
    .split(" | ")
    .find((item) => item.startsWith("Reference:"));

  return part
    ? part.replace("Reference:", "").trim()
    : "";
}

function getNotes(description: string | null) {
  if (!description) return "";

  const part = description
    .split(" | ")
    .find((item) => item.startsWith("Notes:"));

  return part
    ? part.replace("Notes:", "").trim()
    : "";
}

function getPaymentMethod(
  description: string | null,
  paidFrom: Account | undefined
): PaymentMethod {
  if (description) {
    const methodPart = description
      .split(" | ")
      .find((item) => item.startsWith("Payment method:"));

    if (methodPart) {
      const value = methodPart
        .replace("Payment method:", "")
        .trim() as PaymentMethod;

      if (
        PAYMENT_METHODS.some(
          (method) => method.value === value
        )
      ) {
        return value;
      }
    }
  }

  if (paidFrom?.account_type === "cash") {
    return "cash";
  }

  return "bank_transfer";
}

export default function PaymentPage() {
  const [supabase] = useState(() => createClient());

  const [schoolId, setSchoolId] =
    useState<string | null>(null);

  const [accounts, setAccounts] =
    useState<Account[]>([]);

  const [payments, setPayments] =
    useState<PaymentRow[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  // CREATE / EDIT FORM
  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [paymentDate, setPaymentDate] =
    useState(getToday());

  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("cash");

  const [paidFromAccountId, setPaidFromAccountId] =
    useState("");

  const [expenseAccountId, setExpenseAccountId] =
    useState("");

  const [amount, setAmount] =
    useState("");

  const [particulars, setParticulars] =
    useState("");

  const [referenceNumber, setReferenceNumber] =
    useState("");

  const [notes, setNotes] =
    useState("");

  // PAYROLL PAYMENT CONTEXT
  const [payrollMode, setPayrollMode] =
    useState(false);

  const [payrollMonth, setPayrollMonth] =
    useState("");

  const [payrollTotalAmount, setPayrollTotalAmount] =
    useState("");

  const [payrollStaffItems, setPayrollStaffItems] =
    useState<PayrollStaffItem[]>([]);

  const [selectedPayrollStaffId, setSelectedPayrollStaffId] =
    useState("");

  const [payrollRunId, setPayrollRunId] =
    useState("");
  const [payrollPayableAccountId, setPayrollPayableAccountId] =
    useState("");
  const [payrollAccountingTransactionNumber, setPayrollAccountingTransactionNumber] =
    useState("");

  // PAYMENT TYPE + VENDOR PAYMENT CONTEXT
  const [paymentType, setPaymentType] =
    useState<PaymentType>("expense");

  const [vendors, setVendors] =
    useState<VendorOption[]>([]);

  const [vendorBills, setVendorBills] =
    useState<PurchaseBillOption[]>([]);

  const [vendorAllocations, setVendorAllocations] =
    useState<{ bill_id: string; amount: number }[]>(
      []
    );

  const [vendorReturns, setVendorReturns] =
    useState<{ bill_id: string; total_amount: number }[]>(
      []
    );

  const [vendorPayments, setVendorPayments] =
    useState<VendorPaymentRow[]>([]);

  const [vendorPaymentSaving, setVendorPaymentSaving] =
    useState(false);

  const [vendorPaymentDeletingId, setVendorPaymentDeletingId] =
    useState<string | null>(null);

  const [vendorPaymentId, setVendorPaymentId] =
    useState("");

  const [vendorBillId, setVendorBillId] =
    useState("");

  const [vendorAmount, setVendorAmount] =
    useState("");

  const [vendorRequestId, setVendorRequestId] =
    useState("");


  // VIEW MODAL
  const [viewPayment, setViewPayment] =
    useState<PaymentRow | null>(null);

  // DELETE CONFIRMATION
  const [deletePayment, setDeletePayment] =
    useState<PaymentRow | null>(null);

  /*
   * =====================================================
   * GET CURRENT SCHOOL
   * =====================================================
   */

  async function getCurrentSchoolId() {
    const {
      data: userData,
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw new Error(
        `Authentication error: ${userError.message}`
      );
    }

    if (!userData.user) {
      throw new Error(
        "No authenticated user found. Please log in again."
      );
    }

    const {
      data: rpcSchoolId,
      error: rpcError,
    } = await supabase.rpc("get_my_school_id");

    if (!rpcError && rpcSchoolId) {
      return rpcSchoolId as string;
    }

    const {
      data: schoolUser,
      error: schoolUserError,
    } = await supabase
      .from("school_users")
      .select(
        "school_id, is_active, created_at"
      )
      .eq(
        "user_id",
        userData.user.id
      )
      .eq(
        "is_active",
        true
      )
      .order(
        "created_at",
        {
          ascending: true,
        }
      )
      .limit(1)
      .maybeSingle();

    if (schoolUserError) {
      throw new Error(
        `Unable to determine school: ${schoolUserError.message}`
      );
    }

    if (!schoolUser?.school_id) {
      throw new Error(
        "Your user is not linked to an active school."
      );
    }

    return schoolUser.school_id as string;
  }

  /*
   * =====================================================
   * LOAD ACCOUNTS
   * =====================================================
   */

  async function loadAccounts(
    currentSchoolId: string
  ) {
    const {
      data,
      error: accountsError,
    } = await supabase
      .from("accounts")
      .select(
        `
          id,
          school_id,
          code,
          name,
          account_type,
          opening_balance,
          is_system,
          is_active
        `
      )
      .eq(
        "school_id",
        currentSchoolId
      )
      .eq(
        "is_active",
        true
      )
      .order("account_type")
      .order("name");

    if (accountsError) {
      throw new Error(
        accountsError.message
      );
    }

    setAccounts(
      (data || []) as Account[]
    );
  }

  /*
   * =====================================================
   * LOAD PAYMENT HISTORY
   * =====================================================
   */

  async function loadPayments(
    currentSchoolId: string
  ) {
    /*
     * Payment history is read from the CANONICAL journal (entries tagged
     * reference_type = "payment") plus any historical legacy transaction that
     * has no canonical counterpart yet. That keeps the history complete
     * without ever listing the same payment twice.
     */
    const {
      data: journalEntries,
      error: journalError,
    } = await supabase
      .from("journal_entries")
      .select(
        `
          id,
          entry_number,
          entry_date,
          description,
          reference_type,
          reference_id,
          source_record_id,
          created_at
        `
      )
      .eq(
        "school_id",
        currentSchoolId
      )
      .eq(
        "reference_type",
        "payment"
      )
      .order(
        "entry_date",
        {
          ascending: false,
        }
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(100);

    if (journalError) {
      throw new Error(journalError.message);
    }

    const canonicalEntries = journalEntries || [];

    const canonicalEntryIds = canonicalEntries.map(
      (entry) => String(entry.id)
    );

    // A canonical entry may point at a legacy transaction (older payments)
    // through reference_id - those legacy rows must not be listed again.
    const canonicalReferenceIds = new Set(
      canonicalEntries
        .map((entry) => String(entry.reference_id || ""))
        .filter(Boolean)
    );

    const {
      data: canonicalLines,
      error: canonicalLinesError,
    } = canonicalEntryIds.length > 0
      ? await supabase
          .from("journal_lines")
          .select(
            "id, journal_entry_id, account_id, debit, credit, description"
          )
          .eq("school_id", currentSchoolId)
          .in("journal_entry_id", canonicalEntryIds)
      : { data: [] as {
          id: string;
          journal_entry_id: string;
          account_id: string;
          debit: number | null;
          credit: number | null;
          description: string | null;
        }[], error: null };

    if (canonicalLinesError) {
      throw new Error(canonicalLinesError.message);
    }

    const canonicalLineRows = canonicalLines || [];

    const {
      data: transactions,
      error: transactionError,
    } = await supabase
      .from("transactions")
      .select(
        `
          id,
          transaction_number,
          transaction_date,
          description,
          reference_type,
          reference_id,
          created_at
        `
      )
      .eq(
        "school_id",
        currentSchoolId
      )
      .eq(
        "transaction_type",
        "expense"
      )
      .eq(
        "reference_type",
        "payment"
      )
      .order(
        "transaction_date",
        {
          ascending: false,
        }
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(100);

    if (transactionError) {
      throw new Error(
        transactionError.message
      );
    }

    const transactionRows =
      transactions || [];

    /*
     * Legacy rows already represented by a canonical journal entry (older
     * payments stored both) are skipped so each payment is listed once.
     */
    const legacyRowsSource =
      transactionRows.filter(
        (transaction) =>
          !canonicalReferenceIds.has(
            String(transaction.id)
          )
      );

    if (
      legacyRowsSource.length === 0 &&
      canonicalEntries.length === 0
    ) {
      setPayments([]);
      return;
    }

    const transactionIds =
      transactionRows.map(
        (row) => row.id
      );

    const {
      data: entries,
      error: entriesError,
    } = await supabase
      .from("transaction_entries")
      .select(
        `
          id,
          transaction_id,
          account_id,
          debit,
          credit,
          description
        `
      )
      .eq(
        "school_id",
        currentSchoolId
      )
      .in(
        "transaction_id",
        transactionIds
      );

    if (entriesError) {
      throw new Error(
        entriesError.message
      );
    }

    const entryRows =
      entries || [];

    const accountIds =
      Array.from(
        new Set(
          [
            ...entryRows.map(
              (entry) =>
                entry.account_id
            ),
            ...canonicalLineRows.map(
              (line) =>
                line.account_id
            ),
          ].filter(Boolean)
        )
      );

    let accountMap =
      new Map<string, Account>();

    if (
      accountIds.length > 0
    ) {
      const {
        data: entryAccounts,
        error: accountError,
      } = await supabase
        .from("accounts")
        .select(
          `
            id,
            school_id,
            code,
            name,
            account_type,
            opening_balance,
            is_system,
            is_active
          `
        )
        .eq(
          "school_id",
          currentSchoolId
        )
        .in(
          "id",
          accountIds
        );

      if (accountError) {
        throw new Error(
          accountError.message
        );
      }

      for (
        const account of
          (entryAccounts ||
            []) as Account[]
      ) {
        accountMap.set(
          account.id,
          account
        );
      }
    }

    const legacyPaymentRows: PaymentRow[] =
      legacyRowsSource.map(
        (transaction) => ({
          id: transaction.id,
          transaction_number:
            transaction.transaction_number,
          transaction_date:
            transaction.transaction_date,
          description:
            transaction.description,
          reference_type:
            transaction.reference_type,
          reference_id:
            transaction.reference_id,
          created_at:
            transaction.created_at,
          entries:
            entryRows
              .filter(
                (entry) =>
                  entry.transaction_id ===
                  transaction.id
              )
              .map(
                (entry) => {
                  const account =
                    accountMap.get(
                      entry.account_id
                    );

                  return {
                    id: entry.id,
                    transaction_id:
                      entry.transaction_id,
                    account_id:
                      entry.account_id,
                    debit: Number(
                      entry.debit || 0
                    ),
                    credit: Number(
                      entry.credit || 0
                    ),
                    description:
                      entry.description,
                    account_name:
                      account?.name ||
                      "Unknown Account",
                    account_code:
                      account?.code ||
                      null,
                  };
                }
              ),
        })
      );

    /*
     * Canonical payments: the journal entry is the payment and its lines are
     * the Cash/Bank movement plus the expense or salary-payable leg.
     */
    const canonicalPaymentRows: PaymentRow[] =
      canonicalEntries.map((entry) => ({
        id: String(entry.id),
        transaction_number:
          entry.entry_number
            ? String(entry.entry_number)
            : null,
        transaction_date: String(
          entry.entry_date
        ),
        description:
          entry.description || null,
        reference_type:
          entry.reference_type || null,
        reference_id:
          String(
            entry.reference_id ||
              entry.source_record_id ||
              ""
          ) || null,
        created_at: String(
          entry.created_at || ""
        ),
        entries: canonicalLineRows
          .filter(
            (line) =>
              String(line.journal_entry_id) ===
              String(entry.id)
          )
          .map((line) => {
            const account =
              accountMap.get(
                String(line.account_id)
              );

            return {
              id: String(line.id),
              transaction_id: String(
                line.journal_entry_id
              ),
              account_id: String(
                line.account_id
              ),
              debit: Number(line.debit || 0),
              credit: Number(
                line.credit || 0
              ),
              description:
                line.description || null,
              account_name:
                account?.name ||
                "Unknown Account",
              account_code:
                account?.code || null,
            };
          }),
      }));

    const result: PaymentRow[] = [
      ...canonicalPaymentRows,
      ...legacyPaymentRows,
    ].sort((a, b) => {
      const dateCompare =
        b.transaction_date.localeCompare(
          a.transaction_date
        );

      if (dateCompare !== 0) {
        return dateCompare;
      }

      return String(b.created_at).localeCompare(
        String(a.created_at)
      );
    });

    setPayments(result);
  }

  /*
   * =====================================================
   * LOAD VENDOR PAYMENT DATA
   *
   * Reads exactly the same canonical rows the Vendor
   * Purchases page uses (vendors, purchase_bills,
   * bill_payment_allocations, purchase_returns,
   * vendor_payments) so bill outstanding and the payment
   * history share ONE source of truth.
   * =====================================================
   */

  async function loadVendorData(
    currentSchoolId: string
  ) {
    const [
      vendorRes,
      billRes,
      allocationRes,
      returnRes,
      vendorPaymentRes,
    ] = await Promise.all([
      supabase
        .from("vendors")
        .select("id, name, is_active")
        .eq("school_id", currentSchoolId)
        .order("name"),

      supabase
        .from("purchase_bills")
        .select(
          "id, vendor_id, bill_number, bill_date, total_amount"
        )
        .eq("school_id", currentSchoolId)
        .order("bill_date", { ascending: false }),

      supabase
        .from("bill_payment_allocations")
        .select("bill_id, amount")
        .eq("school_id", currentSchoolId),

      supabase
        .from("purchase_returns")
        .select("bill_id, total_amount")
        .eq("school_id", currentSchoolId),

      supabase
        .from("vendor_payments")
        .select(
          "id, payment_date, amount, vendor_id, paid_from_account_id, reference_number, notes, payment_method, journal_entry_id"
        )
        .eq("school_id", currentSchoolId)
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (vendorRes.error) throw vendorRes.error;
    if (billRes.error) throw billRes.error;
    if (allocationRes.error) throw allocationRes.error;
    if (returnRes.error) throw returnRes.error;
    if (vendorPaymentRes.error) throw vendorPaymentRes.error;

    setVendors(
      (vendorRes.data || []) as VendorOption[]
    );
    setVendorBills(
      (billRes.data || []) as PurchaseBillOption[]
    );
    setVendorAllocations(
      (allocationRes.data || []).map(
        (row) => ({
          bill_id: row.bill_id as string,
          amount: Number(row.amount || 0),
        })
      )
    );
    setVendorReturns(
      (returnRes.data || []).map(
        (row) => ({
          bill_id: row.bill_id as string,
          total_amount: Number(row.total_amount || 0),
        })
      )
    );
    setVendorPayments(
      (vendorPaymentRes.data || []) as VendorPaymentRow[]
    );
  }

  /*
   * =====================================================
   * LOAD EVERYTHING
   * =====================================================
   */

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const currentSchoolId =
        await getCurrentSchoolId();

      setSchoolId(
        currentSchoolId
      );

      await loadAccounts(
        currentSchoolId
      );

      await loadPayments(
        currentSchoolId
      );

      await loadVendorData(
        currentSchoolId
      );
    } catch (err: any) {
      console.error(
        "PAYMENT PAGE LOAD ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to load payment page."
      );
    } finally {
      setLoading(false);
    }
  }

  function formatPayrollMonthLabel(
    value: string
  ) {
    if (!value) return "Month";

    const date =
      new Date(`${value}-01T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString(
      "en-IN",
      {
        month: "long",
        year: "numeric",
      }
    );
  }

  function readPayrollPaymentContext() {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    if (params.get("source") !== "payroll") {
      return;
    }

    let stored:
      | {
          payroll_run_id?: string;
          payroll_month?: string;
          amount?: number;
          particulars?: string;
          reference?: string;
          staff_items?: PayrollStaffItem[];
          payable_account_id?: string;
          accounting_transaction_number?: string;
        }
      | null = null;

    try {
      const raw = window.sessionStorage.getItem(
        "schoolflow_payroll_payment",
      );

      if (raw) {
        stored = JSON.parse(raw);
      }
    } catch {
      stored = null;
    }

    const runId =
      params.get("run_id") ||
      stored?.payroll_run_id ||
      "";

    const payableId =
      params.get("payable_account_id") ||
      stored?.payable_account_id ||
      "";

    const amountValue = Number(
      params.get("amount") ||
        stored?.amount ||
        0,
    );

    if (!runId || !payableId || amountValue <= 0) {
      setError(
        "Payroll payment context is incomplete. Return to Payroll and click Prepare Salary Payment again.",
      );
      return;
    }

    const effectiveMonth =
      params.get("month") ||
      stored?.payroll_month ||
      "";

    const staffItems =
      Array.isArray(stored?.staff_items)
        ? stored!.staff_items!.filter(
            (item) =>
              item &&
              typeof item.employee_id === "string" &&
              Number.isFinite(Number(item.net_pay)),
          )
        : [];

    setPayrollMode(true);
    setPaymentType("salary");
    setPayrollRunId(runId);
    setPayrollPayableAccountId(payableId);
    setPayrollAccountingTransactionNumber(
      stored?.accounting_transaction_number || "",
    );
    setPayrollMonth(effectiveMonth);
    setPayrollTotalAmount(amountValue.toFixed(2));
    setPayrollStaffItems(staffItems);

    const selectedId =
      params.get("employee_id") || "";

    setSelectedPayrollStaffId(selectedId);

    const selectedStaff =
      staffItems.find(
        (item) => item.employee_id === selectedId,
      );

    const selectedAmount =
      selectedStaff
        ? Number(selectedStaff.net_pay)
        : amountValue;

    setAmount(
      selectedAmount > 0
        ? selectedAmount.toFixed(2)
        : "",
    );

    setParticulars(
      selectedStaff
        ? `Salary - ${selectedStaff.name} - ${formatPayrollMonthLabel(
            effectiveMonth,
          )}`
        : params.get("particulars") ||
          stored?.particulars ||
          "Salary Payroll",
    );

    setReferenceNumber(
      selectedStaff
        ? `PAYROLL-${effectiveMonth}-${selectedStaff.employee_no}`
        : params.get("reference") ||
          stored?.reference ||
          (effectiveMonth
            ? `PAYROLL-${effectiveMonth}`
            : ""),
    );
  }

  function handlePayrollStaffChange(
    employeeId: string
  ) {
    setSelectedPayrollStaffId(
      employeeId
    );

    if (!employeeId) {
      const total =
        Number(
          payrollTotalAmount || 0
        );

      setAmount(
        total > 0
          ? total.toFixed(2)
          : ""
      );

      setParticulars(
        `Salary Payroll - ${formatPayrollMonthLabel(
          payrollMonth
        )}`
      );

      setReferenceNumber(
        payrollMonth
          ? `PAYROLL-${payrollMonth}`
          : ""
      );

      return;
    }

    const item =
      payrollStaffItems.find(
        (staff) =>
          staff.employee_id ===
          employeeId
      );

    if (!item) return;

    setAmount(
      Number(item.net_pay || 0).toFixed(
        2
      )
    );

    setParticulars(
      `Salary - ${item.name} - ${formatPayrollMonthLabel(
        payrollMonth
      )}`
    );

    setReferenceNumber(
      `PAYROLL-${payrollMonth}-${item.employee_no}`
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function initializePage() {
      await loadPage();
      if (cancelled) return;
    }

    initializePage();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    readPayrollPaymentContext();
  }, []);

  /*
   * =====================================================
   * FILTER ACCOUNTS
   * =====================================================
   */

  const cashBankAccounts =
    useMemo(() => {
      /*
       * Pay-from selector: only Cash/Bank accounts the school can actually
       * pay from - school-created Cash/Bank accounts plus the common
       * Cash/Bank defaults. Seeded accounts of other types never appear here.
       */
      return filterSelectableAccountsByTypes(
        accounts,
        CASH_BANK_ACCOUNT_TYPES
      );
    }, [accounts]);

  const expenseAccounts =
    useMemo(() => {
      /*
       * Expense selector: accounts created by the school from
       * Dashboard -> Accounting -> Accounts (for example "Electricity
       * Expense" or "School Bus Expense"). The seeded generic expense
       * accounts are hidden so the selector only lists the school's own
       * chart of accounts.
       */
      return filterSelectableAccountsByTypes(
        accounts,
        EXPENSE_ACCOUNT_TYPES
      );
    }, [accounts]);

  /*
   * =====================================================
   * VENDOR PAYMENT DATA
   *
   * Outstanding = bill total - allocations - purchase
   * returns, computed from the canonical database rows
   * (identical formula to the Vendor Purchases page).
   * =====================================================
   */

  const activeVendors =
    useMemo(() => {
      return vendors.filter(
        (vendor) =>
          vendor.is_active !== false
      );
    }, [vendors]);

  const vendorOutstandingByBill =
    useMemo(() => {
      const paidByBill: Record<
        string,
        number
      > = {};
      const returnedByBill: Record<
        string,
        number
      > = {};

      for (const allocation of vendorAllocations) {
        paidByBill[allocation.bill_id] =
          roundToTwo(
            (paidByBill[allocation.bill_id] || 0) +
              allocation.amount
          );
      }

      for (const returned of vendorReturns) {
        returnedByBill[returned.bill_id] =
          roundToTwo(
            (returnedByBill[returned.bill_id] || 0) +
              returned.total_amount
          );
      }

      const map: Record<
        string,
        {
          total: number;
          paid: number;
          returned: number;
          outstanding: number;
        }
      > = {};

      for (const bill of vendorBills) {
        const total = roundToTwo(
          Number(bill.total_amount || 0)
        );
        const paid = roundToTwo(
          paidByBill[bill.id] || 0
        );
        const returned = roundToTwo(
          returnedByBill[bill.id] || 0
        );

        map[bill.id] = {
          total,
          paid,
          returned,
          outstanding: roundToTwo(
            total - paid - returned
          ),
        };
      }

      return map;
    }, [vendorBills, vendorAllocations, vendorReturns]);

  const vendorBillOptions =
    useMemo(() => {
      return vendorBills
        .filter(
          (bill) =>
            bill.vendor_id === vendorPaymentId
        )
        .sort((a, b) =>
          a.bill_date < b.bill_date ? -1 : 1
        );
    }, [vendorBills, vendorPaymentId]);

  const selectedVendorBill =
    useMemo(() => {
      return (
        vendorBillOptions.find(
          (bill) => bill.id === vendorBillId
        ) || null
      );
    }, [vendorBillOptions, vendorBillId]);

  const selectedVendorBillOutstanding =
    selectedVendorBill
      ? vendorOutstandingByBill[
          selectedVendorBill.id
        ]?.outstanding ?? 0
      : 0;

  const vendorRemainingAfterPayment =
    useMemo(() => {
      const paid = Number(vendorAmount || 0);

      if (!Number.isFinite(paid) || paid <= 0) {
        return selectedVendorBillOutstanding;
      }

      return roundToTwo(
        Math.max(
          selectedVendorBillOutstanding - paid,
          0
        )
      );
    }, [vendorAmount, selectedVendorBillOutstanding]);



  /*
   * =====================================================
   * PAYMENT METHOD
   * =====================================================
   */

  function handlePaymentMethodChange(
    method: PaymentMethod
  ) {
    setPaymentMethod(method);

    if (
      method === "cash"
    ) {
      const cash =
        accounts.find(
          (account) =>
            account.account_type ===
            "cash"
        );

      if (cash) {
        setPaidFromAccountId(
          cash.id
        );
      }

      return;
    }

    if (
      method ===
        "bank_transfer" ||
      method === "upi" ||
      method === "card" ||
      method === "cheque" ||
      method === "online"
    ) {
      const bank =
        accounts.find(
          (account) =>
            account.account_type ===
            "bank"
        );

      if (bank) {
        setPaidFromAccountId(
          bank.id
        );
      }
    }
  }

  /*
   * =====================================================
   * PAYMENT TYPE + VENDOR FORM HANDLERS
   * =====================================================
   */

  function handlePaymentTypeChange(
    type: PaymentType
  ) {
    setPaymentType(type);
    setPayrollMode(type === "salary");

    if (type === "vendor") {
      setVendorRequestId(
        crypto.randomUUID()
      );
    }

    setError("");
    setSuccess("");
  }

  function handleVendorPaymentVendorChange(
    vendorId: string
  ) {
    setVendorPaymentId(vendorId);
    setVendorBillId("");
    setVendorAmount("");
    setVendorRequestId(
      crypto.randomUUID()
    );

    if (!vendorId) {
      setParticulars("");
      return;
    }

    const vendor = vendors.find(
      (item) => item.id === vendorId
    );

    setParticulars(
      `${vendor?.name || "Vendor"} • Vendor Payment`
    );
  }

  function handleVendorPaymentBillChange(
    billId: string
  ) {
    setVendorBillId(billId);
    setVendorAmount("");
    setVendorRequestId(
      crypto.randomUUID()
    );

    const vendor = vendors.find(
      (item) => item.id === vendorPaymentId
    );

    if (!vendor) return;

    const bill = vendorBills.find(
      (item) => item.id === billId
    );

    if (!bill) {
      setParticulars(
        `${vendor.name} • Vendor Payment`
      );
      return;
    }

    setParticulars(
      `${vendor.name} • ${bill.bill_number || "Purchase bill"} • Vendor Payment`
    );
  }


  /*
   * =====================================================
   * RESET FORM
   * =====================================================
   */

  function resetForm() {
    setEditingId(null);

    setPaymentDate(
      getToday()
    );

    setPaymentMethod(
      "cash"
    );

    const cash =
      accounts.find(
        (account) =>
          account.account_type ===
          "cash"
      );

    setPaidFromAccountId(
      cash?.id || ""
    );

    setExpenseAccountId("");

    if (payrollMode) {
      setSelectedPayrollStaffId("");
      setAmount(
        payrollTotalAmount || ""
      );
      setParticulars(
        `Salary Payroll - ${formatPayrollMonthLabel(
          payrollMonth
        )}`
      );
      setReferenceNumber(
        payrollMonth
          ? `PAYROLL-${payrollMonth}`
          : ""
      );
    } else {
      setAmount("");
      setParticulars("");
      setReferenceNumber("");
    }

    setNotes("");

    setError("");
    setSuccess("");
  }

  /*
   * =====================================================
   * CREATE / EDIT DESCRIPTION
   * =====================================================
   */

  function buildDescription() {
    const descriptionParts = [
      particulars.trim(),
      `Payment method: ${paymentMethod}`,
    ];

    if (
      payrollMode &&
      selectedPayrollStaffId
    ) {
      const staff =
        payrollStaffItems.find(
          (item) =>
            item.employee_id ===
            selectedPayrollStaffId
        );

      if (staff) {
        descriptionParts.push(
          `Staff: ${staff.name} (${staff.employee_no})`
        );
      }
    }

    if (
      payrollMode &&
      payrollMonth
    ) {
      descriptionParts.push(
        `Payroll Month: ${payrollMonth}`
      );
    }

    if (
      referenceNumber.trim()
    ) {
      descriptionParts.push(
        `Reference: ${referenceNumber.trim()}`
      );
    }

    if (notes.trim()) {
      descriptionParts.push(
        `Notes: ${notes.trim()}`
      );
    }

    return descriptionParts.join(
      " | "
    );
  }

  /*
   * =====================================================
   * SAVE PAYMENT
   * =====================================================
   */

  async function submitPayment(
    event: FormEvent
  ) {
    event.preventDefault();

    /*
     * Duplicate protection: while a submission is in flight, ignore any
     * repeated submit (double click, Enter twice, retried request) so ONE
     * financial event can only produce ONE canonical posting.
     */
    if (saving) {
      return;
    }

    setError("");
    setSuccess("");

    if (paymentType === "vendor") {
      await submitVendorPayment();
      return;
    }

    if (!schoolId) {
      setError("Current school could not be determined.");
      return;
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid payment amount greater than zero.");
      return;
    }

    if (!paidFromAccountId) {
      setError(
        "Select the Cash or Bank account from which the payment is made.",
      );
      return;
    }

    const paidFrom = accounts.find(
      (account) => account.id === paidFromAccountId,
    );

    if (!paidFrom) {
      setError("Selected Cash/Bank account was not found.");
      return;
    }

    if (
      paidFrom.account_type !== "cash" &&
      paidFrom.account_type !== "bank"
    ) {
      setError("Pay From must be a Cash or Bank account.");
      return;
    }

    if (!particulars.trim()) {
      setError("Enter payment particulars.");
      return;
    }

    if (!paymentDate) {
      setError("Select payment date.");
      return;
    }

    let debitAccountId = expenseAccountId;
    let debitAccountName = "";

    // These values are resolved during payroll validation and reused when
    // the selected employee payment is posted. Keep them outside the
    // payrollMode block so TypeScript scope is correct.
    let selectedStaff: PayrollStaffItem | null = null;
    let payrollItem: {
      id: string;
      employee_id: string;
      net_salary: number | null;
      paid_amount: number | null;
      paid: boolean | null;
      status: string | null;
    } | null = null;
    let alreadyPaid = 0;

    if (payrollMode) {
      if (!payrollRunId) {
        setError(
          "Payroll information is incomplete. Return to Payroll and click Prepare Salary Payment again.",
        );
        return;
      }

      /*
       * The Salary Payable account normally travels with the payroll context
       * (?payable_account_id=... / sessionStorage). When it is missing - deep
       * link, cleared storage, or preparation that finished without the old
       * RPC - resolve it from the seeded chart of accounts so an individual
       * staff payment can still be recorded and posted to Salary Payable
       * instead of failing with "Payroll information is incomplete".
       */
      let effectivePayableAccountId = payrollPayableAccountId;

      if (!effectivePayableAccountId) {
        const setup = await ensureSchoolAccountingSetup(supabase, schoolId);
        effectivePayableAccountId = setup.accountMap.SALARY_PAYABLE || "";
      }

      let payable =
        accounts.find(
          (account) => account.id === effectivePayableAccountId,
        ) || null;

      if (!payable && effectivePayableAccountId) {
        const { data: payableAccount, error: payableAccountError } =
          await supabase
            .from("accounts")
            .select("*")
            .eq("school_id", schoolId)
            .eq("id", effectivePayableAccountId)
            .maybeSingle();

        if (payableAccountError) {
          setError(payableAccountError.message);
          return;
        }

        payable = payableAccount;
      }

      if (!payable) {
        payable =
          accounts.find(
            (account) =>
              (account.account_type === "payable" ||
                account.account_type === "liability") &&
              /salary payable/i.test(account.name),
          ) || null;
      }

      if (!effectivePayableAccountId || !payable) {
        setError(
          "Payroll information is incomplete. Return to Payroll and click Prepare Salary Payment again.",
        );
        return;
      }

      if (payable.id !== payrollPayableAccountId) {
        setPayrollPayableAccountId(payable.id);
        effectivePayableAccountId = payable.id;
      }

      if (
        payable.account_type !== "payable" &&
        payable.account_type !== "liability"
      ) {
        setError(
          "Salary Payable must be a payable/liability account.",
        );
        return;
      }

      debitAccountId = payable.id;
      debitAccountName = payable.name;

      const { data: payrollRun, error: payrollRunError } =
        await supabase
          .from("payroll_runs")
          .select("id, school_id, month, year, status, total_net")
          .eq("id", payrollRunId)
          .eq("school_id", schoolId)
          .maybeSingle();

      if (payrollRunError) {
        setError(payrollRunError.message);
        return;
      }

      if (!payrollRun) {
        setError("Payroll run could not be found.");
        return;
      }

      if (
        payrollRun.status !== "prepared" &&
        payrollRun.status !== "draft"
      ) {
        setError(
          `Payroll is already ${payrollRun.status} and cannot be paid again.`,
        );
        return;
      }

      /*
       * Payroll payments are employee-by-employee.
       *
       * IMPORTANT:
       * payroll_runs.total_net is the TOTAL for every employee.
       * It must NOT be compared with the selected employee amount.
       */
      const currentSelectedStaff = payrollStaffItems.find(
        (item) => item.employee_id === selectedPayrollStaffId,
      ) || null;

      if (!currentSelectedStaff) {
        setError(
          "Select the Teacher / Staff member you want to pay.",
        );
        return;
      }

      selectedStaff = currentSelectedStaff;

      const { data: loadedPayrollItem, error: payrollItemError } =
        await supabase
          .from("payroll_items")
          .select(
            "id, employee_id, net_salary, paid_amount, paid, status",
          )
          .eq("payroll_run_id", payrollRunId)
          .eq("school_id", schoolId)
          .eq("employee_id", currentSelectedStaff.employee_id)
          .maybeSingle();

      if (payrollItemError) {
        setError(
          `Unable to load payroll item for ${currentSelectedStaff.name}: ${payrollItemError.message}`,
        );
        return;
      }

      payrollItem = loadedPayrollItem;

      if (!payrollItem) {
        setError(
          `Payroll item for ${currentSelectedStaff.name} could not be found.`,
        );
        return;
      }

      const employeeNetSalary = Number(
        payrollItem.net_salary || selectedStaff.net_pay || 0,
      );
      alreadyPaid = Number(payrollItem.paid_amount || 0);
      const remainingForEmployee = Math.max(
        employeeNetSalary - alreadyPaid,
        0,
      );

      if (
        Boolean(payrollItem.paid) ||
        payrollItem.status === "paid" ||
        remainingForEmployee <= 0.005
      ) {
        setError(
          `${currentSelectedStaff.name} has already been paid for this payroll.`,
        );
        return;
      }

      if (
        Math.abs(numericAmount - remainingForEmployee) > 0.005
      ) {
        setError(
          `Payment amount ${money(
            numericAmount,
          )} does not match ${currentSelectedStaff.name}'s remaining salary ${money(
            remainingForEmployee,
          )}.`,
        );
        return;
      }

      /*
       * One payroll run can have multiple payment transactions.
       * Do not block the second employee just because the first employee
       * already has a payment transaction.
       */
    } else {
      if (!expenseAccountId) {
        setError("Select the expense account.");
        return;
      }

      if (paidFromAccountId === expenseAccountId) {
        setError(
          "Expense account and Paid From account cannot be the same.",
        );
        return;
      }

      const expense = accounts.find(
        (account) => account.id === expenseAccountId,
      );

      if (!expense) {
        setError("Selected Expense account was not found.");
        return;
      }

      if (expense.account_type !== "expense") {
        setError("Selected account is not an Expense account.");
        return;
      }

      debitAccountName = expense.name;
    }

    const paymentStaff = selectedStaff;
    const paymentPayrollItem = payrollItem;

    if (payrollMode && (!paymentStaff || !paymentPayrollItem)) {
      setError("Selected payroll employee could not be resolved.");
      return;
    }

    setSaving(true);

    let expenseCategoryId: string | null = null;

    // Canonical payment record created for this submission. Used for the
    // cleanup below when the canonical posting fails.
    let createdExpenseId: string | null = null;

    try {
      const { data: userData } = await supabase.auth.getUser();

      const descriptionParts = [
        particulars.trim(),
        `Payment method: ${paymentMethod}`,
      ];

      if (payrollMode) {
        descriptionParts.push(`Payroll run: ${payrollRunId}`);

        if (payrollAccountingTransactionNumber) {
          descriptionParts.push(
            `Salary journal: ${payrollAccountingTransactionNumber}`,
          );
        }
      }

      if (referenceNumber.trim()) {
        descriptionParts.push(
          `Reference: ${referenceNumber.trim()}`,
        );
      }

      if (notes.trim()) {
        descriptionParts.push(`Notes: ${notes.trim()}`);
      }

      const description = descriptionParts.join(" | ");

      // Canonical accounting only: we post through journal_entries/journal_lines
      // and do NOT create legacy transactions/transaction_entries for the same
      // financial event. This prevents the cash_book/bank_book views from showing
      // the same payment twice (legacy UNION ALL canonical).
      const setup = await ensureSchoolAccountingSetup(supabase, schoolId);

      /*
       * =====================================================
       * ONE FINANCIAL EVENT = ONE CANONICAL POSTING
       * -----------------------------------------------------
       * 1. The payment record (expenses table) is the canonical source of
       *    this financial event.
       * 2. Exactly ONE canonical journal entry is posted, linked to that
       *    payment record through source_record_id / reference_id.
       *
       * Because the journal entry is linked, deleting the payment also
       * removes its accounting effect from the Cash Book, Bank Book, Ledger
       * and reports, and a repeated submission re-uses the existing posting
       * instead of creating a second one.
       * =====================================================
       */

      const payrollExpenseDescription = payrollMode && paymentStaff
        ? `Salary - ${paymentStaff.name} - ${formatPayrollMonthLabel(
            payrollMonth,
          )}`
        : particulars.trim();

      const payrollExpenseReference = payrollMode && paymentStaff
        ? `PAYROLL-${payrollMonth}-${paymentStaff.employee_no}`
        : referenceNumber.trim() || null;

      const expenseCategories = await ensureBuiltInExpenseCategories(
        supabase,
        schoolId,
      );
      const expenseCategory = expenseCategories.get(
        (payrollMode ? "Salary" : "Fee").toLowerCase(),
      );

      if (!expenseCategory) {
        throw new Error("Built-in expense category could not be created.");
      }

      expenseCategoryId = expenseCategory.id;

      // 1. Create the payment record first (no legacy transaction).
      const { data: paymentExpense, error: expenseRowError } = await supabase
        .from("expenses")
        .insert({
          school_id: schoolId,
          expense_category_id: expenseCategory.id,
          expense_date: paymentDate,
          amount: numericAmount,
          paid_from_account_id: paidFromAccountId,
          transaction_id: null, // canonical journal only - no legacy transaction
          vendor_name: payrollMode && paymentStaff
            ? paymentStaff.name
            : null,
          invoice_number: payrollExpenseReference,
          description: payrollExpenseDescription,
          created_by: userData.user?.id || null,
        })
        .select("id")
        .single();

      if (expenseRowError) {
        throw new Error(
          `Expense record could not be created: ${expenseRowError.message}`,
        );
      }

      if (!paymentExpense?.id) {
        throw new Error("Payment record could not be created.");
      }

      createdExpenseId = String(paymentExpense.id);

      // Human readable narration for the Cash Book, Bank Book and Ledger.
      const paymentNarration = payrollMode && paymentStaff
        ? `Salary payment - ${paymentStaff.name} - ${formatPayrollMonthLabel(
            payrollMonth,
          )}`
        : description;

      // 2. Post the ONE canonical journal entry for this payment.
      if (payrollMode) {
        await postSalaryPaymentJournal(supabase, {
          schoolId,
          fiscalYearId: setup.fiscalYearId,
          entryDate: paymentDate,
          sourceRecordId: createdExpenseId,
          salaryPayableAccountId: debitAccountId,
          paymentAccountId: paidFromAccountId,
          amount: numericAmount,
          createdBy: userData.user?.id || null,
          entryDescription: paymentNarration,
          referenceType: "payment",
        });
      } else {
        await postExpenseJournal(supabase, {
          schoolId,
          fiscalYearId: setup.fiscalYearId,
          entryDate: paymentDate,
          sourceRecordId: createdExpenseId,
          expenseAccountId: debitAccountId,
          paymentAccountId: paidFromAccountId,
          amount: numericAmount,
          createdBy: userData.user?.id || null,
          entryDescription: paymentNarration,
          referenceType: "payment",
        });
      }

      if (payrollMode) {
        /*
         * Mark ONLY the selected employee's payroll item as paid.
         * Never mark the entire payroll run paid after the first employee.
         */
        const { data: updatedItem, error: itemError } =
          await supabase
            .from("payroll_items")
            .update({
              paid: true,
              paid_amount: Number(
                (alreadyPaid + numericAmount).toFixed(2),
              ),
              status: "paid",
            })
            .eq("id", paymentPayrollItem!.id)
            .eq("payroll_run_id", payrollRunId)
            .eq("school_id", schoolId)
            .select(
              "id, employee_id, net_salary, paid_amount, paid, status",
            )
            .maybeSingle();

        if (itemError) {
          throw new Error(
            `Payroll item could not be marked paid: ${itemError.message}`,
          );
        }

        if (!updatedItem) {
          throw new Error(
            `Payroll item for ${paymentStaff!.name} was not updated.`,
          );
        }

        /*
         * Check every employee after this payment and finalize the run only
         * when all payroll items are fully paid.
         *
         * This step is deliberately BEST-EFFORT: the payment itself (expense
         * row + canonical journal + paid payroll item) is already stored, so
         * a failure here must never roll the payment back. Rolling back at
         * this point previously left payroll_items marked paid while the
         * expense row and the journal entry had been deleted again.
         */
        let successMessage = "";
        let finalizeWarning = "";

        try {
          const {
            data: allPayrollItems,
            error: allItemsError,
          } = await supabase
            .from("payroll_items")
            .select(
              "id, employee_id, net_salary, paid_amount, paid, status",
            )
            .eq("payroll_run_id", payrollRunId)
            .eq("school_id", schoolId);

          if (allItemsError) {
            throw new Error(
              `Unable to verify remaining payroll payments: ${allItemsError.message}`,
            );
          }

          if (!allPayrollItems || allPayrollItems.length === 0) {
            throw new Error(
              "No payroll items were found after recording the employee payment.",
            );
          }

          const allPaid = allPayrollItems.every(
            (item) =>
              Boolean(item.paid) ||
              item.status === "paid" ||
              Number(item.paid_amount || 0) >=
                Number(item.net_salary || 0) - 0.005,
          );

          if (allPaid) {
            const {
              data: finalizedRun,
              error: runUpdateError,
            } = await supabase
              .from("payroll_runs")
              .update({
                status: "finalized",
                finalized_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", payrollRunId)
              .eq("school_id", schoolId)
              // Accept 'prepared' (the normal path) but also 'draft', so a
              // run whose status was never persisted (older preparation flow)
              // can still be closed instead of failing the whole payment.
              .in("status", ["draft", "prepared"])
              .select("id, status, finalized_at")
              .maybeSingle();

            if (runUpdateError) {
              throw new Error(
                `Payroll could not be finalized: ${runUpdateError.message}`,
              );
            }

            if (finalizedRun) {
              try {
                window.sessionStorage.removeItem(
                  "schoolflow_payroll_payment",
                );
              } catch {
                // Storage cleanup only.
              }

              successMessage = `Salary payment completed — ${money(
                numericAmount,
              )} paid from ${paidFrom.name} for ${paymentStaff!.name}. Payroll is now fully finalized.`;
            } else {
              successMessage = `Salary payment completed — ${money(
                numericAmount,
              )} paid from ${paidFrom.name} for ${paymentStaff!.name}.`;
              finalizeWarning =
                " The payment is saved, but the payroll run status could not be set to finalized — finish it from Payroll.";
            }
          } else {
            const remainingPayrollAmount = allPayrollItems.reduce(
              (sum, item) =>
                sum +
                Math.max(
                  Number(item.net_salary || 0) -
                    Number(item.paid_amount || 0),
                  0,
                ),
              0,
            );

            setPayrollTotalAmount(remainingPayrollAmount.toFixed(2));

            successMessage = `Salary payment completed — ${money(
              numericAmount,
            )} paid from ${paidFrom.name} for ${paymentStaff!.name}. Other employees remain unpaid.`;
          }
        } catch (finalizeError) {
          // Never undo a saved payment because of the status refresh.
          console.error("PAYROLL FINALIZE WARNING:", finalizeError);
          successMessage = `Salary payment completed — ${money(
            numericAmount,
          )} paid from ${paidFrom.name} for ${paymentStaff!.name}.`;
          finalizeWarning = ` The payment is saved, but the payroll status could not be refreshed: ${
            finalizeError instanceof Error
              ? finalizeError.message
              : "unknown error"
          }`;
        }

        setSuccess(successMessage + finalizeWarning);
      } else {
        setSuccess(
          `Payment saved successfully — ${money(
            numericAmount,
          )} paid from ${paidFrom.name}.`,
        );
      }

      resetForm();
      await loadPayments(schoolId);
    } catch (err: any) {
      console.error("PAYMENT RECORDING ERROR:", err);

      // Clean up the canonical payment record and its journal entry so a
      // failed submission never leaves a half-recorded payment behind.
      if (createdExpenseId) {
        try {
          await deleteCanonicalJournalForSource(supabase, {
            schoolId,
            sourceRecordId: createdExpenseId,
            sourceModule: "expenses",
            sourceTable: "expenses",
          });

          await supabase
            .from("expenses")
            .delete()
            .eq("school_id", schoolId)
            .eq("id", createdExpenseId);
        } catch (cleanupError) {
          console.error("PAYMENT ROLLBACK ERROR:", cleanupError);
        }
      }

      setError(
        err?.message || "Unable to save payment.",
      );
    } finally {
      setSaving(false);
    }
  }

  /*
   * =====================================================
   * VENDOR PAYMENT — RECORD
   *
   * One atomic RPC inserts the vendor payment, allocates
   * it to the selected purchase bill and posts the
   * canonical Dr Vendor Payables / Cr Cash-Bank journal.
   * The browser never decides the amount or accounts:
   * the RPC re-validates everything server-side.
   * =====================================================
   */

  async function submitVendorPayment() {
    if (!schoolId) {
      setError("Current school could not be determined.");
      return;
    }

    if (!vendorPaymentId) {
      setError("No vendor selected.");
      return;
    }

    if (!vendorBillId) {
      setError("No purchase bill selected.");
      return;
    }

    const numericAmount = roundToTwo(
      Number(vendorAmount)
    );

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Payment amount must be greater than zero.");
      return;
    }

    if (numericAmount > selectedVendorBillOutstanding + 0.009) {
      setError(
        `Payment amount cannot exceed the outstanding amount of ${money(
          selectedVendorBillOutstanding,
        )}.`,
      );
      return;
    }

    if (!paidFromAccountId) {
      setError(
        "Select the Cash or Bank account from which the payment is made.",
      );
      return;
    }

    const paidFrom = accounts.find(
      (account) => account.id === paidFromAccountId,
    );

    if (!paidFrom) {
      setError("Selected Cash/Bank account was not found.");
      return;
    }

    if (
      paidFrom.account_type !== "cash" &&
      paidFrom.account_type !== "bank"
    ) {
      setError("Pay From must be a Cash or Bank account.");
      return;
    }

    if (!paymentDate) {
      setError("Select payment date.");
      return;
    }

    const requestId = vendorRequestId || crypto.randomUUID();
    setVendorRequestId(requestId);

    setVendorPaymentSaving(true);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "record_vendor_payment",
        {
          p_school_id: schoolId,
          p_vendor_id: vendorPaymentId,
          p_request_id: requestId,
          p_payment_date: paymentDate,
          p_amount: numericAmount,
          p_paid_from_account_id: paidFromAccountId,
          p_bill_id: vendorBillId,
          p_payment_method: paymentMethod,
          p_reference_number: referenceNumber.trim() || null,
          p_particulars: particulars.trim() || null,
          p_notes: notes.trim() || null,
        },
      );

      if (rpcError) {
        throw new Error(
          rpcError.message ||
            "Vendor payment could not be recorded.",
        );
      }

      if (!data?.vendor_payment_id) {
        throw new Error(
          "Vendor payment could not be recorded. Retry the same request.",
        );
      }

      const previousOutstanding = Number(
        data.previous_outstanding ?? selectedVendorBillOutstanding,
      );
      const remainingOutstanding = Number(
        data.remaining_outstanding ?? 0,
      );

      setSuccess(
        data.idempotent
          ? `This vendor payment was already recorded. Previous outstanding ${money(
              previousOutstanding,
            )}, payment ${money(
              Number(data.amount || numericAmount),
            )}, remaining outstanding ${money(remainingOutstanding)}.`
          : `Vendor payment of ${money(numericAmount)} recorded — Dr Vendor Payables / Cr ${
              paidFrom.name
            }. Previous outstanding ${money(
              previousOutstanding,
            )}, remaining outstanding ${money(remainingOutstanding)}.`,
      );

      setVendorAmount("");
      setVendorRequestId(crypto.randomUUID());
      setNotes("");

      await loadVendorData(schoolId);
    } catch (err: any) {
      console.error("VENDOR PAYMENT ERROR:", err);
      setError(
        err?.message ||
          "Vendor payment could not be recorded.",
      );
    } finally {
      setVendorPaymentSaving(false);
    }
  }

  /*
   * =====================================================
   * VENDOR PAYMENT — DELETE
   *
   * One atomic RPC reverses the journal entry and
   * releases the bill allocations, restoring vendor
   * outstanding. Purchase bills and other payments are
   * never touched.
   * =====================================================
   */

  async function confirmDeleteVendorPayment(
    payment: VendorPaymentRow
  ) {
    if (!schoolId) return;

    const vendorName =
      vendors.find((item) => item.id === payment.vendor_id)
        ?.name || "vendor";

    if (
      !window.confirm(
        `Delete the vendor payment of ${money(
          Number(payment.amount || 0),
        )} to ${vendorName}? Its accounting entry will be reversed and the bill outstanding restored.`,
      )
    ) {
      return;
    }

    setVendorPaymentDeletingId(payment.id);
    setError("");
    setSuccess("");

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "delete_vendor_payment",
        {
          p_school_id: schoolId,
          p_vendor_payment_id: payment.id,
        },
      );

      if (rpcError) {
        throw new Error(
          rpcError.message ||
            "Vendor payment could not be deleted.",
        );
      }

      if (!data?.deleted) {
        throw new Error(
          "Vendor payment could not be deleted. Refresh the page.",
        );
      }

      setSuccess(
        `Vendor payment of ${money(
          Number(data.amount || 0),
        )} to ${vendorName} deleted. The accounting entry was reversed and the bill outstanding restored.`,
      );

      await loadVendorData(schoolId);
    } catch (err: any) {
      console.error("VENDOR PAYMENT DELETE ERROR:", err);
      setError(
        err?.message ||
          "Vendor payment could not be deleted.",
      );
    } finally {
      setVendorPaymentDeletingId(null);
    }
  }

  /*
   * =====================================================
   * START EDIT
   * =====================================================
   */

  function startEdit(
    payment: PaymentRow
  ) {
    const debitEntry =
      payment.entries.find(
        (entry) =>
          Number(entry.debit) >
          0
      );

    const creditEntry =
      payment.entries.find(
        (entry) =>
          Number(entry.credit) >
          0
      );

    if (
      !debitEntry ||
      !creditEntry
    ) {
      setError(
        "This payment does not contain a valid double-entry."
      );
      return;
    }

    const paidFrom =
      accounts.find(
        (account) =>
          account.id ===
          creditEntry.account_id
      );

    const expense =
      accounts.find(
        (account) =>
          account.id ===
          debitEntry.account_id
      );

    if (!paidFrom) {
      setError(
        "Paid From account is no longer available."
      );
      return;
    }

    if (!expense) {
      setError(
        "Expense account is no longer available."
      );
      return;
    }

    setEditingId(
      payment.id
    );

    setPaymentDate(
      payment.transaction_date
    );

    setPaymentMethod(
      getPaymentMethod(
        payment.description,
        paidFrom
      )
    );

    setPaidFromAccountId(
      paidFrom.id
    );

    setExpenseAccountId(
      expense.id
    );

    setAmount(
      String(
        Number(
          debitEntry.debit
        )
      )
    );

    setParticulars(
      getParticulars(
        payment.description
      )
    );

    setReferenceNumber(
      getReference(
        payment.description
      )
    );

    setNotes(
      getNotes(
        payment.description
      )
    );

    setError("");
    setSuccess("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  /*
   * =====================================================
   * DELETE PAYMENT
   * =====================================================
   */

  async function confirmDeletePayment() {
    if (
      !deletePayment ||
      !schoolId
    ) {
      return;
    }

    setDeleting(true);
    setError("");
    setSuccess("");

    try {
      /*
       * The row can be a CANONICAL payment (journal entry) or a historical
       * legacy transaction. Either way exactly ONE accounting effect is
       * removed: the canonical journal entry of that payment.
       */

      const {
        data: journalEntry,
        error: journalReadError,
      } = await supabase
        .from("journal_entries")
        .select(
          "id, entry_number, description, reference_id, source_record_id"
        )
        .eq("id", deletePayment.id)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (journalReadError) {
        throw new Error(
          journalReadError.message
        );
      }

      let paymentLabel =
        deletePayment.transaction_number || "";

      if (journalEntry) {
        // Canonical payment: remove the journal entry and the payment record.
        const sourceRecordId = String(
          journalEntry.reference_id ||
            journalEntry.source_record_id ||
            ""
        );

        if (journalEntry.entry_number) {
          paymentLabel = String(
            journalEntry.entry_number
          );
        }

        await deleteCanonicalJournalForSource(
          supabase,
          {
            schoolId,
            sourceRecordId,
            journalEntryIds: [journalEntry.id],
            sourceModule: "expenses",
            sourceTable: "expenses",
          }
        );

        if (sourceRecordId) {
          const {
            error: expenseDeleteError,
          } = await supabase
            .from("expenses")
            .delete()
            .eq("id", sourceRecordId)
            .eq("school_id", schoolId);

          if (expenseDeleteError) {
            throw new Error(
              expenseDeleteError.message
            );
          }
        }
      } else {
        /*
         * Historical legacy payment. Delete the legacy rows and the canonical
         * journal entry linked to that transaction (older payments posted
         * both) so nothing is left behind in the ledger or cash/bank books.
         */
        const {
          data: transaction,
          error: transactionError,
        } = await supabase
          .from("transactions")
          .select("id, transaction_number")
          .eq("id", deletePayment.id)
          .eq("school_id", schoolId)
          .eq("transaction_type", "expense")
          .eq("reference_type", "payment")
          .maybeSingle();

        if (transactionError) {
          throw new Error(
            transactionError.message
          );
        }

        if (!transaction) {
          throw new Error(
            "Payment could not be found or does not belong to the current school."
          );
        }

        paymentLabel =
          transaction.transaction_number ||
          paymentLabel;

        await deleteCanonicalJournalForSource(
          supabase,
          {
            schoolId,
            sourceRecordId:
              transaction.id,
            legacyTransactionId:
              transaction.id,
          }
        );

        const {
          error: deleteEntriesError,
        } = await supabase
          .from("transaction_entries")
          .delete()
          .eq(
            "transaction_id",
            transaction.id
          )
          .eq("school_id", schoolId);

        if (deleteEntriesError) {
          throw new Error(
            `Payment accounting entries could not be deleted: ${deleteEntriesError.message}`
          );
        }

        const {
          error: deleteTransactionError,
        } = await supabase
          .from("transactions")
          .delete()
          .eq("id", transaction.id)
          .eq("school_id", schoolId);

        if (deleteTransactionError) {
          throw new Error(
            `Payment could not be deleted: ${deleteTransactionError.message}`
          );
        }
      }

      setDeletePayment(null);

      setSuccess(
        `Payment${
          paymentLabel
            ? ` ${paymentLabel}`
            : ""
        } and its accounting entry deleted successfully.`
      );

      await loadPayments(
        schoolId
      );
    } catch (err: any) {
      console.error(
        "PAYMENT DELETE ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to delete payment."
      );
    } finally {
      setDeleting(false);
    }
  }

  /*
   * =====================================================
   * CANCEL EDIT
   * =====================================================
   */

  function cancelEdit() {
    resetForm();

    setSuccess(
      "Edit cancelled."
    );
  }

  /*
   * =====================================================
   * RENDER
   * =====================================================
   */

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Link
            href="/dashboard"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600"
          >
            <ArrowLeft
              size={16}
            />
            Dashboard
          </Link>

          <div className="text-sm font-semibold text-blue-600">
            Accounting
          </div>

          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Payment
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Record school expenses and payments.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-6 flex items-start justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <span>
              {error}
            </span>

            <button
              type="button"
              onClick={() =>
                setError("")
              }
              className="ml-4"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {success && (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <div className="flex items-center gap-2">
              <CheckCircle2
                size={18}
              />
              {success}
            </div>

            <button
              type="button"
              onClick={() =>
                setSuccess("")
              }
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* =================================================
            CREATE / EDIT FORM
        ================================================= */}

        <section className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {editingId
                  ? "Edit Payment"
                  : "New Payment"}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {editingId
                  ? "Update the existing payment. The double-entry will be replaced."
                  : "Every payment creates a balanced double-entry transaction."}
              </p>
            </div>

            {editingId && (
              <button
                type="button"
                onClick={
                  cancelEdit
                }
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <X size={16} />
                Cancel Edit
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-12 text-sm text-slate-500">
              <Loader2
                size={18}
                className="mr-2 animate-spin"
              />
              Loading accounts...
            </div>
          ) : (
            <form
              onSubmit={
                submitPayment
              }
              className="space-y-6"
            >
              {/* PAYMENT TYPE */}

              <div className="max-w-sm">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Type
                </label>

                <select
                  value={paymentType}
                  onChange={(e) =>
                    handlePaymentTypeChange(
                      e.target
                        .value as PaymentType
                    )
                  }
                  disabled={
                    saving ||
                    vendorPaymentSaving ||
                    Boolean(editingId)
                  }
                  className="w-full rounded-lg border bg-white px-3 py-2.5 outline-none focus:border-blue-500"
                >
                  <option value="expense">
                    Expense Payment
                  </option>

                  <option value="vendor">
                    Vendor Payment
                  </option>

                  <option value="salary">
                    Salary Payment
                  </option>
                </select>

                {paymentType ===
                  "salary" &&
                  !payrollRunId && (
                    <p className="mt-2 text-xs text-amber-600">
                      Salary payments need a prepared payroll
                      run. Return to Payroll and click
                      &ldquo;Prepare Salary Payment&rdquo; to pay
                      salaries.
                    </p>
                  )}

                {editingId && (
                  <p className="mt-2 text-xs text-slate-500">
                    Editing an existing payment. Cancel the
                    edit to switch payment type.
                  </p>
                )}
              </div>

              {payrollMode && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-blue-900">
                        Salary Payroll Payment
                      </p>
                      <p className="mt-1 text-xs leading-5 text-blue-700">
                        {payrollMonth
                          ? `Payroll period: ${formatPayrollMonthLabel(
                              payrollMonth
                            )}.`
                          : "Payroll payment prepared from Payroll."}
                        {" "}
                        Select a teacher/staff member for an individual payment or keep All Staff.
                      </p>
                    </div>

                    <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-blue-700">
                      Payroll Amount:{" "}
                      {money(
                        Number(
                          payrollTotalAmount ||
                            0
                        )
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {payrollMode && (
                  <div className="md:col-span-2 lg:col-span-4">
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Teacher / Staff
                    </label>

                    <select
                      value={
                        selectedPayrollStaffId
                      }
                      onChange={(e) =>
                        handlePayrollStaffChange(
                          e.target.value
                        )
                      }
                      className="w-full rounded-lg border bg-white px-3 py-2.5 outline-none focus:border-blue-500"
                    >
                      <option value="">
                        All Staff —{" "}
                        {money(
                          Number(
                            payrollTotalAmount ||
                              0
                          )
                        )}
                      </option>

                      {payrollStaffItems.map(
                        (staff) => (
                          <option
                            key={
                              staff.employee_id
                            }
                            value={
                              staff.employee_id
                            }
                          >
                            {staff.name} —{" "}
                            {money(
                              Number(
                                staff.net_pay ||
                                  0
                              )
                            )}
                            {staff.employee_no
                              ? ` (${staff.employee_no})`
                              : ""}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                )}

                {/* VENDOR PAYMENT FIELDS */}

                {paymentType ===
                  "vendor" && (
                  <>
                    <div className="md:col-span-2 lg:col-span-4">
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Vendor
                      </label>

                      <select
                        value={
                          vendorPaymentId
                        }
                        onChange={(e) =>
                          handleVendorPaymentVendorChange(
                            e.target
                              .value
                          )
                        }
                        className="w-full rounded-lg border bg-white px-3 py-2.5 outline-none focus:border-blue-500"
                      >
                        <option value="">
                          Select vendor
                        </option>

                        {activeVendors.map(
                          (vendor) => (
                            <option
                              key={
                                vendor.id
                              }
                              value={
                                vendor.id
                              }
                            >
                              {
                                vendor.name
                              }
                            </option>
                          ),
                        )}
                      </select>

                      {activeVendors.length ===
                        0 && (
                        <p className="mt-2 text-xs text-red-600">
                          No vendors found. Add
                          vendors in Vendor
                          Purchases.
                        </p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Purchase Bill
                      </label>

                      <select
                        value={
                          vendorBillId
                        }
                        onChange={(e) =>
                          handleVendorPaymentBillChange(
                            e.target
                              .value
                          )
                        }
                        disabled={
                          !vendorPaymentId
                        }
                        className="w-full rounded-lg border bg-white px-3 py-2.5 outline-none focus:border-blue-500 disabled:bg-slate-50"
                      >
                        <option value="">
                          {!vendorPaymentId
                            ? "Select a vendor first"
                            : vendorBillOptions.length
                              ? "Select purchase bill"
                              : "No purchase bills for this vendor"}
                        </option>

                        {vendorBillOptions.map(
                          (bill) => {
                            const outstanding =
                              vendorOutstandingByBill[
                                bill.id
                              ];

                            return (
                              <option
                                key={
                                  bill.id
                                }
                                value={
                                  bill.id
                                }
                              >
                                {bill.bill_number ||
                                  "Purchase bill"}
                                {" • "}
                                {bill.bill_date}
                                {" • Total "}
                                {money(
                                  outstanding?.total ||
                                    0,
                                )}
                                {" • Paid "}
                                {money(
                                  outstanding?.paid ||
                                    0,
                                )}
                                {" • Outstanding "}
                                {money(
                                  outstanding?.outstanding ||
                                    0,
                                )}
                              </option>
                            );
                          },
                        )}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Bill Outstanding
                      </label>

                      <div className="rounded-lg border bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900">
                        {money(
                          selectedVendorBillOutstanding,
                        )}
                      </div>

                      {selectedVendorBill &&
                        selectedVendorBillOutstanding <=
                          0.009 && (
                          <p className="mt-2 text-xs text-amber-600">
                            This bill is fully settled
                            (payments and/or purchase
                            returns cover its total).
                          </p>
                        )}
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Payment Amount
                      </label>

                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                          ₹
                        </span>

                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={
                            vendorAmount
                          }
                          onChange={(e) =>
                            setVendorAmount(
                              e.target
                                .value
                            )
                          }
                          placeholder="0.00"
                          className="w-full rounded-lg border py-2.5 pl-8 pr-3 outline-none focus:border-blue-500"
                        />
                      </div>

                      <p className="mt-2 text-xs text-slate-500">
                        Remaining outstanding after this
                        payment:{" "}
                        <span className="font-semibold text-slate-700">
                          {money(
                            vendorRemainingAfterPayment,
                          )}
                        </span>
                      </p>

                      {Number(
                        vendorAmount || 0,
                      ) >
                        selectedVendorBillOutstanding +
                          0.009 && (
                        <p className="mt-2 text-xs text-red-600">
                          Payment amount cannot exceed
                          the outstanding amount of{" "}
                          {money(
                            selectedVendorBillOutstanding,
                          )}
                          .
                        </p>
                      )}
                    </div>
                  </>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Payment Date
                  </label>

                  <input
                    type="date"
                    value={
                      paymentDate
                    }
                    onChange={(e) =>
                      setPaymentDate(
                        e.target.value
                      )
                    }
                    className="w-full rounded-lg border px-3 py-2.5 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Payment Method
                  </label>

                  <select
                    value={
                      paymentMethod
                    }
                    onChange={(e) =>
                      handlePaymentMethodChange(
                        e.target
                          .value as PaymentMethod
                      )
                    }
                    className="w-full rounded-lg border bg-white px-3 py-2.5 outline-none focus:border-blue-500"
                  >
                    {PAYMENT_METHODS.map(
                      (method) => (
                        <option
                          key={
                            method.value
                          }
                          value={
                            method.value
                          }
                        >
                          {
                            method.label
                          }
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Pay From
                  </label>

                  <select
                    value={
                      paidFromAccountId
                    }
                    onChange={(e) =>
                      setPaidFromAccountId(
                        e.target.value
                      )
                    }
                    className="w-full rounded-lg border bg-white px-3 py-2.5 outline-none focus:border-blue-500"
                  >
                    <option value="">
                      Select Cash / Bank
                    </option>

                    {cashBankAccounts.map(
                      (account) => (
                        <option
                          key={
                            account.id
                          }
                          value={
                            account.id
                          }
                        >
                          {account.name}
                          {account.code
                            ? ` (${account.code})`
                            : ""}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {paymentType !==
                  "vendor" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Amount
                  </label>

                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      ₹
                    </span>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        amount
                      }
                      onChange={(e) =>
                        setAmount(
                          e.target.value
                        )
                      }
                      placeholder="0.00"
                      className="w-full rounded-lg border py-2.5 pl-8 pr-3 outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {paymentType !==
                  "vendor" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Expense Account
                  </label>

                  <select
                    value={
                      expenseAccountId
                    }
                    onChange={(e) =>
                      setExpenseAccountId(
                        e.target.value
                      )
                    }
                    className="w-full rounded-lg border bg-white px-3 py-2.5 outline-none focus:border-blue-500"
                  >
                    <option value="">
                      Select Expense Account
                    </option>

                    {expenseAccounts.map(
                      (account) => (
                        <option
                          key={
                            account.id
                          }
                          value={
                            account.id
                          }
                        >
                          {account.name}
                          {account.code
                            ? ` (${account.code})`
                            : ""}
                        </option>
                      )
                    )}
                  </select>

                  {expenseAccounts.length ===
                    0 && (
                    <p className="mt-2 text-xs text-red-600">
                      No active expense
                      accounts found.
                      Create one in Chart
                      of Accounts.
                    </p>
                  )}
                </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Particulars
                  </label>

                  <input
                    type="text"
                    value={
                      particulars
                    }
                    onChange={(e) =>
                      setParticulars(
                        e.target.value
                      )
                    }
                    placeholder="Electricity bill, stationery, salary..."
                    className="w-full rounded-lg border px-3 py-2.5 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Reference / Cheque / UTR
                  </label>

                  <input
                    type="text"
                    value={
                      referenceNumber
                    }
                    onChange={(e) =>
                      setReferenceNumber(
                        e.target.value
                      )
                    }
                    placeholder="Optional reference"
                    className="w-full rounded-lg border px-3 py-2.5 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Notes
                  </label>

                  <input
                    type="text"
                    value={
                      notes
                    }
                    onChange={(e) =>
                      setNotes(
                        e.target.value
                      )
                    }
                    placeholder="Optional notes"
                    className="w-full rounded-lg border px-3 py-2.5 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* ACCOUNTING PREVIEW */}

              <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2
                    size={18}
                    className="text-blue-600"
                  />

                  <h3 className="font-semibold text-blue-900">
                    Accounting Entry
                  </h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg bg-white p-4">
                    <p className="text-xs font-semibold text-slate-500">
                      DEBIT
                    </p>

                    <p className="mt-1 font-semibold text-slate-900">
                      {paymentType ===
                      "vendor"
                        ? "Vendor Payables"
                        : payrollMode
                        ? accounts.find(
                            (account) =>
                              account.id ===
                              payrollPayableAccountId
                          )?.name ||
                            "Salary Payable"
                        : accounts.find(
                            (account) =>
                              account.id ===
                              expenseAccountId
                          )?.name ||
                            "Expense Account"}
                    </p>

                    <p className="mt-2 text-lg font-bold text-red-600">
                      {money(
                        Number(
                          (paymentType ===
                          "vendor"
                            ? vendorAmount
                            : amount) ||
                            0
                        )
                      )}
                    </p>
                  </div>

                  <div className="rounded-lg bg-white p-4">
                    <p className="text-xs font-semibold text-slate-500">
                      CREDIT
                    </p>

                    <p className="mt-1 font-semibold text-slate-900">
                      {accounts.find(
                        (account) =>
                          account.id ===
                          paidFromAccountId
                      )?.name ||
                        "Cash / Bank"}
                    </p>

                    <p className="mt-2 text-lg font-bold text-blue-600">
                      {money(
                        Number(
                          (paymentType ===
                          "vendor"
                            ? vendorAmount
                            : amount) ||
                            0
                        )
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={
                    resetForm
                  }
                  disabled={
                    saving
                  }
                  className="inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw
                    size={16}
                  />
                  Clear
                </button>

                <button
                  type="submit"
                  disabled={
                    saving ||
                    vendorPaymentSaving
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ||
                  vendorPaymentSaving ? (
                    <>
                      <Loader2
                        size={17}
                        className="animate-spin"
                      />
                      {vendorPaymentSaving
                        ? "Recording..."
                        : editingId
                          ? "Updating..."
                          : "Saving..."}
                    </>
                  ) : (
                    <>
                      {editingId ? (
                        <Pencil
                          size={17}
                        />
                      ) : (
                        <Plus
                          size={17}
                        />
                      )}

                      {paymentType ===
                      "vendor"
                        ? "Save Vendor Payment"
                        : editingId
                          ? "Update Payment"
                          : "Save Payment"}
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* =================================================
            PAYMENT HISTORY
        ================================================= */}

        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">
                Payment History
              </h2>

              <p className="text-xs text-slate-500">
                {payments.length} payments
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (schoolId) {
                  loadPayments(
                    schoolId
                  );
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
            >
              <RefreshCw
                size={15}
              />
              Refresh
            </button>
          </div>

          {payments.length ===
          0 ? (
            <div className="p-12 text-center">
              <Banknote
                size={36}
                className="mx-auto text-slate-300"
              />

              <h3 className="mt-3 font-semibold text-slate-900">
                No payments
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Saved payments will
                appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1150px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Date
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Transaction
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Particulars
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Type
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Paid From
                    </th>

                    <th className="px-5 py-3 text-right text-xs text-slate-500">
                      Amount
                    </th>

                    <th className="px-5 py-3 text-right text-xs text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {payments.map(
                    (payment) => {
                      const debitEntry =
                        payment.entries.find(
                          (entry) =>
                            Number(
                              entry.debit
                            ) > 0
                        );

                      const creditEntry =
                        payment.entries.find(
                          (entry) =>
                            Number(
                              entry.credit
                            ) > 0
                        );

                      const amountValue =
                        Number(
                          debitEntry?.debit ||
                            creditEntry?.credit ||
                            0
                        );

                      return (
                        <tr
                          key={
                            payment.id
                          }
                          className="hover:bg-slate-50"
                        >
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {
                              payment.transaction_date
                            }
                          </td>

                          <td className="px-5 py-4 font-mono text-xs">
                            {payment.transaction_number ||
                              payment.id.slice(
                                0,
                                8
                              )}
                          </td>

                          <td className="max-w-[280px] px-5 py-4 text-sm">
                            <div className="truncate">
                              {getParticulars(
                                payment.description
                              )}
                            </div>
                            <div className="mt-1 text-xs text-slate-500 truncate">
                              {payment.description
                                ? payment.description
                                    .split(" | ")
                                    .filter(
                                      (p) =>
                                        !p.startsWith("Payment method:")
                                    )
                                    .join(" | ")
                                : ""}
                            </div>
                          </td>

                          <td className="px-5 py-4 text-sm">
                            <div>
                              {debitEntry?.account_name ||
                                "-"}
                            </div>

                            <div className="mt-1 text-xs text-slate-500">
                              {(() => {
                                const debitAccount =
                                  accounts.find(
                                    (account) =>
                                      account.id ===
                                      debitEntry?.account_id,
                                  );

                                return debitAccount &&
                                  (debitAccount.account_type ===
                                    "payable" ||
                                    debitAccount.account_type ===
                                      "liability")
                                  ? "Salary Payment"
                                  : "Expense Payment";
                              })()}
                            </div>
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {creditEntry?.account_name ||
                              "-"}
                          </td>

                          <td className="px-5 py-4 text-right font-semibold text-red-600">
                            {money(
                              amountValue
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-2">
                              {/* VIEW */}

                              <button
                                type="button"
                                onClick={() =>
                                  setViewPayment(
                                    payment
                                  )
                                }
                                title="View Payment"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border text-slate-600 hover:bg-slate-50 hover:text-blue-600"
                              >
                                <Eye
                                  size={16}
                                />
                              </button>

                              {/* EDIT */}

                              <button
                                type="button"
                                onClick={() =>
                                  startEdit(
                                    payment
                                  )
                                }
                                title="Edit Payment"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border text-slate-600 hover:bg-slate-50 hover:text-amber-600"
                              >
                                <Pencil
                                  size={16}
                                />
                              </button>

                              {/* DELETE */}

                              <button
                                type="button"
                                onClick={() =>
                                  setDeletePayment(
                                    payment
                                  )
                                }
                                title="Delete Payment"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                              >
                                <Trash2
                                  size={16}
                                />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* =================================================
            VENDOR PAYMENT HISTORY
        ================================================= */}

        <section className="mt-6 overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">
                Vendor Payment History
              </h2>

              <p className="text-xs text-slate-500">
                {vendorPayments.length} vendor
                payments
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (schoolId) {
                  loadVendorData(
                    schoolId
                  );
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
            >
              <RefreshCw
                size={15}
              />
              Refresh
            </button>
          </div>

          {vendorPayments.length ===
          0 ? (
            <div className="p-12 text-center">
              <Landmark
                size={36}
                className="mx-auto text-slate-300"
              />

              <h3 className="mt-3 font-semibold text-slate-900">
                No vendor payments
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Select &ldquo;Vendor
                Payment&rdquo; above to pay a
                purchase bill.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1150px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Date
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Vendor
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Purchase Bill
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Particulars
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Paid From
                    </th>

                    <th className="px-5 py-3 text-right text-xs text-slate-500">
                      Amount
                    </th>

                    <th className="px-5 py-3 text-left text-xs text-slate-500">
                      Reference
                    </th>

                    <th className="px-5 py-3 text-right text-xs text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {vendorPayments.map(
                    (payment) => {
                      const vendor =
                        vendors.find(
                          (item) =>
                            item.id ===
                            payment.vendor_id
                        );

                      const bills =
                        Array.from(
                          new Set(
                            vendorAllocations
                              .filter(
                                (allocation) =>
                                  vendorBills.some(
                                    (bill) =>
                                      bill.id ===
                                        allocation.bill_id &&
                                      bill.vendor_id ===
                                        payment.vendor_id,
                                  ),
                              )
                              .map(
                                (allocation) =>
                                  vendorBills.find(
                                    (bill) =>
                                      bill.id ===
                                      allocation.bill_id,
                                  )?.bill_number ||
                                  "Purchase bill",
                              ),
                          ),
                        );

                      const paidFrom =
                        accounts.find(
                          (account) =>
                            account.id ===
                            payment.paid_from_account_id,
                        );

                      const particulars =
                        [
                          vendor?.name ||
                            "Vendor",
                          bills.length
                            ? bills.join(
                                ", ",
                              )
                            : null,
                          "Vendor Payment",
                        ]
                          .filter(Boolean)
                          .join(" • ");

                      return (
                        <tr
                          key={payment.id}
                          className="hover:bg-slate-50"
                        >
                          <td className="px-5 py-4 text-sm">
                            {
                              payment.payment_date
                            }
                          </td>

                          <td className="px-5 py-4 text-sm font-medium text-slate-900">
                            {vendor?.name ||
                              "Unknown vendor"}
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {bills.length
                              ? bills.join(
                                  ", ",
                                )
                              : "-"}
                          </td>

                          <td className="max-w-[260px] px-5 py-4 text-sm">
                            <div className="truncate">
                              {
                                particulars
                              }
                            </div>
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {paidFrom?.name ||
                              "-"}
                          </td>

                          <td className="px-5 py-4 text-right font-semibold text-red-600">
                            {money(
                              Number(
                                payment.amount ||
                                  0,
                              ),
                            )}
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {payment.reference_number ||
                              "-"}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  confirmDeleteVendorPayment(
                                    payment,
                                  )
                                }
                                disabled={
                                  vendorPaymentDeletingId ===
                                  payment.id
                                }
                                title="Delete Vendor Payment"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                {vendorPaymentDeletingId ===
                                payment.id ? (
                                  <Loader2
                                    size={
                                      16
                                    }
                                    className="animate-spin"
                                  />
                                ) : (
                                  <Trash2
                                    size={
                                      16
                                    }
                                  />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* =================================================
            INFO CARDS
        ================================================= */}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <InfoCard
            icon={
              <Banknote
                size={20}
              />
            }
            title="Cash Payment"
            text="Expense payment from cash credits the selected Cash account."
          />

          <InfoCard
            icon={
              <Landmark
                size={20}
              />
            }
            title="Bank Payment"
            text="Bank, UPI and other banking payments credit the selected Bank account."
          />

          <InfoCard
            icon={
              <CheckCircle2
                size={20}
              />
            }
            title="Double Entry"
            text="Every payment creates equal debit and credit entries."
          />
        </div>
      </div>

      {/* ===================================================
          VIEW PAYMENT MODAL
      =================================================== */}

      {viewPayment && (
        <ViewPaymentModal
          payment={
            viewPayment
          }
          onClose={() =>
            setViewPayment(
              null
            )
          }
        />
      )}

      {/* ===================================================
          DELETE CONFIRMATION
      =================================================== */}

      {deletePayment && (
        <DeletePaymentModal
          payment={
            deletePayment
          }
          deleting={
            deleting
          }
          onCancel={() =>
            setDeletePayment(
              null
            )
          }
          onConfirm={
            confirmDeletePayment
          }
        />
      )}
    </main>
  );
}

/*
 * =========================================================
 * VIEW PAYMENT MODAL
 * =========================================================
 */

function ViewPaymentModal({
  payment,
  onClose,
}: {
  payment: PaymentRow;
  onClose: () => void;
}) {
  const debitEntry =
    payment.entries.find(
      (entry) =>
        Number(
          entry.debit
        ) > 0
    );

  const creditEntry =
    payment.entries.find(
      (entry) =>
        Number(
          entry.credit
        ) > 0
    );

  const amount =
    Number(
      debitEntry?.debit ||
        creditEntry?.credit ||
        0
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Payment Details
            </h2>

            <p className="mt-1 font-mono text-xs text-slate-500">
              {payment.transaction_number ||
                payment.id}
            </p>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <DetailItem
              label="Payment Date"
              value={
                payment.transaction_date
              }
            />

            <DetailItem
              label="Amount"
              value={money(
                amount
              )}
            />

            <DetailItem
              label="Expense Account"
              value={
                debitEntry?.account_name ||
                "-"
              }
            />

            <DetailItem
              label="Paid From"
              value={
                creditEntry?.account_name ||
                "-"
              }
            />

            <DetailItem
              label="Reference"
              value={
                getReference(
                  payment.description
                ) || "-"
              }
            />

            <DetailItem
              label="Created"
              value={new Date(
                payment.created_at
              ).toLocaleString(
                "en-IN"
              )}
            />
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Particulars
            </p>

            <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-800">
              {getParticulars(
                payment.description
              ) || "-"}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </p>

            <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-800">
              {getNotes(
                payment.description
              ) || "-"}
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
            <h3 className="mb-4 font-semibold text-blue-900">
              Accounting Entry
            </h3>

            <div className="overflow-hidden rounded-xl border bg-white">
              <div className="grid grid-cols-3 border-b bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                <div>
                  Account
                </div>

                <div className="text-right">
                  Debit
                </div>

                <div className="text-right">
                  Credit
                </div>
              </div>

              {payment.entries.map(
                (entry) => (
                  <div
                    key={
                      entry.id
                    }
                    className="grid grid-cols-3 border-b px-4 py-3 text-sm last:border-0"
                  >
                    <div>
                      <div className="font-medium text-slate-900">
                        {
                          entry.account_name
                        }
                      </div>

                      {entry.account_code && (
                        <div className="text-xs text-slate-400">
                          {
                            entry.account_code
                          }
                        </div>
                      )}
                    </div>

                    <div className="text-right text-red-600">
                      {Number(
                        entry.debit
                      ) > 0
                        ? money(
                            entry.debit
                          )
                        : "-"}
                    </div>

                    <div className="text-right text-blue-600">
                      {Number(
                        entry.credit
                      ) > 0
                        ? money(
                            entry.credit
                          )
                        : "-"}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t px-6 py-4">
          <button
            type="button"
            onClick={
              onClose
            }
            className="rounded-lg border px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * DELETE MODAL
 * =========================================================
 */

function DeletePaymentModal({
  payment,
  deleting,
  onCancel,
  onConfirm,
}: {
  payment: PaymentRow;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const debitEntry =
    payment.entries.find(
      (entry) =>
        Number(
          entry.debit
        ) > 0
    );

  const creditEntry =
    payment.entries.find(
      (entry) =>
        Number(
          entry.credit
        ) > 0
    );

  const amount =
    Number(
      debitEntry?.debit ||
        creditEntry?.credit ||
        0
    );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            Delete Payment?
          </h2>

          <button
            type="button"
            onClick={
              onCancel
            }
            disabled={
              deleting
            }
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={19} />
          </button>
        </div>

        <div className="p-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-800">
              This action cannot be undone.
            </p>

            <p className="mt-2 text-sm leading-6 text-red-700">
              The payment transaction and
              its accounting entries will
              be deleted.
            </p>
          </div>

          <div className="mt-5 space-y-3 text-sm">
            <DetailItem
              label="Transaction"
              value={
                payment.transaction_number ||
                payment.id.slice(
                  0,
                  8
                )
              }
            />

            <DetailItem
              label="Particulars"
              value={
                getParticulars(
                  payment.description
                )
              }
            />

            <DetailItem
              label="Amount"
              value={money(
                amount
              )}
            />

            <DetailItem
              label="Paid From"
              value={
                creditEntry?.account_name ||
                "-"
              }
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={
              onCancel
            }
            disabled={
              deleting
            }
            className="rounded-lg border px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={
              onConfirm
            }
            disabled={
              deleting
            }
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? (
              <>
                <Loader2
                  size={16}
                  className="animate-spin"
                />
                Deleting...
              </>
            ) : (
              <>
                <Trash2
                  size={16}
                />
                Delete Payment
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * =========================================================
 * DETAIL ITEM
 * =========================================================
 */

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-1 break-words text-sm font-medium text-slate-900">
        {value}
      </p>
    </div>
  );
}

/*
 * =========================================================
 * INFO CARD
 * =========================================================
 */

function InfoCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        {icon}
      </div>

      <h3 className="mt-4 font-semibold text-slate-900">
        {title}
      </h3>

      <p className="mt-1 text-sm leading-6 text-slate-500">
        {text}
      </p>
    </div>
  );
}