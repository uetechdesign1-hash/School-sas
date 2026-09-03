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

    if (
      transactionRows.length === 0
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
          entryRows.map(
            (entry) =>
              entry.account_id
          )
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

    const result: PaymentRow[] =
      transactionRows.map(
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

    setPayments(result);
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
      return accounts.filter(
        (account) =>
          account.account_type ===
            "cash" ||
          account.account_type ===
            "bank"
      );
    }, [accounts]);

  const expenseAccounts =
    useMemo(() => {
      return accounts.filter(
        (account) =>
          account.account_type ===
          "expense"
      );
    }, [accounts]);


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

    setError("");
    setSuccess("");

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

    if (payrollMode) {
      if (!payrollRunId || !payrollPayableAccountId) {
        setError(
          "Payroll information is incomplete. Return to Payroll and click Prepare Salary Payment again.",
        );
        return;
      }

      const payable = accounts.find(
        (account) => account.id === payrollPayableAccountId,
      );

      if (!payable) {
        setError(
          "Salary Payable account was not found in the current school.",
        );
        return;
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

      const expectedAmount = Number(payrollRun.total_net || 0);

      if (
        expectedAmount > 0 &&
        Math.abs(expectedAmount - numericAmount) > 0.005
      ) {
        setError(
          `Payment amount ${money(
            numericAmount,
          )} does not match payroll net amount ${money(
            expectedAmount,
          )}.`,
        );
        return;
      }

      const {
        data: existingPayrollPayment,
        error: existingPayrollPaymentError,
      } = await supabase
        .from("transactions")
        .select("id, transaction_number")
        .eq("school_id", schoolId)
        .eq("transaction_type", "expense")
        .eq("reference_type", "payment")
        .eq("reference_id", payrollRunId)
        .limit(1)
        .maybeSingle();

      if (existingPayrollPaymentError) {
        setError(existingPayrollPaymentError.message);
        return;
      }

      if (existingPayrollPayment) {
        setError(
          `This payroll has already been paid${
            existingPayrollPayment.transaction_number
              ? ` — ${existingPayrollPayment.transaction_number}`
              : ""
          }.`,
        );
        return;
      }
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

    setSaving(true);

    let createdTransactionId: string | null = null;

    try {
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

      const {
        data: transaction,
        error: transactionError,
      } = await supabase
        .from("transactions")
        .insert({
          school_id: schoolId,
          transaction_date: paymentDate,
          transaction_type: "expense",
          description,
          reference_type: "payment",
          reference_id: payrollMode ? payrollRunId : null,
        })
        .select(
          `
            id,
            transaction_number,
            transaction_date,
            transaction_type,
            description,
            reference_type,
            reference_id,
            created_at
          `,
        )
        .single();

      if (transactionError) {
        throw new Error(transactionError.message);
      }

      if (!transaction) {
        throw new Error("Payment transaction was not created.");
      }

      createdTransactionId = transaction.id;

      const entries = [
        {
          school_id: schoolId,
          transaction_id: transaction.id,
          account_id: debitAccountId,
          debit: numericAmount,
          credit: 0,
          description: payrollMode
            ? `Salary payable settled - ${particulars.trim()}`
            : `Expense - ${particulars.trim()}`,
        },
        {
          school_id: schoolId,
          transaction_id: transaction.id,
          account_id: paidFromAccountId,
          debit: 0,
          credit: numericAmount,
          description: `Paid from ${paidFrom.name} - ${particulars.trim()}`,
        },
      ];

      const debitTotal = entries.reduce(
        (sum, entry) => sum + Number(entry.debit || 0),
        0,
      );

      const creditTotal = entries.reduce(
        (sum, entry) => sum + Number(entry.credit || 0),
        0,
      );

      if (Math.abs(debitTotal - creditTotal) > 0.005) {
        throw new Error("Accounting entry is not balanced.");
      }

      const { error: entriesError } = await supabase
        .from("transaction_entries")
        .insert(entries);

      if (entriesError) {
        throw new Error(
          `Accounting entries could not be created: ${entriesError.message}`,
        );
      }

      /*
       * The Expenses dashboard is backed by public.expenses.
       * Normal payments create an expense row here.
       *
       * Payroll does NOT create another expense row here because
       * payroll preparation creates the Salary Expense row.
       */
      if (!payrollMode) {
        const { data: userData } =
          await supabase.auth.getUser();

        const { error: expenseRowError } = await supabase
          .from("expenses")
          .insert({
            school_id: schoolId,
            expense_category_id: null,
            expense_date: paymentDate,
            amount: numericAmount,
            paid_from_account_id: paidFromAccountId,
            transaction_id: transaction.id,
            vendor_name: null,
            invoice_number: referenceNumber.trim() || null,
            description: particulars.trim(),
            created_by: userData.user?.id || null,
          });

        if (expenseRowError) {
          throw new Error(
            `Expense record could not be created: ${expenseRowError.message}`,
          );
        }
      }

      if (payrollMode) {
        const { data: updatedItems, error: itemError } =
          await supabase
            .from("payroll_items")
            .update({
              paid: true,
              paid_amount: numericAmount,
              status: "paid",
            })
            .eq("payroll_run_id", payrollRunId)
            .eq("school_id", schoolId)
            .select("id");

        if (itemError) {
          throw new Error(
            `Payroll items could not be marked paid: ${itemError.message}`,
          );
        }

        if (!updatedItems || updatedItems.length === 0) {
          throw new Error(
            "No payroll items were found to mark as paid.",
          );
        }

        const { data: finalizedRun, error: runUpdateError } =
          await supabase
            .from("payroll_runs")
            .update({
              status: "finalized",
              finalized_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", payrollRunId)
            .eq("school_id", schoolId)
            .eq("status", "prepared")
            .select("id, status, finalized_at")
            .maybeSingle();

        if (runUpdateError) {
          throw new Error(
            `Payroll could not be finalized: ${runUpdateError.message}`,
          );
        }

        if (!finalizedRun) {
          throw new Error(
            "Payroll could not be finalized because its status changed before payment completion.",
          );
        }

        try {
          window.sessionStorage.removeItem(
            "schoolflow_payroll_payment",
          );
        } catch {
          // Storage cleanup only.
        }

        setSuccess(
          `Salary payment completed — ${money(
            numericAmount,
          )} paid from ${paidFrom.name}. Dr ${debitAccountName} / Cr ${paidFrom.name}. Payroll is finalized.`,
        );
      } else {
        setSuccess(
          `Payment saved successfully${
            transaction.transaction_number
              ? ` — ${transaction.transaction_number}`
              : ""
          }. ${money(
            numericAmount,
          )} paid from ${paidFrom.name}.`,
        );
      }

      resetForm();
      await loadPayments(schoolId);
    } catch (err: any) {
      console.error("PAYMENT RECORDING ERROR:", err);

      if (createdTransactionId) {
        await supabase
          .from("transaction_entries")
          .delete()
          .eq("transaction_id", createdTransactionId)
          .eq("school_id", schoolId);

        await supabase
          .from("expenses")
          .delete()
          .eq("transaction_id", createdTransactionId)
          .eq("school_id", schoolId);

        await supabase
          .from("transactions")
          .delete()
          .eq("id", createdTransactionId)
          .eq("school_id", schoolId);
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
       * Verify payment belongs to
       * current school.
       */

      const {
        data: transaction,
        error:
          transactionError,
      } = await supabase
        .from("transactions")
        .select(
          "id, transaction_number"
        )
        .eq(
          "id",
          deletePayment.id
        )
        .eq(
          "school_id",
          schoolId
        )
        .eq(
          "transaction_type",
          "expense"
        )
        .eq(
          "reference_type",
          "payment"
        )
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

      /*
       * Delete transaction entries first.
       */

      const {
        error:
          deleteEntriesError,
      } = await supabase
        .from("transaction_entries")
        .delete()
        .eq(
          "transaction_id",
          transaction.id
        )
        .eq(
          "school_id",
          schoolId
        );

      if (deleteEntriesError) {
        throw new Error(
          `Payment accounting entries could not be deleted: ${deleteEntriesError.message}`
        );
      }

      /*
       * Delete transaction.
       */

      const {
        error:
          deleteTransactionError,
      } = await supabase
        .from("transactions")
        .delete()
        .eq(
          "id",
          transaction.id
        )
        .eq(
          "school_id",
          schoolId
        );

      if (
        deleteTransactionError
      ) {
        throw new Error(
          `Payment could not be deleted: ${deleteTransactionError.message}`
        );
      }

      setDeletePayment(
        null
      );

      setSuccess(
        `Payment${
          transaction.transaction_number
            ? ` ${transaction.transaction_number}`
            : ""
        } deleted successfully.`
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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
                      {payrollMode
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
                          amount ||
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
                          amount ||
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
                    saving
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2
                        size={17}
                        className="animate-spin"
                      />
                      {editingId
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

                      {editingId
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
                      Expense
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
                          </td>

                          <td className="px-5 py-4 text-sm">
                            {debitEntry?.account_name ||
                              "-"}
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