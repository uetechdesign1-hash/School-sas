"use client";


import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AccountingExportActions } from "../accounting-export";
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

type FeeCategoryRow = {
  id: string;
  school_id: string;
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
  transaction_date: string;
  description: string | null;
  debit_account: string;
  credit_account: string;
  amount: number;
  receipt_type: ReceiptType;
  reference_id: string | null;
  student_id?: string | null;
  manual_bill_number?: string | null;
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

function getStudentClassName(student: Student, classes: ClassRow[]) {
  return (
    classes.find((item) => item.id === student.class_id)?.name ||
    "Class not assigned"
  );
}

function createSystemReceiptNumber(manualBillNumber: string) {
  return `SYS-${manualBillNumber.trim().slice(0, 60)}-${Date.now()}`;
}

function buildStudentFeeParticulars(
  student: Student | null,
  classRow: ClassRow | null,
  feeCategory: FeeCategoryRow | null
) {
  const studentName = student ? getStudentName(student) : "Student";
  const className = classRow?.name || "Class";
  const feeCategoryName = feeCategory?.name || "Fee";

  return `${studentName} - ${className} - ${feeCategoryName}`;
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
  const [receiveIntoAccountId, setReceiveIntoAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [manualBillNumber, setManualBillNumber] = useState("");

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [sections, setSections] = useState<SectionRow[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");

  const [feeBills, setFeeBills] = useState<FeeBill[]>([]);
  const [feeCategories, setFeeCategories] = useState<FeeCategoryRow[]>([]);
  const [concessionsByBillId, setConcessionsByBillId] = useState<Record<string, number>>({});
  const [selectedBillId, setSelectedBillId] = useState("");
  const [selectedFeeCategoryId, setSelectedFeeCategoryId] = useState("");
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
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState<"all" | ReceiptType>("all");
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

  const selectedFeeCategory = useMemo(
    () =>
      feeCategories.find((item) => item.id === selectedFeeCategoryId) || null,
    [feeCategories, selectedFeeCategoryId]
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

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();

    return history.filter((receipt) => {
      if (historyType !== "all" && receipt.receipt_type !== historyType) {
        return false;
      }

      if (historyFromDate && receipt.transaction_date < historyFromDate) {
        return false;
      }

      if (historyToDate && receipt.transaction_date > historyToDate) {
        return false;
      }

      if (!query) return true;

      const student = receipt.student_id
        ? students.find((item) => item.id === receipt.student_id)
        : null;

      return [
        receipt.manual_bill_number,
        receipt.description,
        student ? getStudentName(student) : "",
        student ? getStudentClassName(student, classes) : "",
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [
    classes,
    history,
    historyFromDate,
    historySearch,
    historyToDate,
    historyType,
    students,
  ]);

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

  async function loadFeeCategoriesForBills(billIds: string[]) {
    if (!schoolId || !billIds.length) {
      setFeeCategories([]);
      setSelectedFeeCategoryId("");
      return;
    }

    const { data: billItems, error: billItemsError } = await supabase
      .from("fee_bill_items")
      .select("fee_category_id")
      .eq("school_id", schoolId)
      .in("bill_id", billIds);

    if (billItemsError) {
      throw new Error(
        `Unable to load fee categories for the selected bill: ${billItemsError.message}`
      );
    }

    const categoryIds = Array.from(
      new Set(
        (billItems || [])
          .map((row) => row.fee_category_id as string | null)
          .filter((id): id is string => Boolean(id))
      )
    );

    if (!categoryIds.length) {
      setFeeCategories([]);
      setSelectedFeeCategoryId("");
      return;
    }

    const { data: categoryData, error: categoryError } = await supabase
      .from("fee_categories")
      .select("id, school_id, name")
      .eq("school_id", schoolId)
      .in("id", categoryIds);

    if (categoryError) {
      throw new Error(
        `Unable to load fee categories: ${categoryError.message}`
      );
    }

    const categories = (categoryData || []) as FeeCategoryRow[];
    const selectedCategory =
      categories.find((item) => item.id === selectedFeeCategoryId) || null;

    setFeeCategories(categories);
    setSelectedFeeCategoryId(
      selectedCategory ? selectedCategory.id : categories[0]?.id || ""
    );
  }

  async function loadStudentBills(studentId: string) {
    if (!schoolId || !studentId) {
      setFeeBills([]);
      setFeeCategories([]);
      setConcessionsByBillId({});
      setSelectedBillId("");
      setSelectedFeeCategoryId("");
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
      setFeeManagementName(structure.name);
      setFeeManagementAcademicYear(academicYear.name);
      setFeeManagementAmount(currentFeeManagementAmount);

      const billIds = bills.map((bill) => bill.id);

      if (billIds.length) {
        await loadFeeCategoriesForBills(billIds);
      } else {
        setFeeCategories([]);
        setSelectedFeeCategoryId("");
      }

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

      setSelectedBillId("");
      setAmount("");
    } catch (err: unknown) {
      setFeeBills([]);
      setFeeCategories([]);
      setConcessionsByBillId({});
      setSelectedBillId("");
      setSelectedFeeCategoryId("");
      setAmount("");
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load Fee Management fees."
      );
    } finally {
      setLoadingBills(false);
    }
  }

  async function loadHistory(currentSchoolId: string) {
    const { data, error } = await supabase.rpc("get_receipt_history", {
      p_school_id: currentSchoolId,
    });

    if (error) throw new Error(error.message);

    const receiptHistory = (data || []) as ReceiptHistoryRow[];
    const paymentIds = receiptHistory
      .filter(
        (receipt) =>
          receipt.receipt_type === "student_fee" && receipt.reference_id
      )
      .map((receipt) => receipt.reference_id as string);

    if (!paymentIds.length) {
      setHistory(receiptHistory);
      return;
    }

    const { data: payments, error: paymentError } = await supabase
      .from("fee_payments")
      .select("id, student_id, bill_id")
      .eq("school_id", currentSchoolId)
      .in("id", paymentIds);

    if (paymentError) throw new Error(paymentError.message);

    const paymentById = new Map(
      (payments || []).map((payment) => [payment.id, payment])
    );
    const billIds = (payments || [])
      .map((payment) => payment.bill_id)
      .filter((billId): billId is string => Boolean(billId));

    const billById = new Map<string, { bill_number: string }>();

    if (billIds.length) {
      const { data: bills, error: billError } = await supabase
        .from("fee_bills")
        .select("id, bill_number")
        .eq("school_id", currentSchoolId)
        .in("id", billIds);

      if (billError) throw new Error(billError.message);

      (bills || []).forEach((bill) => {
        billById.set(bill.id, bill);
      });
    }

    setHistory(
      receiptHistory.map((receipt) => {
        const payment = receipt.reference_id
          ? paymentById.get(receipt.reference_id)
          : undefined;

        return {
          ...receipt,
          student_id: payment?.student_id || null,
          manual_bill_number: payment?.bill_id
            ? billById.get(payment.bill_id)?.bill_number || null
            : null,
        };
      })
    );
  }

  function downloadReceiptHistory() {
    if (!filteredHistory.length) return;

    const escapeCsv = (value: string | number | null | undefined) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;

    const rows = filteredHistory.map((receipt) => {
      const student = receipt.student_id
        ? students.find((item) => item.id === receipt.student_id)
        : null;

      return [
        receipt.transaction_date,
        receipt.receipt_type === "student_fee" ? "Student Fee" : "Other Income",
        receipt.manual_bill_number || "",
        student ? getStudentName(student) : "",
        student ? getStudentClassName(student, classes) : "",
        receipt.debit_account,
        receipt.credit_account,
        receipt.description,
        Number(receipt.amount || 0).toFixed(2),
      ];
    });

    const csv = [
      [
        "Date",
        "Type",
        "Manual Bill Number",
        "Student",
        "Class",
        "Debit Account",
        "Credit Account",
        "Description",
        "Amount",
      ],
      ...rows,
    ]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" })
    );
    const link = document.createElement("a");

    link.href = url;
    link.download = `receipt-history-${today()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    } catch (err: unknown) {
      console.error("RECEIPT PAGE LOAD ERROR:", err);

      setError(
        err instanceof Error ? err.message : "Unable to load Receipt page."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    loadPage();
  }, []);

  useEffect(() => {
    if (receiptType !== "student_fee") {
      return;
    }

    if (!selectedStudentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParticulars("");
      return;
    }

    const nextParticulars = buildStudentFeeParticulars(
      selectedStudent,
      selectedClass,
      selectedFeeCategory
    );
    setParticulars((current) => {
      if (current === nextParticulars) {
        return current;
      }
      return nextParticulars;
    });
  }, [receiptType, selectedStudentId, selectedClassId, selectedFeeCategoryId, selectedStudent, selectedClass]);

  function resetForm() {
    setReceiptType("student_fee");
    setReceiptDate(today());
    setPaymentMethod("cash");

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
    setSelectedFeeCategoryId("");

    setFeeBills([]);
    setFeeCategories([]);
    setConcessionsByBillId({});
    setFeeManagementName("");
    setFeeManagementAcademicYear("");
    setFeeManagementAmount(0);

    setAmount("");
    setManualBillNumber("");
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
    setSelectedFeeCategoryId("");
    setFeeBills([]);
    setFeeCategories([]);
    setConcessionsByBillId({});
    setFeeManagementName("");
    setFeeManagementAcademicYear("");
    setFeeManagementAmount(0);

    setAmount("");
    setManualBillNumber("");
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
    setSelectedFeeCategoryId("");
    setFeeBills([]);
    setFeeCategories([]);
    setConcessionsByBillId({});
    setAmount("");
  }

  function handleSectionChange(sectionId: string) {
    setSelectedSectionId(sectionId);
    setSelectedStudentId("");
    setSelectedBillId("");
    setSelectedFeeCategoryId("");
    setFeeBills([]);
    setFeeCategories([]);
    setConcessionsByBillId({});
    setAmount("");
  }

  async function handleStudentChange(studentId: string) {
    setSelectedStudentId(studentId);
    setSelectedBillId("");
    setSelectedFeeCategoryId("");
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
        setPaymentMethod(payment.payment_method);
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

          if (payment.bill_id) {
            await loadFeeCategoriesForBills([payment.bill_id]);
          }
        } else {
          setManualBillNumber("");
          /*
           * A legacy Student Fee receipt without bill_id has no safe bill
           * linkage. Do not guess by loading all of the student's bills.
           */
          setFeeBills([]);
          setFeeCategories([]);
          setSelectedFeeCategoryId("");
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
    } catch (err: unknown) {
      console.error("EDIT RECEIPT ERROR:", err);

      setEditingId(null);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load receipt for editing."
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

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid amount greater than zero.");
      return false;
    }

    if (!receiveIntoAccountId) {
      setError(
        "Select the Cash or Bank account receiving the money."
      );
      return false;
    }

    const receiveAccount = accounts.find(
      (account) => account.id === receiveIntoAccountId
    );

    if (!receiveAccount) {
      setError("Selected Cash/Bank account was not found.");
      return false;
    }

    if (
      receiveAccount.account_type !== "cash" &&
      receiveAccount.account_type !== "bank"
    ) {
      setError(
        "Receive Into must be a Cash or Bank account."
      );
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

    if (!selectedFeeCategoryId) {
      setError("Select the fee category being collected.");
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

    if (numericAmount > feeManagementOutstanding + 0.005) {
      setError(
        `Payment cannot exceed Fee Management outstanding ${money(
          feeManagementOutstanding
        )}.`
      );
      return false;
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

      if (!incomeAccount || !receiveAccount) {
        throw new Error("Receipt accounts could not be determined.");
      }

      let description = "";

      if (receiptType === "student_fee") {
        /*
         * Fee Management is the source of truth. The user supplies the
         * physical/manual Bill Number.
         *
         * If a current Fee Management-linked bill already exists, reuse it
         * and update its bill number to the manual number. If no linked bill
         * exists, create one from the current Fee Management amount.
         */
        let bill = feeBills[0] || null;

        if (bill) {
          const { data: updatedBill, error: billUpdateError } = await supabase
            .from("fee_bills")
            .update({
              bill_number: manualBillNumber.trim(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", bill.id)
            .eq("school_id", schoolId)
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
            .single();

          if (billUpdateError) {
            throw new Error(`Unable to update fee bill number: ${billUpdateError.message}`);
          }

          bill = updatedBill as FeeBill;
        } else {
          const { data: currentAcademicYear, error: academicYearError } =
            await supabase
              .from("academic_years")
              .select("id")
              .eq("school_id", schoolId)
              .eq("is_current", true)
              .order("start_date", { ascending: false })
              .limit(1)
              .maybeSingle();

          if (academicYearError) {
            throw new Error(`Unable to load current academic year: ${academicYearError.message}`);
          }

          if (!currentAcademicYear) {
            throw new Error("No current academic year is configured.");
          }

          const feeAmount = Number(feeManagementAmount || 0);

          if (feeAmount <= 0) {
            throw new Error("Fee Management amount is zero.");
          }

          const { data: newBill, error: newBillError } = await supabase
            .from("fee_bills")
            .insert({
              school_id: schoolId,
              student_id: selectedStudentId,
              academic_year_id: currentAcademicYear.id,
              bill_number: manualBillNumber.trim(),
              bill_date: receiptDate,
              due_date: null,
              status: "unpaid",
              subtotal: feeAmount,
              discount: 0,
              late_fee: 0,
              total_amount: feeAmount,
              paid_amount: 0,
              balance_amount: feeAmount,
              notes: `Created from Fee Management: ${feeManagementName}`,
              created_by: userId,
            })
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
            .single();

          if (newBillError) {
            throw new Error(`Unable to create fee bill: ${newBillError.message}`);
          }

          bill = newBill as FeeBill;

          const { error: billItemError } = await supabase
            .from("fee_bill_items")
            .insert({
              school_id: schoolId,
              bill_id: bill.id,
              fee_structure_id: null,
              description: `Fee Management - ${feeManagementName}`,
              fee_type: "fee",
              amount: feeAmount,
              discount: 0,
              net_amount: feeAmount,
            });

          if (billItemError) {
            await supabase
              .from("fee_bills")
              .delete()
              .eq("id", bill.id)
              .eq("school_id", schoolId);

            throw new Error(`Unable to create fee bill item: ${billItemError.message}`);
          }
        }

        setSelectedBillId(bill.id);

        const systemReceiptNumber = createSystemReceiptNumber(
          manualBillNumber
        );

        const { data: payment, error: paymentError } = await supabase
          .from("fee_payments")
          .insert({
            school_id: schoolId,
            student_id: selectedStudentId,
            receipt_number: systemReceiptNumber,
            payment_date: receiptDate,
            amount: numericAmount,
            payment_method: paymentMethod,
            account_id: receiveIntoAccountId,
            reference_number: referenceNumber.trim() || null,
            notes: notes.trim() || null,
            received_by: userId,
            receipt_generated: true,
            bill_id: bill.id,
          })
          .select(
            `
              id,
              school_id,
              student_id,
              receipt_number,
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
          .single();

        if (paymentError) {
          throw new Error(`Unable to record fee payment: ${paymentError.message}`);
        }

        if (!payment) {
          throw new Error("Fee payment was not created.");
        }

        createdPaymentId = payment.id;
        paymentId = payment.id;

        const { data: receipt, error: receiptError } = await supabase
          .from("receipts")
          .insert({
            school_id: schoolId,
            payment_id: payment.id,
            receipt_number: systemReceiptNumber,
            pdf_storage_path: null,
          })
          .select("id")
          .single();

        if (receiptError) {
          throw new Error(`Unable to create fee receipt: ${receiptError.message}`);
        }

        createdReceiptId = receipt?.id || null;

        const oldPaid = Number(bill.paid_amount || 0);
        const oldBalance = Number(bill.balance_amount || 0);
        const newPaid = oldPaid + numericAmount;
        const newBalance = Math.max(0, oldBalance - numericAmount);

        let newStatus = "partial";
        if (newBalance <= 0.005) {
          newStatus = "paid";
        } else if (newPaid <= 0.005) {
          newStatus = "unpaid";
        }

        const { error: billError } = await supabase
          .from("fee_bills")
          .update({
            bill_number: manualBillNumber.trim(),
            paid_amount: newPaid,
            balance_amount: newBalance,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", bill.id)
          .eq("school_id", schoolId);

        if (billError) {
          throw new Error(`Unable to update fee bill: ${billError.message}`);
        }

        description =
          `${particulars.trim() || buildStudentFeeParticulars(selectedStudent, selectedClass, selectedFeeCategory)} - Bill ${manualBillNumber.trim()}`;
      } else {
        description =
          `${particulars.trim()} - received from ${receivedFrom.trim()}`;
      }

      if (referenceNumber.trim()) {
        description +=
          ` | Reference: ${referenceNumber.trim()}`;
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
          account_id: incomeAccount.id,
          debit: 0,
          credit: numericAmount,
          description:
            receiptType === "student_fee"
              ? `Fee income - Bill ${manualBillNumber.trim()}`
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
    } catch (err: unknown) {
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
        err instanceof Error ? err.message : "Unable to save receipt."
      );
    } finally {
      setSaving(false);
    }
  }

  function resetPaymentFields() {
    setSelectedStudentId("");
    setSelectedBillId("");
    setSelectedFeeCategoryId("");
    setFeeBills([]);
    setFeeCategories([]);
    setConcessionsByBillId({});
    setAmount("");
    setManualBillNumber("");

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

        const payment = await getPayment(editingRow.reference_id);

        if (!payment) {
          throw new Error("Fee payment could not be found.");
        }

        if (!receiveIntoAccountId) {
          throw new Error("Select the Cash or Bank account receiving the money.");
        }

        const feeIncome = accounts.find(
          (account) =>
            account.account_type === "income" &&
            account.name.toLowerCase() === "fee income"
        );

        if (!feeIncome) {
          throw new Error("Fee Income account was not found.");
        }

        const { data, error: rpcError } = await supabase.rpc(
          "update_fee_payment_receipt",
          {
            p_school_id: schoolId,
            p_payment_id: payment.id,
            p_amount: numericAmount,
            p_payment_mode: paymentMethod,
            p_account_id: receiveIntoAccountId,
            p_payment_date: receiptDate,
            p_reference_number: referenceNumber.trim() || null,
            p_remarks: notes.trim() || null,
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

        setSuccess("Fee receipt updated successfully.");

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
    } catch (err: unknown) {
      console.error("UPDATE RECEIPT ERROR:", err);

      setError(
        err instanceof Error ? err.message : "Unable to update receipt."
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
    } catch (err: unknown) {
      console.error("DELETE RECEIPT ERROR:", err);

      setError(
        err instanceof Error ? err.message : "Unable to delete receipt."
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
                              Collect against a student&apos;s fee bill
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
                  </div>

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
                        <Field label="Fee Category *">
                          <select
                            value={selectedFeeCategoryId}
                            onChange={(e) =>
                              setSelectedFeeCategoryId(e.target.value)
                            }
                            disabled={!selectedStudentId || feeCategories.length === 0 || saving}
                            className="input disabled:bg-slate-100"
                          >
                            <option value="">
                              {!selectedStudentId
                                ? "Select Student first"
                                : feeCategories.length === 0
                                  ? "No fee categories available"
                                  : "Select Fee Category"}
                            </option>

                            {feeCategories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-slate-500">
                            Choose the fee category being collected for this student.
                          </p>
                        </Field>

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

                      <div className="mt-4">
                        <Field label="Particulars">
                          <input
                            type="text"
                            value={particulars}
                            readOnly
                            className="input bg-slate-100"
                          />
                        </Field>
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

                          <div className="mt-4">
                            <Link
                              href={`/dashboard/students/${selectedStudent.id}/fees`}
                              className="inline-flex rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              Give / Manage Concession
                            </Link>
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
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={downloadReceiptHistory}
                      disabled={!filteredHistory.length}
                      className="rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Download CSV
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

                <div className="grid gap-3 border-b bg-slate-50/70 px-5 py-4 md:grid-cols-4">
                  <input
                    type="search"
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                    placeholder="Search student, class or bill number"
                    className="input"
                  />

                  <select
                    value={historyType}
                    onChange={(event) =>
                      setHistoryType(event.target.value as "all" | ReceiptType)
                    }
                    className="input"
                  >
                    <option value="all">All receipt types</option>
                    <option value="student_fee">Student Fee</option>
                    <option value="other_income">Other Income</option>
                  </select>

                  <input
                    type="date"
                    value={historyFromDate}
                    onChange={(event) => setHistoryFromDate(event.target.value)}
                    aria-label="History from date"
                    className="input"
                  />

                  <input
                    type="date"
                    value={historyToDate}
                    onChange={(event) => setHistoryToDate(event.target.value)}
                    aria-label="History to date"
                    className="input"
                  />
                </div>

                {filteredHistory.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    No receipts match these filters.
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
                            Type
                          </th>

                          <th className="px-5 py-3 text-left text-xs text-slate-500">
                            Manual Bill Number
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
                        {filteredHistory.map((row) => {
                          const historyStudent = row.student_id
                            ? students.find(
                                (student) => student.id === row.student_id
                              )
                            : null;

                          return (
                          <tr key={row.id}>
                            <td className="px-5 py-4 text-sm">
                              {row.transaction_date}
                            </td>

                            <td className="px-5 py-4">
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                  row.receipt_type ===
                                  "student_fee"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-emerald-100 text-emerald-700"
                                }`}
                              >
                                {row.receipt_type ===
                                "student_fee"
                                  ? "Student Fee"
                                  : "Other Income"}
                              </span>
                            </td>

                            <td className="px-5 py-4 font-mono text-xs">
                              {row.receipt_type === "student_fee"
                                ? row.manual_bill_number || "-"
                                : "-"}
                            </td>

                            <td className="px-5 py-4 text-sm text-emerald-700">
                              {row.debit_account}
                            </td>

                            <td className="px-5 py-4 text-sm text-blue-700">
                              {row.credit_account}
                            </td>

                            <td className="max-w-[320px] px-5 py-4 text-sm text-slate-600">
                              {historyStudent ? (
                                <Link
                                  href={`/dashboard/students/${historyStudent.id}/fees`}
                                  className="block rounded-md text-blue-700 hover:underline"
                                >
                                  <span className="font-medium">
                                    {getStudentName(historyStudent)}
                                  </span>
                                  <span className="block text-xs text-slate-500">
                                    {getStudentClassName(historyStudent, classes)}
                                  </span>
                                </Link>
                              ) : (
                                row.description
                              )}
                            </td>

                            <td className="px-5 py-4 text-right font-semibold text-emerald-600">
                              {money(row.amount)}
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
                          );
                        })}
                      </tbody>
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
              <AccountingExportActions fileName="receipts" />
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

  const row = history.find(
    (item) => item.id === transactionId
  );

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError("");

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

          const client = createClient();
          const { data: journal, error: journalError } = await client
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
            const { data: lines, error: linesError } = await client
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
      } catch (err: unknown) {
        if (!active) return;

        setError(
          err instanceof Error ? err.message : "Unable to load receipt."
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
  /* eslint-enable react-hooks/exhaustive-deps */

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
                        label="Receipt Number"
                        value={payment.receipt_number}
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

                      <PrintDetail
                        label="Fee Bill"
                        value={
                          bill?.bill_number ||
                          payment.bill_id ||
                          "-"
                        }
                      />
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
