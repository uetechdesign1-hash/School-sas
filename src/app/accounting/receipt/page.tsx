"use client";


import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import jsPDF from "jspdf";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  User,
  Wallet,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { getCurrentSchoolId } from "@/lib/supabase/current-school";

type ReceiptType = "student_fee" | "other_income";

type Account = {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  account_type: string;
  opening_balance: number | null;
  is_system: boolean;
  is_active: boolean;
};

type ClassRow = {
  id: string;
  school_id: string;
  name: string;
  display_order: number;
};

type SectionRow = {
  id: string;
  school_id: string;
  class_id: string;
  name: string;
};

type Student = {
  id: string;
  school_id: string;
  admission_no: string;
  roll_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  class_id: string | null;
  section_id: string | null;
  status: string;
};

type FeeConcession = {
  id: string;
  school_id: string;
  student_id: string;
  bill_id: string;
  concession_type: string;
  percentage: number | null;
  amount: number;
  reason: string | null;
};

type FeeBillItem = {
  id: string;
  school_id: string;
  bill_id: string;
  fee_category_id: string | null;
  description: string;
  amount: number;
  discount: number;
  net_amount: number;
  balance: number;
};

type ReceiptPaymentLine = {
  feeBillItemId: string;
  amount: string;
};

type FeeBill = {
  id: string;
  school_id: string;
  student_id: string;
  academic_year_id?: string | null;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  status: string;
  subtotal: number;
  discount: number;
  late_fee: number;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  notes: string | null;
};

type ReceiptHistoryRow = {
  id: string;
  transaction_number: string | null;
  manual_bill_number?: string | null;
  fee_categories?: string[];
  fee_category_amounts?: Array<{ description: string; amount: number }>;
  student_name?: string | null;
  class_name?: string | null;
  section_name?: string | null;
  transaction_date: string;
  description: string | null;
  debit_account: string;
  credit_account: string;
  amount: number;
  receipt_type: ReceiptType;
  reference_id: string | null;
};

type TransactionEntry = {
  id: string;
  transaction_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
};

type TransactionRow = {
  id: string;
  school_id: string;
  transaction_number: string | null;
  transaction_date: string;
  transaction_type: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
};

type FeePayment = {
  id: string;
  school_id: string;
  student_id: string;
  receipt_number: string;
  manual_bill_number: string | null;
  payment_date: string;
  amount: number;
  payment_method: string;
  account_id: string | null;
  reference_number: string | null;
  notes: string | null;
  received_by: string | null;
  receipt_generated: boolean;
  bill_id: string | null;
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "online", label: "Online" },
  { value: "other", label: "Other" },
];

function today() {
  return new Date().toISOString().split("T")[0];
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function getStudentName(student: Student) {
  return [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(" ");
}

function cleanFeeCategory(value: string) {
  return value
    .replace(/^Fee Management\s*-\s*/i, "")
    .replace(/^Fee\s*[-:]\s*/i, "")
    .trim();
}

function paymentMethodLabel(value: string) {
  return (
    PAYMENT_METHODS.find((item) => item.value === value)?.label || value
  );
}


export default function ReceiptPage() {
  const supabase = useMemo(() => createClient(), []);

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingBills, setLoadingBills] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [receiptType, setReceiptType] =
    useState<ReceiptType>("student_fee");

  const [receiptDate, setReceiptDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [collectionType, setCollectionType] = useState<"single" | "split">("single");
  const [cashCollectionAmount, setCashCollectionAmount] = useState("");
  const [bankCollectionAmount, setBankCollectionAmount] = useState("");
  const [cashCollectionAccountId, setCashCollectionAccountId] = useState("");
  const [bankCollectionAccountId, setBankCollectionAccountId] = useState("");
  const [receiveIntoAccountId, setReceiveIntoAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [manualBillNumber, setManualBillNumber] = useState("");
  const [manualReceiptNumber, setManualReceiptNumber] = useState("");

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [sections, setSections] = useState<SectionRow[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");

  const [feeBills, setFeeBills] = useState<FeeBill[]>([]);
  const [concessionsByBillId, setConcessionsByBillId] = useState<Record<string, number>>({});
  const [selectedBillId, setSelectedBillId] = useState("");
  const [receiptFeeItems, setReceiptFeeItems] = useState<FeeBillItem[]>([]);
  const [receiptPaymentLines, setReceiptPaymentLines] = useState<ReceiptPaymentLine[]>([]);
  const [feeManagementName, setFeeManagementName] = useState("");
  const [feeManagementAcademicYear, setFeeManagementAcademicYear] = useState("");
  const [feeManagementAmount, setFeeManagementAmount] = useState(0);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeAccountId, setIncomeAccountId] = useState("");

  const [receivedFrom, setReceivedFrom] = useState("");
  const [particulars, setParticulars] = useState("");

  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [history, setHistory] = useState<ReceiptHistoryRow[]>([]);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<ReceiptType | "all">("all");
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState("all");
  const [historyFromDate, setHistoryFromDate] = useState("");
  const [historyToDate, setHistoryToDate] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<ReceiptHistoryRow | null>(null);

  const filteredSections = useMemo(() => {
    if (!selectedClassId) return [];

    return sections.filter(
      (section) => section.class_id === selectedClassId
    );
  }, [sections, selectedClassId]);

  const filteredStudents = useMemo(() => {
    let result = students;

    if (selectedClassId) {
      result = result.filter(
        (student) => student.class_id === selectedClassId
      );
    }

    if (selectedSectionId) {
      result = result.filter(
        (student) => student.section_id === selectedSectionId
      );
    }

    return result;
  }, [students, selectedClassId, selectedSectionId]);

  const selectedClass = useMemo(
    () =>
      classes.find((item) => item.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const selectedSection = useMemo(
    () =>
      sections.find((item) => item.id === selectedSectionId) || null,
    [sections, selectedSectionId]
  );

  const selectedStudent = useMemo(
    () =>
      students.find((item) => item.id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

  const selectedBill = useMemo(
    () =>
      feeBills.find((item) => item.id === selectedBillId) || null,
    [feeBills, selectedBillId]
  );

  const selectedBillConcession = useMemo(
    () => (selectedBillId ? Number(concessionsByBillId[selectedBillId] || 0) : 0),
    [concessionsByBillId, selectedBillId]
  );

  const selectedBillNetFee = useMemo(
    () =>
      selectedBill
        ? Math.max(0, Number(selectedBill.total_amount || 0))
        : 0,
    [selectedBill]
  );

  const cashBankAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.is_active &&
          (account.account_type === "cash" ||
            account.account_type === "bank")
      ),
    [accounts]
  );

  const cashAccounts = useMemo(() => accounts.filter((account) => account.is_active && account.account_type === "cash"), [accounts]);
  const bankAccounts = useMemo(() => accounts.filter((account) => account.is_active && account.account_type === "bank"), [accounts]);
  const cashSplit = Number(cashCollectionAmount || 0);
  const bankSplit = Number(bankCollectionAmount || 0);
  const splitCollectionTotal = cashSplit + bankSplit;

  const incomeAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.is_active &&
          (account.account_type === "income" ||
            account.account_type === "receivable")
      ),
    [accounts]
  );

  const selectedReceiveAccount = useMemo(
    () =>
      accounts.find(
        (account) => account.id === receiveIntoAccountId
      ) || null,
    [accounts, receiveIntoAccountId]
  );

  const selectedIncomeAccount = useMemo(
    () =>
      accounts.find(
        (account) => account.id === incomeAccountId
      ) || null,
    [accounts, incomeAccountId]
  );

  const numericAmount = Number(amount || 0);
  const receiptPaymentTotal = useMemo(
    () => receiptPaymentLines.reduce((sum, line) => sum + Math.max(Number(line.amount || 0), 0), 0),
    [receiptPaymentLines],
  );

  async function loadAccounts(currentSchoolId: string) {
    const { data, error } = await supabase
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
      .eq("school_id", currentSchoolId)
      .eq("is_active", true)
      .order("account_type")
      .order("name");

    if (error) throw new Error(error.message);

    const rows = (data || []) as Account[];
    setAccounts(rows);

    const mainCash =
      rows.find(
        (account) =>
          account.account_type === "cash" &&
          account.name.toLowerCase().includes("main cash")
      ) ||
      rows.find((account) => account.account_type === "cash");

    if (mainCash) {
      setReceiveIntoAccountId(mainCash.id);
    }

    const feeIncome = rows.find(
      (account) =>
        account.account_type === "income" &&
        account.name.toLowerCase() === "fee income"
    );

    if (feeIncome) {
      setIncomeAccountId(feeIncome.id);
    }
  }

  async function loadClasses(currentSchoolId: string) {
    const { data, error } = await supabase
      .from("classes")
      .select(
        `
          id,
          school_id,
          name,
          display_order
        `
      )
      .eq("school_id", currentSchoolId)
      .order("display_order", { ascending: true })
      .order("name");

    if (error) throw new Error(error.message);

    setClasses((data || []) as ClassRow[]);
  }

  async function loadSections(currentSchoolId: string) {
    const { data, error } = await supabase
      .from("sections")
      .select(
        `
          id,
          school_id,
          class_id,
          name
        `
      )
      .eq("school_id", currentSchoolId)
      .order("name");

    if (error) throw new Error(error.message);

    setSections((data || []) as SectionRow[]);
  }

  async function loadStudents(currentSchoolId: string) {
    const { data, error } = await supabase
      .from("students")
      .select(
        `
          id,
          school_id,
          admission_no,
          roll_no,
          first_name,
          middle_name,
          last_name,
          class_id,
          section_id,
          status
        `
      )
      .eq("school_id", currentSchoolId)
      .eq("status", "active")
      .order("first_name")
      .order("last_name");

    if (error) throw new Error(error.message);

    setStudents((data || []) as Student[]);
  }

  async function loadReceiptFeeItems(billId: string, excludePaymentId?: string) {
    if (!schoolId || !billId) {
      setReceiptFeeItems([]);
      setReceiptPaymentLines([]);
      return [];
    }

    const { data: itemData, error: itemError } = await supabase
      .from("fee_bill_items")
      .select("id, school_id, bill_id, fee_category_id, description, amount, discount, net_amount")
      .eq("school_id", schoolId)
      .eq("bill_id", billId)
      .order("created_at", { ascending: true });

    if (itemError) throw new Error(`Unable to load fee categories: ${itemError.message}`);

    const itemIds = (itemData || []).map((item) => item.id as string);
    let allocationData: Array<{ fee_bill_item_id: string | null; amount: number; payment_id: string }> = [];

    if (itemIds.length > 0) {
      let query = supabase
        .from("fee_payment_allocations")
        .select("fee_bill_item_id, amount, payment_id")
        .eq("school_id", schoolId)
        .eq("bill_id", billId)
        .in("fee_bill_item_id", itemIds);

      if (excludePaymentId) query = query.neq("payment_id", excludePaymentId);

      const { data, error } = await query;
      if (error) throw new Error(`Unable to load fee payment allocations: ${error.message}`);
      allocationData = (data || []) as typeof allocationData;
    }

    const paidByItem = new Map<string, number>();
    for (const allocation of allocationData) {
      if (!allocation.fee_bill_item_id) continue;
      paidByItem.set(
        allocation.fee_bill_item_id,
        (paidByItem.get(allocation.fee_bill_item_id) || 0) + Number(allocation.amount || 0),
      );
    }

    const items = (itemData || []).map((item) => {
      const gross = Number(item.amount || 0);
      const net = Number(item.net_amount ?? gross);
      const balance = Math.max(net - (paidByItem.get(item.id) || 0), 0);
      return {
        ...(item as any),
        fee_category_id: item.fee_category_id || null,
        amount: gross,
        discount: Number(item.discount || 0),
        net_amount: net,
        balance,
        description: cleanFeeCategory(item.description || "Fee"),
      } as FeeBillItem;
    });

    setReceiptFeeItems(items);
    return items;
  }

  async function loadStudentBills(studentId: string) {
    if (!schoolId || !studentId) {
      setFeeBills([]);
      setConcessionsByBillId({});
      setSelectedBillId("");
      setReceiptFeeItems([]);
      setReceiptPaymentLines([]);
      setFeeManagementName("");
      setFeeManagementAcademicYear("");
      setFeeManagementAmount(0);
      return;
    }

    try {
      setLoadingBills(true);
      setError("");

      /*
       * FEE MANAGEMENT IS THE SOURCE OF TRUTH.
       *
       * For a new Student Fee receipt we do NOT show every historical
       * fee_bills row. We first resolve:
       *   1. the school's current academic year
       *   2. the active Fee Management structure for the student's class
       *   3. the fee bill directly linked to that structure
       *
       * Only the newest outstanding linked bill is shown.
       * Old/duplicate/unrelated fee bills therefore disappear from this
       * selector without deleting historical database records.
       */

      const { data: student, error: studentError } = await supabase
        .from("students")
        .select("id, school_id, class_id")
        .eq("id", studentId)
        .eq("school_id", schoolId)
        .maybeSingle();

      if (studentError) throw new Error(studentError.message);

      if (!student) {
        throw new Error("Selected student was not found in your school.");
      }

      if (!student.class_id) {
        throw new Error(
          "This student has no class assigned. Assign a class before collecting fees.",
        );
      }

      const { data: academicYear, error: academicYearError } = await supabase
        .from("academic_years")
        .select("id, name, start_date, end_date, is_current")
        .eq("school_id", schoolId)
        .eq("is_current", true)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (academicYearError) {
        throw new Error(
          `Unable to load current academic year: ${academicYearError.message}`,
        );
      }

      if (!academicYear) {
        throw new Error(
          "No current academic year is configured for this school.",
        );
      }

      const { data: structure, error: structureError } = await supabase
        .from("fee_structures")
        .select("id, name, academic_year_id, class_id, active")
        .eq("school_id", schoolId)
        .eq("academic_year_id", academicYear.id)
        .eq("class_id", student.class_id)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (structureError) {
        throw new Error(
          `Unable to load Fee Management structure: ${structureError.message}`,
        );
      }

      if (!structure) {
        setFeeBills([]);
        setConcessionsByBillId({});
        setSelectedBillId("");
        setFeeManagementName("");
        setFeeManagementAcademicYear(academicYear.name);
        setFeeManagementAmount(0);
        throw new Error(
          "No active Fee Management structure is assigned to this student's class for the current academic year.",
        );
      }

      const { data: structureItems, error: structureItemsError } =
        await supabase
          .from("fee_structure_items")
          .select("id, amount, mandatory")
          .eq("school_id", schoolId)
          .eq("fee_structure_id", structure.id);

      if (structureItemsError) {
        throw new Error(
          `Unable to load Fee Management fee items: ${structureItemsError.message}`,
        );
      }

      /*
       * IMPORTANT:
       * This must match Student Fees exactly.
       * Mandatory Fee Management items are included automatically.
       * Optional items are NOT included unless the student assignment
       * explicitly selected them.
       */
      const mandatoryStructureAmount = (structureItems || [])
        .filter((item) => Boolean(item.mandatory))
        .reduce(
          (total, item) => total + Math.max(Number(item.amount || 0), 0),
          0,
        );

      /*
       * Pending previous-year carry-forward is part of the student's
       * current fee position in Student Fees.
       */
      const { data: pendingCarryForwards, error: carryForwardError } =
        await supabase
          .from("fee_carry_forwards")
          .select("id, source_bill_id, to_academic_year_id, amount, status")
          .eq("school_id", schoolId)
          .eq("student_id", studentId)
          .eq("to_academic_year_id", academicYear.id)
          .eq("status", "pending");

      if (carryForwardError) {
        throw new Error(
          `Unable to load previous-year carry-forward: ${carryForwardError.message}`,
        );
      }

      const carryForwardAmount = (pendingCarryForwards || []).reduce(
        (total, record) => total + Math.max(Number(record.amount || 0), 0),
        0,
      );

      const currentFeeManagementAmount =
        mandatoryStructureAmount + carryForwardAmount;

      /*
       * Direct linkage:
       * fee_bill_items.fee_structure_id -> fee_structures.id
       */
      const { data: structureBillItems, error: structureBillItemsError } =
        await supabase
          .from("fee_bill_items")
          .select("bill_id")
          .eq("school_id", schoolId)
          .eq("fee_structure_id", structure.id);

      if (structureBillItemsError) {
        throw new Error(
          `Unable to link fee bills to Fee Management: ${structureBillItemsError.message}`,
        );
      }

      const structureBillIds = Array.from(
        new Set(
          (structureBillItems || [])
            .map((row) => row.bill_id as string)
            .filter(Boolean),
        ),
      );

      let bills: FeeBill[] = [];

      if (structureBillIds.length > 0) {
        const { data: billData, error: billError } = await supabase
          .from("fee_bills")
          .select(
            `
              id,
              school_id,
              student_id,
              academic_year_id,
              bill_number,
              bill_date,
              due_date,
              status,
              subtotal,
              discount,
              late_fee,
              total_amount,
              paid_amount,
              balance_amount,
              notes
            `,
          )
          .eq("school_id", schoolId)
          .eq("student_id", studentId)
          .eq("academic_year_id", academicYear.id)
          .in("id", structureBillIds)
          .gt("balance_amount", 0)
          .order("bill_date", { ascending: false })
          .limit(1);

        if (billError) throw new Error(billError.message);

        bills = (billData || []) as FeeBill[];
      }

      setFeeBills(bills);
      setSelectedBillId(bills[0]?.id || "");
      setManualBillNumber(bills[0]?.bill_number || "");
      if (bills[0]) {
        const items = await loadReceiptFeeItems(bills[0].id);
        const firstAvailable = items.find((item) => item.balance > 0);
        setReceiptPaymentLines(
          firstAvailable ? [{ feeBillItemId: firstAvailable.id, amount: "" }] : [],
        );
      } else {
        setReceiptFeeItems([]);
        setReceiptPaymentLines([]);
      }
      setFeeManagementName(structure.name);
      setFeeManagementAcademicYear(academicYear.name);
      setFeeManagementAmount(currentFeeManagementAmount);

      const billIds = bills.map((bill) => bill.id);

      if (billIds.length) {
        const { data: concessions, error: concessionError } =
          await supabase
            .from("fee_concessions")
            .select(
              "id, school_id, student_id, bill_id, concession_type, percentage, amount, reason",
            )
            .eq("school_id", schoolId)
            .eq("student_id", studentId)
            .in("bill_id", billIds);

        if (concessionError) {
          throw new Error(concessionError.message);
        }

        const totals: Record<string, number> = {};
        ((concessions || []) as FeeConcession[]).forEach((item) => {
          totals[item.bill_id] =
            (totals[item.bill_id] || 0) + Number(item.amount || 0);
        });

        setConcessionsByBillId(totals);
      } else {
        setConcessionsByBillId({});
      }

      setAmount("");
    } catch (err: any) {
      setFeeBills([]);
      setReceiptFeeItems([]);
      setReceiptPaymentLines([]);
      setConcessionsByBillId({});
      setSelectedBillId("");
      setAmount("");
      setError(err?.message || "Unable to load Fee Management fees.");
    } finally {
      setLoadingBills(false);
    }
  }

  async function loadHistory(currentSchoolId: string) {
    const { data, error } = await supabase.rpc("get_receipt_history", {
      p_school_id: currentSchoolId,
    });

    if (error) throw new Error(error.message);

    const rows = (data || []) as ReceiptHistoryRow[];
    const paymentIds = rows
      .filter((row) => row.receipt_type === "student_fee" && row.reference_id)
      .map((row) => row.reference_id as string);

    if (paymentIds.length === 0) {
      setHistory(rows);
      return;
    }

    const { data: paymentData, error: paymentError } = await supabase
      .from("fee_payments")
      .select("id, student_id, receipt_number, manual_bill_number, bill_id")
      .eq("school_id", currentSchoolId)
      .in("id", paymentIds);

    if (paymentError) throw new Error(paymentError.message);

    const payments = (paymentData || []) as Array<{
      id: string;
      student_id: string;
      receipt_number: string;
      manual_bill_number: string | null;
      bill_id: string | null;
    }>;
    const billIds = Array.from(new Set(payments.map((payment) => payment.bill_id).filter(Boolean) as string[]));
    const billNumberMap = new Map<string, string>();

    if (billIds.length > 0) {
      const { data: billData, error: billError } = await supabase
        .from("fee_bills")
        .select("id, bill_number")
        .eq("school_id", currentSchoolId)
        .in("id", billIds);
      if (billError) throw new Error(billError.message);
      for (const bill of billData || []) billNumberMap.set(bill.id, bill.bill_number);
    }

    const { data: allocationData, error: allocationError } = await supabase
      .from("fee_payment_allocations")
      .select("payment_id, fee_bill_item_id, amount")
      .eq("school_id", currentSchoolId)
      .in("payment_id", paymentIds);

    if (allocationError) throw new Error(allocationError.message);

    const itemIds = Array.from(new Set((allocationData || []).map((item) => item.fee_bill_item_id).filter(Boolean) as string[]));
    let itemData: Array<{ id: string; description: string }> = [];

    if (itemIds.length > 0) {
      const { data, error: itemError } = await supabase
        .from("fee_bill_items")
        .select("id, description")
        .eq("school_id", currentSchoolId)
        .in("id", itemIds);
      if (itemError) throw new Error(itemError.message);
      itemData = (data || []) as Array<{ id: string; description: string }>;
    }

    const paymentMap = new Map(payments.map((payment) => [payment.id, payment]));
    const itemMap = new Map(itemData.map((item) => [item.id, cleanFeeCategory(item.description)]));
    const paymentCategoryMap = new Map<string, string[]>();
    const paymentCategoryAmountMap = new Map<string, Map<string, number>>();

    for (const allocation of allocationData || []) {
      if (!allocation.fee_bill_item_id) continue;

      const description = itemMap.get(allocation.fee_bill_item_id);
      if (!description) continue;

      const current = paymentCategoryMap.get(allocation.payment_id) || [];
      if (!current.includes(description)) current.push(description);
      paymentCategoryMap.set(allocation.payment_id, current);
      const amountMap = paymentCategoryAmountMap.get(allocation.payment_id) || new Map<string, number>();
      amountMap.set(description, (amountMap.get(description) || 0) + Number(allocation.amount || 0));
      paymentCategoryAmountMap.set(allocation.payment_id, amountMap);
    }

    // Resolve student/class/section BEFORE mapping rows. The row mapper must
    // stay synchronous because Array.map() does not accept await.
    const studentIds = Array.from(
      new Set(
        payments
          .map((payment) => payment.student_id)
          .filter(Boolean),
      ),
    );

    const studentMap = new Map<string, Student>();
    if (studentIds.length > 0) {
      const { data: studentData, error: studentError } = await supabase
        .from("students")
        .select("id, school_id, admission_no, roll_no, first_name, middle_name, last_name, class_id, section_id, status")
        .eq("school_id", currentSchoolId)
        .in("id", studentIds);
      if (studentError) throw new Error(studentError.message);
      for (const student of (studentData || []) as Student[]) {
        studentMap.set(student.id, student);
      }
    }

    const classIds = Array.from(
      new Set(
        Array.from(studentMap.values())
          .map((student) => student.class_id)
          .filter(Boolean) as string[],
      ),
    );
    const classMap = new Map<string, string>();
    if (classIds.length > 0) {
      const { data: classData, error: classError } = await supabase
        .from("classes")
        .select("id, name")
        .eq("school_id", currentSchoolId)
        .in("id", classIds);
      if (classError) throw new Error(classError.message);
      for (const item of classData || []) classMap.set(item.id, item.name);
    }

    const sectionIds = Array.from(
      new Set(
        Array.from(studentMap.values())
          .map((student) => student.section_id)
          .filter(Boolean) as string[],
      ),
    );
    const sectionMap = new Map<string, string>();
    if (sectionIds.length > 0) {
      const { data: sectionData, error: sectionError } = await supabase
        .from("sections")
        .select("id, name")
        .eq("school_id", currentSchoolId)
        .in("id", sectionIds);
      if (sectionError) throw new Error(sectionError.message);
      for (const item of sectionData || []) sectionMap.set(item.id, item.name);
    }

    const enriched = rows.map((row) => {
      if (row.receipt_type !== "student_fee" || !row.reference_id) return row;

      const payment = paymentMap.get(row.reference_id);
      const categories = payment
        ? paymentCategoryMap.get(payment.id) || []
        : [];
      const student = payment?.student_id
        ? studentMap.get(payment.student_id)
        : undefined;
      const studentName = student ? getStudentName(student) : "Student";
      const className = student?.class_id
        ? classMap.get(student.class_id) || "Class"
        : "Class";
      const sectionName = student?.section_id
        ? sectionMap.get(student.section_id) || ""
        : "";

      const categoryAmounts = paymentCategoryAmountMap.get(payment.id);
      const feeCategoryAmounts = categories.map((description) => ({
        description,
        amount: Number(categoryAmounts?.get(description) || 0),
      }));
      const particulars = [studentName, className].filter(Boolean).join(" • ");

      return {
        ...row,
        transaction_number: payment?.receipt_number || row.transaction_number,
        manual_bill_number: payment?.manual_bill_number || (payment?.bill_id ? billNumberMap.get(payment.bill_id) || null : null),
        fee_categories: categories,
        fee_category_amounts: feeCategoryAmounts,
        student_name: studentName,
        class_name: className,
        section_name: sectionName || null,
        description: particulars || row.description,
      };
    });

    setHistory(enriched);
  }

  const historyCategories = useMemo(() => {
    const values = history.flatMap((row) => row.fee_categories || []);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [history]);

  const filteredHistory = useMemo(() => {
    return history.filter((row) => {
      const typeMatches = historyTypeFilter === "all" || row.receipt_type === historyTypeFilter;
      const categoryMatches = historyCategoryFilter === "all" || (row.fee_categories || []).includes(historyCategoryFilter);
      const fromMatches = !historyFromDate || row.transaction_date >= historyFromDate;
      const toMatches = !historyToDate || row.transaction_date <= historyToDate;
      return typeMatches && categoryMatches && fromMatches && toMatches;
    });
  }, [history, historyTypeFilter, historyCategoryFilter, historyFromDate, historyToDate]);

  function getDisplayedHistoryCategories(row: ReceiptHistoryRow) {
    const categories = row.fee_categories || [];
    return historyCategoryFilter === "all" ? categories : categories.filter((category) => category === historyCategoryFilter);
  }

  function getDisplayedHistoryAmount(row: ReceiptHistoryRow) {
    if (historyCategoryFilter === "all") return Number(row.amount || 0);
    return (row.fee_category_amounts || [])
      .filter((item) => item.description === historyCategoryFilter)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }

  const filteredHistoryTotal = useMemo(
    () =>
      filteredHistory.reduce(
        (sum, row) => sum + getDisplayedHistoryAmount(row),
        0,
      ),
    [filteredHistory, historyCategoryFilter],
  );

  const historyDateRangeLabel = useMemo(() => {
    if (historyFromDate && historyToDate) {
      return `${historyFromDate} to ${historyToDate}`;
    }
    if (historyFromDate) return `From ${historyFromDate}`;
    if (historyToDate) return `Up to ${historyToDate}`;
    return "All dates";
  }, [historyFromDate, historyToDate]);

  function exportHistoryExcel() {
    const rows = filteredHistory.map((row) => ({
      Date: row.transaction_date,
      "Receipt No.": row.transaction_number || row.id.slice(0, 8),
      "Bill No.": row.manual_bill_number || "",
      Student: row.student_name || "",
      Class: row.class_name || "",
      "Fee Categories Paid": getDisplayedHistoryCategories(row).join(", "),
      Debit: row.debit_account || "",
      Credit: row.credit_account || "",
      Particulars: row.receipt_type === "student_fee"
        ? [row.student_name, row.class_name].filter(Boolean).join(" • ")
        : row.description || "",
      Amount: getDisplayedHistoryAmount(row),
    }));

    if (rows.length === 0) {
      setError("No receipt history available for the selected filters.");
      return;
    }

    const headers = Object.keys(rows[0]);
    const escapeHtml = (value: unknown) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    // SpreadsheetML/HTML is directly readable by Microsoft Excel without
    // requiring an additional XLSX package in the Next.js bundle.
    const html = `\uFEFF<html><head><meta charset="utf-8" /></head><body>
      <h2>Receipt History</h2>
      <p>Category: ${escapeHtml(historyCategoryFilter === "all" ? "All fee categories" : historyCategoryFilter)} | Date: ${escapeHtml(historyFromDate || "All")} to ${escapeHtml(historyToDate || "All")}</p>
      <table border="1" cellspacing="0" cellpadding="5">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header as keyof typeof row])}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </body></html>`;

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `receipt-history-${historyFromDate || "all"}-${historyToDate || "all"}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportHistoryPDF() {
    if (filteredHistory.length === 0) {
      setError("No receipt history available for the selected filters.");
      return;
    }

    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const left = 10;
    let y = 12;

    const title = historyCategoryFilter === "all"
      ? "Receipt History"
      : `Receipt History — ${historyCategoryFilter}`;

    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text(title, left, y);
    y += 6;
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.text(
      `Date: ${historyFromDate || "All"} to ${historyToDate || "All"} | Receipts: ${filteredHistory.length}`,
      left,
      y,
    );
    y += 7;

    const columns = [
      { label: "Date", x: 10, width: 23 },
      { label: "Receipt", x: 33, width: 27 },
      { label: "Bill", x: 60, width: 35 },
      { label: "Student / Class", x: 95, width: 42 },
      { label: "Category", x: 137, width: 43 },
      { label: "Debit", x: 180, width: 27 },
      { label: "Credit", x: 207, width: 28 },
      { label: "Amount", x: 235, width: 42 },
    ];

    const drawHeader = () => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      columns.forEach((column) => pdf.text(column.label, column.x, y));
      y += 4;
      pdf.setDrawColor(160);
      pdf.line(left, y, pageWidth - left, y);
      y += 5;
      pdf.setFont("helvetica", "normal");
    };

    drawHeader();

    const wrap = (text: string, width: number) =>
      pdf.splitTextToSize(text || "—", width) as string[];

    for (const row of filteredHistory) {
      const categories = getDisplayedHistoryCategories(row).join(", ") || "—";
      const studentClass = [row.student_name, row.class_name].filter(Boolean).join(" • ") || "—";
      const cells = [
        row.transaction_date || "—",
        row.transaction_number || row.id.slice(0, 8),
        row.manual_bill_number || "—",
        studentClass,
        categories,
        row.debit_account || "—",
        row.credit_account || "—",
        money(getDisplayedHistoryAmount(row)),
      ].map((value, index) => wrap(String(value), columns[index].width));

      const rowHeight = Math.max(...cells.map((cell) => cell.length), 1) * 3.4;
      if (y + rowHeight > pageHeight - 10) {
        pdf.addPage();
        y = 12;
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "bold");
        pdf.text(title, left, y);
        y += 7;
        drawHeader();
      }

      pdf.setFontSize(6.5);
      cells.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => pdf.text(line, columns[index].x, y + lineIndex * 3.4));
      });
      y += rowHeight + 2;
      pdf.setDrawColor(220);
      pdf.line(left, y - 1, pageWidth - left, y - 1);
    }

    pdf.save(`receipt-history-${historyCategoryFilter === "all" ? "all" : historyCategoryFilter}-${historyFromDate || "all"}-${historyToDate || "all"}.pdf`);
  }

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const currentSchoolId = await getCurrentSchoolId();

      setSchoolId(currentSchoolId);

      await Promise.all([
        loadAccounts(currentSchoolId),
        loadClasses(currentSchoolId),
        loadSections(currentSchoolId),
        loadStudents(currentSchoolId),
        loadHistory(currentSchoolId),
      ]);
    } catch (err: any) {
      console.error("RECEIPT PAGE LOAD ERROR:", err);

      setError(
        err?.message || "Unable to load Receipt page."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, []);

  function resetForm() {
    setReceiptType("student_fee");
    setReceiptDate(today());
    setPaymentMethod("cash");
    setCollectionType("single");
    setCashCollectionAmount("");
    setBankCollectionAmount("");
    setCashCollectionAccountId("");
    setBankCollectionAccountId("");

    const cash = accounts.find(
      (account) => account.account_type === "cash"
    );

    setReceiveIntoAccountId(cash?.id || "");

    const feeIncome = accounts.find(
      (account) =>
        account.account_type === "income" &&
        account.name.toLowerCase() === "fee income"
    );

    setIncomeAccountId(feeIncome?.id || "");

    setSelectedClassId("");
    setSelectedSectionId("");
    setSelectedStudentId("");
    setSelectedBillId("");

    setFeeBills([]);
    setConcessionsByBillId({});
    setFeeManagementName("");
    setFeeManagementAcademicYear("");
    setFeeManagementAmount(0);

    setAmount("");
    setManualBillNumber("");
    setManualReceiptNumber("");
    setCollectionType("single");
    setCashCollectionAmount("");
    setBankCollectionAmount("");
    setCashCollectionAccountId("");
    setBankCollectionAccountId("");
    setReceivedFrom("");
    setParticulars("");
    setReferenceNumber("");
   

    setEditingId(null);
    setViewingId(null);

    setError("");
    setSuccess("");
  }

  function changeReceiptType(type: ReceiptType) {
    setReceiptType(type);
    setError("");
    setSuccess("");

    setSelectedClassId("");
    setSelectedSectionId("");
    setSelectedStudentId("");
    setSelectedBillId("");
    setFeeBills([]);
    setReceiptFeeItems([]);
    setReceiptPaymentLines([]);
    setConcessionsByBillId({});
    setFeeManagementName("");
    setFeeManagementAcademicYear("");
    setFeeManagementAmount(0);

    setAmount("");
    setManualBillNumber("");
    setManualReceiptNumber("");
    setCollectionType("single");
    setCashCollectionAmount("");
    setBankCollectionAmount("");
    setCashCollectionAccountId("");
    setBankCollectionAccountId("");
    setReceivedFrom("");
    setParticulars("");
    setReferenceNumber("");
    setNotes("");

    if (type === "student_fee") {
      const feeIncome = accounts.find(
        (account) =>
          account.account_type === "income" &&
          account.name.toLowerCase() === "fee income"
      );

      setIncomeAccountId(feeIncome?.id || "");
    } else {
      setIncomeAccountId("");
    }
  }

  function handleClassChange(classId: string) {
    setSelectedClassId(classId);
    setSelectedSectionId("");
    setSelectedStudentId("");
    setSelectedBillId("");
    setFeeBills([]);
    setReceiptFeeItems([]);
    setReceiptPaymentLines([]);
    setConcessionsByBillId({});
    setAmount("");
  }

  function handleSectionChange(sectionId: string) {
    setSelectedSectionId(sectionId);
    setSelectedStudentId("");
    setSelectedBillId("");
    setFeeBills([]);
    setReceiptFeeItems([]);
    setReceiptPaymentLines([]);
    setConcessionsByBillId({});
    setAmount("");
  }

  async function handleStudentChange(studentId: string) {
    setSelectedStudentId(studentId);
    setSelectedBillId("");
    setAmount("");

    await loadStudentBills(studentId);
  }

  function changePaymentMethod(method: string) {
    setPaymentMethod(method);

    if (method === "cash") {
      const cash = accounts.find(
        (account) => account.account_type === "cash"
      );

      if (cash) setReceiveIntoAccountId(cash.id);
      return;
    }

    if (
      ["bank_transfer", "upi", "card", "online"].includes(method)
    ) {
      const bank = accounts.find(
        (account) => account.account_type === "bank"
      );

      if (bank) setReceiveIntoAccountId(bank.id);
    }
  }

  async function getTransaction(transactionId: string) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        `
          id,
          school_id,
          transaction_number,
          transaction_date,
          transaction_type,
          description,
          reference_type,
          reference_id,
          created_by,
          created_at
        `
      )
      .eq("id", transactionId)
      .eq("school_id", schoolId)
      .single();

    if (error) throw new Error(error.message);

    return data as TransactionRow;
  }

  async function getTransactionEntries(transactionId: string) {
    const { data, error } = await supabase
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
      .eq("transaction_id", transactionId)
      .eq("school_id", schoolId);

    if (error) throw new Error(error.message);

    return (data || []) as TransactionEntry[];
  }

  async function getPayment(
    paymentId: string
  ): Promise<FeePayment | null> {
    const { data, error } = await supabase
      .from("fee_payments")
      .select(
        `
          id,
          school_id,
          student_id,
          receipt_number,
          manual_bill_number,
          payment_date,
          amount,
          payment_method,
          account_id,
          reference_number,
          notes,
          received_by,
          receipt_generated,
          bill_id
        `
      )
      .eq("id", paymentId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    return (data as FeePayment | null) ?? null;
  }

  async function getBill(billId: string) {
    const { data, error } = await supabase
      .from("fee_bills")
      .select(
        `
          id,
          school_id,
          student_id,
          bill_number,
          bill_date,
          due_date,
          status,
          subtotal,
          discount,
          late_fee,
          total_amount,
          paid_amount,
          balance_amount,
          notes
        `
      )
      .eq("id", billId)
      .eq("school_id", schoolId)
      .single();

    if (error) throw new Error(error.message);

    return data as FeeBill;
  }

  async function openView(row: ReceiptHistoryRow) {
    setError("");
    setSuccess("");
    setViewingId(row.id);
  }

  async function openEdit(row: ReceiptHistoryRow) {
    try {
      setError("");
      setSuccess("");
      setSaving(true);

      if (!schoolId) {
        throw new Error("School could not be determined.");
      }

      setEditingId(row.id);
      setViewingId(null);

      /*
       * Student Fee receipts are canonical fee_payments.
       * Do NOT look them up in transactions: canonical receipts
       * may have no legacy transactions row.
       */
      if (row.receipt_type === "student_fee") {
        if (!row.reference_id) {
          throw new Error("Student fee receipt has no payment reference.");
        }

        const payment = await getPayment(row.reference_id);

        if (!payment) {
          throw new Error("Fee payment could not be found.");
        }

        setReceiptType("student_fee");
        setReceiptDate(payment.payment_date);
        setAmount(Number(payment.amount || 0).toFixed(2));
        setManualReceiptNumber(payment.receipt_number || "");
        setPaymentMethod(payment.payment_method);
        setCollectionType("single");
        setCashCollectionAmount("");
        setBankCollectionAmount("");
        setCashCollectionAccountId("");
        setBankCollectionAccountId("");
        if (!payment.account_id && payment.payment_method === "other") {
          throw new Error("This is a split receipt. Split receipt editing is not enabled yet; use View or Delete and create a corrected receipt if required.");
        }
        setReceiveIntoAccountId(payment.account_id || receiveIntoAccountId);
        setReferenceNumber(payment.reference_number || "");
        setNotes(payment.notes || "");

        setSelectedStudentId(payment.student_id);
        setSelectedBillId(payment.bill_id || "");

        const student = students.find(
          (item) => item.id === payment.student_id
        );

        if (student) {
          setSelectedClassId(student.class_id || "");
          setSelectedSectionId(student.section_id || "");
        }

        if (payment.student_id && payment.bill_id) {
          /*
           * EDIT MODE:
           * Never load every historical bill for the student.
           * The receipt must be tied to the exact bill that this payment
           * originally paid. Loading all bills was the reason the edit form
           * displayed the old combined outstanding amount (for example
           * ₹46,200).
           *
           * New receipts use the current Fee Management structure in
           * loadStudentBills(). Existing receipts use their original bill
           * so historical accounting remains correct.
           */
          const { data: linkedBill, error: linkedBillError } = await supabase
            .from("fee_bills")
            .select(
              `
                id,
                school_id,
                student_id,
                academic_year_id,
                bill_number,
                bill_date,
                due_date,
                status,
                subtotal,
                discount,
                late_fee,
                total_amount,
                paid_amount,
                balance_amount,
                notes
              `
            )
            .eq("school_id", schoolId)
            .eq("student_id", payment.student_id)
            .eq("id", payment.bill_id)
            .maybeSingle();

          if (linkedBillError) {
            throw new Error(linkedBillError.message);
          }

          setFeeBills(linkedBill ? [linkedBill as FeeBill] : []);
          setManualBillNumber(linkedBill?.bill_number || "");
          if (linkedBill) {
            const items = await loadReceiptFeeItems(linkedBill.id, payment.id);
            const { data: allocations, error: allocationError } = await supabase
              .from("fee_payment_allocations")
              .select("fee_bill_item_id, amount")
              .eq("school_id", schoolId)
              .eq("payment_id", payment.id)
              .eq("bill_id", linkedBill.id);
            if (allocationError) throw new Error(allocationError.message);
            setReceiptPaymentLines(
              (allocations || [])
                .filter((allocation) => allocation.fee_bill_item_id)
                .map((allocation) => ({
                  feeBillItemId: allocation.fee_bill_item_id as string,
                  amount: Number(allocation.amount || 0).toFixed(2),
                })),
            );
          } else {
            setReceiptFeeItems([]);
            setReceiptPaymentLines([]);
          }
        } else {
          setManualBillNumber("");
          /*
           * A legacy Student Fee receipt without bill_id has no safe bill
           * linkage. Do not guess by loading all of the student's bills.
           */
          setFeeBills([]);
        }

        const feeIncome = accounts.find(
          (account) =>
            account.account_type === "income" &&
            account.name.toLowerCase() === "fee income"
        );

        if (feeIncome) {
          setIncomeAccountId(feeIncome.id);
        }
      } else {
        /* Other Income continues to use the existing transactions ledger. */
        const transaction = await getTransaction(row.id);
        const entries = await getTransactionEntries(row.id);

        const debitEntry = entries.find(
          (entry) => Number(entry.debit || 0) > 0
        );

        const creditEntry = entries.find(
          (entry) => Number(entry.credit || 0) > 0
        );

        setReceiptType("other_income");
        setReceiptDate(transaction.transaction_date);
        setAmount(
          Number(
            debitEntry?.debit ||
              creditEntry?.credit ||
              row.amount ||
              0
          ).toFixed(2)
        );

        setReceiveIntoAccountId(debitEntry?.account_id || "");
        setIncomeAccountId(creditEntry?.account_id || "");

        const description = transaction.description || "";
        const receivedMarker = " - received from ";
        const receivedIndex = description.indexOf(receivedMarker);

        if (receivedIndex >= 0) {
          setParticulars(description.slice(0, receivedIndex).trim());

          const receivedText = description.slice(
            receivedIndex + receivedMarker.length
          );

          const referenceIndex = receivedText.indexOf(" | Reference:");

          if (referenceIndex >= 0) {
            setReceivedFrom(
              receivedText.slice(0, referenceIndex).trim()
            );

            setReferenceNumber(
              receivedText
                .slice(referenceIndex + " | Reference:".length)
                .trim()
            );
          } else {
            setReceivedFrom(receivedText.trim());
            setReferenceNumber("");
          }
        } else {
          setParticulars(description);
          setReceivedFrom("");
          setReferenceNumber("");
        }

        setNotes("");
        setSelectedClassId("");
        setSelectedSectionId("");
        setSelectedStudentId("");
        setSelectedBillId("");
        setFeeBills([]);
        setConcessionsByBillId({});
      }

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (err: any) {
      console.error("EDIT RECEIPT ERROR:", err);

      setEditingId(null);
      setError(
        err?.message || "Unable to load receipt for editing."
      );
    } finally {
      setSaving(false);
    }
  }

  function validateCommon() {
    if (!schoolId) {
      setError("Current school could not be determined.");
      return false;
    }

    const effectiveAmount = receiptType === "student_fee" ? receiptPaymentTotal : numericAmount;
    if (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) {
      setError("Enter a valid payment amount greater than zero.");
      return false;
    }

    if (receiptType === "student_fee" && collectionType === "split") {
      if (!cashCollectionAccountId || !bankCollectionAccountId) {
        setError("Select both Cash and Bank accounts for the split collection.");
        return false;
      }
      if (cashSplit <= 0 || bankSplit <= 0) {
        setError("Enter a positive amount for both Cash and Bank.");
        return false;
      }
      if (Math.abs(splitCollectionTotal - effectiveAmount) > 0.005) {
        setError(`Cash + Bank must equal ${money(effectiveAmount)}.`);
        return false;
      }
      const cashAccount = accounts.find((account) => account.id === cashCollectionAccountId);
      const bankAccount = accounts.find((account) => account.id === bankCollectionAccountId);
      if (!cashAccount || cashAccount.account_type !== "cash") {
        setError("Selected Cash account is invalid.");
        return false;
      }
      if (!bankAccount || bankAccount.account_type !== "bank") {
        setError("Selected Bank account is invalid.");
        return false;
      }
      return true;
    }

    if (!receiveIntoAccountId) {
      setError("Select the Cash or Bank account receiving the money.");
      return false;
    }
    const receiveAccount = accounts.find((account) => account.id === receiveIntoAccountId);
    if (!receiveAccount) {
      setError("Selected Cash/Bank account was not found.");
      return false;
    }
    if (receiveAccount.account_type !== "cash" && receiveAccount.account_type !== "bank") {
      setError("Receive Into must be a Cash or Bank account.");
      return false;
    }
    return true;
  }

  function validateStudentFeeForCreate() {
    if (!selectedClassId) {
      setError("Select the Class / Grade.");
      return false;
    }

    if (!selectedSectionId) {
      setError("Select the Section.");
      return false;
    }

    if (!selectedStudentId) {
      setError("Select the Student.");
      return false;
    }

    if (!selectedStudent) {
      setError("Selected student was not found.");
      return false;
    }

    if (!feeManagementName) {
      setError("Fee Management fee could not be loaded for this student.");
      return false;
    }

    if (!manualBillNumber.trim()) {
      setError("Enter the manual Bill Number.");
      return false;
    }

    if (!manualReceiptNumber.trim()) {
      setError("Enter the manual Receipt Number.");
      return false;
    }

    /*
     * Fee Management is the source of truth for the current fee.
     * Do not require the user to select an existing fee_bill.
     */
    const feeManagementOutstanding = feeBills[0]
      ? Number(feeBills[0].balance_amount || 0)
      : Number(feeManagementAmount || 0);

    if (!Number.isFinite(feeManagementOutstanding) || feeManagementOutstanding <= 0) {
      setError("No outstanding Fee Management amount is available for this student.");
      return false;
    }

    if (receiptPaymentTotal > feeManagementOutstanding + 0.005) {
      setError(
        `Payment cannot exceed Fee Management outstanding ${money(
          feeManagementOutstanding
        )}.`
      );
      return false;
    }

    if (receiptPaymentLines.length === 0) {
      setError("Select at least one fee category and enter an amount.");
      return false;
    }

    const seen = new Set<string>();
    for (const line of receiptPaymentLines) {
      const value = Number(line.amount);
      if (!line.feeBillItemId || !Number.isFinite(value) || value <= 0) {
        setError("Every selected fee category must have a valid amount.");
        return false;
      }
      if (seen.has(line.feeBillItemId)) {
        setError("Each fee category can be added only once to the same receipt.");
        return false;
      }
      seen.add(line.feeBillItemId);
      const item = receiptFeeItems.find((candidate) => candidate.id === line.feeBillItemId);
      if (!item || value > item.balance + 0.005) {
        setError(`Payment exceeds the selected fee category balance.`);
        return false;
      }
    }

    const feeIncome = accounts.find(
      (account) => account.id === incomeAccountId
    );

    if (!feeIncome) {
      setError("Fee Income account was not found.");
      return false;
    }

    if (feeIncome.account_type !== "income") {
      setError("Fee Income must be an Income account.");
      return false;
    }

    return true;
  }

  function validateOtherIncome() {
    if (!receivedFrom.trim()) {
      setError("Enter who the money was received from.");
      return false;
    }

    if (!incomeAccountId) {
      setError("Select the Income Account.");
      return false;
    }

    if (!particulars.trim()) {
      setError("Enter receipt particulars.");
      return false;
    }

    const incomeAccount = accounts.find(
      (account) => account.id === incomeAccountId
    );

    if (!incomeAccount) {
      setError("Selected Income Account was not found.");
      return false;
    }

    if (
      incomeAccount.account_type !== "income" &&
      incomeAccount.account_type !== "receivable"
    ) {
      setError(
        "Selected account must be Income or Receivable."
      );
      return false;
    }

    return true;
  }

  async function createReceipt(event: FormEvent) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!validateCommon()) return;

    if (receiptType === "student_fee") {
      if (!validateStudentFeeForCreate()) return;
    } else {
      if (!validateOtherIncome()) return;
    }

    setSaving(true);

    let createdTransactionId: string | null = null;
    let createdPaymentId: string | null = null;
    let createdReceiptId: string | null = null;
    let paymentId: string | null = null;

    try {
      const {
        data: userData,
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !userData.user) {
        throw new Error("No authenticated user found.");
      }

      const userId = userData.user.id;

      const incomeAccount = accounts.find(
        (account) => account.id === incomeAccountId
      );

      const receiveAccount = accounts.find(
        (account) => account.id === receiveIntoAccountId
      );

      if (!receiveAccount) {
        throw new Error("Receipt receiving account could not be determined.");
      }
      if (receiptType === "other_income" && !incomeAccount) {
        throw new Error("Receipt income account could not be determined.");
      }

      let description = "";

      if (receiptType === "student_fee") {
        const bill = feeBills[0];
        if (!bill) {
          throw new Error("No outstanding fee bill is linked to this student. Assign the fees in Student Fees first.");
        }

        const total = receiptPaymentTotal;
        const allocationPayload = receiptPaymentLines.map((line) => ({
          fee_bill_item_id: line.feeBillItemId,
          amount: Number(line.amount),
        }));

        let data: any = null;
        let rpcError: any = null;
        if (collectionType === "split") {
          const result = await supabase.rpc("record_fee_payment_collection_split", {
            p_student_id: selectedStudentId,
            p_bill_id: bill.id,
            p_amount: total,
            p_receipt_number: manualReceiptNumber.trim(),
            p_payment_date: receiptDate,
            p_reference_number: referenceNumber.trim() || null,
            p_remarks: notes.trim() || null,
            p_allocations: allocationPayload,
            p_splits: [
              { account_id: cashCollectionAccountId, payment_mode: "cash", amount: cashSplit },
              { account_id: bankCollectionAccountId, payment_mode: "bank_transfer", amount: bankSplit },
            ],
          });
          data = result.data;
          rpcError = result.error;
        } else {
          const result = await supabase.rpc("record_fee_payment_collection", {
            p_student_id: selectedStudentId,
            p_bill_id: bill.id,
            p_amount: total,
            p_payment_mode: paymentMethod,
            p_account_id: receiveIntoAccountId,
            p_receipt_number: manualReceiptNumber.trim(),
            p_payment_date: receiptDate,
            p_reference_number: referenceNumber.trim() || null,
            p_remarks: notes.trim() || null,
            p_allocations: allocationPayload,
          });
          data = result.data;
          rpcError = result.error;
        }

        if (rpcError) throw new Error(`Unable to record fee payment: ${rpcError.message}`);
        if (!data || data.success === false) throw new Error(data?.message || "Unable to record fee payment.");

        const paymentId = String(data.payment_id || "");
        if (!paymentId) throw new Error("Payment was recorded but no payment ID was returned.");

        if (manualBillNumber.trim()) {
          const { error: billNumberError } = await supabase
            .from("fee_bills")
            .update({ bill_number: manualBillNumber.trim(), updated_at: new Date().toISOString() })
            .eq("id", bill.id)
            .eq("school_id", schoolId);
          if (billNumberError) throw new Error(`Unable to save bill number: ${billNumberError.message}`);
        }

        await supabase
          .from("fee_payments")
          .update({ receipt_generated: true })
          .eq("id", paymentId)
          .eq("school_id", schoolId);

        const feeItemsForReceipt = receiptPaymentLines.map((line) => {
          const item = receiptFeeItems.find((candidate) => candidate.id === line.feeBillItemId);
          return { description: item?.description || "Fee Payment", amount: Number(line.amount) };
        });

        const refreshedBill = await getBill(bill.id);
        const className = selectedClass?.name || "Class";
        const sectionName = selectedSection?.name || "";

        generateReceiptPDF({
          schoolName: "School",
          receiptNumber: manualReceiptNumber.trim(),
          receiptDate,
          studentName: getStudentName(selectedStudent!),
          admissionNumber: selectedStudent!.admission_no,
          className,
          section: sectionName,
          billNumber: manualBillNumber.trim() || refreshedBill.bill_number,
          feeDescription: feeItemsForReceipt.map((item) => item.description).join(", "),
          particulars: `${getStudentName(selectedStudent!)} • ${className}`,
          feeItems: feeItemsForReceipt,
          amount: total,
          concessionAmount: Number(refreshedBill.discount || 0),
          paymentMode:
            collectionType === "split"
              ? `Split — Cash ${money(cashSplit)} + Bank ${money(bankSplit)}`
              : paymentMethod,
          referenceNumber: referenceNumber.trim() || null,
          previousOutstanding: Number(bill.balance_amount || 0),
          remainingOutstanding: Number(refreshedBill.balance_amount || 0),
          remarks: notes.trim() || null,
        });

        setSuccess(`Receipt ${manualReceiptNumber.trim()} saved successfully.`);
        resetPaymentFields();
        await loadHistory(schoolId!);
        return;
      }

      if (receiptType === "other_income") {
        description = `${particulars.trim()} - received from ${receivedFrom.trim()}`;
        if (referenceNumber.trim()) {
          description += ` | Reference: ${referenceNumber.trim()}`;
        }
      }

      const { data: transaction, error: transactionError } =
        await supabase
          .from("transactions")
          .insert({
            school_id: schoolId,
            transaction_date: receiptDate,
            transaction_type: "income",
            description,
            reference_type:
              receiptType === "student_fee"
                ? "fee_payment"
                : "accounting_receipt",
            reference_id:
              receiptType === "student_fee"
                ? paymentId
                : null,
            created_by: userId,
          })
          .select(
            `
              id,
              transaction_number,
              transaction_date
            `
          )
          .single();

      if (transactionError) {
        throw new Error(
          `Unable to create accounting transaction: ${transactionError.message}`
        );
      }

      if (!transaction) {
        throw new Error(
          "Accounting transaction was not created."
        );
      }

      createdTransactionId = transaction.id;

      const entries = [
        {
          school_id: schoolId,
          transaction_id: transaction.id,
          account_id: receiveIntoAccountId,
          debit: numericAmount,
          credit: 0,
          description:
            `Receipt into ${receiveAccount.name}`,
        },
        {
          school_id: schoolId,
          transaction_id: transaction.id,
          account_id: incomeAccount!.id,
          debit: 0,
          credit: numericAmount,
          description:
            receiptType === "student_fee"
              ? `Fee income - Bill ${manualBillNumber.trim()} - Receipt ${manualReceiptNumber.trim()}`
              : `Income - ${particulars.trim()}`,
        },
      ];

      const { error: entryError } = await supabase
        .from("transaction_entries")
        .insert(entries);

      if (entryError) {
        throw new Error(
          `Accounting entries could not be created: ${entryError.message}`
        );
      }

      const transactionNumber =
        transaction.transaction_number ||
        transaction.id.slice(0, 8);

      setSuccess(
        `Receipt saved successfully â€” ${transactionNumber}. ${money(
          numericAmount
        )} received into ${receiveAccount.name}.`
      );

      resetPaymentFields();

      await loadHistory(schoolId!);
    } catch (err: any) {
      console.error("RECEIPT RECORDING ERROR:", err);

      if (createdReceiptId) {
        await supabase
          .from("receipts")
          .delete()
          .eq("id", createdReceiptId)
          .eq("school_id", schoolId);
      }

      if (createdTransactionId) {
        await supabase
          .from("transaction_entries")
          .delete()
          .eq("transaction_id", createdTransactionId)
          .eq("school_id", schoolId);

        await supabase
          .from("transactions")
          .delete()
          .eq("id", createdTransactionId)
          .eq("school_id", schoolId);
      }

      if (createdPaymentId) {
        await supabase
          .from("fee_payments")
          .delete()
          .eq("id", createdPaymentId)
          .eq("school_id", schoolId);
      }

      setError(
        err?.message || "Unable to save receipt."
      );
    } finally {
      setSaving(false);
    }
  }

  function resetPaymentFields() {
    setSelectedStudentId("");
    setSelectedBillId("");
    setFeeBills([]);
    setReceiptFeeItems([]);
    setReceiptPaymentLines([]);
    setConcessionsByBillId({});
    setAmount("");
    setManualBillNumber("");
    setManualReceiptNumber("");

    setReceivedFrom("");
    setParticulars("");
    setReferenceNumber("");
    setNotes("");

    setEditingId(null);
  }

  async function updateReceipt(event: FormEvent) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!editingId || !schoolId) {
      setError("No receipt selected for editing.");
      return;
    }

    if (!validateCommon()) return;

    setSaving(true);

    try {
      /*
       * Student Fee = canonical fee_payments.
       * Use the dedicated RPC so payment, allocation, bill balance,
       * receipt and canonical journal stay synchronized.
       */
      const editingRow = history.find((item) => item.id === editingId);

      if (!editingRow) {
        throw new Error("Receipt could not be found in receipt history.");
      }

      if (editingRow.receipt_type === "student_fee") {
        if (!editingRow.reference_id) {
          throw new Error("Student fee receipt has no payment reference.");
        }

        if (!selectedStudentId) {
          throw new Error("Select Student.");
        }

        if (!manualBillNumber.trim()) {
          throw new Error("Enter the manual Bill Number.");
        }

        if (!manualReceiptNumber.trim()) {
          throw new Error("Enter the manual Receipt Number.");
        }

        if (receiptPaymentLines.length === 0) {
          throw new Error("Select at least one fee category and enter an amount.");
        }

        for (const line of receiptPaymentLines) {
          const value = Number(line.amount);
          const item = receiptFeeItems.find((candidate) => candidate.id === line.feeBillItemId);
          if (!item || !Number.isFinite(value) || value <= 0) {
            throw new Error("Every selected fee category must have a valid amount.");
          }
          if (value > item.balance + 0.005) {
            throw new Error(`Payment for ${item.description} exceeds its available balance of ${money(item.balance)}.`);
          }
        }

        const duplicateCategory = new Set(receiptPaymentLines.map((line) => line.feeBillItemId));
        if (duplicateCategory.size !== receiptPaymentLines.length) {
          throw new Error("Each fee category can be added only once to the same receipt.");
        }

        const payment = await getPayment(editingRow.reference_id);

        if (!payment) {
          throw new Error("Fee payment could not be found.");
        }

        if (!receiveIntoAccountId) {
          throw new Error("Select the Cash or Bank account receiving the money.");
        }

        const { data, error: rpcError } = await supabase.rpc(
          "update_fee_payment_collection",
          {
            p_payment_id: payment.id,
            p_amount: receiptPaymentTotal,
            p_payment_mode: paymentMethod,
            p_account_id: receiveIntoAccountId,
            p_payment_date: receiptDate,
            p_receipt_number: manualReceiptNumber.trim(),
            p_reference_number: referenceNumber.trim() || null,
            p_remarks: notes.trim() || null,
            p_allocations: receiptPaymentLines.map((line) => ({
              fee_bill_item_id: line.feeBillItemId,
              amount: Number(line.amount),
            })),
          }
        );

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        if (data?.success === false) {
          throw new Error(
            data?.message || "Unable to update fee payment."
          );
        }

        if (payment.bill_id) {
          const { error: billNumberError } = await supabase
            .from("fee_bills")
            .update({
              bill_number: manualBillNumber.trim(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.bill_id)
            .eq("school_id", schoolId);

          if (billNumberError) {
            throw new Error(
              `Unable to update bill number: ${billNumberError.message}`
            );
          }
        }

        setSuccess(
          `Receipt ${manualReceiptNumber.trim()} updated successfully.`
        );

        setEditingId(null);
        await loadHistory(schoolId);
        return;
      }

      /* Other Income keeps the existing transaction workflow. */
      const transaction = await getTransaction(editingId);
      const entries = await getTransactionEntries(editingId);

      const oldDebit = entries.find(
        (entry) => Number(entry.debit || 0) > 0
      );

      const oldCredit = entries.find(
        (entry) => Number(entry.credit || 0) > 0
      );

      if (!oldDebit || !oldCredit) {
        throw new Error("Receipt accounting entries are incomplete.");
      }

      if (!validateOtherIncome()) return;

      const description =
        `${particulars.trim()} - received from ${receivedFrom.trim()}${
          referenceNumber.trim()
            ? ` | Reference: ${referenceNumber.trim()}`
            : ""
        }`;

      await updateTransactionAndEntries(
        transaction.id,
        description,
        receiptDate,
        receiveIntoAccountId,
        incomeAccountId,
        numericAmount
      );

      setSuccess(
        `Receipt ${
          transaction.transaction_number ||
          transaction.id.slice(0, 8)
        } updated successfully.`
      );

      setEditingId(null);
      await loadHistory(schoolId);
    } catch (err: any) {
      console.error("UPDATE RECEIPT ERROR:", err);

      setError(
        err?.message || "Unable to update receipt."
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateTransactionAndEntries(
    transactionId: string,
    description: string,
    transactionDate: string,
    debitAccountId: string,
    creditAccountId: string,
    newAmount: number
  ) {
    const { error: transactionError } =
      await supabase
        .from("transactions")
        .update({
          transaction_date: transactionDate,
          description,
        })
        .eq("id", transactionId)
        .eq("school_id", schoolId);

    if (transactionError) {
      throw new Error(
        `Unable to update transaction: ${transactionError.message}`
      );
    }

    const { error: deleteEntriesError } =
      await supabase
        .from("transaction_entries")
        .delete()
        .eq("transaction_id", transactionId)
        .eq("school_id", schoolId);

    if (deleteEntriesError) {
      throw new Error(
        `Unable to replace accounting entries: ${deleteEntriesError.message}`
      );
    }

    const { error: entryError } = await supabase
      .from("transaction_entries")
      .insert([
        {
          school_id: schoolId,
          transaction_id: transactionId,
          account_id: debitAccountId,
          debit: newAmount,
          credit: 0,
          description: "Receipt debit",
        },
        {
          school_id: schoolId,
          transaction_id: transactionId,
          account_id: creditAccountId,
          debit: 0,
          credit: newAmount,
          description: "Receipt credit",
        },
      ]);

    if (entryError) {
      throw new Error(
        `Unable to recreate accounting entries: ${entryError.message}`
      );
    }
  }

  async function deleteReceipt() {
    if (!deleteTarget || !schoolId) return;

    const row = deleteTarget;

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      if (row.receipt_type === "student_fee") {
        if (!row.reference_id) {
          throw new Error("Student fee receipt has no payment reference.");
        }

        const { error: deleteError } = await supabase.rpc(
          "delete_fee_payment_receipt",
          {
            p_school_id: schoolId,
            p_payment_id: row.reference_id,
          }
        );

        if (deleteError) {
          throw new Error(deleteError.message);
        }

        setDeleteTarget(null);

        setSuccess(
          `Receipt ${
            row.transaction_number || row.id.slice(0, 8)
          } deleted successfully.`
        );

        await loadHistory(schoolId);
        return;
      }

      /* Other Income continues to use the existing delete RPC. */
      const { error: deleteError } = await supabase.rpc(
        "delete_receipt",
        {
          p_transaction_id: row.id,
          p_school_id: schoolId,
        }
      );

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      setDeleteTarget(null);

      setSuccess(
        `Receipt ${
          row.transaction_number || row.id.slice(0, 8)
        } deleted successfully.`
      );

      await loadHistory(schoolId);
    } catch (err: any) {
      console.error("DELETE RECEIPT ERROR:", err);

      setError(
        err?.message || "Unable to delete receipt."
      );
    } finally {
      setSaving(false);
    }
  }

  function printReceipt() {
    window.print();
  }

  function cancelEdit() {
    setEditingId(null);
    setViewingId(null);
    resetPaymentFields();
  }

  return (
    <>
      <style>{`
        @media print {
          body {
            background: white !important;
          }

          body * {
            visibility: hidden;
          }

          #receipt-print-area,
          #receipt-print-area * {
            visibility: visible;
          }

          #receipt-print-area {
            position: absolute;
            inset: 0;
            width: 100%;
            padding: 24px;
            background: white;
          }

          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <main className="min-h-screen bg-slate-50">
        <div className="border-b bg-white no-print">
          <div className="mx-auto max-w-7xl px-6 py-6">
            <Link
              href="/dashboard"
              className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600"
            >
              <ArrowLeft size={16} />
              Dashboard
            </Link>

            <div className="text-sm font-semibold text-blue-600">
              Accounting
            </div>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Receipt
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Create, view, edit, delete and print school receipts.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-6 py-6">
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 no-print">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 no-print">
              <CheckCircle2 size={18} />
              {success}
            </div>
          )}

          {loading ? (
            <section className="rounded-2xl border bg-white p-12 shadow-sm">
              <div className="flex items-center justify-center text-sm text-slate-500">
                <Loader2
                  size={18}
                  className="mr-2 animate-spin"
                />
                Loading school data...
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-2xl border bg-white p-6 shadow-sm no-print">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      {editingId ? "Edit Receipt" : "New Receipt"}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      {editingId
                        ? "Update the receipt and its double-entry accounting."
                        : "Select who paid and where the money was received."}
                    </p>
                  </div>

                  {editingId && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                    >
                      <X size={16} />
                      Cancel Edit
                    </button>
                  )}
                </div>

                <form
                  onSubmit={
                    editingId
                      ? updateReceipt
                      : createReceipt
                  }
                  className="space-y-6"
                >
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Receipt Type
                    </label>

                    <div className="grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        disabled={!!editingId}
                        onClick={() =>
                          changeReceiptType("student_fee")
                        }
                        className={`rounded-xl border p-4 text-left ${
                          receiptType === "student_fee"
                            ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                            : "border-slate-200"
                        } ${
                          editingId
                            ? "cursor-not-allowed opacity-70"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <User
                            size={20}
                            className="text-blue-600"
                          />

                          <div>
                            <div className="font-semibold">
                              Student Fee
                            </div>

                            <div className="text-xs text-slate-500">
                              Collect against a student's fee bill
                            </div>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={!!editingId}
                        onClick={() =>
                          changeReceiptType("other_income")
                        }
                        className={`rounded-xl border p-4 text-left ${
                          receiptType === "other_income"
                            ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                            : "border-slate-200"
                        } ${
                          editingId
                            ? "cursor-not-allowed opacity-70"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Wallet
                            size={20}
                            className="text-emerald-600"
                          />

                          <div>
                            <div className="font-semibold">
                              Other Income
                            </div>

                            <div className="text-xs text-slate-500">
                              Donation, rent, interest, miscellaneous income
                            </div>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Field label="Receipt Date">
                      <input
                        type="date"
                        value={receiptDate}
                        onChange={(e) =>
                          setReceiptDate(e.target.value)
                        }
                        className="input"
                      />
                    </Field>

                    <Field label="Payment Method">
                      <select
                        value={paymentMethod}
                        onChange={(e) =>
                          changePaymentMethod(
                            e.target.value
                          )
                        }
                        className="input"
                      >
                        {PAYMENT_METHODS.map(
                          (method) => (
                            <option
                              key={method.value}
                              value={method.value}
                            >
                              {method.label}
                            </option>
                          )
                        )}
                      </select>
                    </Field>

                    {(receiptType !== "student_fee" || collectionType === "single") && (
                    <Field label="Receive Into">
                      <select
                        value={receiveIntoAccountId}
                        onChange={(e) =>
                          setReceiveIntoAccountId(
                            e.target.value
                          )
                        }
                        className="input"
                      >
                        <option value="">
                          Select Cash / Bank
                        </option>

                        {cashBankAccounts.map(
                          (account) => (
                            <option
                              key={account.id}
                              value={account.id}
                            >
                              {account.name}
                              {account.code
                                ? ` (${account.code})`
                                : ""}
                            </option>
                          )
                        )}
                      </select>
                    </Field>
                    )}

                    {receiptType !== "student_fee" && (
                    <Field label="Amount">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    
                        </span>

                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={amount}
                          onChange={(e) =>
                            setAmount(
                              e.target.value
                            )
                          }
                          placeholder="0.00"
                          className="input pl-8"
                        />
                      </div>
                    </Field>
                    )}
                  </div>

                  {receiptType === "student_fee" && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">Collection Type</h4>
                          <p className="mt-1 text-xs text-slate-500">One receipt can be paid partly in Cash and partly through Bank/Online.</p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" disabled={!!editingId} onClick={() => setCollectionType("single")} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${collectionType === "single" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>Single Payment</button>
                          <button type="button" disabled={!!editingId} onClick={() => setCollectionType("split")} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${collectionType === "split" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>Split — Cash + Bank</button>
                        </div>
                      </div>
                      {collectionType === "split" && (
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <Field label="Cash Amount *">
                            <input type="number" min="0" step="0.01" value={cashCollectionAmount} onChange={(e) => setCashCollectionAmount(e.target.value)} className="input" placeholder="0.00" />
                            <select value={cashCollectionAccountId} onChange={(e) => setCashCollectionAccountId(e.target.value)} className="input mt-2">
                              <option value="">Select Cash Account</option>
                              {cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.code ? ` (${account.code})` : ""}</option>)}
                            </select>
                          </Field>
                          <Field label="Bank / Online Amount *">
                            <input type="number" min="0" step="0.01" value={bankCollectionAmount} onChange={(e) => setBankCollectionAmount(e.target.value)} className="input" placeholder="0.00" />
                            <select value={bankCollectionAccountId} onChange={(e) => setBankCollectionAccountId(e.target.value)} className="input mt-2">
                              <option value="">Select Bank Account</option>
                              {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.code ? ` (${account.code})` : ""}</option>)}
                            </select>
                          </Field>
                          <div className="md:col-span-2 rounded-lg bg-blue-50 px-4 py-3 text-sm">
                            <span className="font-semibold text-slate-700">Split Total: </span>
                            <span className={`font-bold ${Math.abs(splitCollectionTotal - receiptPaymentTotal) <= 0.005 ? "text-emerald-700" : "text-red-600"}`}>{money(splitCollectionTotal)}</span>
                            <span className="ml-2 text-slate-500">of {money(receiptPaymentTotal)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {receiptType === "student_fee" && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-5">
                      <div className="mb-5">
                        <h3 className="font-semibold text-slate-900">
                          Student Fee Collection
                        </h3>

                        <p className="mt-1 text-xs text-slate-500">
                          Filter by Class  Section  Student  Fee Bill.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label="Class / Grade">
                          <select
                            value={selectedClassId}
                            onChange={(e) =>
                              handleClassChange(
                                e.target.value
                              )
                            }
                            className="input"
                          >
                            <option value="">
                              Select Class / Grade
                            </option>

                            {classes.map((item) => (
                              <option
                                key={item.id}
                                value={item.id}
                              >
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </Field>

                        <Field label="Section">
                          <select
                            value={selectedSectionId}
                            onChange={(e) =>
                              handleSectionChange(
                                e.target.value
                              )
                            }
                            disabled={!selectedClassId}
                            className="input disabled:bg-slate-100"
                          >
                            <option value="">
                              {!selectedClassId
                                ? "Select Class first"
                                : "Select Section"}
                            </option>

                            {filteredSections.map(
                              (section) => (
                                <option
                                  key={section.id}
                                  value={section.id}
                                >
                                  {section.name}
                                </option>
                              )
                            )}
                          </select>
                        </Field>

                        <Field label="Student">
                          <select
                            value={selectedStudentId}
                            onChange={(e) =>
                              handleStudentChange(
                                e.target.value
                              )
                            }
                            disabled={
                              !selectedSectionId
                            }
                            className="input disabled:bg-slate-100"
                          >
                            <option value="">
                              {!selectedSectionId
                                ? "Select Section first"
                                : "Select Student"}
                            </option>

                            {filteredStudents.map(
                              (student) => (
                                <option
                                  key={student.id}
                                  value={student.id}
                                >
                                  {getStudentName(
                                    student
                                  )}{" "}
                                  â€”{" "}
                                  {
                                    student.admission_no
                                  }
                                </option>
                              )
                            )}
                          </select>
                        </Field>
                      </div>

                      {feeManagementName && (
                        <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                                Fee Management
                              </div>
                              <div className="mt-1 font-semibold text-slate-900">
                                {feeManagementName}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Current academic year: {feeManagementAcademicYear}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-slate-500">
                                Current Fee
                              </div>
                              <div className="text-lg font-bold text-emerald-700">
                                {money(feeManagementAmount)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <Field label="Manual Bill Number *">
                          <input
                            type="text"
                            value={manualBillNumber}
                            onChange={(e) =>
                              setManualBillNumber(e.target.value)
                            }
                            disabled={!selectedStudentId || saving}
                            placeholder="Enter physical bill number"
                            className="input disabled:bg-slate-100"
                            autoComplete="off"
                          />
                          <p className="mt-1 text-xs text-slate-500">
                            Enter the exact Bill Number printed on the physical/offline bill.
                          </p>
                        </Field>

                        <Field label="Manual Receipt Number *">
                          <input
                            type="text"
                            value={manualReceiptNumber}
                            onChange={(e) =>
                              setManualReceiptNumber(e.target.value)
                            }
                            disabled={saving}
                            placeholder="Enter physical receipt number"
                            className="input disabled:bg-slate-100"
                            autoComplete="off"
                          />
                          <p className="mt-1 text-xs text-slate-500">
                            Enter the exact Receipt Number printed on the physical/offline receipt.
                          </p>
                        </Field>

                        <Field label="Fee Bill Status">
                          <div className="input flex items-center bg-slate-50 text-slate-700">
                            {loadingBills
                              ? "Checking current fee..."
                              : !selectedStudentId
                                ? "Select Student first"
                                : feeBills[0]
                                  ? `Outstanding ${money(Number(feeBills[0].balance_amount || 0))}`
                                  : `Current Fee ${money(Number(feeManagementAmount || 0))}`}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            Bill number is manual; outstanding is read from Fee Management.
                          </p>
                        </Field>
                      </div>

                      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">Fee Categories & Payment Amounts</h4>
                            <p className="mt-1 text-xs text-slate-500">Select the categories actually being paid. One receipt can contain multiple categories.</p>
                          </div>
                          <div className="rounded-lg bg-blue-50 px-3 py-2 text-right">
                            <div className="text-[10px] font-semibold uppercase text-slate-500">This Collection</div>
                            <div className="text-sm font-bold text-blue-700">{money(receiptPaymentTotal)}</div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-3">
                          {receiptPaymentLines.map((line, index) => {
                            const item = receiptFeeItems.find((candidate) => candidate.id === line.feeBillItemId);
                            return (
                              <div key={`${line.feeBillItemId}-${index}`} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
                                <Field label="Fee Category">
                                  <select
                                    value={line.feeBillItemId}
                                    onChange={(e) => setReceiptPaymentLines((current) => current.map((candidate, i) => i === index ? { ...candidate, feeBillItemId: e.target.value, amount: "" } : candidate))}
                                    className="input"
                                  >
                                    <option value="">Select Fee Category</option>
                                    {receiptFeeItems.map((feeItem) => (
                                      <option key={feeItem.id} value={feeItem.id} disabled={receiptPaymentLines.some((candidate, i) => i !== index && candidate.feeBillItemId === feeItem.id)}>
                                        {feeItem.description} — Due {money(feeItem.balance)}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="Amount">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    max={item?.balance ?? undefined}
                                    value={line.amount}
                                    onChange={(e) => setReceiptPaymentLines((current) => current.map((candidate, i) => i === index ? { ...candidate, amount: e.target.value } : candidate))}
                                    placeholder="Enter amount"
                                    className="input"
                                  />
                                  {item && item.balance > 0 && (
                                    <div className="mt-1.5 flex gap-1.5">
                                      {[25, 50, 100].map((percent) => (
                                        <button
                                          key={percent}
                                          type="button"
                                          onClick={() => setReceiptPaymentLines((current) => current.map((candidate, i) => i === index ? { ...candidate, amount: (item.balance * percent / 100).toFixed(2) } : candidate))}
                                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                                        >
                                          {percent}%
                                        </button>
                                      ))}
                                      <button
                                        type="button"
                                        onClick={() => setReceiptPaymentLines((current) => current.map((candidate, i) => i === index ? { ...candidate, amount: item.balance.toFixed(2) } : candidate))}
                                        className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                                      >
                                        Full
                                      </button>
                                    </div>
                                  )}
                                </Field>
                                <button
                                  type="button"
                                  onClick={() => setReceiptPaymentLines((current) => current.filter((_, i) => i !== index))}
                                  disabled={receiptPaymentLines.length <= 1}
                                  className="rounded-lg border border-red-200 px-3 py-2.5 text-xs font-semibold text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const available = receiptFeeItems.find((item) => item.balance > 0 && !receiptPaymentLines.some((line) => line.feeBillItemId === item.id));
                            if (available) setReceiptPaymentLines((current) => [...current, { feeBillItemId: available.id, amount: "" }]);
                          }}
                          disabled={!receiptFeeItems.some((item) => item.balance > 0 && !receiptPaymentLines.some((line) => line.feeBillItemId === item.id))}
                          className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-40"
                        >
                          + Add Another Fee Category
                        </button>
                      </div>

                      {selectedStudent && (
                        <div className="mt-4 rounded-xl bg-white p-4">
                          <div className="grid gap-4 md:grid-cols-4">
                            <Detail
                              label="Student"
                              value={getStudentName(
                                selectedStudent
                              )}
                            />

                            <Detail
                              label="Admission No."
                              value={
                                selectedStudent.admission_no
                              }
                            />

                            <Detail
                              label="Class / Grade"
                              value={
                                selectedClass?.name || "-"
                              }
                            />

                            <Detail
                              label="Section"
                              value={
                                selectedSection?.name || "-"
                              }
                            />
                          </div>

                          <div className="mt-4 border-t pt-4">
                            {selectedBill ? (
                              <div className="grid gap-3 sm:grid-cols-4">
                                <Detail
                                  label="Gross Fee"
                                  value={money(Number(selectedBill.subtotal || 0))}
                                />
                                <Detail
                                  label="Concession"
                                  value={money(selectedBillConcession)}
                                />
                                <Detail
                                  label="Net Fee"
                                  value={money(selectedBillNetFee)}
                                />
                                <Detail
                                  label="Paid"
                                  value={money(Number(selectedBill.paid_amount || 0))}
                                />
                              </div>
                            ) : null}

                            <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3">
                              <div className="text-xs font-medium text-red-600">
                                Outstanding
                              </div>
                              <div className="mt-1 text-xl font-bold text-red-700">
                                {money(
                                  selectedBill
                                    ? Number(selectedBill.balance_amount)
                                    : feeBills.reduce(
                                        (total, bill) =>
                                          total + Number(bill.balance_amount || 0),
                                        0
                                      )
                                )}
                              </div>
                              {selectedBillConcession > 0 && (
                                <div className="mt-1 text-xs text-red-600">
                                  Concession has already been applied to this bill.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {receiptType === "other_income" && (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-5">
                      <h3 className="mb-4 font-semibold">
                        Other Income
                      </h3>

                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Received From">
                          <input
                            type="text"
                            value={receivedFrom}
                            onChange={(e) =>
                              setReceivedFrom(
                                e.target.value
                              )
                            }
                            placeholder="Person / company / foundation"
                            className="input"
                          />
                        </Field>

                        <Field label="Income Account">
                          <select
                            value={incomeAccountId}
                            onChange={(e) =>
                              setIncomeAccountId(
                                e.target.value
                              )
                            }
                            className="input"
                          >
                            <option value="">
                              Select Income Account
                            </option>

                            {incomeAccounts.map(
                              (account) => (
                                <option
                                  key={account.id}
                                  value={account.id}
                                >
                                  {account.name}
                                </option>
                              )
                            )}
                          </select>
                        </Field>

                        <div className="md:col-span-2">
                          <Field label="Particulars">
                            <input
                              type="text"
                              value={particulars}
                              onChange={(e) =>
                                setParticulars(
                                  e.target.value
                                )
                              }
                              placeholder="Donation, rent, interest, miscellaneous income..."
                              className="input"
                            />
                          </Field>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Reference / Cheque / UTR">
                      <input
                        type="text"
                        value={referenceNumber}
                        onChange={(e) =>
                          setReferenceNumber(
                            e.target.value
                          )
                        }
                        placeholder="Optional reference"
                        className="input"
                      />
                    </Field>

                    <Field label="Notes">
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) =>
                          setNotes(e.target.value)
                        }
                        placeholder="Optional notes"
                        className="input"
                      />
                    </Field>
                  </div>

                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <CheckCircle2
                        size={18}
                        className="text-blue-600"
                      />

                      <h3 className="font-semibold">
                        Accounting Entry
                      </h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-lg bg-white p-4">
                        <div className="text-xs text-slate-500">
                          DEBIT
                        </div>

                        <div className="mt-1 font-semibold">
                          {selectedReceiveAccount?.name ||
                            "Cash / Bank"}
                        </div>

                        <div className="mt-2 text-lg font-bold text-emerald-600">
                          {money(numericAmount)}
                        </div>
                      </div>

                      <div className="rounded-lg bg-white p-4">
                        <div className="text-xs text-slate-500">
                          CREDIT
                        </div>

                        <div className="mt-1 font-semibold">
                          {selectedIncomeAccount?.name ||
                            (receiptType ===
                            "student_fee"
                              ? "Fee Income"
                              : "Income Account")}
                        </div>

                        <div className="mt-2 text-lg font-bold text-blue-600">
                          {money(numericAmount)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={
                        editingId
                          ? cancelEdit
                          : resetForm
                      }
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 font-semibold hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw size={16} />
                      {editingId
                        ? "Cancel"
                        : "Clear"}
                    </button>

                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2
                            size={17}
                            className="animate-spin"
                          />
                          Saving...
                        </>
                      ) : editingId ? (
                        <>
                          <Pencil size={17} />
                          Update Receipt
                        </>
                      ) : (
                        <>
                          <Plus size={17} />
                          Save Receipt
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </section>

              <section className="mt-6 overflow-hidden rounded-2xl border bg-white no-print">
                <div className="flex items-center justify-between border-b px-5 py-4">
                  <div>
                    <h2 className="font-semibold">
                      Receipt History
                    </h2>

                    <p className="text-xs text-slate-500">
                      {filteredHistory.length} of {history.length} receipts
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="text-slate-500">
                        Date range: <span className="font-semibold text-slate-700">{historyDateRangeLabel}</span>
                      </span>
                      <span className="font-bold text-emerald-700">
                        Total Collected: {money(filteredHistoryTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={historyTypeFilter}
                      onChange={(event) => setHistoryTypeFilter(event.target.value as ReceiptType | "all")}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="all">All receipt types</option>
                      <option value="student_fee">Student Fee</option>
                      <option value="other_income">Other Income</option>
                    </select>

                    <select
                      value={historyCategoryFilter}
                      onChange={(event) => setHistoryCategoryFilter(event.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="all">All fee categories</option>
                      {historyCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>

                    <input
                      type="date"
                      value={historyFromDate}
                      onChange={(event) => setHistoryFromDate(event.target.value)}
                      title="From date"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />

                    <input
                      type="date"
                      value={historyToDate}
                      onChange={(event) => setHistoryToDate(event.target.value)}
                      title="To date"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />

                    <button
                      type="button"
                      onClick={exportHistoryPDF}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                      PDF
                    </button>

                    <button
                      type="button"
                      onClick={exportHistoryExcel}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                    >
                      Excel
                    </button>

                  <button
                    type="button"
                    onClick={() =>
                      schoolId &&
                      loadHistory(schoolId)
                    }
                    className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                  </div>
                </div>

                {filteredHistory.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    No receipts found.
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
                            Receipt No.
                          </th>

                          <th className="px-5 py-3 text-left text-xs text-slate-500">
                            Bill No.
                          </th>

                          <th className="px-5 py-3 text-left text-xs text-slate-500">
                            Student / Class
                          </th>

                          <th className="px-5 py-3 text-left text-xs text-slate-500">
                            Fee Categories Paid
                          </th>

                          <th className="px-5 py-3 text-left text-xs text-slate-500">
                            Debit
                          </th>

                          <th className="px-5 py-3 text-left text-xs text-slate-500">
                            Credit
                          </th>

                          <th className="px-5 py-3 text-left text-xs text-slate-500">
                            Particulars
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
                        {filteredHistory.map((row) => (
                          <tr key={row.id}>
                            <td className="px-5 py-4 text-sm">
                              {row.transaction_date}
                            </td>

                            <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-700">
                              {row.transaction_number ||
                                row.id.slice(0, 8)}
                            </td>

                            <td className="px-5 py-4 text-sm font-semibold text-slate-700">
                              {row.manual_bill_number || "—"}
                            </td>

                            <td className="px-5 py-4 text-sm">
                              <div className="font-semibold text-slate-800">
                                {row.student_name || "—"}
                              </div>
                              <div className="text-xs text-slate-500">
                                {row.class_name || "—"}{row.section_name ? ` • ${row.section_name}` : ""}
                              </div>
                            </td>

                            <td className="max-w-[240px] px-5 py-4 text-xs font-semibold text-blue-700">
                              {getDisplayedHistoryCategories(row).join(", ") || "—"}
                            </td>

                            <td className="px-5 py-4 text-sm text-emerald-700">
                              {row.debit_account}
                            </td>

                            <td className="px-5 py-4 text-sm text-blue-700">
                              {row.credit_account}
                            </td>

                            <td className="max-w-[360px] px-5 py-4 text-sm font-medium text-slate-700">
                              {row.receipt_type === "student_fee"
                                ? [row.student_name, row.class_name].filter(Boolean).join(" • ") || "—"
                                : row.description}
                            </td>

                            <td className="px-5 py-4 text-right font-semibold text-emerald-600">
                              {money(getDisplayedHistoryAmount(row))}
                            </td>

                            <td className="px-5 py-4">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openView(row)
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                                >
                                  <Eye size={14} />
                                  View
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    openEdit(row)
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget(row)
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>

                      <tfoot>
                        <tr className="border-t-2 bg-slate-50">
                          <td
                            colSpan={9}
                            className="px-5 py-3 text-right text-sm font-bold text-slate-700"
                          >
                            Filtered Total
                          </td>
                          <td className="px-5 py-3 text-right text-base font-bold text-emerald-700">
                            {money(filteredHistoryTotal)}
                          </td>
                          <td className="px-5 py-3"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-3 no-print">
            <InfoCard
              icon={<User size={20} />}
              title="Student Fee"
              text="Select Class, Section and Student, then enter the physical Bill Number manually before recording the payment."
            />

            <InfoCard
              icon={<Wallet size={20} />}
              title="Other Income"
              text="Record donations, rent, interest and other school income with the payer."
            />

            <InfoCard
              icon={<Landmark size={20} />}
              title="Double Entry"
              text="Cash/Bank is debited and Fee Income or the selected income account is credited."
            />
          </div>
        </div>

        {viewingId && (
          <ReceiptViewModal
            transactionId={viewingId}
            history={history}
            onClose={() => setViewingId(null)}
            onPrint={printReceipt}
            getTransaction={getTransaction}
            getTransactionEntries={getTransactionEntries}
            getPayment={getPayment}
            getBill={getBill}
            students={students}
            classes={classes}
            sections={sections}
            accounts={accounts}
          />
        )}

        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 no-print">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <Trash2 size={20} />
                </div>

                <div>
                  <h3 className="font-bold text-slate-900">
                    Delete Receipt?
                  </h3>

                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    This will delete the receipt accounting transaction.
                    Student fee payments will also be removed and the
                    fee bill balance will be restored.
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm">
                <div className="font-semibold">
                  {deleteTarget.transaction_number ||
                    deleteTarget.id.slice(0, 8)}
                </div>

                <div className="mt-1 text-slate-500">
                  {deleteTarget.description}
                </div>

                <div className="mt-2 font-bold text-red-600">
                  {money(deleteTarget.amount)}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setDeleteTarget(null)
                  }
                  disabled={saving}
                  className="rounded-lg border px-4 py-2.5 font-semibold"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={deleteReceipt}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2
                      size={16}
                      className="animate-spin"
                    />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Delete Receipt
                </button>
              </div>
            </div>
          </div>
        )}

        {viewingId && (
          <div
            id="receipt-print-area"
            className="hidden print:block"
          />
        )}
      </main>
    </>
  );
}

/* -------------------------------------------------------
 * View modal
 * ----------------------------------------------------- */

function ReceiptViewModal({
  transactionId,
  history,
  onClose,
  onPrint,
  getTransaction,
  getTransactionEntries,
  getPayment,
  getBill,
  students,
  classes,
  sections,
  accounts,
}: {
  transactionId: string;
  history: ReceiptHistoryRow[];
  onClose: () => void;
  onPrint: () => void;
  getTransaction: (
    id: string
  ) => Promise<TransactionRow>;
  getTransactionEntries: (
    id: string
  ) => Promise<TransactionEntry[]>;
  getPayment: (
    id: string
  ) => Promise<FeePayment | null>;
  getBill: (
    id: string
  ) => Promise<FeeBill>;
  students: Student[];
  classes: ClassRow[];
  sections: SectionRow[];
  accounts: Account[];
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [transaction, setTransaction] =
    useState<TransactionRow | null>(null);

  const [entries, setEntries] =
    useState<TransactionEntry[]>([]);

  const [payment, setPayment] =
    useState<FeePayment | null>(null);

  const [bill, setBill] =
    useState<FeeBill | null>(null);

  const [concession, setConcession] =
    useState<number>(0);

  const [feeCategories, setFeeCategories] = useState<Array<{ description: string; amount: number }>>([]);

  const row = history.find(
    (item) => item.id === transactionId
  );

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError("");
        setFeeCategories([]);

        let transaction: TransactionRow;
        let entries: TransactionEntry[] = [];
        let payment: FeePayment | null = null;
        let bill: FeeBill | null = null;
        let concession = 0;

        if (row?.receipt_type === "student_fee" && row.reference_id) {
          payment = await getPayment(row.reference_id);
          if (!payment) throw new Error("Fee payment could not be found.");

          transaction = {
            id: payment.id,
            school_id: payment.school_id,
            transaction_number: payment.receipt_number,
            transaction_date: payment.payment_date,
            transaction_type: "receipt",
            description: row.description || `Fee collection - ${payment.receipt_number}`,
            reference_type: "fee_payment",
            reference_id: payment.id,
            created_by: payment.received_by,
          };

          if (payment.bill_id) {
            bill = await getBill(payment.bill_id);

            const client = createClient();
            const { data: concessions, error: concessionError } = await client
              .from("fee_concessions")
              .select("amount")
              .eq("school_id", payment.school_id)
              .eq("bill_id", payment.bill_id);

            if (concessionError) throw new Error(concessionError.message);

            concession = (concessions || []).reduce(
              (sum, item) => sum + Number(item.amount || 0),
              0
            );
          }

          // Load the exact categories paid by THIS payment. A bill may contain
          // many categories, but the receipt must only show its allocations.
          const client = createClient();
          const { data: allocationRows, error: allocationError } = await client
            .from("fee_payment_allocations")
            .select("amount, fee_bill_item_id")
            .eq("school_id", payment.school_id)
            .eq("payment_id", payment.id);

          if (allocationError) throw new Error(allocationError.message);

          const itemIds = Array.from(new Set(
            (allocationRows || [])
              .map((item) => item.fee_bill_item_id)
              .filter(Boolean) as string[]
          ));

          if (itemIds.length) {
            const { data: itemRows, error: itemError } = await client
              .from("fee_bill_items")
              .select("id, description")
              .eq("school_id", payment.school_id)
              .in("id", itemIds);
            if (itemError) throw new Error(itemError.message);

            const itemMap = new Map((itemRows || []).map((item) => [item.id, item.description]));
            setFeeCategories((allocationRows || []).map((allocation) => ({
              description: itemMap.get(allocation.fee_bill_item_id) || "Fee",
              amount: Number(allocation.amount || 0),
            })));
          } else {
            setFeeCategories([]);
          }

          const client2 = createClient();
          const { data: journal, error: journalError } = await client2
            .from("journal_entries")
            .select("id")
            .eq("school_id", payment.school_id)
            .eq("reference_type", "fee_payment")
            .eq("reference_id", payment.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (journalError) throw new Error(journalError.message);

          if (journal?.id) {
            const { data: lines, error: linesError } = await client2
              .from("journal_lines")
              .select("id, account_id, debit, credit, description")
              .eq("school_id", payment.school_id)
              .eq("journal_entry_id", journal.id);

            if (linesError) throw new Error(linesError.message);

            entries = (lines || []).map((line) => ({
              id: line.id,
              transaction_id: payment!.id,
              account_id: line.account_id,
              debit: Number(line.debit || 0),
              credit: Number(line.credit || 0),
              description: line.description || null,
            }));
          }
        } else {
          transaction = await getTransaction(transactionId);
          entries = await getTransactionEntries(transactionId);
        }

        if (!active) return;

        setTransaction(transaction);
        setEntries(entries);
        setPayment(payment);
        setBill(bill);
        setConcession(concession);
      } catch (err: any) {
        if (!active) return;

        setError(
          err?.message ||
            "Unable to load receipt."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [
    transactionId,
    getTransaction,
    getTransactionEntries,
    getPayment,
    getBill,
  ]);

  const debitEntry = entries.find(
    (entry) => Number(entry.debit || 0) > 0
  );

  const creditEntry = entries.find(
    (entry) => Number(entry.credit || 0) > 0
  );

  const debitAccount = accounts.find(
    (account) =>
      account.id === debitEntry?.account_id
  );

  const creditAccount = accounts.find(
    (account) =>
      account.id === creditEntry?.account_id
  );

  const student = students.find(
    (item) => item.id === payment?.student_id
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 no-print">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="font-bold">
                Receipt Details
              </h2>

              <p className="text-xs text-slate-500">
                {transaction?.transaction_number ||
                  row?.transaction_number ||
                  transactionId.slice(0, 8)}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onPrint}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
              >
                <Printer size={15} />
                PDF / Print
              </button>

              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border p-2"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          <div
            id="receipt-print-area"
            className="p-6"
          >
            {loading ? (
              <div className="flex items-center justify-center p-12 text-sm text-slate-500">
                <Loader2
                  size={18}
                  className="mr-2 animate-spin"
                />
                Loading receipt...
              </div>
            ) : error ? (
              <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            ) : transaction ? (
              <>
                <div className="border-b pb-5 text-center">
                  <div className="text-sm font-semibold text-blue-600">
                    ACCOUNTING RECEIPT
                  </div>

                  <h1 className="mt-1 text-2xl font-bold">
                    Receipt
                  </h1>

                  <p className="mt-1 text-sm text-slate-500">
                    {transaction.transaction_number ||
                      transaction.id.slice(0, 8)}
                  </p>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <PrintDetail
                    label="Date"
                    value={
                      transaction.transaction_date
                    }
                  />

                  <PrintDetail
                    label="Type"
                    value={
                      transaction.reference_type ===
                      "fee_payment"
                        ? "Student Fee"
                        : "Other Income"
                    }
                  />

                  <PrintDetail
                    label="Amount"
                    value={money(
                      Number(
                        debitEntry?.debit ||
                          creditEntry?.credit ||
                          0
                      )
                    )}
                  />
                </div>

                {payment && (
                  <div className="mt-6 rounded-xl border p-5">
                    <h3 className="font-semibold">
                      Student Payment
                    </h3>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <PrintDetail
                        label="Student"
                        value={
                          student
                            ? getStudentName(student)
                            : payment.student_id
                        }
                      />

                      <PrintDetail
                        label="Class"
                        value={
                          student?.class_id
                            ? classes.find((item) => item.id === student.class_id)?.name || "—"
                            : "—"
                        }
                      />

                      <PrintDetail
                        label="Section"
                        value={
                          student?.section_id
                            ? sections.find((item) => item.id === student.section_id)?.name || "—"
                            : "—"
                        }
                      />

                      <PrintDetail
                        label="Receipt Number"
                        value={payment.receipt_number}
                      />

                      <PrintDetail
                        label="Bill Number"
                        value={payment.manual_bill_number || bill?.bill_number || "—"}
                      />

                      <PrintDetail
                        label="Payment Method"
                        value={paymentMethodLabel(
                          payment.payment_method
                        )}
                      />

                      <PrintDetail
                        label="Reference"
                        value={
                          payment.reference_number ||
                          "-"
                        }
                      />

                      <PrintDetail
                        label="Notes"
                        value={
                          payment.notes || "-"
                        }
                      />


                    </div>

                    <div className="mt-5 rounded-xl border bg-slate-50 p-4">
                      <h4 className="font-semibold">Particulars</h4>
                      <div className="mt-2 text-sm font-semibold text-slate-700">
                        {student ? getStudentName(student) : "Student"}
                        {student?.class_id ? ` • ${classes.find((item) => item.id === student.class_id)?.name || "Class"}` : ""}
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border bg-slate-50 p-4">
                      <h4 className="font-semibold">Fee Categories Paid</h4>
                      <div className="mt-3 space-y-2">
                        {feeCategories.length ? feeCategories.map((item) => (
                          <div key={`${item.description}-${item.amount}`} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                            <span>{item.description}</span>
                            <span>{money(item.amount)}</span>
                          </div>
                        )) : <div className="text-sm text-slate-500">—</div>}
                      </div>
                    </div>

                    {bill && (
                      <div className="mt-5 rounded-xl border bg-slate-50 p-4">
                        <h4 className="font-semibold">Fee Summary</h4>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <PrintDetail label="Gross Fee" value={money(bill.subtotal)} />
                          <PrintDetail label="Concession" value={money(concession)} />
                          <PrintDetail
                            label="Net Fee"
                            value={money(Math.max(Number(bill.subtotal || 0) - concession + Number(bill.late_fee || 0), 0))}
                          />
                          <PrintDetail label="Payment Received" value={money(payment.amount)} />
                          <PrintDetail label="Remaining Outstanding" value={money(bill.balance_amount)} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!payment && (
                  <div className="mt-6 rounded-xl border p-5">
                    <h3 className="font-semibold">
                      Other Income
                    </h3>

                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {transaction.description ||
                        "-"}
                    </p>
                  </div>
                )}

                <div className="mt-6 rounded-xl border p-5">
                  <h3 className="font-semibold">
                    Double Entry
                  </h3>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">
                        DEBIT
                      </div>

                      <div className="mt-1 font-semibold">
                        {debitAccount?.name ||
                          "Unknown"}
                      </div>

                      <div className="mt-2 font-bold text-emerald-600">
                        {money(
                          Number(
                            debitEntry?.debit || 0
                          )
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-4">
                      <div className="text-xs text-slate-500">
                        CREDIT
                      </div>

                      <div className="mt-1 font-semibold">
                        {creditAccount?.name ||
                          "Unknown"}
                      </div>

                      <div className="mt-2 font-bold text-blue-600">
                        {money(
                          Number(
                            creditEntry?.credit || 0
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 border-t pt-5 text-center text-xs text-slate-400">
                  This receipt was generated from the school accounting system.
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
 * Small UI components
 * ----------------------------------------------------- */

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>

      {children}
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">
        {label}
      </div>

      <div className="mt-1 font-semibold">
        {value}
      </div>
    </div>
  );
}

function PrintDetail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div className="mt-1 font-semibold text-slate-900">
        {value}
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        {icon}
      </div>

      <h3 className="mt-4 font-semibold">
        {title}
      </h3>

      <p className="mt-1 text-sm leading-6 text-slate-500">
        {text}
      </p>
    </div>
  );
}