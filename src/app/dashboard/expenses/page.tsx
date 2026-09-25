/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  FileText,
  Landmark,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  deleteCanonicalJournalForSource,
  ensureSchoolAccountingSetup,
  postExpenseJournal,
  postVendorPaymentJournal,
} from "@/lib/accounting/canonical-accounting";
import {
  CASH_BANK_ACCOUNT_TYPES,
  EXPENSE_ACCOUNT_TYPES,
  filterSelectableAccountsByTypes,
} from "@/lib/accounting/account-visibility";

/*
 * =====================================================
 * FIND THE JOURNAL LINKED TO AN EXPENSE ROW
 * =====================================================
 *
 * Expense rows are journaled from two different places:
 *
 *   - the Expenses module itself posts with
 *       source_module = 'expenses' / source_table = 'expenses'
 *   - Accounting -> Payment posts salary payments with
 *       source_module = 'salary_payment' / source_table = 'salary_payments'
 *
 * Both flows pass the expense row id as source_record_id (and reference_id),
 * so the event is looked up by source_record_id ONLY - without pinning
 * source_module / source_table. That is what makes "View accounting", the
 * Edit prefill and reference preservation work for salary-payment rows
 * created for payroll on the Payment page, which previously posted to the
 * expense side of accounting but were invisible in this module.
 */
type ExpenseJournalEvent = {
  id: string;
  journal_entry_id: string;
  source_module: string | null;
  source_table: string | null;
};

async function findExpenseJournalEvent(
  supabase: ReturnType<typeof createClient>,
  schoolId: string,
  expenseId: string,
): Promise<ExpenseJournalEvent | null> {
  const { data, error } = await supabase
    .from("accounting_events")
    .select("id, journal_entry_id, source_module, source_table")
    .eq("school_id", schoolId)
    .eq("source_record_id", expenseId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ExpenseJournalEvent | null;
}

type Vendor = {
  id: string;
  school_id: string;
  name: string;
};

type VendorPayment = {
  id: string;
  school_id: string;
  vendor_id: string;
  payment_date: string;
  amount: number;
  paid_from_account_id: string | null;
  reference_number: string | null;
  notes: string | null;
  journal_entry_id: string | null;
  created_at: string;
};

type Allocation = {
  id: string;
  payment_id: string;
  bill_id: string;
  amount: number;
};

type PurchaseBill = {
  id: string;
  vendor_id: string;
  bill_number: string | null;
  bill_date: string;
  due_date: string | null;
  total_amount: number;
};

type PurchaseReturnRow = {
  id: string;
  bill_id: string;
  total_amount: number;
};

type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type: string;
  is_active: boolean;
};

type Expense = {
  id: string;
  school_id: string;
  expense_date: string;
  amount: number;
  paid_from_account_id: string | null;
  transaction_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  description: string | null;
  created_at: string;
};

type Entry = {
  id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
};

type Txn = {
  id: string;
  transaction_number: string | null;
  transaction_date: string;
  transaction_type: string;
  description: string | null;
};

const DIGI_SCHOOL_ID = "54ab324b-a707-4516-9b33-6721d97163ec";

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

function money(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

function dateText(v: string) {
  if (!v) return "-";

  const d = new Date(`${v}T00:00:00`);

  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function monthText(v: string) {
  if (!v) return "";

  const [y, m] = v.split("-");

  return new Date(
    Number(y),
    Number(m) - 1,
    1,
  ).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function csv(v: unknown) {
  const s = String(v ?? "");

  return /[",\n]/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export default function ExpensesPage() {
  const supabase = useMemo(() => createClient(), []);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState("School");

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorPayments, setVendorPayments] = useState<VendorPayment[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturnRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("");

  const [showAdd, setShowAdd] = useState(false);

  const [addDate, setAddDate] = useState(today());
  const [addExpenseAccount, setAddExpenseAccount] = useState("");
  const [addPaidFrom, setAddPaidFrom] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addVendor, setAddVendor] = useState("");
  const [addInvoice, setAddInvoice] = useState("");
  const [addDescription, setAddDescription] = useState("");

  const [savingExpense, setSavingExpense] = useState(false);

  const [viewExpense, setViewExpense] = useState<Expense | null>(null);
  const [viewTxn, setViewTxn] = useState<Txn | null>(null);
  const [viewEntries, setViewEntries] = useState<Entry[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  const [vendorPayablesAccountId, setVendorPayablesAccountId] = useState("");
  const [showVendorPaymentModal, setShowVendorPaymentModal] = useState(false);
  const [editVendorPayment, setEditVendorPayment] = useState<VendorPayment | null>(null);
  const [vpVendorId, setVpVendorId] = useState("");
  const [vpDate, setVpDate] = useState(today());
  const [vpAmount, setVpAmount] = useState("");
  const [vpPaidFrom, setVpPaidFrom] = useState("");
  const [vpReference, setVpReference] = useState("");
  const [vpNotes, setVpNotes] = useState("");
  const [savingVendorPayment, setSavingVendorPayment] = useState(false);
  const [deleteVendorTarget, setDeleteVendorTarget] = useState<VendorPayment | null>(null);
  const [deletingVendor, setDeletingVendor] = useState(false);
  const [viewVendorPayment, setViewVendorPayment] = useState<VendorPayment | null>(null);

  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editPaidFrom, setEditPaidFrom] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editVendor, setEditVendor] = useState("");
  const [editInvoice, setEditInvoice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editExpenseAccount, setEditExpenseAccount] = useState("");

  const [savingEdit, setSavingEdit] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function getSchool() {
    const { data: auth, error: authError } =
      await supabase.auth.getUser();

    if (authError) throw authError;

    if (!auth.user) {
      window.location.assign("/login");
      throw new Error("Please log in again.");
    }

    const { data: rpcId, error: rpcError } =
      await supabase.rpc("get_my_school_id");

    if (!rpcError && rpcId) {
      return String(rpcId);
    }

    const { data, error } = await supabase
      .from("school_users")
      .select("school_id")
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data?.school_id) {
      throw new Error("No active school found.");
    }

    return String(data.school_id);
  }

  async function loadData(
    id: string,
    selectedMonth = month,
  ) {
    const [y, m] = selectedMonth.split("-");

    const start = `${y}-${m}-01`;

    const next =
      Number(m) === 12
        ? `${Number(y) + 1}-01-01`
        : `${y}-${String(
            Number(m) + 1,
          ).padStart(2, "0")}-01`;

    const [
      schoolRes,
      accountRes,
      expenseRes,
      vendorRes,
      paymentRes,
      billRes,
      allocRes,
      returnRes,
    ] = await Promise.all([
      supabase
        .from("schools")
        .select("id,name")
        .eq("id", id)
        .maybeSingle(),

      supabase
        .from("accounts")
        .select(
          "id,school_id,code,name,account_type,is_active",
        )
        .eq("school_id", id)
        .eq("is_active", true)
        .order("name"),

      supabase
        .from("expenses")
        .select(
          "id,school_id,expense_date,amount,paid_from_account_id,transaction_id,vendor_name,invoice_number,description,created_at",
        )
        .eq("school_id", id)
        .gte("expense_date", start)
        .lt("expense_date", next)
        .order("expense_date", {
          ascending: false,
        })
        .order("created_at", {
          ascending: false,
        }),

      supabase
        .from("vendors")
        .select("id,school_id,name")
        .eq("school_id", id)
        .order("name"),

      supabase
        .from("vendor_payments")
        .select(
          "id,school_id,vendor_id,payment_date,amount,paid_from_account_id,reference_number,notes,journal_entry_id,created_at",
        )
        .eq("school_id", id)
        .gte("payment_date", start)
        .lt("payment_date", next)
        .order("payment_date", {
          ascending: false,
        })
        .order("created_at", {
          ascending: false,
        }),

      supabase
        .from("purchase_bills")
        .select("id,vendor_id,bill_number,bill_date,due_date,total_amount")
        .eq("school_id", id),

      supabase
        .from("bill_payment_allocations")
        .select("id,payment_id,bill_id,amount")
        .eq("school_id", id),

      supabase
        .from("purchase_returns")
        .select("id,bill_id,total_amount")
        .eq("school_id", id),
    ]);

    if (schoolRes.error) throw schoolRes.error;
    if (accountRes.error) throw accountRes.error;
    if (expenseRes.error) throw expenseRes.error;
    if (vendorRes.error) throw vendorRes.error;
    if (paymentRes.error) throw paymentRes.error;
    if (billRes.error) throw billRes.error;
    if (allocRes.error) throw allocRes.error;
    if (returnRes.error) throw returnRes.error;

    setSchoolName(
      schoolRes.data?.name || "School",
    );

    setAccounts(
      (accountRes.data || []) as Account[],
    );

    setExpenses(
      (expenseRes.data || []) as Expense[],
    );

    setVendors(
      (vendorRes.data || []) as Vendor[],
    );

    setVendorPayments(
      (paymentRes.data || []) as VendorPayment[],
    );

    setBills(
      (billRes.data || []) as PurchaseBill[],
    );

    setAllocations(
      (allocRes.data || []) as Allocation[],
    );

    setPurchaseReturns(
      (returnRes.data || []) as PurchaseReturnRow[],
    );

    const setup = await ensureSchoolAccountingSetup(supabase, id);

    setVendorPayablesAccountId(
      (setup.accountMap as Record<string, string> | undefined)?.VENDOR_PAYABLES || "",
    );
  }

  async function refresh(first = false) {
    try {
      if (first) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError("");

      const id =
        schoolId || (await getSchool());

      setSchoolId(id);

      await loadData(id);
    } catch (e: any) {
      console.error(e);
      setError(
        e?.message ||
          "Unable to load Expenses.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vendorMap = useMemo(
    () =>
      new Map(
        vendors.map((x) => [
          x.id,
          x,
        ]),
      ),
    [vendors],
  );

  const billMap = useMemo(
    () =>
      new Map(
        bills.map((x) => [
          x.id,
          x,
        ]),
      ),
    [bills],
  );

  const allocationTotalByPayment = useMemo(() => {
    const map = new Map<string, number>();

    for (const a of allocations) {
      map.set(
        a.payment_id,
        round2((map.get(a.payment_id) || 0) + Number(a.amount || 0)),
      );
    }

    return map;
  }, [allocations]);

  const billBalanceById = useMemo(() => {
    const paid = new Map<string, number>();
    const returned = new Map<string, number>();

    for (const a of allocations) {
      paid.set(
        a.bill_id,
        round2((paid.get(a.bill_id) || 0) + Number(a.amount || 0)),
      );
    }

    for (const r of purchaseReturns) {
      returned.set(
        r.bill_id,
        round2((returned.get(r.bill_id) || 0) + Number(r.total_amount || 0)),
      );
    }

    const map = new Map<string, {
      paid: number;
      returned: number;
      outstanding: number;
    }>();

    for (const b of bills) {
      const p = paid.get(b.id) || 0;
      const ret = returned.get(b.id) || 0;

      map.set(b.id, {
        paid: p,
        returned: ret,
        outstanding: round2(Number(b.total_amount || 0) - p - ret),
      });
    }

    return map;
  }, [bills, allocations, purchaseReturns]);

  const accountMap = useMemo(
    () =>
      new Map(
        accounts.map((x) => [
          x.id,
          x,
        ]),
      ),
    [accounts],
  );

  const expenseAccounts = useMemo(
    () =>
      filterSelectableAccountsByTypes(
        accounts,
        EXPENSE_ACCOUNT_TYPES,
      ),
    [accounts],
  );

  const paidAccounts = useMemo(
    () =>
      filterSelectableAccountsByTypes(accounts, [
        ...CASH_BANK_ACCOUNT_TYPES,
        "asset",
      ]),
    [accounts],
  );

  const filtered = useMemo(() => {
    const q =
      search.trim().toLowerCase();

    return expenses.filter((e) => {
      const accOk =
        !accountFilter ||
        e.paid_from_account_id ===
          accountFilter;

      if (!accOk) {
        return false;
      }

      if (!q) return true;

      return [
        e.vendor_name,
        e.invoice_number,
        e.description,
        e.expense_date,
        e.paid_from_account_id
          ? accountMap.get(
              e.paid_from_account_id,
            )?.name
          : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [
    expenses,
    search,
    accountFilter,
    accountMap,
  ]);

  const filteredVendorPayments = useMemo(() => {
    const q =
      search.trim().toLowerCase();

    return vendorPayments.filter((p) => {
      const accOk =
        !accountFilter ||
        p.paid_from_account_id ===
          accountFilter;

      if (!accOk) {
        return false;
      }

      if (!q) return true;

      const billNumbers = allocations
        .filter((a) => a.payment_id === p.id)
        .map((a) => billMap.get(a.bill_id)?.bill_number || "")
        .join(" ");

      return [
        vendorMap.get(p.vendor_id)?.name || "",
        billNumbers,
        p.reference_number,
        p.notes,
        p.payment_date,
        p.paid_from_account_id
          ? accountMap.get(
              p.paid_from_account_id,
            )?.name
          : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [
    vendorPayments,
    search,
    accountFilter,
    accountMap,
    allocations,
    billMap,
    vendorMap,
  ]);

  const totals = useMemo(() => {
    let total = 0;
    let cash = 0;
    let bank = 0;
    let other = 0;

    const add = (amount: number, paidFromId: string | null) => {
      const a = Number(amount || 0);

      total += a;

      const type = paidFromId
        ? accountMap.get(
            paidFromId,
          )?.account_type
        : "";

      if (type === "cash") {
        cash += a;
      } else if (type === "bank") {
        bank += a;
      } else {
        other += a;
      }
    };

    for (const e of filtered) {
      add(Number(e.amount || 0), e.paid_from_account_id);
    }

    for (const p of filteredVendorPayments) {
      add(Number(p.amount || 0), p.paid_from_account_id);
    }

    return {
      total,
      cash,
      bank,
      other,
    };
  }, [filtered, filteredVendorPayments, accountMap]);

  async function changeMonth(
    value: string,
  ) {
    setMonth(value);

    if (!schoolId) return;

    try {
      setRefreshing(true);

      await loadData(
        schoolId,
        value,
      );
    } catch (e: any) {
      setError(
        e?.message ||
          "Unable to load month.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  function resetAdd() {
    setAddDate(today());
    setAddExpenseAccount("");
    setAddPaidFrom("");
    setAddAmount("");
    setAddVendor("");
    setAddInvoice("");
    setAddDescription("");
  }

  function resetVendorPaymentForm() {
    setEditVendorPayment(null);
    setVpVendorId("");
    setVpDate(today());
    setVpAmount("");
    setVpPaidFrom("");
    setVpReference("");
    setVpNotes("");
  }

  /*
   * Vendor payment outstanding uses the same canonical formula as the
   * Payment and Vendor Purchases pages:
   *   bill total - allocations - purchase returns
   * When an existing payment is being edited, its own allocations are
   * released back first so the preview and FIFO allocation agree.
   */
  function vendorOutstandingExcluding(
    vendorId: string,
    excludePaymentId = "",
  ) {
    const reclaim = new Map<string, number>();

    if (excludePaymentId) {
      for (const a of allocations) {
        if (a.payment_id !== excludePaymentId) continue;

        reclaim.set(
          a.bill_id,
          round2((reclaim.get(a.bill_id) || 0) + Number(a.amount || 0)),
        );
      }
    }

    let total = 0;

    for (const b of bills) {
      if (b.vendor_id !== vendorId) continue;

      const balance = billBalanceById.get(b.id);
      const locked = balance
        ? balance.outstanding
        : Number(b.total_amount || 0);

      total = round2(total + locked + (reclaim.get(b.id) || 0));
    }

    return round2(total);
  }

  function oldestOutstandingBills(
    vendorId: string,
    excludePaymentId = "",
  ) {
    const reclaim = new Map<string, number>();

    if (excludePaymentId) {
      for (const a of allocations) {
        if (a.payment_id !== excludePaymentId) continue;

        reclaim.set(
          a.bill_id,
          round2((reclaim.get(a.bill_id) || 0) + Number(a.amount || 0)),
        );
      }
    }

    return bills
      .filter((b) => b.vendor_id === vendorId)
      .map((b) => {
        const balance = billBalanceById.get(b.id);
        const locked = balance
          ? balance.outstanding
          : Number(b.total_amount || 0);

        return {
          ...b,
          outstanding: round2(locked + (reclaim.get(b.id) || 0)),
        };
      })
      .filter((b) => b.outstanding > 0.009)
      .sort((a, b) =>
        (a.due_date || a.bill_date).localeCompare(
          b.due_date || b.bill_date,
        ),
      );
  }

  function openAddVendorPayment() {
    resetVendorPaymentForm();

    const cash = paidAccounts.find(
      (a) =>
        String(a.account_type || "").trim().toLowerCase() ===
        "cash",
    );

    if (cash) {
      setVpPaidFrom(cash.id);
    }

    setError("");
    setSuccess("");
  }

  function openEditVendorPayment(payment: VendorPayment) {
    setEditVendorPayment(payment);
    setVpVendorId(payment.vendor_id);
    setVpDate(payment.payment_date);
    setVpAmount(String(Number(payment.amount || 0)));
    setVpPaidFrom(payment.paid_from_account_id || "");
    setVpReference(payment.reference_number || "");
    setVpNotes(payment.notes || "");
    setError("");
    setSuccess("");
  }

  async function saveVendorPayment() {
    if (!schoolId) return;

    try {
      setSavingVendorPayment(true);
      setError("");

      if (!vpVendorId) throw new Error("Select the vendor being paid.");
      if (!vpDate) throw new Error("Select the payment date.");

      const amount = round2(Number(vpAmount || 0));

      if (!(amount > 0)) {
        throw new Error("Enter a payment amount greater than zero.");
      }

      if (!vpPaidFrom) {
        throw new Error(
          "Select the Cash or Bank account the payment leaves from.",
        );
      }

      const editing = editVendorPayment;
      const available = vendorOutstandingExcluding(
        vpVendorId,
        editing?.id || "",
      );

      if (!(available > 0)) {
        throw new Error(
          "This vendor has no outstanding bills to allocate payment to.",
        );
      }

      if (amount > round2(available + 0.009)) {
        throw new Error(
          `Payment exceeds the outstanding payable of ${money(available)}.`,
        );
      }

      if (!vendorPayablesAccountId) {
        throw new Error(
          "The Vendor Payables account is missing. Please run accounting setup first.",
        );
      }

      const user =
        (await supabase.auth.getUser()).data.user?.id || null;

      const payload = {
        vendor_id: vpVendorId,
        payment_date: vpDate,
        amount,
        paid_from_account_id: vpPaidFrom,
        reference_number: vpReference.trim() || null,
        notes: vpNotes.trim() || null,
      };

      let paymentId = editing?.id || "";

      if (editing) {
        const { error: updateError } = await supabase
          .from("vendor_payments")
          .update(payload)
          .eq("id", editing.id)
          .eq("school_id", schoolId);

        if (updateError) throw updateError;

        // Release the old allocations so the new amount is applied
        // oldest first all over again.
        const { error: clearAllocationsError } = await supabase
          .from("bill_payment_allocations")
          .delete()
          .eq("payment_id", editing.id)
          .eq("school_id", schoolId);

        if (clearAllocationsError) throw clearAllocationsError;
      } else {
        const { data: payment, error: paymentError } = await supabase
          .from("vendor_payments")
          .insert({
            school_id: schoolId,
            ...payload,
            created_by: user,
          })
          .select("id")
          .single();

        if (paymentError) throw paymentError;

        if (!payment?.id) {
          throw new Error("Vendor payment was not created.");
        }

        paymentId = payment.id;
      }

      // Automatic FIFO allocation: oldest outstanding bills first.
      let remaining = amount;
      const allocationRows: {
        school_id: string;
        payment_id: string;
        bill_id: string;
        amount: number;
      }[] = [];

      for (const bill of oldestOutstandingBills(
        vpVendorId,
        editing?.id || "",
      )) {
        if (remaining <= 0.009) break;

        const take = round2(
          Math.min(remaining, bill.outstanding),
        );

        if (!(take > 0)) continue;

        allocationRows.push({
          school_id: schoolId,
          payment_id: paymentId,
          bill_id: bill.id,
          amount: take,
        });

        remaining = round2(remaining - take);
      }

      if (allocationRows.length > 0) {
        const { error: allocError } = await supabase
          .from("bill_payment_allocations")
          .insert(allocationRows);

        if (allocError) throw allocError;
      }

      const setup = await ensureSchoolAccountingSetup(
        supabase,
        schoolId,
      );

      /*
       * Re-post the ONE canonical journal entry (Dr Vendor Payables /
       * Cr Cash-Bank) so the Cash Book, Bank Book, Ledger and reports
       * reflect the corrected values while leaving a single posting.
       */
      if (editing?.journal_entry_id) {
        await deleteCanonicalJournalForSource(supabase, {
          schoolId,
          sourceRecordId: editing.id,
          sourceModule: "vendor_purchases",
          sourceTable: "vendor_payments",
          journalEntryIds: [editing.journal_entry_id],
        });
      }

      const posted = await postVendorPaymentJournal(supabase, {
        schoolId,
        fiscalYearId: setup.fiscalYearId,
        entryDate: vpDate,
        sourceRecordId: paymentId,
        vendorPayablesAccountId,
        paymentAccountId: vpPaidFrom,
        amount,
        createdBy: user,
        vendorName: vendorMap.get(vpVendorId)?.name || null,
        paymentReference: vpReference.trim() || null,
        paymentNotes: vpNotes.trim() || null,
      });

      await supabase
        .from("vendor_payments")
        .update({
          journal_entry_id: posted?.journalEntryId || null,
        })
        .eq("id", paymentId)
        .eq("school_id", schoolId);

      resetVendorPaymentForm();

      setSuccess(
        editing
          ? `Vendor payment of ${money(amount)} updated and re-allocated across ${allocationRows.length} bill(s). The accounting entry was re-posted.`
          : `Vendor payment of ${money(amount)} recorded and allocated across ${allocationRows.length} bill(s). Dr Vendor Payables / Cr Cash-Bank posted.`,
      );

      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to record vendor payment.");
    } finally {
      setSavingVendorPayment(false);
    }
  }

  /*
   * Vendor payment delete: reverses the canonical journal entry (Cash Book,
   * Bank Book, Ledger, Balance Sheet, Trial Balance stop showing it) and
   * removes the payment row. The bill_payment_allocations rows cascade with
   * the payment, so vendor outstanding is restored everywhere.
   */
  async function deleteVendorPayment() {
    if (!schoolId || !deleteVendorTarget) return;

    try {
      setDeletingVendor(true);
      setError("");

      if (deleteVendorTarget.journal_entry_id) {
        await deleteCanonicalJournalForSource(supabase, {
          schoolId,
          sourceRecordId: deleteVendorTarget.id,
          sourceModule: "vendor_purchases",
          sourceTable: "vendor_payments",
          journalEntryIds: [deleteVendorTarget.journal_entry_id],
        });
      }

      const { error: paymentError } = await supabase
        .from("vendor_payments")
        .delete()
        .eq("id", deleteVendorTarget.id)
        .eq("school_id", schoolId);

      if (paymentError) throw paymentError;

      setDeleteVendorTarget(null);

      setSuccess(
        "Vendor payment, its allocations and its accounting entry deleted. Bill outstanding restored.",
      );

      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Unable to delete vendor payment.");
    } finally {
      setDeletingVendor(false);
    }
  }

  async function createExpense() {
    if (!schoolId) return;

    const amount =
      Number(addAmount);

    if (
      !addDate ||
      !addExpenseAccount ||
      !addPaidFrom
    ) {
      setError(
        "Date, expense account and paid-from account are required.",
      );
      return;
    }

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setError(
        "Enter a valid expense amount.",
      );
      return;
    }

    if (
      addExpenseAccount ===
      addPaidFrom
    ) {
      setError(
        "Expense account and paid-from account cannot be the same.",
      );
      return;
    }

    const expenseAccount =
      accountMap.get(
        addExpenseAccount,
      );

    const paidAccount =
      accountMap.get(
        addPaidFrom,
      );

    if (
      !expenseAccount ||
      expenseAccount.account_type
        .trim()
        .toLowerCase() !==
        "expense"
    ) {
      setError(
        "Select a valid Expense account.",
      );
      return;
    }

    if (!paidAccount) {
      setError(
        "Select a valid Cash/Bank account.",
      );
      return;
    }

    try {
      setSavingExpense(true);
      setError("");
      setSuccess("");

      const description =
        addVendor.trim()
          ? `Expense - ${addVendor.trim()}`
          : "Expense";

      const {
        data: insertedExpense,
        error: expenseError,
      } = await supabase
        .from("expenses")
        .insert({
          school_id: schoolId,
          expense_date: addDate,
          amount,
          paid_from_account_id:
            addPaidFrom,
          /*
           * Canonical accounting only: the journal entry is the accounting
           * effect, so no legacy transaction is created here. transaction_id
           * stays null to keep the legacy table out of this event.
           */
          transaction_id: null,
          vendor_name:
            addVendor.trim() || null,
          invoice_number:
            addInvoice.trim() || null,
          description:
            addDescription.trim() ||
            null,
          created_by:
            (
              await supabase.auth.getUser()
            ).data.user?.id ||
            null,
        })
        .select("id")
        .single();

      if (expenseError) {
        throw expenseError;
      }

      if (!insertedExpense?.id) {
        throw new Error(
          "Expense record was not created.",
        );
      }

      const setup =
        await ensureSchoolAccountingSetup(
          supabase,
          schoolId,
        );

      /*
       * Exactly ONE canonical journal entry per expense, linked to the expense
       * record through source_record_id / reference_id. The Cash Book, Bank
       * Book, Ledger, Trial Balance and reports all read this one posting.
       */
      await postExpenseJournal(
        supabase,
        {
          schoolId,
          fiscalYearId:
            setup.fiscalYearId,
          entryDate: addDate,
          sourceRecordId:
            insertedExpense.id,
          expenseAccountId:
            addExpenseAccount,
          paymentAccountId:
            addPaidFrom,
          amount,
          createdBy:
            (
              await supabase.auth.getUser()
            ).data.user?.id ||
            null,
          vendorName:
            addVendor.trim() || null,
          expenseDescription:
            addDescription.trim() || null,
          invoiceNumber:
            addInvoice.trim() || null,
          entryDescription: description,
        },
      );

      setShowAdd(false);
      resetAdd();

      setSuccess(
        "Expense recorded and canonical accounting entry created.",
      );

      await loadData(schoolId);
    } catch (e: any) {
      console.error(e);

      setError(
        e?.message ||
          "Unable to create expense.",
      );
    } finally {
      setSavingExpense(false);
    }
  }

  async function openView(
    expense: Expense,
  ) {
    setViewExpense(expense);
    setViewTxn(null);
    setViewEntries([]);

    try {
      setViewLoading(true);

      if (expense.transaction_id) {
        const [
          txnRes,
          entryRes,
        ] = await Promise.all([
          supabase
            .from("transactions")
            .select(
              "id,transaction_number,transaction_date,transaction_type,description",
            )
            .eq(
              "id",
              expense.transaction_id,
            )
            .eq(
              "school_id",
              expense.school_id,
            )
            .maybeSingle(),

          supabase
            .from("transaction_entries")
            .select(
              "id,account_id,debit,credit,description",
            )
            .eq(
              "transaction_id",
              expense.transaction_id,
            )
            .eq(
              "school_id",
              expense.school_id,
            )
            .order("created_at"),
        ]);

        if (txnRes.error) {
          throw txnRes.error;
        }

        if (entryRes.error) {
          throw entryRes.error;
        }

        setViewTxn(
          (txnRes.data ||
            null) as Txn | null,
        );

        setViewEntries(
          (entryRes.data ||
            []) as Entry[],
        );

        return;
      }

      /*
       * Canonical-only expense: read the accounting from the journal entry
       * linked to this expense through accounting_events / source_record_id.
       * The lookup is not limited to source_module = 'expenses', so rows
       * journaled by the Payment page (salary payments) resolve as well.
       */
      const event = await findExpenseJournalEvent(
        supabase,
        expense.school_id,
        expense.id,
      );

      if (!event?.journal_entry_id) {
        return;
      }

      const [entryRes, lineRes] =
        await Promise.all([
          supabase
            .from("journal_entries")
            .select(
              "id,entry_number,entry_date,entry_type,description",
            )
            .eq("id", event.journal_entry_id)
            .eq("school_id", expense.school_id)
            .maybeSingle(),

          supabase
            .from("journal_lines")
            .select(
              "id,journal_entry_id,account_id,debit,credit,description",
            )
            .eq(
              "journal_entry_id",
              event.journal_entry_id,
            )
            .eq("school_id", expense.school_id)
            .order("debit", {
              ascending: false,
            }),
        ]);

      if (entryRes.error) {
        throw entryRes.error;
      }

      if (lineRes.error) {
        throw lineRes.error;
      }

      setViewTxn(
        (entryRes.data ||
          null) as unknown as Txn | null,
      );

      setViewEntries(
        (lineRes.data ||
          []) as unknown as Entry[],
      );
    } catch (e: any) {
      setError(
        e?.message ||
          "Unable to load accounting details.",
      );
    } finally {
      setViewLoading(false);
    }
  }

  async function openEdit(
    expense: Expense,
  ) {
    setEditExpense(expense);
    setEditPaidFrom(
      expense.paid_from_account_id ||
        "",
    );
    setEditAmount(
      String(
        Number(
          expense.amount || 0,
        ),
      ),
    );
    setEditDate(
      expense.expense_date,
    );
    setEditVendor(
      expense.vendor_name || "",
    );
    setEditInvoice(
      expense.invoice_number || "",
    );
    setEditDescription(
      expense.description || "",
    );
    setEditExpenseAccount("");

    if (expense.transaction_id) {
      const {
        data,
        error,
      } = await supabase
        .from("transaction_entries")
        .select(
          "account_id,debit,credit",
        )
        .eq(
          "transaction_id",
          expense.transaction_id,
        )
        .eq(
          "school_id",
          expense.school_id,
        );

      if (!error) {
        const debit =
          (data || []).find(
            (x: any) =>
              Number(
                x.debit || 0,
              ) > 0 &&
              Number(
                x.credit || 0,
              ) === 0,
          );

        if (debit) {
          setEditExpenseAccount(
            debit.account_id,
          );
        }
      }

      return;
    }

    /*
     * Canonical-only expense: prefill the expense account from the
     * canonical journal lines linked through accounting_events. Works for
     * salary-payment rows too (their journal is posted by the Payment page,
     * not by this module), so Edit can never be blocked by an empty account.
     */
    const event = await findExpenseJournalEvent(
      supabase,
      expense.school_id,
      expense.id,
    );

    if (!event?.journal_entry_id) {
      return;
    }

    const {
      data: lines,
      error: linesError,
    } = await supabase
      .from("journal_lines")
      .select("account_id,debit,credit")
      .eq("journal_entry_id", event.journal_entry_id)
      .eq("school_id", expense.school_id);

    if (linesError || !lines) {
      return;
    }

    const debit = lines.find(
      (x: any) =>
        Number(x.debit || 0) > 0 &&
        Number(x.credit || 0) === 0,
    );

    if (debit) {
      setEditExpenseAccount(debit.account_id);
    }
  }

  async function saveEdit() {
    if (
      !schoolId ||
      !editExpense
    ) {
      return;
    }

    const amount =
      Number(editAmount);

    if (
      !editDate ||
      !editExpenseAccount ||
      !editPaidFrom
    ) {
      setError(
        "Date, expense account and paid-from account are required.",
      );
      return;
    }

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setError(
        "Enter a valid amount.",
      );
      return;
    }

    if (
      editExpenseAccount ===
      editPaidFrom
    ) {
      setError(
        "Expense account and paid-from account cannot be the same.",
      );
      return;
    }

    try {
      setSavingEdit(true);
      setError("");

      const {
        error: expenseError,
      } = await supabase
        .from("expenses")
        .update({
          expense_date: editDate,
          amount,
          paid_from_account_id:
            editPaidFrom,
          vendor_name:
            editVendor.trim() ||
            null,
          invoice_number:
            editInvoice.trim() ||
            null,
          description:
            editDescription.trim() ||
            null,
        })
        .eq(
          "id",
          editExpense.id,
        )
        .eq(
          "school_id",
          schoolId,
        );

      if (expenseError) {
        throw expenseError;
      }

      /*
       * Re-post the canonical accounting for the edited expense: reverse the
       * previous journal entry and create the new one. This keeps the Cash
       * Book, Bank Book, Ledger and reports in step with the edited amount,
       * date, accounts and particulars while still leaving ONE posting.
       *
       * The journal's reference_type is preserved so an expense created by
       * the Payment page (reference_type = "payment") keeps appearing in the
       * Payment history after being edited here.
       */
      const existingEvent = await findExpenseJournalEvent(
        supabase,
        schoolId,
        editExpense.id,
      );

      let referenceType =
        "expense";

      if (existingEvent?.journal_entry_id) {
        const {
          data: existingEntry,
        } = await supabase
          .from("journal_entries")
          .select("reference_type")
          .eq(
            "id",
            existingEvent.journal_entry_id,
          )
          .eq("school_id", schoolId)
          .maybeSingle();

        referenceType =
          existingEntry?.reference_type ||
          "expense";
      }

      await deleteCanonicalJournalForSource(
        supabase,
        {
          schoolId,
          sourceRecordId:
            editExpense.id,
          legacyTransactionId:
            editExpense.transaction_id,
          sourceModule: "expenses",
          sourceTable: "expenses",
        },
      );

      const setup =
        await ensureSchoolAccountingSetup(
          supabase,
          schoolId,
        );

      const editedDescription =
        editDescription.trim() ||
        (editVendor.trim()
          ? `Expense - ${editVendor.trim()}`
          : "Expense");

      await postExpenseJournal(
        supabase,
        {
          schoolId,
          fiscalYearId:
            setup.fiscalYearId,
          entryDate: editDate,
          sourceRecordId:
            editExpense.id,
          expenseAccountId:
            editExpenseAccount,
          paymentAccountId:
            editPaidFrom,
          amount,
          createdBy:
            (
              await supabase.auth.getUser()
            ).data.user?.id ||
            null,
          vendorName:
            editVendor.trim() || null,
          expenseDescription:
            editedDescription,
          invoiceNumber:
            editInvoice.trim() || null,
          entryDescription:
            editedDescription,
          referenceType,
        },
      );

      if (editExpense.transaction_id) {
        const description =
          editVendor.trim()
            ? `Expense - ${editVendor.trim()}`
            : "Expense";

        const {
          error: txnError,
        } = await supabase
          .from("transactions")
          .update({
            transaction_date:
              editDate,
            description,
          })
          .eq(
            "id",
            editExpense.transaction_id,
          )
          .eq(
            "school_id",
            schoolId,
          );

        if (txnError) {
          throw txnError;
        }

        const {
          data: entries,
          error: entriesError,
        } = await supabase
          .from(
            "transaction_entries",
          )
          .select(
            "id,debit,credit",
          )
          .eq(
            "transaction_id",
            editExpense.transaction_id,
          )
          .eq(
            "school_id",
            schoolId,
          )
          .order("created_at");

        if (entriesError) {
          throw entriesError;
        }

        const debit =
          (entries || []).find(
            (x: any) =>
              Number(
                x.debit || 0,
              ) > 0 &&
              Number(
                x.credit || 0,
              ) === 0,
          );

        const credit =
          (entries || []).find(
            (x: any) =>
              Number(
                x.credit || 0,
              ) > 0 &&
              Number(
                x.debit || 0,
              ) === 0,
          );

        if (!debit || !credit) {
          throw new Error(
            "Linked accounting transaction is not a normal expense journal.",
          );
        }

        const {
          error: dErr,
        } = await supabase
          .from(
            "transaction_entries",
          )
          .update({
            account_id:
              editExpenseAccount,
            debit: amount,
            credit: 0,
            description:
              editedDescription,
          })
          .eq(
            "id",
            debit.id,
          )
          .eq(
            "school_id",
            schoolId,
          );

        if (dErr) {
          throw dErr;
        }

        const paid =
          accountMap.get(
            editPaidFrom,
          );

        const {
          error: cErr,
        } = await supabase
          .from(
            "transaction_entries",
          )
          .update({
            account_id:
              editPaidFrom,
            debit: 0,
            credit: amount,
            description: `Paid from ${
              paid?.name ||
              "account"
            }`,
          })
          .eq(
            "id",
            credit.id,
          )
          .eq(
            "school_id",
            schoolId,
          );

        if (cErr) {
          throw cErr;
        }
      }

      setEditExpense(null);

      setSuccess(
        "Expense and accounting transaction updated.",
      );

      await loadData(
        schoolId,
      );
    } catch (e: any) {
      setError(
        e?.message ||
          "Unable to update expense.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteExpense() {
    if (
      !schoolId ||
      !deleteTarget
    ) {
      return;
    }

    try {
      setDeleting(true);
      setError("");

      if (
        deleteTarget.transaction_id
      ) {
        const {
          data: txn,
          error:
            txnReadError,
        } = await supabase
          .from("transactions")
          .select(
            "id,reference_type",
          )
          .eq(
            "id",
            deleteTarget.transaction_id,
          )
          .eq(
            "school_id",
            schoolId,
          )
          .maybeSingle();

        if (txnReadError) {
          throw txnReadError;
        }

        if (
          txn?.reference_type ===
          "payroll"
        ) {
          throw new Error(
            "Payroll-linked expenses cannot be deleted here.",
          );
        }
      }

      /*
       * Salary payments recorded from Accounting -> Payment create an expense
       * row whose journal posts Dr Salary Payable / Cr Cash-Bank
       * (source_module = 'salary_payment'). Deleting the row here would leave
       * the payroll item marked paid while the money reappears in Cash/Bank,
       * so such payments must be reversed from the Payment page instead.
       */
      const salaryEvent = await findExpenseJournalEvent(
        supabase,
        schoolId,
        deleteTarget.id,
      );

      if (
        salaryEvent &&
        (salaryEvent.source_module === "salary_payment" ||
          salaryEvent.source_table === "salary_payments")
      ) {
        throw new Error(
          "Salary payments cannot be deleted from Expenses. Open Accounting -> Payment and reverse the salary payment there.",
        );
      }

      /*
       * Remove the ONE canonical journal entry of this expense (lines and
       * accounting_events included) so the Cash Book, Bank Book, Ledger and
       * reports stop showing it. The helper resolves the entry through
       * accounting_events, source_record_id and reference_id.
       */
      await deleteCanonicalJournalForSource(
        supabase,
        {
          schoolId,
          sourceRecordId:
            deleteTarget.id,
          legacyTransactionId:
            deleteTarget.transaction_id,
          sourceModule: "expenses",
          sourceTable: "expenses",
        },
      );

      const {
        error: expenseError,
      } = await supabase
        .from("expenses")
        .delete()
        .eq(
          "id",
          deleteTarget.id,
        )
        .eq(
          "school_id",
          schoolId,
        );

      if (expenseError) {
        throw expenseError;
      }

      if (
        deleteTarget.transaction_id
      ) {
        const {
          error: entryError,
        } = await supabase
          .from(
            "transaction_entries",
          )
          .delete()
          .eq(
            "transaction_id",
            deleteTarget.transaction_id,
          )
          .eq(
            "school_id",
            schoolId,
          );

        if (entryError) {
          throw entryError;
        }

        const {
          error: txnError,
        } = await supabase
          .from("transactions")
          .delete()
          .eq(
            "id",
            deleteTarget.transaction_id,
          )
          .eq(
            "school_id",
            schoolId,
          );

        if (txnError) {
          throw txnError;
        }
      }

      setDeleteTarget(null);

      setSuccess(
        "Expense and all linked accounting entries deleted.",
      );

      await loadData(
        schoolId,
      );
    } catch (e: any) {
      setError(
        e?.message ||
          "Unable to delete expense.",
      );
    } finally {
      setDeleting(false);
    }
  }

  function exportCsv() {
    const rows = [
      [
        "Type",
        "Date",
        "Vendor / Paid To",
        "Paid From",
        "Amount",
        "Reference / Invoice",
        "Description",
      ],
      ...filtered.map((e) => [
        "Expense",
        e.expense_date,
        e.vendor_name || "",
        e.paid_from_account_id
          ? accountMap.get(
              e.paid_from_account_id,
            )?.name || ""
          : "",
        Number(
          e.amount || 0,
        ).toFixed(2),
        e.invoice_number || "",
        e.description || "",
      ]),
      ...filteredVendorPayments.map((p) => [
        "Vendor Payment",
        p.payment_date,
        vendorMap.get(p.vendor_id)?.name || "",
        p.paid_from_account_id
          ? accountMap.get(
              p.paid_from_account_id,
            )?.name || ""
          : "",
        Number(
          p.amount || 0,
        ).toFixed(2),
        p.reference_number || "",
        p.notes || "",
      ]),
    ];

    const blob = new Blob(
      [
        rows
          .map((r) =>
            r.map(csv).join(","),
          )
          .join("\n"),
      ],
      {
        type: "text/csv;charset=utf-8",
      },
    );

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement("a");

    a.href = url;
    a.download = `expenses-${month}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2
            className="animate-spin"
            size={20}
          />
          Loading Expenses...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm text-blue-600 font-semibold">
                {schoolName}
              </div>

              <h1 className="mt-1 text-3xl font-bold text-slate-900">
                Expenses
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                All expense payments, vendor payments and their accounting.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  void refresh(false)
                }
                className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                <RefreshCw
                  size={16}
                  className={
                    refreshing
                      ? "animate-spin"
                      : ""
                  }
                />
                Refresh
              </button>

              <button
                onClick={exportCsv}
                className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50"
              >
                <Download size={16} />
                Export
              </button>

              <button
                onClick={() => {
                  openAddVendorPayment();
                  setShowVendorPaymentModal(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
              >
                <Banknote size={17} />
                Add Vendor Payment
              </button>

              <button
                onClick={() => {
                  resetAdd();
                  setShowAdd(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Plus size={17} />
                Add Expense
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="flex gap-2">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>

            <button
              onClick={() =>
                setError("")
              }
            >
              <X size={16} />
            </button>
          </div>
        )}

        {success && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <div className="flex items-center gap-2">
              <CheckCircle2
                size={18}
              />
              <span>{success}</span>
            </div>

            <button
              onClick={() =>
                setSuccess("")
              }
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card
            title="Total Outflow"
            value={money(totals.total)}
            sub={`${filtered.length + filteredVendorPayments.length} records`}
            icon={<Receipt size={20} />}
          />

          <Card
            title="Cash"
            value={money(totals.cash)}
            sub="Paid from Cash"
            icon={<Banknote size={20} />}
          />

          <Card
            title="Bank"
            value={money(totals.bank)}
            sub="Paid from Bank"
            icon={<Landmark size={20} />}
          />

          <Card
            title="Other"
            value={money(totals.other)}
            sub="Other accounts"
            icon={<Wallet size={20} />}
          />
        </div>

        <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Month">
              <input
                type="month"
                value={month}
                onChange={(e) =>
                  void changeMonth(
                    e.target.value,
                  )
                }
                className="input"
              />
            </Field>

            <Field label="Paid From">
              <select
                value={accountFilter}
                onChange={(e) =>
                  setAccountFilter(
                    e.target.value,
                  )
                }
                className="input"
              >
                <option value="">
                  All Accounts
                </option>

                {paidAccounts.map(
                  (a) => (
                    <option
                      key={a.id}
                      value={a.id}
                    >
                      {a.code
                        ? `${a.code} - `
                        : ""}
                      {a.name}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Search">
              <input
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value,
                  )
                }
                placeholder="Vendor, invoice, description..."
                className="input"
              />
            </Field>
          </div>

          <div className="mt-4 text-xs text-slate-500">
            Showing{" "}
            <b>{filtered.length}</b>{" "}
            of{" "}
            <b>{expenses.length}</b>{" "}
            expenses for{" "}
            <b>{monthText(month)}</b>.
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[1050px] w-full">
              <thead className="bg-slate-50">
                <tr className="border-b">
                  {[
                    "Date",
                    "Vendor / Description",
                    "Paid From",
                    "Amount",
                    "Accounting",
                    "Actions",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-16 text-center text-sm text-slate-500"
                    >
                      <Receipt
                        className="mx-auto text-slate-300"
                        size={34}
                      />

                      <div className="mt-3 font-semibold text-slate-700">
                        No expenses found
                      </div>

                      <div className="mt-1">
                        Try another filter or click Add Expense.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((e) => {
                    const acc =
                      e.paid_from_account_id
                        ? accountMap.get(
                            e.paid_from_account_id,
                          )
                        : null;

                    return (
                      <tr
                        key={e.id}
                        className="border-b last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-5 py-4 text-sm font-semibold">
                          {dateText(
                            e.expense_date,
                          )}
                        </td>

                        <td className="px-5 py-4">
                          <div className="font-semibold text-sm">
                            {e.vendor_name ||
                              "School Expense"}
                          </div>

                          <div className="mt-1 max-w-[280px] truncate text-xs text-slate-500">
                            {e.description ||
                              e.invoice_number ||
                              "-"}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-sm">
                          <div className="font-semibold">
                            {acc?.name ||
                              "Not selected"}
                          </div>

                          <div className="text-xs text-slate-400">
                            {acc?.account_type ||
                              ""}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-right font-bold">
                          {money(
                            Number(
                              e.amount || 0,
                            ),
                          )}
                        </td>

                        <td className="px-5 py-4 text-center">
                          {e.transaction_id ? (
                            <button
                              onClick={() =>
                                void openView(e)
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              <Eye size={14} />
                              View
                            </button>
                          ) : (
                            <span className="text-xs text-amber-600">
                              No entry
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() =>
                                void openView(e)
                              }
                              className="rounded-lg border p-2 hover:bg-slate-100"
                              title="View"
                            >
                              <Eye size={16} />
                            </button>

                            <button
                              onClick={() =>
                                void openEdit(e)
                              }
                              className="rounded-lg border p-2 hover:bg-blue-50 hover:text-blue-600"
                              title="Edit"
                            >
                              <Edit3 size={16} />
                            </button>

                            <button
                              onClick={() =>
                                setDeleteTarget(e)
                              }
                              className="rounded-lg border p-2 hover:bg-red-50 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2
                                size={16}
                              />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/*
         * VENDOR PAYMENTS: the same canonical vendor_payments rows the
         * Payment page and Vendor Purchases page use. Edit or delete here
         * and the accounting (Cash Book, Bank Book, Ledger, reports) plus
         * bill outstanding stay in sync everywhere.
         */}
        <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                <Landmark
                  size={18}
                  className="text-blue-600"
                />
                Vendor Payments
              </h2>

              <p className="mt-1 text-xs text-slate-500">
                Payments made to vendors against purchase bills, linked with
                the Payment page and Vendor Purchases.
              </p>
            </div>

            <button
              onClick={() => {
                openAddVendorPayment();
                setShowVendorPaymentModal(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus size={16} />
              Add Vendor Payment
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1050px] w-full">
              <thead className="bg-slate-50">
                <tr className="border-b">
                  {[
                    "Date",
                    "Vendor",
                    "Bills Settled",
                    "Paid From",
                    "Amount",
                    "Reference",
                    "Actions",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredVendorPayments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-6 py-16 text-center text-sm text-slate-500"
                    >
                      <Landmark
                        className="mx-auto text-slate-300"
                        size={34}
                      />

                      <div className="mt-3 font-semibold text-slate-700">
                        No vendor payments
                      </div>

                      <div className="mt-1">
                        Click Add Vendor Payment to record one.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredVendorPayments.map((p) => {
                    const vendor =
                      vendorMap.get(p.vendor_id);

                    const billNumbers =
                      allocations
                        .filter(
                          (a) =>
                            a.payment_id ===
                            p.id,
                        )
                        .map(
                          (a) =>
                            billMap.get(a.bill_id)
                              ?.bill_number ||
                            "Purchase bill",
                        )
                        .join(", ");

                    const acc =
                      p.paid_from_account_id
                        ? accountMap.get(
                            p.paid_from_account_id,
                          )
                        : null;

                    return (
                      <tr
                        key={p.id}
                        className="border-b last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-5 py-4 text-sm font-semibold">
                          {dateText(p.payment_date)}
                        </td>

                        <td className="px-5 py-4">
                          <div className="font-semibold text-sm">
                            {vendor?.name ||
                              "Unknown vendor"}
                          </div>

                          <div className="mt-1 max-w-[240px] truncate text-xs text-slate-500">
                            {p.notes || "-"}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-sm">
                          {billNumbers || "-"}
                        </td>

                        <td className="px-5 py-4 text-sm">
                          <div className="font-semibold">
                            {acc?.name || "-"}
                          </div>

                          <div className="text-xs text-slate-400">
                            {acc?.account_type || ""}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-right font-bold">
                          {money(
                            Number(p.amount || 0),
                          )}
                        </td>

                        <td className="px-5 py-4 text-sm">
                          {p.reference_number || "-"}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() =>
                                setViewVendorPayment(p)
                              }
                              className="rounded-lg border p-2 hover:bg-slate-100"
                              title="View"
                            >
                              <Eye size={16} />
                            </button>

                            <button
                              onClick={() => {
                                openEditVendorPayment(p);
                                setShowVendorPaymentModal(true);
                              }}
                              className="rounded-lg border p-2 hover:bg-blue-50 hover:text-blue-600"
                              title="Edit"
                            >
                              <Edit3 size={16} />
                            </button>

                            <button
                              onClick={() =>
                                setDeleteVendorTarget(p)
                              }
                              className="rounded-lg border p-2 hover:bg-red-50 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showAdd && (
        <Modal
          title="Add Expense"
          onClose={() =>
            !savingExpense &&
            setShowAdd(false)
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Expense Date">
              <input
                type="date"
                value={addDate}
                onChange={(e) =>
                  setAddDate(
                    e.target.value,
                  )
                }
                className="input"
              />
            </Field>

            <Field label="Expense Account">
              <select
                value={addExpenseAccount}
                onChange={(e) =>
                  setAddExpenseAccount(
                    e.target.value,
                  )
                }
                className="input"
              >
                <option value="">
                  Select expense account
                </option>

                {expenseAccounts.map(
                  (a) => (
                    <option
                      key={a.id}
                      value={a.id}
                    >
                      {a.code
                        ? `${a.code} - `
                        : ""}
                      {a.name}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Paid From">
              <select
                value={addPaidFrom}
                onChange={(e) =>
                  setAddPaidFrom(
                    e.target.value,
                  )
                }
                className="input"
              >
                <option value="">
                  Select Cash / Bank
                </option>

                {paidAccounts.map(
                  (a) => (
                    <option
                      key={a.id}
                      value={a.id}
                    >
                      {a.code
                        ? `${a.code} - `
                        : ""}
                      {a.name} (
                      {
                        a.account_type
                      }
                      )
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Amount">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={addAmount}
                onChange={(e) =>
                  setAddAmount(
                    e.target.value,
                  )
                }
                className="input"
                placeholder="0.00"
              />
            </Field>

            <Field label="Vendor / Paid To">
              <input
                value={addVendor}
                onChange={(e) =>
                  setAddVendor(
                    e.target.value,
                  )
                }
                className="input"
                placeholder="Vendor name"
              />
            </Field>

            <Field label="Invoice Number">
              <input
                value={addInvoice}
                onChange={(e) =>
                  setAddInvoice(
                    e.target.value,
                  )
                }
                className="input"
                placeholder="Optional"
              />
            </Field>

            <Field label="Description">
              <input
                value={addDescription}
                onChange={(e) =>
                  setAddDescription(
                    e.target.value,
                  )
                }
                className="input"
                placeholder="What was this expense for?"
              />
            </Field>
          </div>

          <div className="mt-5 rounded-xl bg-blue-50 border border-blue-100 p-4 text-xs text-blue-800">
            Accounting entry:
            <b>
              {" "}
              Dr Expense Account → Cr Cash / Bank
            </b>
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() =>
                setShowAdd(false)
              }
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() =>
                void createExpense()
              }
              disabled={savingExpense}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingExpense ? (
                <>
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2
                    size={16}
                  />
                  Save Expense
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {viewExpense && (
        <Modal
          title="Expense & Accounting Details"
          onClose={() => {
            setViewExpense(null);
            setViewTxn(null);
            setViewEntries([]);
          }}
        >
          <div className="grid gap-4 rounded-xl bg-slate-50 border p-4 sm:grid-cols-2">
            <Info
              label="Date"
              value={dateText(
                viewExpense.expense_date,
              )}
            />

            <Info
              label="Amount"
              value={money(
                Number(
                  viewExpense.amount ||
                    0,
                ),
              )}
            />

            <Info
              label="Paid From"
              value={
                viewExpense.paid_from_account_id
                  ? accountMap.get(
                      viewExpense.paid_from_account_id,
                    )?.name || "-"
                  : "-"
              }
            />

            <Info
              label="Vendor"
              value={
                viewExpense.vendor_name ||
                "-"
              }
            />

            <Info
              label="Invoice"
              value={
                viewExpense.invoice_number ||
                "-"
              }
            />
          </div>

          <div className="mt-5 flex items-center gap-2 font-bold">
            <FileText
              size={18}
              className="text-blue-600"
            />
            Accounting Transaction
          </div>

          {viewLoading ? (
            <div className="py-10 text-center text-sm text-slate-500">
              <Loader2
                className="mx-auto animate-spin"
                size={22}
              />

              <div className="mt-2">
                Loading...
              </div>
            </div>
          ) : !viewTxn ? (
            <div className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">
              No linked accounting transaction.
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl border">
              <div className="grid gap-3 border-b bg-slate-50 p-4 sm:grid-cols-3">
                <Info
                  label="Transaction No."
                  value={
                    viewTxn.transaction_number ||
                    "-"
                  }
                />

                <Info
                  label="Date"
                  value={dateText(
                    viewTxn.transaction_date,
                  )}
                />

                <Info
                  label="Type"
                  value={
                    viewTxn.transaction_type ||
                    "-"
                  }
                />
              </div>

              <table className="w-full">
                <thead className="bg-white">
                  <tr className="border-b">
                    <th className="p-3 text-left text-xs text-slate-500">
                      Account
                    </th>

                    <th className="p-3 text-right text-xs text-slate-500">
                      Debit
                    </th>

                    <th className="p-3 text-right text-xs text-slate-500">
                      Credit
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {viewEntries.map(
                    (e) => (
                      <tr
                        key={e.id}
                        className="border-b last:border-0"
                      >
                        <td className="p-3 text-sm font-semibold">
                          {accountMap.get(
                            e.account_id,
                          )?.name ||
                            "Unknown"}
                        </td>

                        <td className="p-3 text-right text-sm">
                          {Number(
                            e.debit || 0,
                          ) > 0
                            ? money(
                                Number(
                                  e.debit,
                                ),
                              )
                            : "-"}
                        </td>

                        <td className="p-3 text-right text-sm">
                          {Number(
                            e.credit || 0,
                          ) > 0
                            ? money(
                                Number(
                                  e.credit,
                                ),
                              )
                            : "-"}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {editExpense && (
        <Modal
          title="Edit Expense"
          onClose={() =>
            !savingEdit &&
            setEditExpense(null)
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <input
                type="date"
                value={editDate}
                onChange={(e) =>
                  setEditDate(
                    e.target.value,
                  )
                }
                className="input"
              />
            </Field>

            <Field label="Expense Account">
              <select
                value={editExpenseAccount}
                onChange={(e) =>
                  setEditExpenseAccount(
                    e.target.value,
                  )
                }
                className="input"
              >
                <option value="">
                  Select expense account
                </option>

                {expenseAccounts.map(
                  (a) => (
                    <option
                      key={a.id}
                      value={a.id}
                    >
                      {a.code
                        ? `${a.code} - `
                        : ""}
                      {a.name}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Paid From">
              <select
                value={editPaidFrom}
                onChange={(e) =>
                  setEditPaidFrom(
                    e.target.value,
                  )
                }
                className="input"
              >
                <option value="">
                  Select account
                </option>

                {paidAccounts.map(
                  (a) => (
                    <option
                      key={a.id}
                      value={a.id}
                    >
                      {a.code
                        ? `${a.code} - `
                        : ""}
                      {a.name}
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Amount">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={editAmount}
                onChange={(e) =>
                  setEditAmount(
                    e.target.value,
                  )
                }
                className="input"
              />
            </Field>

            <Field label="Vendor">
              <input
                value={editVendor}
                onChange={(e) =>
                  setEditVendor(
                    e.target.value,
                  )
                }
                className="input"
              />
            </Field>

            <Field label="Invoice">
              <input
                value={editInvoice}
                onChange={(e) =>
                  setEditInvoice(
                    e.target.value,
                  )
                }
                className="input"
              />
            </Field>

            <Field label="Description">
              <input
                value={editDescription}
                onChange={(e) =>
                  setEditDescription(
                    e.target.value,
                  )
                }
                className="input"
              />
            </Field>
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() =>
                setEditExpense(null)
              }
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() =>
                void saveEdit()
              }
              disabled={savingEdit}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingEdit ? (
                <>
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2
                    size={16}
                  />
                  Update Expense
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="Delete Expense"
          onClose={() =>
            !deleting &&
            setDeleteTarget(null)
          }
        >
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            This will delete the expense and
            its linked accounting transaction.
            Payroll-linked expenses are protected.
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="font-semibold">
              {deleteTarget.vendor_name ||
                "School Expense"}
            </div>

            <div className="mt-1 text-sm text-slate-500">
              {dateText(
                deleteTarget.expense_date,
              )}
            </div>

            <div className="mt-2 text-lg font-bold">
              {money(
                Number(
                  deleteTarget.amount ||
                    0,
                ),
              )}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={() =>
                setDeleteTarget(null)
              }
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() =>
                void deleteExpense()
              }
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
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
                  <Trash2 size={16} />
                  Delete
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {showVendorPaymentModal && (
        <Modal
          title={
            editVendorPayment
              ? "Edit Vendor Payment"
              : "Add Vendor Payment"
          }
          onClose={() =>
            !savingVendorPayment &&
            setShowVendorPaymentModal(false)
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor">
              <select
                value={vpVendorId}
                onChange={(e) =>
                  setVpVendorId(e.target.value)
                }
                className="input"
              >
                <option value="">
                  Select vendor
                </option>

                {vendors.map((v) => (
                  <option
                    key={v.id}
                    value={v.id}
                  >
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Payment Date">
              <input
                type="date"
                value={vpDate}
                onChange={(e) =>
                  setVpDate(e.target.value)
                }
                className="input"
              />
            </Field>

            <Field label="Amount">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={vpAmount}
                onChange={(e) =>
                  setVpAmount(e.target.value)
                }
                className="input"
                placeholder="0.00"
              />
            </Field>

            <Field label="Paid From (Cash / Bank)">
              <select
                value={vpPaidFrom}
                onChange={(e) =>
                  setVpPaidFrom(e.target.value)
                }
                className="input"
              >
                <option value="">
                  Select Cash / Bank
                </option>

                {paidAccounts.map((a) => (
                  <option
                    key={a.id}
                    value={a.id}
                  >
                    {a.code
                      ? `${a.code} - `
                      : ""}
                    {a.name} (
                    {a.account_type})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Reference">
              <input
                value={vpReference}
                onChange={(e) =>
                  setVpReference(e.target.value)
                }
                className="input"
                placeholder="Optional"
              />
            </Field>

            <Field label="Notes">
              <input
                value={vpNotes}
                onChange={(e) =>
                  setVpNotes(e.target.value)
                }
                className="input"
                placeholder="Optional"
              />
            </Field>
          </div>

          {vpVendorId && (
            <div className="mt-4 rounded-xl border bg-slate-50 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">
                  Outstanding payable (after edit)
                </span>

                <span className="font-bold text-slate-900">
                  {money(
                    vendorOutstandingExcluding(
                      vpVendorId,
                      editVendorPayment?.id ||
                        "",
                    ),
                  )}
                </span>
              </div>

              <p className="mt-1 text-xs text-slate-500">
                Allocated oldest-bills first. On save
                the accounting entry is re-posted (Dr
                Vendor Payables / Cr Cash-Bank).
              </p>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-3 border-t pt-5">
            <button
              onClick={() =>
                setShowVendorPaymentModal(false)
              }
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() =>
                void saveVendorPayment()
              }
              disabled={savingVendorPayment}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingVendorPayment ? (
                <>
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  {editVendorPayment
                    ? "Update Payment"
                    : "Record Payment"}
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      {viewVendorPayment && (
        <Modal
          title="Vendor Payment Details"
          onClose={() =>
            setViewVendorPayment(null)
          }
        >
          <div className="grid gap-4 rounded-xl bg-slate-50 border p-4 sm:grid-cols-2">
            <Info
              label="Date"
              value={dateText(
                viewVendorPayment.payment_date,
              )}
            />

            <Info
              label="Amount"
              value={money(
                Number(
                  viewVendorPayment.amount || 0,
                ),
              )}
            />

            <Info
              label="Vendor"
              value={
                vendorMap.get(
                  viewVendorPayment.vendor_id,
                )?.name || "-"
              }
            />

            <Info
              label="Paid From"
              value={
                viewVendorPayment.paid_from_account_id
                  ? accountMap.get(
                      viewVendorPayment.paid_from_account_id,
                    )?.name || "-"
                  : "-"
              }
            />

            <Info
              label="Reference"
              value={
                viewVendorPayment.reference_number ||
                "-"
              }
            />

            <Info
              label="Notes"
              value={
                viewVendorPayment.notes || "-"
              }
            />
          </div>

          <div className="mt-5 flex items-center gap-2 font-bold">
            <FileText
              size={18}
              className="text-blue-600"
            />
            Bills Settled
          </div>

          <div className="mt-3 space-y-2">
            {allocations
              .filter(
                (a) =>
                  a.payment_id ===
                  viewVendorPayment.id,
              )
              .map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm"
                >
                  <span className="font-semibold">
                    {billMap.get(a.bill_id)
                      ?.bill_number ||
                      "Purchase bill"}
                  </span>

                  <span className="font-bold">
                    {money(
                      Number(a.amount || 0),
                    )}
                  </span>
                </div>
              ))}

            {allocations.filter(
              (a) =>
                a.payment_id ===
                viewVendorPayment.id,
            ).length === 0 && (
              <div className="rounded-xl border border-dashed p-4 text-center text-sm text-slate-500">
                No allocations found.
              </div>
            )}
          </div>
        </Modal>
      )}

      {deleteVendorTarget && (
        <Modal
          title="Delete Vendor Payment"
          onClose={() =>
            !deletingVendor &&
            setDeleteVendorTarget(null)
          }
        >
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            This will delete the vendor payment,
            its bill allocations and its
            accounting entry everywhere. Bill
            outstanding is restored.
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="font-semibold">
              {vendorMap.get(
                deleteVendorTarget.vendor_id,
              )?.name || "Vendor payment"}
            </div>

            <div className="mt-1 text-sm text-slate-500">
              {dateText(
                deleteVendorTarget.payment_date,
              )}
            </div>

            <div className="mt-2 text-lg font-bold">
              {money(
                Number(
                  deleteVendorTarget.amount ||
                    0,
                ),
              )}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={() =>
                setDeleteVendorTarget(null)
              }
              className="rounded-lg border px-5 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>

            <button
              onClick={() =>
                void deleteVendorPayment()
              }
              disabled={deletingVendor}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {deletingVendor ? (
                <>
                  <Loader2
                    size={16}
                    className="animate-spin"
                  />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Delete
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      <style>{`
        .input {
          width: 100%;
          border: 1px solid rgb(203 213 225);
          border-radius: .5rem;
          background: white;
          padding: .65rem .75rem;
          font-size: .875rem;
          outline: none;
        }

        .input:focus {
          border-color: rgb(59 130 246);
          box-shadow: 0 0 0 3px rgb(219 234 254);
        }
      `}</style>
    </main>
  );
}

function Card({
  title,
  value,
  sub,
  icon,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {title}
          </div>

          <div className="mt-2 text-2xl font-bold text-slate-900">
            {value}
          </div>

          <div className="mt-1 text-xs text-slate-500">
            {sub}
          </div>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          {icon}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </label>

      {children}
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>

      <div className="mt-1 text-sm font-semibold text-slate-800">
        {value}
      </div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            {title}
          </h2>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={19} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-73px)] overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
