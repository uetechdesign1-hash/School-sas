

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
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

type FeeBill = {
  id: string;
  school_id: string;
  student_id: string;
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

function paymentMethodLabel(value: string) {
  return (
    PAYMENT_METHODS.find((item) => item.value === value)?.label || value
  );
}

function generateReceiptNumber() {
  return `RCP-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 6)
    .toUpperCase()}`;
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

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [sections, setSections] = useState<SectionRow[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");

  const [feeBills, setFeeBills] = useState<FeeBill[]>([]);
  const [selectedBillId, setSelectedBillId] = useState("");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeAccountId, setIncomeAccountId] = useState("");

  const [receivedFrom, setReceivedFrom] = useState("");
  const [particulars, setParticulars] = useState("");

  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [history, setHistory] = useState<ReceiptHistoryRow[]>([]);

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

  async function loadStudentBills(studentId: string) {
    if (!schoolId || !studentId) {
      setFeeBills([]);
      setSelectedBillId("");
      return;
    }

    try {
      setLoadingBills(true);

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
        .eq("school_id", schoolId)
        .eq("student_id", studentId)
        .gt("balance_amount", 0)
        .order("bill_date", { ascending: false });

      if (error) throw new Error(error.message);

      setFeeBills((data || []) as FeeBill[]);
      setSelectedBillId("");
      setAmount("");
    } catch (err: any) {
      setError(err?.message || "Unable to load fee bills.");
    } finally {
      setLoadingBills(false);
    }
  }

  async function loadHistory(currentSchoolId: string) {
    const { data: transactions, error: transactionError } =
      await supabase
        .from("transactions")
        .select(
          `
            id,
            transaction_number,
            transaction_date,
            description,
            reference_type,
            reference_id
          `
        )
        .eq("school_id", currentSchoolId)
        .in("reference_type", [
          "fee_payment",
          "accounting_receipt",
        ])
        .order("created_at", { ascending: false })
        .limit(100);

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    if (!transactions?.length) {
      setHistory([]);
      return;
    }

    const transactionIds = transactions.map((item) => item.id);

    const { data: entries, error: entriesError } =
      await supabase
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
        .eq("school_id", currentSchoolId)
        .in("transaction_id", transactionIds);

    if (entriesError) throw new Error(entriesError.message);

    const accountIds = Array.from(
      new Set((entries || []).map((entry) => entry.account_id))
    );

    let entryAccounts: Account[] = [];

    if (accountIds.length) {
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
        .in("id", accountIds);

      if (error) throw new Error(error.message);

      entryAccounts = (data || []) as Account[];
    }

    const accountMap = new Map<string, Account>();

    entryAccounts.forEach((account) => {
      accountMap.set(account.id, account);
    });

    const result = transactions.map((transaction) => {
      const transactionEntries = (entries || []).filter(
        (entry) => entry.transaction_id === transaction.id
      );

      const debitEntry = transactionEntries.find(
        (entry) => Number(entry.debit || 0) > 0
      );

      const creditEntry = transactionEntries.find(
        (entry) => Number(entry.credit || 0) > 0
      );

      return {
        id: transaction.id,
        transaction_number: transaction.transaction_number,
        transaction_date: transaction.transaction_date,
        description: transaction.description,
        debit_account:
          accountMap.get(debitEntry?.account_id || "")?.name ||
          "Unknown",
        credit_account:
          accountMap.get(creditEntry?.account_id || "")?.name ||
          "Unknown",
        amount: Number(
          debitEntry?.debit || creditEntry?.credit || 0
        ),
        receipt_type:
          transaction.reference_type === "fee_payment"
            ? "student_fee"
            : "other_income",
        reference_id: transaction.reference_id,
      } as ReceiptHistoryRow;
    });

    setHistory(result);
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

    setAmount("");
    setReceivedFrom("");
    setParticulars("");
    setReferenceNumber("");
    setNotes("");

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

    setAmount("");
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
    setAmount("");
  }

  function handleSectionChange(sectionId: string) {
    setSelectedSectionId(sectionId);
    setSelectedStudentId("");
    setSelectedBillId("");
    setFeeBills([]);
    setAmount("");
  }

  async function handleStudentChange(studentId: string) {
    setSelectedStudentId(studentId);
    setSelectedBillId("");
    setAmount("");

    await loadStudentBills(studentId);
  }

  function handleBillChange(billId: string) {
    setSelectedBillId(billId);

    const bill = feeBills.find((item) => item.id === billId);

    if (bill) {
      setAmount(Number(bill.balance_amount).toFixed(2));
    }
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

      if (!schoolId) throw new Error("School could not be determined.");

      const transaction = await getTransaction(row.id);
      const entries = await getTransactionEntries(row.id);

      const debitEntry = entries.find(
        (entry) => Number(entry.debit || 0) > 0
      );

      const creditEntry = entries.find(
        (entry) => Number(entry.credit || 0) > 0
      );

      setEditingId(row.id);
      setViewingId(null);

      setReceiptDate(transaction.transaction_date);
      setAmount(
        Number(
          debitEntry?.debit ||
            creditEntry?.credit ||
            row.amount ||
            0
        ).toFixed(2)
      );

      setReceiveIntoAccountId(
        debitEntry?.account_id || ""
      );

      setIncomeAccountId(
        creditEntry?.account_id || ""
      );

      if (transaction.reference_type === "fee_payment") {
        setReceiptType("student_fee");

        if (!transaction.reference_id) {
          throw new Error(
            "Fee transaction has no payment reference."
          );
        }

        const payment = await getPayment(
          transaction.reference_id
        );

        if (!payment) {
          throw new Error("Fee payment could not be found.");
        }

        setPaymentMethod(payment.payment_method);
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

        if (payment.student_id) {
          const { data: bills, error: billsError } =
            await supabase
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
              .eq("school_id", schoolId)
              .eq("student_id", payment.student_id)
              .order("bill_date", { ascending: false });

          if (billsError) {
            throw new Error(billsError.message);
          }

          setFeeBills((bills || []) as FeeBill[]);
        }
      } else {
        setReceiptType("other_income");

        const description = transaction.description || "";

        const receivedMarker = " - received from ";
        const receivedIndex = description.indexOf(
          receivedMarker
        );

        if (receivedIndex >= 0) {
          setParticulars(
            description.slice(0, receivedIndex).trim()
          );

          let receivedText = description.slice(
            receivedIndex + receivedMarker.length
          );

          const referenceIndex = receivedText.indexOf(
            " | Reference:"
          );

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
      }

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (err: any) {
      console.error("EDIT RECEIPT ERROR:", err);

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

    if (!selectedBillId) {
      setError("Select the Fee Bill.");
      return false;
    }

    if (!selectedStudent) {
      setError("Selected student was not found.");
      return false;
    }

    if (!selectedBill) {
      setError("Selected fee bill was not found.");
      return false;
    }

    const outstanding = Number(selectedBill.balance_amount);

    if (numericAmount > outstanding + 0.005) {
      setError(
        `Payment cannot exceed outstanding balance ${money(
          outstanding
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
        description =
          `Fee collection from ${getStudentName(
            selectedStudent!
          )} - ${selectedBill!.bill_number}`;
      } else {
        description =
          `${particulars.trim()} - received from ${receivedFrom.trim()}`;
      }

      if (referenceNumber.trim()) {
        description +=
          ` | Reference: ${referenceNumber.trim()}`;
      }

      let paymentId: string | null = null;

      if (receiptType === "student_fee") {
        const receiptNumber = generateReceiptNumber();

        const { data: payment, error: paymentError } =
          await supabase
            .from("fee_payments")
            .insert({
              school_id: schoolId,
              student_id: selectedStudentId,
              receipt_number: receiptNumber,
              payment_date: receiptDate,
              amount: numericAmount,
              payment_method: paymentMethod,
              account_id: receiveIntoAccountId,
              reference_number:
                referenceNumber.trim() || null,
              notes: notes.trim() || null,
              received_by: userId,
              receipt_generated: true,
              bill_id: selectedBillId,
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
          throw new Error(
            `Unable to record fee payment: ${paymentError.message}`
          );
        }

        if (!payment) {
          throw new Error("Fee payment was not created.");
        }

        createdPaymentId = payment.id;
        paymentId = payment.id;

        const { data: receipt, error: receiptError } =
          await supabase
            .from("receipts")
            .insert({
              school_id: schoolId,
              payment_id: payment.id,
              receipt_number: receiptNumber,
              pdf_storage_path: null,
            })
            .select("id")
            .single();

        if (receiptError) {
          throw new Error(
            `Unable to create fee receipt: ${receiptError.message}`
          );
        }

        createdReceiptId = receipt?.id || null;

        const bill = selectedBill!;

        const oldPaid = Number(bill.paid_amount || 0);
        const oldBalance = Number(bill.balance_amount || 0);

        const newPaid = oldPaid + numericAmount;
        const newBalance = Math.max(
          0,
          oldBalance - numericAmount
        );

        let newStatus = "partial";

        if (newBalance <= 0.005) {
          newStatus = "paid";
        } else if (newPaid <= 0.005) {
          newStatus = "unpaid";
        }

        const { error: billError } = await supabase
          .from("fee_bills")
          .update({
            paid_amount: newPaid,
            balance_amount: newBalance,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", bill.id)
          .eq("school_id", schoolId);

        if (billError) {
          throw new Error(
            `Unable to update fee bill: ${billError.message}`
          );
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
          account_id: incomeAccount.id,
          debit: 0,
          credit: numericAmount,
          description:
            receiptType === "student_fee"
              ? `Fee income - ${selectedBill!.bill_number}`
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
        `Receipt saved successfully — ${transactionNumber}. ${money(
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
    setAmount("");

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
      const transaction = await getTransaction(editingId);
      const entries = await getTransactionEntries(editingId);

      const oldDebit = entries.find(
        (entry) => Number(entry.debit || 0) > 0
      );

      const oldCredit = entries.find(
        (entry) => Number(entry.credit || 0) > 0
      );

      if (!oldDebit || !oldCredit) {
        throw new Error(
          "Receipt accounting entries are incomplete."
        );
      }

      const oldAmount = Number(
        oldDebit.debit || oldCredit.credit || 0
      );

      const receiveAccount = accounts.find(
        (account) => account.id === receiveIntoAccountId
      );

      const incomeAccount = accounts.find(
        (account) => account.id === incomeAccountId
      );

      if (!receiveAccount || !incomeAccount) {
        throw new Error(
          "Receipt accounts could not be determined."
        );
      }

      if (
        transaction.reference_type === "fee_payment"
      ) {
        if (!transaction.reference_id) {
          throw new Error(
            "Fee transaction has no payment reference."
          );
        }

        if (!selectedBillId || !selectedStudentId) {
          throw new Error(
            "Select Student and Fee Bill."
          );
        }

        const payment = await getPayment(
          transaction.reference_id
        );

        if (!payment) {
          throw new Error("Fee payment could not be found.");
        }

        const oldBillId = payment.bill_id;

        if (!oldBillId) {
          throw new Error(
            "Existing fee payment has no bill."
          );
        }

        /*
         * If the user changed the bill, restore the
         * old bill first and apply the new payment
         * to the new bill.
         */
        if (oldBillId !== selectedBillId) {
          const oldBill = await getBill(oldBillId);
          const newBill = await getBill(selectedBillId);

          const restoredPaid = Math.max(
            0,
            Number(oldBill.paid_amount || 0) - oldAmount
          );

          const restoredBalance =
            Number(oldBill.balance_amount || 0) +
            oldAmount;

          const restoredStatus =
            restoredBalance <= 0.005
              ? "paid"
              : restoredPaid <= 0.005
                ? "unpaid"
                : "partial";

          const { error: oldBillError } = await supabase
            .from("fee_bills")
            .update({
              paid_amount: restoredPaid,
              balance_amount: restoredBalance,
              status: restoredStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("id", oldBill.id)
            .eq("school_id", schoolId);

          if (oldBillError) {
            throw new Error(
              `Unable to restore old fee bill: ${oldBillError.message}`
            );
          }

          if (
            numericAmount >
            Number(newBill.balance_amount) + 0.005
          ) {
            throw new Error(
              `Payment cannot exceed outstanding balance ${money(
                Number(newBill.balance_amount)
              )}.`
            );
          }

          const newPaid =
            Number(newBill.paid_amount || 0) +
            numericAmount;

          const newBalance = Math.max(
            0,
            Number(newBill.balance_amount || 0) -
              numericAmount
          );

          const newStatus =
            newBalance <= 0.005
              ? "paid"
              : "partial";

          const { error: newBillError } =
            await supabase
              .from("fee_bills")
              .update({
                paid_amount: newPaid,
                balance_amount: newBalance,
                status: newStatus,
                updated_at: new Date().toISOString(),
              })
              .eq("id", newBill.id)
              .eq("school_id", schoolId);

          if (newBillError) {
            throw new Error(
              `Unable to apply new fee bill: ${newBillError.message}`
            );
          }
        } else {
          const bill = await getBill(oldBillId);

          const restoredPaid = Math.max(
            0,
            Number(bill.paid_amount || 0) - oldAmount
          );

          const restoredBalance =
            Number(bill.balance_amount || 0) +
            oldAmount;

          const availableBalance =
            restoredBalance;

          if (
            numericAmount >
            availableBalance + 0.005
          ) {
            throw new Error(
              `Payment cannot exceed outstanding balance ${money(
                availableBalance
              )}.`
            );
          }

          const newPaid =
            restoredPaid + numericAmount;

          const newBalance = Math.max(
            0,
            availableBalance - numericAmount
          );

          const newStatus =
            newBalance <= 0.005
              ? "paid"
              : newPaid <= 0.005
                ? "unpaid"
                : "partial";

          const { error: billError } =
            await supabase
              .from("fee_bills")
              .update({
                paid_amount: newPaid,
                balance_amount: newBalance,
                status: newStatus,
                updated_at: new Date().toISOString(),
              })
              .eq("id", bill.id)
              .eq("school_id", schoolId);

          if (billError) {
            throw new Error(
              `Unable to update fee bill: ${billError.message}`
            );
          }
        }

        const { error: paymentError } =
          await supabase
            .from("fee_payments")
            .update({
              student_id: selectedStudentId,
              payment_date: receiptDate,
              amount: numericAmount,
              payment_method: paymentMethod,
              account_id: receiveIntoAccountId,
              reference_number:
                referenceNumber.trim() || null,
              notes: notes.trim() || null,
              bill_id: selectedBillId,
            })
            .eq("id", payment.id)
            .eq("school_id", schoolId);

        if (paymentError) {
          throw new Error(
            `Unable to update fee payment: ${paymentError.message}`
          );
        }

        const description =
          `Fee collection from ${getStudentName(
            selectedStudent!
          )} - ${
            (
              await getBill(selectedBillId)
            ).bill_number
          }${
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
      } else {
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
      }

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

      /*
       * Deletion is performed by one PostgreSQL RPC so the receipt,
       * fee payment, bill balance, transaction entries and transaction
       * are handled together.
       *
       * This also handles old/orphan transactions where the linked
       * fee_payment no longer exists.
       */
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
                          ₹
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
                          Filter by Class → Section → Student → Fee Bill.
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
                                  —{" "}
                                  {
                                    student.admission_no
                                  }
                                </option>
                              )
                            )}
                          </select>
                        </Field>
                      </div>

                      <div className="mt-4">
                        <Field label="Fee Bill">
                          <select
                            value={selectedBillId}
                            onChange={(e) =>
                              handleBillChange(
                                e.target.value
                              )
                            }
                            disabled={
                              !selectedStudentId ||
                              loadingBills
                            }
                            className="input disabled:bg-slate-100"
                          >
                            <option value="">
                              {loadingBills
                                ? "Loading fee bills..."
                                : !selectedStudentId
                                  ? "Select Student first"
                                  : feeBills.length === 0
                                    ? "No outstanding fee bills"
                                    : "Select Fee Bill"}
                            </option>

                            {feeBills.map(
                              (bill) => (
                                <option
                                  key={bill.id}
                                  value={bill.id}
                                >
                                  {bill.bill_number} —
                                  Outstanding{" "}
                                  {money(
                                    Number(
                                      bill.balance_amount
                                    )
                                  )}
                                </option>
                              )
                            )}
                          </select>
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

                          <div className="mt-4 border-t pt-4">
                            <div className="text-xs text-slate-500">
                              Outstanding
                            </div>

                            <div className="mt-1 text-xl font-bold text-red-600">
                              {money(
                                selectedBill
                                  ? Number(
                                      selectedBill.balance_amount
                                    )
                                  : feeBills.reduce(
                                      (total, bill) =>
                                        total +
                                        Number(
                                          bill.balance_amount
                                        ),
                                      0
                                    )
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
                      {history.length} receipts
                    </p>
                  </div>

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

                {history.length === 0 ? (
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
                            Type
                          </th>

                          <th className="px-5 py-3 text-left text-xs text-slate-500">
                            Transaction
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
                        {history.map((row) => (
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
                              {row.transaction_number ||
                                row.id.slice(0, 8)}
                            </td>

                            <td className="px-5 py-4 text-sm text-emerald-700">
                              {row.debit_account}
                            </td>

                            <td className="px-5 py-4 text-sm text-blue-700">
                              {row.credit_account}
                            </td>

                            <td className="max-w-[320px] px-5 py-4 text-sm text-slate-600">
                              {row.description}
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
                        ))}
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
              text="Select Class, Section, Student and Fee Bill before recording the payment."
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

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const transaction =
          await getTransaction(transactionId);

        const entries =
          await getTransactionEntries(transactionId);

        let payment: FeePayment | null = null;

        if (
          transaction.reference_type === "fee_payment" &&
          transaction.reference_id
        ) {
          payment = await getPayment(
            transaction.reference_id
          );
        }

        if (!active) return;

        setTransaction(transaction);
        setEntries(entries);
        setPayment(payment);
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
  ]);

  const row = history.find(
    (item) => item.id === transactionId
  );

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
                          payment.bill_id ||
                          "-"
                        }
                      />
                    </div>
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