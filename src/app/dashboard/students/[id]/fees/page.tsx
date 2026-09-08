"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useParams } from "next/navigation";

import {
  Search,
  Plus,
  X,
  Receipt,
  IndianRupee,
  User,
  Calendar,
  CreditCard,
  Download,
  Loader2,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { generateReceiptPDF } from "@/lib/fees/generateReceipt";

const supabase = createClient();

type Student = {
  id: string;
  school_id: string;
  first_name: string;
  middle_name?: string | null;
  last_name?: string | null;
  admission_no: string;
  roll_no?: string | null;
  class_id?: string | null;
  section_id?: string | null;
  class_name?: string | null;
  section?: string | null;
};

type SchoolClass = {
  id: string;
  name: string;
};

type Section = {
  id: string;
  class_id: string;
  name: string;
};

type FeeBill = {
  id: string;
  academic_year_id?: string | null;
  bill_number: string;
  bill_date: string;
  due_date?: string | null;
  discount?: number;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  status: string;
};

type CarryForwardRecord = {
  id: string;
  source_bill_id: string;
  to_academic_year_id: string;
  amount: number;
  status: string;
  target_bill_id?: string | null;
};

type FeePayment = {
  id: string;
  bill_id?: string | null;
  receipt_number: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  account_id?: string | null;
  reference_number?: string | null;
  notes?: string | null;
};

type School = {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
};


type FinancialAccount = {
  id: string;
  school_id: string;
  name: string;
  account_type: string;
  opening_balance?: number;
  is_system?: boolean;
  is_active: boolean;
};

type AcademicYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type FeeStructure = {
  id: string;
  name: string;
  academic_year_id: string;
  class_id?: string | null;
  active: boolean;
};

type AssignmentItem = {
  id: string;
  fee_category_id: string;
  category_name: string;
  amount: number;
  frequency: string;
  mandatory: boolean;
};

type AssignmentPreview = {
  academicYear: AcademicYear;
  structure: FeeStructure;
  items: AssignmentItem[];
  existingBill: FeeBill | null;
  previousAcademicYear: AcademicYear | null;
  pendingCarryForwards: CarryForwardRecord[];
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getStudentName(student: Student) {
  return [
    student.first_name,
    student.middle_name,
    student.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

export default function FeesPage() {
  const params = useParams<{ id?: string }>();
  const routeStudentId =
    typeof params?.id === "string" ? params.id : null;
  const isLockedStudentRoute = Boolean(routeStudentId);

  const [school, setSchool] = useState<School | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const [bills, setBills] = useState<FeeBill[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [assignmentPreview, setAssignmentPreview] =
    useState<AssignmentPreview | null>(null);
  const [selectedAssignmentItemIds, setSelectedAssignmentItemIds] =
    useState<string[]>([]);
  const [loadingAssignment, setLoadingAssignment] = useState(false);
  const [assigningFees, setAssigningFees] = useState(false);
  const [changingAssignment, setChangingAssignment] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedBill, setSelectedBill] = useState<FeeBill | null>(null);
  const [showConcessionForm, setShowConcessionForm] = useState(false);
  const [concessionAmount, setConcessionAmount] = useState("");
  const [concessionReason, setConcessionReason] = useState("");
  const [savingConcession, setSavingConcession] = useState(false);

  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [financialAccounts, setFinancialAccounts] =
    useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [manualBillNumber, setManualBillNumber] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [notes, setRemarks] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  /*
   * --------------------------------------------------
   * LOAD SCHOOL / CURRENT USER MEMBERSHIP
   * --------------------------------------------------
   *
   * The school is determined from the authenticated user's
   * active school membership. We never select an arbitrary
   * school with .limit(1).
   */
  const loadSchoolContext = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      window.location.assign("/login");
      return null;
    }

    const { data: membership, error: membershipError } = await supabase
      .from("school_users")
      .select("school_id, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership?.school_id) {
      throw new Error("Your account is not assigned to an active school.");
    }

    const currentSchoolId = membership.school_id as string;

    const { data: schoolData, error: schoolError } = await supabase
      .from("schools")
      .select("id, name, address, phone, email")
      .eq("id", currentSchoolId)
      .maybeSingle();

    if (schoolError) {
      throw schoolError;
    }

    if (!schoolData) {
      throw new Error("School could not be found.");
    }

    setSchoolId(currentSchoolId);
    setSchool(schoolData as School);

    return currentSchoolId;
  }, []);

  /*
   * --------------------------------------------------
   * LOAD STUDENTS
   * --------------------------------------------------
   *
   * Correct student columns:
   * admission_no, class_id, section_id.
   *
   * Class and section names are loaded separately because
   * the students table stores IDs, not class_name/section text.
   */
  const loadStudents = useCallback(async (currentSchoolId: string) => {
    setLoadingStudents(true);

    try {
      const { data: studentData, error: studentError } = await supabase
        .from("students")
        .select(
          "id, school_id, first_name, middle_name, last_name, admission_no, roll_no, class_id, section_id",
        )
        .eq("school_id", currentSchoolId)
        .order("first_name", { ascending: true })
        .order("last_name", { ascending: true });

      if (studentError) {
        throw studentError;
      }

      const rawStudents = (studentData || []) as Student[];

      const classIds = Array.from(
        new Set(
          rawStudents
            .map((student) => student.class_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const sectionIds = Array.from(
        new Set(
          rawStudents
            .map((student) => student.section_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      let classes: SchoolClass[] = [];
      let sections: Section[] = [];

      if (classIds.length > 0) {
        const { data: classData, error: classError } = await supabase
          .from("classes")
          .select("id, name")
          .eq("school_id", currentSchoolId)
          .in("id", classIds);

        if (classError) {
          throw classError;
        }

        classes = (classData || []) as SchoolClass[];
      }

      if (sectionIds.length > 0) {
        const { data: sectionData, error: sectionError } = await supabase
          .from("sections")
          .select("id, class_id, name")
          .in("id", sectionIds);

        if (sectionError) {
          throw sectionError;
        }

        sections = (sectionData || []) as Section[];
      }

      const classMap = new Map(
        classes.map((schoolClass) => [schoolClass.id, schoolClass.name]),
      );

      const sectionMap = new Map(
        sections.map((section) => [section.id, section.name]),
      );

      const normalizedStudents = rawStudents.map((student) => ({
        ...student,
        class_name: student.class_id
          ? classMap.get(student.class_id) || null
          : null,
        section: student.section_id
          ? sectionMap.get(student.section_id) || null
          : null,
      }));

      setStudents(normalizedStudents);
    } finally {
      setLoadingStudents(false);
    }
  }, []);

  /*
   * --------------------------------------------------
   * LOAD CASH / BANK ACCOUNTS
   * --------------------------------------------------
   */
  const loadFinancialAccounts = useCallback(
    async (currentSchoolId: string) => {
      setLoadingAccounts(true);

      try {
        /*
         * IMPORTANT:
         * fee_payments.account_id -> accounts.id
         *
         * Do NOT use financial_accounts here. That table has a different
         * primary key and caused the fee_payments_account_id_fkey error.
         */
        const { data, error } = await supabase
          .from("accounts")
          .select(
            "id, school_id, name, account_type, opening_balance, is_system, is_active",
          )
          .eq("school_id", currentSchoolId)
          .eq("is_active", true)
          .in("account_type", ["cash", "bank"])
          .order("name", { ascending: true });

        if (error) {
          throw error;
        }

        setFinancialAccounts((data || []) as FinancialAccount[]);
      } finally {
        setLoadingAccounts(false);
      }
    },
    [],
  );

  /*
   * --------------------------------------------------
   * INITIAL LOAD
   * --------------------------------------------------
   */
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        setMessage(null);

        const currentSchoolId = await loadSchoolContext();

        if (!currentSchoolId || cancelled) {
          return;
        }

        await Promise.all([
          loadStudents(currentSchoolId),
          loadFinancialAccounts(currentSchoolId),
        ]);
      } catch (error) {
        console.error("Fee page initialization error:", error);

        if (!cancelled) {
          setMessage({
            type: "error",
            text:
              error instanceof Error
                ? error.message
                : "Unable to load fee page.",
          });
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [loadSchoolContext, loadStudents, loadFinancialAccounts]);

  /*
   * --------------------------------------------------
   * SEARCH STUDENTS
   * --------------------------------------------------
   */
  const filteredStudents = useMemo(() => {
    const search = studentSearch.trim().toLowerCase();

    if (!search) {
      return students.slice(0, 30);
    }

    return students
      .filter((student) => {
        const name = getStudentName(student).toLowerCase();
        const admission = (student.admission_no || "").toLowerCase();
        const roll = (student.roll_no || "").toLowerCase();

        return (
          name.includes(search) ||
          admission.includes(search) ||
          roll.includes(search)
        );
      })
      .slice(0, 30);
  }, [students, studentSearch]);

  /*
   * --------------------------------------------------
   * LOAD LEDGER
   * --------------------------------------------------
   *
   * School isolation is enforced by first verifying that
   * the selected student belongs to the authenticated
   * user's school. Bills/payments are then loaded only
   * for that verified student.
   */
  const loadLedger = useCallback(
    async (student: Student) => {
      if (!schoolId) {
        throw new Error("School context is not loaded.");
      }

      if (student.school_id !== schoolId) {
        throw new Error("This student does not belong to your school.");
      }

      setLoadingLedger(true);

      try {
        const { data: verifiedStudent, error: studentError } = await supabase
          .from("students")
          .select("id, school_id")
          .eq("id", student.id)
          .eq("school_id", schoolId)
          .maybeSingle();

        if (studentError) {
          throw studentError;
        }

        if (!verifiedStudent) {
          throw new Error("Student was not found in your school.");
        }

        const { data: billData, error: billError } = await supabase
          .from("fee_bills")
          .select(
            "id, academic_year_id, bill_number, bill_date, due_date, total_amount, paid_amount, balance_amount, status",
          )
          .eq("student_id", student.id)
          .order("bill_date", { ascending: false });

        if (billError) {
          throw new Error(
            `Unable to load fee bills: ${billError.message}`,
          );
        }

        // Show bills even if payment history has a separate RLS/schema problem.
        setBills((billData || []) as FeeBill[]);

        const { data: paymentData, error: paymentError } = await supabase
          .from("fee_payments")
          .select(
            "id, school_id, bill_id, receipt_number, payment_date, amount, payment_method, reference_number, notes, account_id, received_by, receipt_generated",
          )
          .eq("school_id", schoolId)
          .eq("student_id", student.id)
          .order("payment_date", { ascending: false });

        if (paymentError) {
          console.error(
            "Payment history loading error:",
            paymentError?.message,
            paymentError?.details,
            paymentError?.hint,
            paymentError?.code,
            paymentError
          );

          setPayments([]);

          setMessage({
            type: "error",
            text: `Fee bills loaded, but payment history could not be loaded: ${paymentError.message}`,
          });
        } else {
          setPayments((paymentData || []) as FeePayment[]);
        }
      } finally {
        setLoadingLedger(false);
      }
    },
    [schoolId],
  );

  /*
   * --------------------------------------------------
   * LOAD APPLICABLE FEE STRUCTURE
   * --------------------------------------------------
   *
   * The student is matched automatically by:
   *   school_id + class_id + current academic year.
   *
   * We then read the structure items and their fee categories.
   * No student can receive a structure from another school.
   */
  const loadAssignmentPreview = useCallback(
    async (student: Student) => {
      if (!schoolId) {
        throw new Error("School context is not loaded.");
      }

      if (student.school_id !== schoolId) {
        throw new Error("This student does not belong to your school.");
      }

      setLoadingAssignment(true);

      try {
        if (!student.class_id) {
          setAssignmentPreview(null);
          throw new Error(
            "This student has no class assigned. Assign a class before assigning fees.",
          );
        }

        const { data: academicYear, error: academicYearError } =
          await supabase
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
          setAssignmentPreview(null);
          throw new Error(
            "No current academic year is configured for this school.",
          );
        }

        // Load the immediately preceding academic year and any unpaid
        // carry-forward records already assigned to this student. Carry
        // forward is kept as a separate ledger item; it is never silently
        // mixed into the new year's fee structure amount.
        const { data: academicYearsData, error: academicYearsError } =
          await supabase
            .from("academic_years")
            .select("id, name, start_date, end_date, is_current")
            .eq("school_id", schoolId)
            .order("start_date", { ascending: true });

        if (academicYearsError) {
          throw new Error(
            `Unable to load academic years: ${academicYearsError.message}`,
          );
        }

        const allAcademicYears = (academicYearsData || []) as AcademicYear[];
        const previousAcademicYear =
          allAcademicYears
            .filter((year) => year.end_date < academicYear.start_date)
            .sort((a, b) => b.end_date.localeCompare(a.end_date))[0] || null;

        const { data: pendingCarryData, error: pendingCarryError } =
          await supabase
            .from("fee_carry_forwards")
            .select(
              "id, source_bill_id, to_academic_year_id, amount, status, target_bill_id",
            )
            .eq("school_id", schoolId)
            .eq("student_id", student.id)
            .eq("to_academic_year_id", academicYear.id)
            .eq("status", "pending");

        if (pendingCarryError) {
          console.error(
            "Carry-forward preview error:",
            pendingCarryError.message,
          );
        }

        const pendingCarryForwards =
          (pendingCarryData || []) as CarryForwardRecord[];

        const { data: structureData, error: structureError } =
          await supabase
            .from("fee_structures")
            .select(
              "id, name, academic_year_id, class_id, active",
            )
            .eq("school_id", schoolId)
            .eq("academic_year_id", academicYear.id)
            .eq("class_id", student.class_id)
            .eq("active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (structureError) {
          throw new Error(
            `Unable to load the class fee structure: ${structureError.message}`,
          );
        }

        if (!structureData) {
          setAssignmentPreview(null);
          throw new Error(
            `No active fee structure was found for ${student.class_name || "this class"} for ${academicYear.name}. Create a fee structure for this class first.`,
          );
        }

        const structure = structureData as FeeStructure;

        const { data: itemData, error: itemError } =
          await supabase
            .from("fee_structure_items")
            .select(
              "id, fee_category_id, amount, frequency, mandatory",
            )
            .eq("school_id", schoolId)
            .eq("fee_structure_id", structure.id)
            .order("created_at", { ascending: true });

        if (itemError) {
          throw new Error(
            `Unable to load fee structure items: ${itemError.message}`,
          );
        }

        const rawItems = (itemData || []) as Array<{
          id: string;
          fee_category_id: string;
          amount: number;
          frequency: string;
          mandatory: boolean;
        }>;

        if (!rawItems.length) {
          setAssignmentPreview(null);
          throw new Error(
            `The fee structure "${structure.name}" has no fee items.`,
          );
        }

        const categoryIds = Array.from(
          new Set(rawItems.map((item) => item.fee_category_id)),
        );

        const { data: categoryData, error: categoryError } =
          await supabase
            .from("fee_categories")
            .select("id, name")
            .eq("school_id", schoolId)
            .in("id", categoryIds);

        if (categoryError) {
          throw new Error(
            `Unable to load fee categories: ${categoryError.message}`,
          );
        }

        const categoryMap = new Map(
          (categoryData || []).map((category) => [
            category.id as string,
            category.name as string,
          ]),
        );

        const items: AssignmentItem[] = rawItems.map((item) => ({
          id: item.id,
          fee_category_id: item.fee_category_id,
          category_name:
            categoryMap.get(item.fee_category_id) ||
            "Fee",
          amount: Number(item.amount || 0),
          frequency: item.frequency || "annual",
          mandatory: Boolean(item.mandatory),
        }));

        const { data: existingBillData, error: existingBillError } =
          await supabase
            .from("fee_bills")
            .select(
              "id, academic_year_id, bill_number, bill_date, due_date, total_amount, paid_amount, balance_amount, status",
            )
            .eq("school_id", schoolId)
            .eq("student_id", student.id)
            .eq("academic_year_id", academicYear.id)
            .order("bill_date", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (existingBillError) {
          throw new Error(
            `Unable to check existing student fee bill: ${existingBillError.message}`,
          );
        }

        const existingBill =
          (existingBillData as FeeBill | null) || null;

        // Mandatory fees are selected automatically.
        // Optional fees require an explicit student-level choice.
        setSelectedAssignmentItemIds(
          items
            .filter((item) => item.mandatory)
            .map((item) => item.id),
        );

        setAssignmentPreview({
          academicYear: academicYear as AcademicYear,
          structure,
          items,
          existingBill,
          previousAcademicYear,
          pendingCarryForwards,
        });
      } finally {
        setLoadingAssignment(false);
      }
    },
    [schoolId],
  );

  /*
   * --------------------------------------------------
   * ASSIGN FEES / CREATE BILL
   * --------------------------------------------------
   *
   * Creates one fee bill from the student's class fee structure.
   * The bill and all bill items carry the authenticated school's
   * school_id. If item creation fails, the bill is removed so
   * we don't leave a half-created assignment behind.
   */
  function toggleAssignmentItem(itemId: string) {
    const item = assignmentPreview?.items.find(
      (candidate) => candidate.id === itemId,
    );

    if (!item || item.mandatory || assignmentPreview?.existingBill) {
      return;
    }

    setSelectedAssignmentItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  const selectedAssignmentItems =
    assignmentPreview?.items.filter((item) =>
      selectedAssignmentItemIds.includes(item.id),
    ) || [];

  const selectedAssignmentTotal = selectedAssignmentItems.reduce(
    (sum, item) =>
      sum + Math.max(Number(item.amount || 0), 0),
    0,
  );

  const selectedAssignmentCarryForward =
    assignmentPreview?.pendingCarryForwards.reduce(
      (sum, record) =>
        sum + Math.max(Number(record.amount || 0), 0),
      0,
    ) || 0;

  const assignmentTotalWithCarry =
    selectedAssignmentTotal + selectedAssignmentCarryForward;

  async function handleChangeFeeSelection() {
    if (!selectedStudent || !schoolId || !assignmentPreview?.existingBill) {
      return;
    }

    const existingBill = assignmentPreview.existingBill;

    if (Number(existingBill.paid_amount || 0) > 0) {
      setMessage({
        type: "error",
        text:
          "This bill already has a payment. Its fee selection cannot be changed.",
      });
      return;
    }

    const confirmed = window.confirm(
      `Change the fee selection for ${getStudentName(
        selectedStudent,
      )}? The unpaid bill ${existingBill.bill_number} will be removed and you can create a new bill with only the selected fees.`,
    );

    if (!confirmed) {
      return;
    }

    setChangingAssignment(true);
    setMessage(null);

    try {
      const { data: paymentRows, error: paymentCheckError } =
        await supabase
          .from("fee_payments")
          .select("id")
          .eq("school_id", schoolId)
          .eq("student_id", selectedStudent.id)
          .eq("bill_id", existingBill.id)
          .limit(1);

      if (paymentCheckError) {
        throw paymentCheckError;
      }

      if (paymentRows && paymentRows.length > 0) {
        throw new Error(
          "This bill has payment history and cannot be changed.",
        );
      }

      // A bill that contains a previous-year carry-forward cannot be
      // deleted by the fee-selection editor because that would orphan the
      // applied carry record. Keep the carry-forward attached to its bill.
      const { data: appliedCarryRows, error: appliedCarryError } =
        await supabase
          .from("fee_carry_forwards")
          .select("id")
          .eq("school_id", schoolId)
          .eq("student_id", selectedStudent.id)
          .eq("target_bill_id", existingBill.id)
          .eq("status", "applied")
          .limit(1);

      if (appliedCarryError) {
        throw appliedCarryError;
      }

      if (appliedCarryRows && appliedCarryRows.length > 0) {
        throw new Error(
          "This bill contains a previous-year carry-forward and cannot be changed.",
        );
      }

      const { error: itemDeleteError } = await supabase
        .from("fee_bill_items")
        .delete()
        .eq("school_id", schoolId)
        .eq("bill_id", existingBill.id);

      if (itemDeleteError) {
        throw new Error(
          `Unable to remove the existing fee items: ${itemDeleteError.message}`,
        );
      }

      const { error: billDeleteError } = await supabase
        .from("fee_bills")
        .delete()
        .eq("school_id", schoolId)
        .eq("id", existingBill.id);

      if (billDeleteError) {
        throw new Error(
          `Unable to remove the existing fee bill: ${billDeleteError.message}`,
        );
      }

      setSelectedAssignmentItemIds(
        assignmentPreview.items
          .filter((item) => item.mandatory)
          .map((item) => item.id),
      );

      await loadAssignmentPreview(selectedStudent);
      await loadLedger(selectedStudent);

      setMessage({
        type: "success",
        text:
          "Existing unpaid bill removed. Select the fees you want and click Assign Fees.",
      });
    } catch (error) {
      console.error(
        "CHANGE FEE SELECTION ERROR:",
        error,
      );

      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to change the fee selection.",
      });
    } finally {
      setChangingAssignment(false);
    }
  }

  async function handleAssignFees() {
    if (!selectedStudent) {
      setMessage({
        type: "error",
        text: "Please select a student.",
      });
      return;
    }

    if (!schoolId || selectedStudent.school_id !== schoolId) {
      setMessage({
        type: "error",
        text: "This student does not belong to your school.",
      });
      return;
    }

    if (!assignmentPreview) {
      setMessage({
        type: "error",
        text: "No applicable fee structure is available.",
      });
      return;
    }

    if (assignmentPreview.existingBill) {
      setMessage({
        type: "error",
        text:
          "This student already has a fee bill for " +
          assignmentPreview.academicYear.name +
          ".",
      });
      return;
    }

    const selectedItems = assignmentPreview.items.filter(
      (item) => selectedAssignmentItemIds.includes(item.id),
    );

    const missingMandatory = assignmentPreview.items.filter(
      (item) =>
        item.mandatory &&
        !selectedAssignmentItemIds.includes(item.id),
    );

    if (missingMandatory.length > 0) {
      setMessage({
        type: "error",
        text:
          "Mandatory fees cannot be removed from the assignment.",
      });
      return;
    }

    if (selectedItems.length === 0) {
      setMessage({
        type: "error",
        text: "Select at least one fee before assigning fees.",
      });
      return;
    }

    const structureTotal = selectedItems.reduce(
      (sum, item) => sum + Math.max(Number(item.amount || 0), 0),
      0,
    );

    // A pending previous-year balance becomes part of the new academic
    // year's bill. This keeps one payment flow and one outstanding balance.
    const carryForwardTotal = assignmentPreview.pendingCarryForwards.reduce(
      (sum, record) => sum + Math.max(Number(record.amount || 0), 0),
      0,
    );

    const totalAmount = structureTotal + carryForwardTotal;

    if (totalAmount <= 0) {
      setMessage({
        type: "error",
        text: "The selected fee structure has no payable amount.",
      });
      return;
    }

    setAssigningFees(true);
    setMessage(null);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        window.location.assign("/login");
        return;
      }

      const { data: verifiedStudent, error: studentError } =
        await supabase
          .from("students")
          .select("id, school_id, class_id")
          .eq("id", selectedStudent.id)
          .eq("school_id", schoolId)
          .maybeSingle();

      if (studentError) {
        throw studentError;
      }

      if (
        !verifiedStudent ||
        verifiedStudent.class_id !== selectedStudent.class_id
      ) {
        throw new Error(
          "The student's class changed. Reload the student fees page and try again.",
        );
      }

      const { data: duplicateBill, error: duplicateError } =
        await supabase
          .from("fee_bills")
          .select("id, bill_number")
          .eq("school_id", schoolId)
          .eq("student_id", selectedStudent.id)
          .eq("academic_year_id", assignmentPreview.academicYear.id)
          .limit(1)
          .maybeSingle();

      if (duplicateError) {
        throw duplicateError;
      }

      if (duplicateBill) {
        throw new Error(
          `A fee bill (${duplicateBill.bill_number}) already exists for ${assignmentPreview.academicYear.name}.`,
        );
      }

      const today = new Date().toISOString().split("T")[0];
      const billNumber =
        "BILL-" +
        today.replace(/-/g, "") +
        "-" +
        crypto.randomUUID().slice(0, 8).toUpperCase();

      const { data: billData, error: billError } =
        await supabase
          .from("fee_bills")
          .insert({
            school_id: schoolId,
            student_id: selectedStudent.id,
            academic_year_id: assignmentPreview.academicYear.id,
            bill_number: billNumber,
            bill_date: today,
            due_date: null,
            status: "unpaid",
            subtotal: totalAmount,
            discount: 0,
            late_fee: 0,
            total_amount: totalAmount,
            paid_amount: 0,
            balance_amount: totalAmount,
            notes:
              "Created from " +
              assignmentPreview.structure.name +
              (carryForwardTotal > 0
                ? ` | Includes ${formatMoney(carryForwardTotal)} previous-year carry-forward`
                : ""),
            created_by: user.id,
          })
          .select(
            "id, academic_year_id, bill_number, bill_date, due_date, total_amount, paid_amount, balance_amount, status",
          )
          .single();

      if (billError) {
        throw new Error(
          `Unable to create fee bill: ${billError.message}`,
        );
      }

      if (!billData?.id) {
        throw new Error(
          "Fee bill was not returned after creation.",
        );
      }

      const billItems = selectedItems.map((item) => ({
        school_id: schoolId,
        bill_id: billData.id,
        fee_structure_id: assignmentPreview.structure.id,
        description: item.category_name,
        fee_type: item.frequency,
        amount: Number(item.amount || 0),
        discount: 0,
        net_amount: Number(item.amount || 0),
      }));

      const { error: billItemsError } = await supabase
        .from("fee_bill_items")
        .insert(billItems);

      if (billItemsError) {
        await supabase
          .from("fee_bills")
          .delete()
          .eq("id", billData.id)
          .eq("school_id", schoolId);

        throw new Error(
          `Unable to save fee bill items: ${billItemsError.message}`,
        );
      }

      // Attach pending carry-forward records to this new bill. The amount
      // has already been included in fee_bills.total_amount/balance_amount,
      // so the carry record is marked applied to prevent double counting.
      if (assignmentPreview.pendingCarryForwards.length > 0) {
        const { error: carryApplyError } = await supabase
          .from("fee_carry_forwards")
          .update({
            target_bill_id: billData.id,
            status: "applied",
          })
          .eq("school_id", schoolId)
          .eq("student_id", selectedStudent.id)
          .eq("to_academic_year_id", assignmentPreview.academicYear.id)
          .eq("status", "pending");

        if (carryApplyError) {
          await supabase
            .from("fee_bill_items")
            .delete()
            .eq("school_id", schoolId)
            .eq("bill_id", billData.id);
          await supabase
            .from("fee_bills")
            .delete()
            .eq("id", billData.id)
            .eq("school_id", schoolId);
          throw new Error(
            `Unable to apply previous-year carry-forward: ${carryApplyError.message}`,
          );
        }
      }

      setMessage({
        type: "success",
        text:
          "Fees assigned successfully. Bill " +
          billNumber +
          " created for " +
          getStudentName(selectedStudent) +
          ".",
      });

      await loadLedger(selectedStudent);
      await loadAssignmentPreview(selectedStudent);
    } catch (error) {
      console.error("FEE ASSIGNMENT ERROR:", error);

      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to assign fees to this student.",
      });
    } finally {
      setAssigningFees(false);
    }
  }

  /*
   * --------------------------------------------------
   * YEAR-END CARRY FORWARD
   * --------------------------------------------------
   *
   * Copies a bill's remaining balance to the next academic year. The actual
   * record is created by the secure RPC so duplicate/over-limit carry
   * forwards are rejected transactionally.
   */
  async function handleCarryForward(bill: FeeBill) {
    if (!selectedStudent || !schoolId || !bill.academic_year_id) {
      return;
    }

    const { data: sourceAcademicYear, error: sourceYearError } =
      await supabase
        .from("academic_years")
        .select("id, name, start_date, end_date, is_current")
        .eq("id", bill.academic_year_id)
        .eq("school_id", schoolId)
        .maybeSingle();

    if (sourceYearError) {
      setMessage({
        type: "error",
        text: `Unable to load source academic year: ${sourceYearError.message}`,
      });
      return;
    }

    if (!sourceAcademicYear) {
      setMessage({
        type: "error",
        text: "Source academic year could not be found.",
      });
      return;
    }

    const { data: nextYears, error: nextYearError } = await supabase
      .from("academic_years")
      .select("id, name, start_date, end_date, is_current")
      .eq("school_id", schoolId)
      .gt("start_date", sourceAcademicYear.start_date)
      .order("start_date", { ascending: true })
      .limit(1);

    if (nextYearError) {
      setMessage({
        type: "error",
        text: `Unable to find next academic year: ${nextYearError.message}`,
      });
      return;
    }

    const targetYear = (nextYears?.[0] as AcademicYear | undefined) || null;
    const outstanding = Math.max(Number(bill.balance_amount || 0), 0);

    if (!targetYear) {
      setMessage({
        type: "error",
        text: `No next academic year exists after ${sourceAcademicYear.name}. Create it first.`,
      });
      return;
    }

    if (outstanding <= 0) {
      setMessage({
        type: "error",
        text: "This bill has no outstanding amount to carry forward.",
      });
      return;
    }

    const confirmed = window.confirm(
      `Carry forward ${formatMoney(outstanding)} from ${sourceAcademicYear.name} to ${targetYear.name} for ${getStudentName(selectedStudent)}?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const { error } = await supabase.rpc("create_fee_carry_forward", {
        p_school_id: schoolId,
        p_student_id: selectedStudent.id,
        p_source_bill_id: bill.id,
        p_to_academic_year_id: targetYear.id,
        p_amount: outstanding,
        p_notes: `Carry forward from ${sourceAcademicYear.name} to ${targetYear.name}`,
      });

      if (error) {
        throw error;
      }

      setMessage({
        type: "success",
        text: `${formatMoney(outstanding)} carried forward to ${targetYear.name}.`,
      });

      await loadLedger(selectedStudent);
      await loadAssignmentPreview(selectedStudent);
    } catch (error) {
      console.error("CARRY FORWARD ERROR:", error);
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to carry forward the outstanding amount.",
      });
    }
  }

  /*
   * --------------------------------------------------
   * SELECT STUDENT
   * --------------------------------------------------
   */
  async function handleStudentSelect(student: Student) {
    if (!schoolId || student.school_id !== schoolId) {
      setMessage({
        type: "error",
        text: "You cannot access this student.",
      });
      return;
    }

    setSelectedStudent(student);
    setStudentSearch(getStudentName(student));
    setAssignmentPreview(null);
    setMessage(null);

    try {
      await loadLedger(student);
      try {
        await loadAssignmentPreview(student);
      } catch (assignmentError) {
        console.error(
          "Fee assignment preview error:",
          assignmentError,
        );

        if (
          assignmentError instanceof Error &&
          !assignmentError.message.includes("No active fee structure") &&
          !assignmentError.message.includes("No current academic year") &&
          !assignmentError.message.includes("has no fee items") &&
          !assignmentError.message.includes("has no class assigned")
        ) {
          setMessage({
            type: "error",
            text: assignmentError.message,
          });
        }
      }
    } catch (error) {
      console.error("Ledger loading error:", error);

      setBills([]);
      setPayments([]);

      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to load fee ledger.",
      });
    }
  }

  /*
   * --------------------------------------------------
   * AUTO-SELECT STUDENT FROM /students/[id]/fees
   * --------------------------------------------------
   * When Fees is opened from a student's detail page, the
   * route already contains that student's ID. Lock the page
   * to that student and load only their ledger.
   */
  useEffect(() => {
    if (!routeStudentId || !schoolId || loadingStudents || selectedStudent) {
      return;
    }

    const student = students.find(
      (item) => item.id === routeStudentId && item.school_id === schoolId,
    );

    if (!student) {
      setAssignmentPreview(null);
      setMessage({
        type: "error",
        text: "The selected student could not be found in your school.",
      });
      return;
    }

    void handleStudentSelect(student);
  }, [
    routeStudentId,
    schoolId,
    students,
    loadingStudents,
    selectedStudent,
  ]);

  /*
   * --------------------------------------------------
   * TOTALS
   * --------------------------------------------------
   */
  const totalBilled = bills.reduce(
    (sum, bill) => sum + Number(bill.total_amount || 0),
    0,
  );

  const totalPaid = bills.reduce(
    (sum, bill) => sum + Number(bill.paid_amount || 0),
    0,
  );

  const totalOutstanding = bills.reduce(
    (sum, bill) => sum + Number(bill.balance_amount || 0),
    0,
  );

  /*
   * --------------------------------------------------
   * OPEN PAYMENT MODAL
   * --------------------------------------------------
   */
  function openPaymentModal(bill: FeeBill) {
    if (Number(bill.balance_amount) <= 0) {
      setMessage({
        type: "error",
        text: "This bill is already fully paid.",
      });

      return;
    }

    setSelectedBill(bill);
    setAmount("");
    setPaymentMode("cash");
    setManualBillNumber(bill.bill_number || "");
    setShowConcessionForm(false);
    setConcessionAmount("");
    setConcessionReason("");
    setReferenceNumber("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setRemarks("");
    setMessage(null);
    setShowPaymentModal(true);
  }

  function closePaymentModal() {
    if (savingPayment) {
      return;
    }

    setShowPaymentModal(false);
    setSelectedBill(null);
    setShowConcessionForm(false);
    setConcessionAmount("");
    setConcessionReason("");
    setManualBillNumber("");
  }

  async function applyConcession() {
    if (!schoolId || !selectedStudent || !selectedBill) return;

    const amountToConcede = Number(concessionAmount);
    const outstanding = Number(selectedBill.balance_amount || 0);

    if (!Number.isFinite(amountToConcede) || amountToConcede <= 0) {
      setMessage({ type: "error", text: "Enter a valid concession amount." });
      return;
    }

    if (amountToConcede > outstanding + 0.005) {
      setMessage({
        type: "error",
        text: "Concession cannot exceed the current outstanding amount.",
      });
      return;
    }

    setSavingConcession(true);
    setMessage(null);

    try {
      const { error: concessionError } = await supabase
        .from("fee_concessions")
        .insert({
          school_id: schoolId,
          student_id: selectedStudent.id,
          bill_id: selectedBill.id,
          concession_type: "manual_amount",
          percentage: null,
          amount: amountToConcede,
          reason: concessionReason.trim() || null,
        });

      if (concessionError) throw concessionError;

      const nextBalance = Math.max(0, outstanding - amountToConcede);
      const nextTotal = Math.max(
        Number(selectedBill.paid_amount || 0),
        Number(selectedBill.total_amount || 0) - amountToConcede,
      );
      const nextDiscount =
        Number(selectedBill.discount || 0) + amountToConcede;
      const nextStatus =
        nextBalance <= 0.005
          ? "paid"
          : Number(selectedBill.paid_amount || 0) > 0
            ? "partial"
            : "unpaid";

      const { data: updatedBill, error: billError } = await supabase
        .from("fee_bills")
        .update({
          discount: nextDiscount,
          total_amount: nextTotal,
          balance_amount: nextBalance,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedBill.id)
        .eq("school_id", schoolId)
        .eq("student_id", selectedStudent.id)
        .select(
          "id, academic_year_id, bill_number, bill_date, due_date, discount, total_amount, paid_amount, balance_amount, status",
        )
        .single();

      if (billError || !updatedBill) {
        throw billError || new Error("Concession was saved but the bill was not updated.");
      }

      const refreshedBill = updatedBill as FeeBill;
      setSelectedBill(refreshedBill);
      setBills((currentBills) =>
        currentBills.map((bill) =>
          bill.id === refreshedBill.id ? refreshedBill : bill,
        ),
      );
      setAmount("");
      setConcessionAmount("");
      setConcessionReason("");
      setShowConcessionForm(false);
      setMessage({
        type: "success",
        text: `${formatMoney(amountToConcede)} concession applied to ${refreshedBill.bill_number}.`,
      });
    } catch (error: unknown) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to apply concession.",
      });
    } finally {
      setSavingConcession(false);
    }
  }

  /*
   * --------------------------------------------------
   * SUBMIT PAYMENT
   * --------------------------------------------------
   *
   * Before calling the RPC we verify:
   * 1. authenticated user still belongs to school
   * 2. selected student belongs to school
   * 3. selected bill belongs to selected student
   *
   * The manual bill number is the only physical identifier entered by staff.
   * The legacy receipt-number field remains system-generated for the current
   * payment RPC contract and is never collected from the user.
   */
  const accountOptions = useMemo(() => {
    const mode = paymentMode.toLowerCase();

    if (mode === "cash") {
      return financialAccounts.filter(
        (account) => account.account_type.toLowerCase() === "cash",
      );
    }

    // Bank, UPI, cheque and card payments are received into a bank account.
    // UPI is a payment method; the receiving account is still account_type=bank.
    return financialAccounts.filter(
      (account) => account.account_type.toLowerCase() === "bank",
    );
  }, [financialAccounts, paymentMode]);

  useEffect(() => {
    if (!showPaymentModal) {
      return;
    }

    if (!accountOptions.some((account) => account.id === accountId)) {
      setAccountId(accountOptions[0]?.id || "");
    }
  }, [showPaymentModal, accountOptions, accountId]);


  async function submitPayment(event: FormEvent) {
    event.preventDefault();

    if (savingPayment) return;

    if (!selectedStudent) {
      setMessage({
        type: "error",
        text: "Please select a student.",
      });
      return;
    }

    if (!selectedBill) {
      setMessage({
        type: "error",
        text: "Please select a fee bill.",
      });
      return;
    }

    if (!schoolId || selectedStudent.school_id !== schoolId) {
      setMessage({
        type: "error",
        text: "This student does not belong to your school.",
      });
      return;
    }

    const paymentAmount = Number(amount);

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setMessage({
        type: "error",
        text: "Enter a valid payment amount.",
      });
      return;
    }

    const outstanding = Number(selectedBill.balance_amount || 0);

    if (outstanding <= 0) {
      setMessage({
        type: "error",
        text: "This bill is already fully paid.",
      });
      return;
    }

    if (paymentAmount > outstanding + 0.005) {
      setMessage({
        type: "error",
        text:
          "Payment cannot be greater than the outstanding amount of " +
          formatMoney(outstanding) +
          ".",
      });
      return;
    }

    if (!paymentDate) {
      setMessage({
        type: "error",
        text: "Please select a payment date.",
      });
      return;
    }

    if (!accountId) {
      setMessage({
        type: "error",
        text:
          paymentMode.toLowerCase() === "cash"
            ? "Please select the cash account that received this payment."
            : "Please select the bank account that received this payment.",
      });
      return;
    }

    const selectedAccount = financialAccounts.find(
      (account) => account.id === accountId,
    );

    if (!selectedAccount) {
      setMessage({
        type: "error",
        text: "The selected Cash/Bank account is not available.",
      });
      return;
    }

    if (selectedAccount.school_id !== schoolId) {
      setMessage({
        type: "error",
        text: "The selected account does not belong to your school.",
      });
      return;
    }

    const mode = paymentMode.toLowerCase();
    const selectedAccountType = selectedAccount.account_type.toLowerCase();

    const accountMatchesPayment =
      mode === "cash"
        ? selectedAccountType === "cash"
        : selectedAccountType === "bank";

    if (!accountMatchesPayment) {
      setMessage({
        type: "error",
        text:
          mode === "cash"
            ? "Please select a Cash account."
            : "Please select a Bank account.",
      });
      return;
    }

    const enteredBillNumber = manualBillNumber.trim();

    if (!enteredBillNumber) {
      setMessage({
        type: "error",
        text: "Enter the manual bill number printed on the physical bill.",
      });
      return;
    }

    if (enteredBillNumber.length > 100) {
      setMessage({
        type: "error",
        text: "Manual bill number is too long.",
      });
      return;
    }

    if (mode === "upi" && !referenceNumber.trim()) {
      setMessage({
        type: "error",
        text: "Enter the UPI transaction/reference number.",
      });
      return;
    }

    setSavingPayment(true);
    setMessage(null);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;

      if (!user) {
        throw new Error(
          "Your session has expired. Please sign in again.",
        );
      }

      /*
       * Re-check the exact bill immediately before recording.
       * The canonical RPC locks this same bill again during the transaction.
       */
      const { data: verifiedBill, error: verifiedBillError } =
        await supabase
          .from("fee_bills")
          .select(
            "id, school_id, student_id, bill_number, bill_date, due_date, total_amount, paid_amount, balance_amount, status",
          )
          .eq("id", selectedBill.id)
          .eq("school_id", schoolId)
          .eq("student_id", selectedStudent.id)
          .maybeSingle();

      if (verifiedBillError) {
        throw new Error(
          `Unable to verify fee bill: ${verifiedBillError.message}`,
        );
      }

      if (!verifiedBill) {
        throw new Error("Fee bill was not found for this student.");
      }

      const currentOutstanding = Number(
        verifiedBill.balance_amount || 0,
      );

      if (currentOutstanding <= 0) {
        throw new Error("This bill is already fully paid.");
      }

      if (paymentAmount > currentOutstanding + 0.005) {
        throw new Error(
          "Payment cannot be greater than the current outstanding amount of " +
            formatMoney(currentOutstanding) +
            ".",
        );
      }

      /*
       * SINGLE SOURCE OF TRUTH:
       *
       * record_fee_payment performs atomically:
       *   fee_payments
       *   fee_payment_allocations
       *   recalculate_fee_bill
       *   journal_entries / journal_lines
       *   receipts
       *
       * The frontend must NOT create a second transactions/
       * transaction_entries accounting record.
       */
      const { data: result, error: rpcError } = await supabase.rpc(
        "record_fee_payment",
        {
          p_student_id: selectedStudent.id,
          p_bill_id: verifiedBill.id,
          p_amount: paymentAmount,
          p_payment_mode: mode,
          p_account_id: selectedAccount.id,
          p_receipt_number: `SYS-${enteredBillNumber.slice(0, 60)}-${Date.now()}`,
          p_payment_date: paymentDate,
          p_reference_number: referenceNumber.trim() || null,
          p_remarks: notes.trim() || null,
        },
      );

      if (rpcError) {
        throw new Error(
          `Unable to record payment: ${rpcError.message}`,
        );
      }

      if (!result || result.success === false) {
        throw new Error(
          result?.message || "Unable to record fee payment.",
        );
      }

      const paymentId = result.payment_id as string | undefined;
      const receiptNumber = enteredBillNumber;

      if (!paymentId) {
        throw new Error(
          "Payment was recorded but no payment ID was returned.",
        );
      }

      /*
       * The physical/manual Bill Number is stored on the same fee_bills row.
       * Receipt page and Fee page therefore always read/edit the same number.
       * We update it only after the payment succeeds so a failed payment does
       * not unexpectedly change the bill number.
       */
      const { data: billWithManualNumber, error: billNumberError } =
        await supabase
          .from("fee_bills")
          .update({
            bill_number: enteredBillNumber,
            updated_at: new Date().toISOString(),
          })
          .eq("id", verifiedBill.id)
          .eq("school_id", schoolId)
          .eq("student_id", selectedStudent.id)
          .select(
            "id, school_id, student_id, bill_number, bill_date, due_date, total_amount, paid_amount, balance_amount, status",
          )
          .single();

      if (billNumberError || !billWithManualNumber) {
        throw new Error(
          `Payment was recorded, but the manual bill number could not be synchronized: ${
            billNumberError?.message || "bill was not returned"
          }`,
        );
      }

      /*
       * Generate the downloadable PDF from the canonical result.
       * This is independent of receipt-history loading, so the new receipt
       * can always be downloaded immediately after recording.
       */
      const newRemaining =
        Number(result.remaining_balance ?? result.remaining_outstanding ?? 0);

      generateReceiptPDF({
        schoolName: school?.name || "School",
        schoolAddress: school?.address || "",
        schoolPhone: school?.phone || "",
        schoolEmail: school?.email || "",
        receiptNumber,
        receiptDate: paymentDate,
        studentName: getStudentName(selectedStudent),
        admissionNumber: selectedStudent.admission_no,
        className: selectedStudent.class_name,
        section: selectedStudent.section,
        billNumber:
          (result.bill_number as string | undefined) ||
          billWithManualNumber.bill_number ||
          enteredBillNumber,
        feeDescription: "School Fee Payment",
        amount: paymentAmount,
        paymentMode: mode,
        referenceNumber: referenceNumber.trim() || null,
        previousOutstanding: currentOutstanding,
        remainingOutstanding: newRemaining,
        remarks: notes.trim() || null,
      });

      const { error: receiptFlagError } = await supabase
        .from("fee_payments")
        .update({ receipt_generated: true })
        .eq("id", paymentId)
        .eq("school_id", schoolId);

      if (receiptFlagError) {
        console.warn(
          "Receipt generated flag could not be updated:",
          receiptFlagError.message,
        );
      }

      setShowPaymentModal(false);
      setSelectedBill(null);
      setAmount("");
      setManualBillNumber("");
      setReferenceNumber("");
      setRemarks("");
      setAccountId("");

      await loadLedger(selectedStudent);

      setMessage({
        type: "success",
        text:
          "Payment of " +
          formatMoney(paymentAmount) +
          " recorded successfully. Receipt " +
          receiptNumber +
          " downloaded.",
      });
    } catch (error: unknown) {
      const messageText =
        error instanceof Error
          ? error.message
          : "Unable to record payment. Please try again.";

      console.error("PAYMENT RECORDING ERROR:", messageText, error);

      setMessage({
        type: "error",
        text: messageText,
      });
    } finally {
      setSavingPayment(false);
    }
  }

  /*
   * --------------------------------------------------
   * DOWNLOAD OLD RECEIPT
   * --------------------------------------------------
   */
  async function downloadOldReceipt(payment: FeePayment) {
    if (!selectedStudent || !schoolId) {
      setMessage({
        type: "error",
        text: "Student or school context is not available.",
      });
      return;
    }

    if (selectedStudent.school_id !== schoolId) {
      setMessage({
        type: "error",
        text: "This student does not belong to your school.",
      });
      return;
    }

    try {
      setMessage(null);

      /*
       * Never depend on the visible bill list for receipt download.
       * A payment may be historical, while the visible Fee Bills list can
       * be filtered to the current academic year. The payment itself stores
       * the exact bill_id that it belongs to.
       */
      let relatedBill: FeeBill | null = null;

      if (payment.bill_id) {
        const { data: bill, error: billError } = await supabase
          .from("fee_bills")
          .select(
            "id, academic_year_id, bill_number, bill_date, due_date, total_amount, paid_amount, balance_amount, status",
          )
          .eq("id", payment.bill_id)
          .eq("school_id", schoolId)
          .eq("student_id", selectedStudent.id)
          .maybeSingle();

        if (billError) {
          throw new Error(
            `Unable to load the receipt bill: ${billError.message}`,
          );
        }

        relatedBill = (bill as FeeBill | null) || null;
      }

      /*
       * For a historical payment whose bill was removed, the receipt is
       * still downloadable. We simply show the payment amount and omit the
       * unavailable bill number.
       */
      const paymentAmount = Number(payment.amount || 0);
      const remainingOutstanding = relatedBill
        ? Number(relatedBill.balance_amount || 0)
        : 0;
      const previousOutstanding =
        relatedBill
          ? remainingOutstanding + paymentAmount
          : paymentAmount;

      generateReceiptPDF({
        schoolName: school?.name || "School",
        schoolAddress: school?.address || "",
        schoolPhone: school?.phone || "",
        schoolEmail: school?.email || "",
        receiptNumber: relatedBill?.bill_number || payment.receipt_number,
        receiptDate: payment.payment_date,
        studentName: getStudentName(selectedStudent),
        admissionNumber: selectedStudent.admission_no,
        className: selectedStudent.class_name,
        section: selectedStudent.section,
        billNumber: relatedBill?.bill_number || "—",
        feeDescription: "School Fee Payment",
        amount: paymentAmount,
        paymentMode: payment.payment_method,
        referenceNumber: payment.reference_number,
        previousOutstanding,
        remainingOutstanding,
        remarks: payment.notes,
      });

      setMessage({
        type: "success",
        text: `Bill ${relatedBill?.bill_number || payment.receipt_number} downloaded successfully.`,
      });
    } catch (error: unknown) {
      console.error("DOWNLOAD RECEIPT ERROR:", error);

      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to download this receipt.",
      });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Fee Ledger
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Search students, view bills, record payments and download
              receipts.
            </p>
          </div>
        </div>

        {message && (
          <div
            className={
              "mb-5 rounded-xl border px-4 py-3 text-sm font-medium " +
              (message.type === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700")
            }
          >
            {message.text}
          </div>
        )}

        {!isLockedStudentRoute && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <User size={18} className="text-blue-600" />

              <h2 className="font-bold text-slate-900">
                Find Student
              </h2>
            </div>

          <div className="relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={studentSearch}
              onChange={(event) => {
                const value = event.target.value;

                setStudentSearch(value);

                if (
                  selectedStudent &&
                  value !== getStudentName(selectedStudent)
                ) {
                  setSelectedStudent(null);
                  setBills([]);
                  setPayments([]);
                }
              }}
              placeholder="Search by student name, admission number or roll number..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {!selectedStudent && studentSearch.trim() && (
            <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-200">
              {loadingStudents ? (
                <div className="p-5 text-center text-sm text-slate-500">
                  Loading students...
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="p-5 text-center text-sm text-slate-500">
                  No students found.
                </div>
              ) : (
                filteredStudents.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => void handleStudentSelect(student)}
                    className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-blue-50"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">
                        {getStudentName(student)}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        Admission: {student.admission_no}
                        {student.roll_no
                          ? " • Roll: " + student.roll_no
                          : ""}
                      </div>
                    </div>

                    <div className="text-right text-xs text-slate-500">
                      <div>{student.class_name || "—"}</div>
                      <div>{student.section || ""}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
          </div>
        )}

        {isLockedStudentRoute && !selectedStudent && (
          <div className="rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm">
            <Loader2
              size={22}
              className="mx-auto animate-spin text-blue-600"
            />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              Loading this student's fees...
            </p>
          </div>
        )}

        {selectedStudent && (
          <>
            <div className="mt-6 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                    Selected Student
                  </div>

                  <h2 className="mt-1 text-xl font-bold text-slate-900">
                    {getStudentName(selectedStudent)}
                  </h2>

                  <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-500">
                    <span>
                      Admission:{" "}
                      <strong className="text-slate-700">
                        {selectedStudent.admission_no}
                      </strong>
                    </span>

                    <span>
                      Class:{" "}
                      <strong className="text-slate-700">
                        {selectedStudent.class_name || "—"}
                      </strong>
                    </span>

                    <span>
                      Section:{" "}
                      <strong className="text-slate-700">
                        {selectedStudent.section || "—"}
                      </strong>
                    </span>
                  </div>
                </div>

                {!isLockedStudentRoute && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStudent(null);
                      setStudentSearch("");
                      setBills([]);
                      setPayments([]);
                      setAssignmentPreview(null);
                      setMessage(null);
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Change Student
                  </button>
                )}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-bold text-slate-900">
                      Student Fee Assignment
                    </h2>

                    <p className="mt-1 text-xs text-slate-500">
                      Automatically applies the active fee structure for this student's class and current academic year.
                    </p>
                  </div>

                  {assignmentPreview?.academicYear && (
                    <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
                      {assignmentPreview.academicYear.name}
                    </span>
                  )}
                </div>
              </div>

              {loadingAssignment ? (
                <div className="flex items-center justify-center p-8 text-sm text-slate-500">
                  <Loader2
                    size={18}
                    className="mr-2 animate-spin"
                  />
                  Finding the applicable class fee structure...
                </div>
              ) : !assignmentPreview ? (
                <div className="p-8 text-center">
                  <div className="font-semibold text-slate-700">
                    No fee structure available
                  </div>

                  <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
                    The student's class must have an active fee structure for the current academic year before fees can be assigned.
                  </p>
                </div>
              ) : (
                <div className="p-5">
                  <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    <span className="font-semibold">Choose the student's fees:</span>{" "}
                    mandatory fees are included automatically; optional fees can be
                    selected individually.
                  </div>

                  {assignmentPreview.pendingCarryForwards.length > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-amber-700">
                        Previous Year Carry-Forward
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-amber-800">
                          Unpaid balance from the previous academic year
                        </span>
                        <span className="text-sm font-bold text-amber-900">
                          {formatMoney(
                            assignmentPreview.pendingCarryForwards.reduce(
                              (sum, record) =>
                                sum + Math.max(Number(record.amount || 0), 0),
                              0,
                            ),
                          )}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-amber-700">
                        This amount will be included in the new academic-year bill.
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col gap-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                        Applicable Fee Structure
                      </div>

                      <div className="mt-1 text-lg font-bold text-slate-900">
                        {assignmentPreview.structure.name}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        {selectedStudent.class_name || "Class"} •{" "}
                        {assignmentPreview.academicYear.name}
                      </div>
                    </div>

                    {assignmentPreview.existingBill ? (
                      <div className="flex flex-col items-stretch gap-2 sm:items-end">
                        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm">
                          <div className="font-bold text-green-700">
                            Fees Already Assigned
                          </div>

                          <div className="mt-1 text-xs text-green-600">
                            Bill {assignmentPreview.existingBill.bill_number}
                          </div>
                        </div>

                        {Number(
                          assignmentPreview.existingBill.paid_amount || 0,
                        ) <= 0 && (
                          <button
                            type="button"
                            onClick={() => void handleChangeFeeSelection()}
                            disabled={changingAssignment}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {changingAssignment ? (
                              <>
                                <Loader2
                                  size={16}
                                  className="animate-spin"
                                />
                                Changing...
                              </>
                            ) : (
                              "Change Fee Selection"
                            )}
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleAssignFees()}
                        disabled={
                          assigningFees ||
                          selectedAssignmentItems.length === 0
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {assigningFees ? (
                          <>
                            <Loader2
                              size={17}
                              className="animate-spin"
                            />
                            Assigning...
                          </>
                        ) : (
                          <>
                            <Plus size={17} />
                            Assign Selected Fees
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                    <div className="grid grid-cols-[1fr_auto_auto] border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <span>Fee</span>
                      <span className="px-4 text-right">Frequency</span>
                      <span className="text-right">Amount</span>
                    </div>

                    {assignmentPreview.items.map((item) => {
                      const selected =
                        selectedAssignmentItemIds.includes(item.id);

                      return (
                        <div
                          key={item.id}
                          className={`grid grid-cols-[1fr_auto_auto] items-center border-b border-slate-100 px-4 py-3 last:border-b-0 ${
                            !selected && !item.mandatory
                              ? "bg-slate-50/70"
                              : ""
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={
                                item.mandatory ||
                                Boolean(
                                  assignmentPreview.existingBill,
                                )
                              }
                              onChange={() =>
                                toggleAssignmentItem(item.id)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                            />

                            <div>
                              <div className="text-sm font-semibold text-slate-800">
                                {item.category_name}
                              </div>

                              <div className="mt-0.5 text-xs text-slate-400">
                                {item.mandatory
                                  ? "Mandatory • Included"
                                  : selected
                                    ? "Optional • Included"
                                    : "Optional • Not included"}
                              </div>
                            </div>
                          </div>

                          <div className="px-4 text-right text-xs font-medium capitalize text-slate-500">
                            {String(item.frequency).replace(/_/g, " ")}
                          </div>

                          <div
                            className={`text-right text-sm font-bold ${
                              selected
                                ? "text-slate-900"
                                : "text-slate-400 line-through"
                            }`}
                          >
                            {formatMoney(item.amount)}
                          </div>
                        </div>
                      );
                    })}

                    <div className="flex flex-col gap-2 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <span className="text-sm font-bold text-slate-700">
                          Selected Total
                        </span>

                        <p className="mt-1 text-xs text-slate-500">
                          Mandatory fees are always included. Optional fees
                          are included only when selected.
                        </p>
                      </div>

                      <span className="text-lg font-bold text-slate-900">
                        {formatMoney(assignmentTotalWithCarry)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SummaryCard
                title="Total Billed"
                value={formatMoney(totalBilled)}
                icon={<IndianRupee size={18} />}
              />

              <SummaryCard
                title="Total Paid"
                value={formatMoney(totalPaid)}
                icon={<Receipt size={18} />}
              />

              <SummaryCard
                title="Outstanding"
                value={formatMoney(totalOutstanding)}
                icon={<CreditCard size={18} />}
                danger={totalOutstanding > 0}
              />
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-bold text-slate-900">
                    Fee Bills
                  </h2>

                  <p className="mt-1 text-xs text-slate-500">
                    Record partial or full payments against each bill.
                  </p>
                </div>
              </div>

              {loadingLedger ? (
                <div className="flex items-center justify-center p-10 text-sm text-slate-500">
                  <Loader2
                    size={18}
                    className="mr-2 animate-spin"
                  />
                  Loading ledger...
                </div>
              ) : bills.length === 0 ? (
                <div className="p-10 text-center">
                  <div className="font-semibold text-slate-700">
                    No fee bills found
                  </div>

                  <div className="mt-1 text-sm text-slate-500">
                    Create a fee bill for this student first.
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3">Bill</th>
                        <th className="px-5 py-3">Date</th>
                        <th className="px-5 py-3 text-right">
                          Bill Amount
                        </th>
                        <th className="px-5 py-3 text-right">
                          Paid
                        </th>
                        <th className="px-5 py-3 text-right">
                          Outstanding
                        </th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3 text-right">
                          Action
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {bills.map((bill) => (
                        <tr
                          key={bill.id}
                          className="border-b border-slate-100 last:border-b-0"
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold text-slate-900">
                              {bill.bill_number}
                            </div>

                            {bill.due_date && (
                              <div className="mt-1 text-xs text-slate-500">
                                Due: {formatDate(bill.due_date)}
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-4 text-slate-600">
                            {formatDate(bill.bill_date)}
                          </td>

                          <td className="px-5 py-4 text-right font-medium text-slate-700">
                            {formatMoney(Number(bill.total_amount))}
                          </td>

                          <td className="px-5 py-4 text-right font-medium text-green-600">
                            {formatMoney(Number(bill.paid_amount))}
                          </td>

                          <td className="px-5 py-4 text-right font-bold text-red-600">
                            {formatMoney(Number(bill.balance_amount))}
                          </td>

                          <td className="px-5 py-4">
                            <StatusBadge status={bill.status} />
                          </td>

                          <td className="px-5 py-4 text-right">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {Number(bill.balance_amount) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openPaymentModal(bill)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
                                >
                                  <Plus size={14} />
                                  Add Payment
                                </button>
                              )}

                              {Number(bill.balance_amount) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    openPaymentModal(bill);
                                    setShowConcessionForm(true);
                                  }}
                                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100"
                                >
                                  Give Concession
                                </button>
                              )}

                              {Number(bill.balance_amount) > 0 && bill.academic_year_id && (
                                <button
                                  type="button"
                                  onClick={() => void handleCarryForward(bill)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100"
                                >
                                  Carry Forward
                                </button>
                              )}

                              {Number(bill.balance_amount) <= 0 && (
                                <span className="text-xs font-semibold text-green-600">
                                  Fully Paid
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-5">
                <h2 className="font-bold text-slate-900">
                  Payment History
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  All payments received from this student.
                </p>
              </div>

              {payments.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  No payments recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-green-50 p-2.5 text-green-600">
                          <Receipt size={18} />
                        </div>

                        <div>
                          <div className="font-semibold text-slate-900">
                            {payment.receipt_number}
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            {formatDate(payment.payment_date)}
                            {" • "}
                            {(payment.payment_method || "").toUpperCase()}
                            {payment.reference_number
                              ? " • " + payment.reference_number
                              : ""}
                          </div>

                          {payment.notes && (
                            <div className="mt-1 text-xs text-slate-400">
                              {payment.notes}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-bold text-green-600">
                            +{formatMoney(Number(payment.amount))}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => downloadOldReceipt(payment)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:text-blue-600"
                        >
                          <Download size={14} />
                          Receipt
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showPaymentModal && selectedBill && selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-bold text-slate-900">
                  Add Payment
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  {selectedBill.bill_number}
                  {" • "}
                  {getStudentName(selectedStudent)}
                </p>
              </div>

              <button
                type="button"
                onClick={closePaymentModal}
                disabled={savingPayment}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={submitPayment}
              className="space-y-5 p-5"
            >
              <div className="rounded-xl bg-red-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-red-500">
                      Current Outstanding
                    </div>

                    <div className="mt-1 text-2xl font-bold text-red-700">
                      {formatMoney(
                        Number(selectedBill.balance_amount),
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowConcessionForm((visible) => !visible)}
                    disabled={savingPayment || savingConcession}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Give Concession
                  </button>
                </div>
              </div>

              {showConcessionForm && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm font-bold text-amber-900">
                    Give Concession
                  </div>
                  <p className="mt-1 text-xs text-amber-800">
                    Enter the concession amount to reduce this bill's outstanding balance.
                  </p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input
                      type="number"
                      min="0.01"
                      max={Number(selectedBill.balance_amount)}
                      step="0.01"
                      value={concessionAmount}
                      onChange={(event) => setConcessionAmount(event.target.value)}
                      placeholder="Concession amount"
                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    />

                    <input
                      value={concessionReason}
                      onChange={(event) => setConcessionReason(event.target.value)}
                      placeholder="Reason (optional)"
                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    />
                  </div>

                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowConcessionForm(false)}
                      disabled={savingConcession}
                      className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyConcession()}
                      disabled={savingConcession}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {savingConcession ? "Applying..." : "Apply Concession"}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Manual Bill Number
                  <span className="ml-1 text-xs font-normal text-red-500">*</span>
                </label>

                <input
                  value={manualBillNumber}
                  onChange={(event) => setManualBillNumber(event.target.value)}
                  placeholder="Enter physical/manual bill number"
                  maxLength={100}
                  required
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                <p className="mt-1.5 text-xs text-slate-500">
                  This number is saved on the same fee bill used by the Receipt page.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Payment Amount
                </label>

                <div className="relative">
                  <IndianRupee
                    size={17}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type="number"
                    min="0.01"
                    max={Number(selectedBill.balance_amount)}
                    step="0.01"
                    value={amount}
                    onChange={(event) =>
                      setAmount(event.target.value)
                    }
                    placeholder="Enter amount"
                    required
                    className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-4 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {[25, 50, 100].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      onClick={() => {
                        const value =
                          (Number(selectedBill.balance_amount) *
                            percent) /
                          100;

                        setAmount(value.toFixed(2));
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {percent}%
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() =>
                      setAmount(
                        Number(
                          selectedBill.balance_amount,
                        ).toFixed(2),
                      )
                    }
                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-600"
                  >
                    Full
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Payment Mode
                </label>

                <select
                  value={paymentMode}
                  onChange={(event) =>
                    setPaymentMode(event.target.value)
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="card">Card</option>
                  <option value="online">Online</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  {paymentMode.toLowerCase() === "cash"
                    ? "Cash Account"
                    : paymentMode.toLowerCase() === "upi"
                      ? "Bank Account (UPI)"
                      : "Bank Account"}
                </label>

                <select
                  value={accountId}
                  onChange={(event) =>
                    setAccountId(event.target.value)
                  }
                  disabled={loadingAccounts || accountOptions.length === 0}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                  required
                >
                  <option value="">
                    {loadingAccounts
                      ? "Loading accounts..."
                      : accountOptions.length
                        ? `Select ${
                            paymentMode.toLowerCase() === "cash"
                              ? "cash"
                              : "bank"
                          } account`
                        : `No ${
                            paymentMode.toLowerCase() === "cash"
                              ? "cash"
                              : "bank"
                          } accounts found`}
                  </option>

                  {accountOptions.map((account) => (
                    <option
                      key={account.id}
                      value={account.id}
                    >
                      {account.name}
                      {account.account_type
                        ? ` — ${account.account_type.toUpperCase()}`
                        : ""}
                    </option>
                  ))}
                </select>

                {!loadingAccounts &&
                  accountOptions.length === 0 && (
                    <p className="mt-1.5 text-xs text-amber-600">
                      Create an active{" "}
                      {paymentMode.toLowerCase() === "cash"
                        ? "Cash"
                        : "Bank"}{" "}
                      account in Accounting first.
                      {paymentMode.toLowerCase() === "upi"
                        ? " UPI uses the selected Bank account."
                        : ""}
                    </p>
                  )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Reference Number
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    Optional
                  </span>
                </label>

                <input
                  value={referenceNumber}
                  onChange={(event) =>
                    setReferenceNumber(event.target.value)
                  }
                  placeholder={
                    paymentMode.toLowerCase() === "upi"
                      ? "UPI transaction ID / UTR"
                      : paymentMode.toLowerCase() === "cheque"
                        ? "Cheque number"
                        : "UPI ID / cheque no. / bank reference"
                  }
                  required={paymentMode.toLowerCase() === "upi"}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Payment Date
                </label>

                <div className="relative">
                  <Calendar
                    size={17}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />

                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(event) =>
                      setPaymentDate(event.target.value)
                    }
                    required
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 pl-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Notes
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    Optional
                  </span>
                </label>

                <textarea
                  value={notes}
                  onChange={(event) =>
                    setRemarks(event.target.value)
                  }
                  rows={3}
                  placeholder="Any notes about this payment..."
                  className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="flex gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={closePaymentModal}
                  disabled={savingPayment}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={savingPayment}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingPayment ? (
                    <>
                      <Loader2
                        size={17}
                        className="animate-spin"
                      />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Receipt size={17} />
                      Save & Receipt
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  danger,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-500">
          {title}
        </div>

        <div
          className={
            "rounded-lg p-2 " +
            (danger
              ? "bg-red-50 text-red-600"
              : "bg-blue-50 text-blue-600")
          }
        >
          {icon}
        </div>
      </div>

      <div
        className={
          "mt-3 text-2xl font-bold " +
          (danger ? "text-red-600" : "text-slate-900")
        }
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = (status || "").toLowerCase();

  let classes = "bg-slate-100 text-slate-600";

  if (
    normalized === "paid" ||
    normalized === "fully_paid"
  ) {
    classes = "bg-green-50 text-green-700";
  } else if (
    normalized === "partial" ||
    normalized === "partially_paid"
  ) {
    classes = "bg-yellow-50 text-yellow-700";
  } else if (
    normalized === "pending" ||
    normalized === "unpaid"
  ) {
    classes = "bg-red-50 text-red-700";
  } else if (normalized === "overdue") {
    classes = "bg-orange-50 text-orange-700";
  } else if (normalized === "cancelled") {
    classes = "bg-slate-100 text-slate-500";
  } else if (normalized === "carried_forward") {
    classes = "bg-amber-50 text-amber-700";
  }

  return (
    <span
      className={
        "inline-flex rounded-full px-2.5 py-1 text-xs font-bold " +
        classes
      }
    >
      {status
        ? status.replace(/_/g, " ")
        : "Unknown"}
    </span>
  );
}
