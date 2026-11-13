"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSchoolContext } from "@/lib/school-context";
import {
  generateAdmissionReceiptPDF,
  loadReceiptLogoDataUrl,
} from "@/lib/fees/generateReceipt";

type Gender = "male" | "female" | "other";

type StudentStatus =
  | "active"
  | "inactive"
  | "transferred"
  | "completed"
  | "alumni";

type SchoolClass = {
  id: string;
  name: string;
  display_order: number;
};

type Section = {
  id: string;
  class_id: string;
  name: string;
};

type AcademicYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type PaymentAccount = {
  id: string;
  name: string;
  code: string | null;
  account_type: string;
};

type SchoolReceiptDetails = {
  name: string;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
};

export default function NewStudentPage() {
  const router = useRouter();
  const { modules } = useSchoolContext();
  const hasFees = modules.includes("fees");

  const [admissionNo, setAdmissionNo] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [admissionDate, setAdmissionDate] = useState("");
  const [admissionFee, setAdmissionFee] = useState("");
  const [admissionReceiptNumber, setAdmissionReceiptNumber] = useState("");
  const [admissionPaymentMethod, setAdmissionPaymentMethod] = useState("cash");
  const [cashAccountId, setCashAccountId] = useState("");
  const [bankAccounts, setBankAccounts] = useState<PaymentAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [utrNumber, setUtrNumber] = useState("");
  const [status, setStatus] = useState<StudentStatus>("active");
  const [bloodGroup, setBloodGroup] = useState("");

  const [academicYearId, setAcademicYearId] = useState("");
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [academicYearsLoading, setAcademicYearsLoading] = useState(true);

  const [classId, setClassId] = useState("");
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);

  const [sectionId, setSectionId] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recoveryStudentId, setRecoveryStudentId] = useState<string | null>(null);
  const [admissionPaymentRecorded, setAdmissionPaymentRecorded] = useState(false);

  const getSchoolId = useCallback(async (
    supabase: ReturnType<typeof createClient>,
  ) => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      router.replace("/login");
      return null;
    }

    const { data: membership, error: membershipError } = await supabase
      .from("school_users")
      .select("school_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership?.school_id) {
      throw new Error("Your account is not assigned to a school.");
    }

    return membership.school_id as string;
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function loadFormData() {
      try {
        const supabase = createClient();
        const schoolId = await getSchoolId(supabase);

        if (!schoolId || cancelled) {
          return;
        }

        const [yearsResult, classesResult, accountsResult] = await Promise.all([
          supabase
            .from("academic_years")
            .select("id, name, start_date, end_date, is_current")
            .eq("school_id", schoolId)
            .order("start_date", { ascending: false }),

          supabase
            .from("classes")
            .select("id, name, display_order")
            .eq("school_id", schoolId)
            .order("display_order", { ascending: true })
            .order("name", { ascending: true }),

          supabase
            .from("accounts")
            .select("id, name, code, account_type")
            .eq("school_id", schoolId)
            .eq("is_active", true)
            .order("name", { ascending: true }),
        ]);

        if (yearsResult.error) throw yearsResult.error;
        if (classesResult.error) throw classesResult.error;
        if (accountsResult.error) throw accountsResult.error;
        if (cancelled) return;

        const years = (yearsResult.data || []) as AcademicYear[];
        const loadedClasses = (classesResult.data || []) as SchoolClass[];
        const loadedAccounts = (accountsResult.data || []) as PaymentAccount[];
        const cashAccounts = loadedAccounts.filter(
          (account) => account.account_type.toLowerCase() === "cash",
        );
        const loadedBankAccounts = loadedAccounts.filter(
          (account) => account.account_type.toLowerCase() === "bank",
        );

        setAcademicYears(years);
        setClasses(loadedClasses);
        setCashAccountId(
          (
            cashAccounts.find((account) =>
              account.name.toLowerCase().includes("main cash"),
            ) || cashAccounts[0]
          )?.id || "",
        );
        setBankAccounts(loadedBankAccounts);
        setBankAccountId(
          loadedBankAccounts.length === 1 ? loadedBankAccounts[0].id : "",
        );

        const currentYear = years.find((year) => year.is_current);
        if (currentYear) {
          setAcademicYearId(currentYear.id);
        } else if (years.length > 0) {
          setAcademicYearId(years[0].id);
        }
      } catch (loadError) {
        console.error("LOAD ADD STUDENT DATA ERROR:", loadError);
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load academic years and classes.",
          );
        }
      } finally {
        if (!cancelled) {
          setAcademicYearsLoading(false);
          setClassesLoading(false);
        }
      }
    }

    void loadFormData();
    return () => {
      cancelled = true;
    };
  }, [getSchoolId]);

  async function handleClassChange(value: string) {
    setClassId(value);
    setSectionId("");
    setSections([]);

    if (!value) {
      return;
    }

    try {
      setError("");
      setSectionsLoading(true);

      const supabase = createClient();
      const schoolId = await getSchoolId(supabase);

      if (!schoolId) {
        return;
      }

      const { data, error: sectionsError } = await supabase
        .from("sections")
        .select("id, class_id, name")
        .eq("school_id", schoolId)
        .eq("class_id", value)
        .order("name", { ascending: true });

      if (sectionsError) {
        throw sectionsError;
      }

      setSections((data || []) as Section[]);
    } catch (sectionError) {
      console.error("LOAD SECTIONS ERROR:", sectionError);
      setError(
        sectionError instanceof Error
          ? sectionError.message
          : "Unable to load sections.",
      );
    } finally {
      setSectionsLoading(false);
    }
  }

  async function getSelectedPaymentAccount(
    supabase: ReturnType<typeof createClient>,
    schoolId: string,
  ) {
    const expectedType =
      admissionPaymentMethod === "cash" ? "cash" : "bank";
    const accountId =
      admissionPaymentMethod === "cash" ? cashAccountId : bankAccountId;

    if (!accountId) {
      throw new Error(`Select an active ${expectedType} account.`);
    }

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, name, account_type")
      .eq("id", accountId)
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .maybeSingle();

    if (accountError) throw accountError;
    if (
      !account ||
      String(account.account_type || "").toLowerCase() !== expectedType
    ) {
      throw new Error(`The selected ${expectedType} account is unavailable.`);
    }

    return account;
  }

  async function collectAdmissionPayment(
    supabase: ReturnType<typeof createClient>,
    schoolId: string,
    userId: string,
    school: SchoolReceiptDetails,
    account: { id: string; name: string },
    student: {
      id: string;
      admission_no: string | null;
      first_name: string;
      middle_name: string | null;
      last_name: string | null;
    },
    onPaymentRecorded: () => void,
  ) {
    const amount = Math.round(Number(admissionFee) * 100) / 100;
    const paymentDate =
      admissionDate || new Date().toISOString().slice(0, 10);
    const billNumber =
      "ADM-" +
      paymentDate.replace(/-/g, "") +
      "-" +
      crypto.randomUUID().slice(0, 8).toUpperCase();

    const { data: bill, error: billError } = await supabase
      .from("fee_bills")
      .insert({
        school_id: schoolId,
        student_id: student.id,
        academic_year_id: academicYearId,
        bill_number: billNumber,
        bill_date: paymentDate,
        due_date: null,
        status: "unpaid",
        subtotal: amount,
        discount: 0,
        late_fee: 0,
        total_amount: amount,
        paid_amount: 0,
        balance_amount: amount,
        notes: "Admission Fee",
        created_by: userId,
      })
      .select("id, bill_number")
      .single();

    if (billError) {
      throw new Error(`Admission fee bill could not be created: ${billError.message}`);
    }

    const { data: billItem, error: billItemError } = await supabase
      .from("fee_bill_items")
      .insert({
        school_id: schoolId,
        bill_id: bill.id,
        fee_structure_id: null,
        fee_category_id: null,
        description: "Admission Fee",
        fee_type: "one_time",
        amount,
        discount: 0,
        net_amount: amount,
      })
      .select("id")
      .single();

    if (billItemError) {
      const { error: rollbackError } = await supabase
        .from("fee_bills")
        .delete()
        .eq("id", bill.id)
        .eq("school_id", schoolId);

      throw new Error(
        rollbackError
          ? `Admission fee line could not be saved: ${billItemError.message}. The bill cleanup also failed: ${rollbackError.message}`
          : `Admission fee line could not be saved; the incomplete bill was removed: ${billItemError.message}`,
      );
    }

    const { data: payment, error: paymentError } = await supabase.rpc(
      "record_fee_payment_collection",
      {
        p_student_id: student.id,
        p_bill_id: bill.id,
        p_amount: amount,
        p_payment_mode: admissionPaymentMethod,
        p_account_id: account.id,
        p_receipt_number: admissionReceiptNumber.trim(),
        p_payment_date: paymentDate,
        p_reference_number:
          admissionPaymentMethod === "bank_transfer" ? utrNumber.trim() : null,
        p_remarks: "Admission Fee",
        p_allocations: [
          {
            fee_bill_item_id: billItem.id,
            amount,
          },
        ],
      },
    );

    if (paymentError) {
      throw new Error(`Admission fee payment failed: ${paymentError.message}`);
    }
    if (!payment?.success || !payment.payment_id) {
      throw new Error("Admission fee payment was not confirmed by the accounting system.");
    }

    onPaymentRecorded();

    const logoDataUrl = await loadReceiptLogoDataUrl(school.logo_url);
    generateAdmissionReceiptPDF({
      schoolName: school.name || "School",
      schoolLogoDataUrl: logoDataUrl,
      schoolAddress: [school.address, school.city, school.state, school.postal_code]
        .filter(Boolean)
        .join(", "),
      schoolPhone: school.phone,
      schoolEmail: school.email,
      receiptNumber: admissionReceiptNumber.trim(),
      receiptDate: paymentDate,
      billNumber: bill.bill_number,
      studentName: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),
      admissionNumber: student.admission_no || "",
      className: classes.find((item) => item.id === classId)?.name || null,
      section: sections.find((item) => item.id === sectionId)?.name || null,
      fatherName: fatherName.trim() || null,
      motherName: motherName.trim() || null,
      mobileNumber: parentPhone.trim() || null,
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      studentAddress: [
        address.trim(),
        city.trim(),
        state.trim(),
        postalCode.trim(),
      ]
        .filter(Boolean)
        .join(", "),
      amount,
      paymentMode: admissionPaymentMethod,
      paymentAccountName: account.name,
      referenceNumber:
        admissionPaymentMethod === "bank_transfer" ? utrNumber.trim() : null,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");

    if (recoveryStudentId) {
      setError("This student was already created. Do not submit the form again; open the student's Fees page below.");
      return;
    }

    if (!admissionNo.trim()) {
      setError("Admission number is required.");
      return;
    }

    if (!firstName.trim()) {
      setError("First name is required.");
      return;
    }

    if (!academicYearId) {
      setError("Please select an academic year.");
      return;
    }

    if (!classId) {
      setError("Please select a class.");
      return;
    }

    if (!sectionId) {
      setError("Please select a section.");
      return;
    }

    const rawAdmissionFee = admissionFee.trim() ? Number(admissionFee) : 0;
    if (rawAdmissionFee > 0 && !hasFees) {
      setError("This module is not included in your plan");
      return;
    }
    if (!Number.isFinite(rawAdmissionFee) || rawAdmissionFee < 0) {
      setError("Admission fee must be zero or a valid positive amount.");
      return;
    }
    const admissionFeeAmount = Math.round(rawAdmissionFee * 100) / 100;
    if (rawAdmissionFee > 0 && admissionFeeAmount <= 0) {
      setError("Admission fee must be at least 0.01.");
      return;
    }
    if (admissionFeeAmount > 0 && !admissionReceiptNumber.trim()) {
      setError("Enter the manual receipt number for the admission fee.");
      return;
    }
    if (admissionFeeAmount > 0 && admissionPaymentMethod === "bank_transfer") {
      if (!bankAccountId) {
        setError("Select the bank account that received the admission fee.");
        return;
      }
      if (!utrNumber.trim()) {
        setError("Enter the UTR number for the bank payment.");
        return;
      }
    }
    if (admissionFeeAmount > 0 && admissionPaymentMethod === "cash" && !cashAccountId) {
      setError("No active cash account is configured for this school.");
      return;
    }

    setLoading(true);
    let createdStudentId: string | null = null;
    let paymentRecorded = false;

    try {
      const supabase = createClient();
      const schoolId = await getSchoolId(supabase);

      if (!schoolId) {
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("You must be signed in to create a student.");

      const [account, school] =
        admissionFeeAmount > 0
          ? await Promise.all([
              getSelectedPaymentAccount(supabase, schoolId),
              (async () => {
                const { data, error: schoolError } = await supabase
                  .from("schools")
                  .select("name, logo_url, address, city, state, postal_code, phone, email")
                  .eq("id", schoolId)
                  .maybeSingle();
                if (schoolError) throw schoolError;
                if (!data) throw new Error("School details could not be loaded for the admission receipt.");
                return data as SchoolReceiptDetails;
              })(),
            ])
          : [null, null];

      const student = {
        school_id: schoolId,
        academic_year_id: academicYearId,
        admission_no: admissionNo.trim(),
        roll_no: rollNo.trim() || null,
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim() || null,
        father_name: fatherName.trim() || null,
        mother_name: motherName.trim() || null,
        parent_phone: parentPhone.trim() || null,
        date_of_birth: dateOfBirth || null,
        gender: gender || null,
        class_id: classId,
        section_id: sectionId,
        admission_date: admissionDate || null,
        status,
        blood_group: bloodGroup.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        postal_code: postalCode.trim() || null,
        notes: notes.trim() || null,
      };

      const { data: createdStudent, error: insertError } = await supabase
        .from("students")
        .insert(student)
        .select("id, admission_no, first_name, middle_name, last_name")
        .single();

      if (insertError) {
        throw insertError;
      }

      if (!createdStudent?.id) {
        throw new Error("Student was created but no student ID was returned.");
      }

      createdStudentId = createdStudent.id;
      setRecoveryStudentId(createdStudent.id);

      if (admissionFeeAmount > 0) {
        if (!account || !school) {
          throw new Error("Admission payment details could not be resolved.");
        }
        await collectAdmissionPayment(
          supabase,
          schoolId,
          user.id,
          school,
          account,
          createdStudent,
          () => {
            paymentRecorded = true;
            setAdmissionPaymentRecorded(true);
          },
        );
      }

      router.replace(
        admissionFeeAmount > 0
          ? `/dashboard/students/${createdStudent.id}/fees`
          : "/dashboard/students",
      );
      router.refresh();
    } catch (createError) {
      const errorDetails =
        createError && typeof createError === "object"
          ? (createError as { message?: string; details?: string; hint?: string; code?: string })
          : {};
      console.error("CREATE STUDENT ERROR:", {
        message: errorDetails.message,
        details: errorDetails.details,
        hint: errorDetails.hint,
        code: errorDetails.code,
      });
      const message =
        createError instanceof Error
          ? createError.message
          : errorDetails.message || "Unable to create student.";
      setError(
        createdStudentId
          ? paymentRecorded
            ? `Student and admission payment were saved, but the receipt PDF could not be downloaded: ${message}`
            : `Student was created, but admission payment was not completed: ${message}`
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <Link
            href="/dashboard/students"
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            ← Back to Students
          </Link>

          <h1 className="mt-3 text-3xl font-bold text-slate-900">
            Add Student
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Create a student record for your school.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">{error}</p>
            {recoveryStudentId && (
              <Link
                href={`/dashboard/students/${recoveryStudentId}/fees`}
                className="mt-3 inline-block text-sm font-bold text-red-800 underline"
              >
                {admissionPaymentRecorded
                  ? "Open fees to download the receipt"
                  : "Open this student's fees — do not submit again"}
              </Link>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">
              Basic Information
            </h2>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Field label="Admission Number" required>
                <input
                  value={admissionNo}
                  onChange={(event) => setAdmissionNo(event.target.value)}
                  required
                  placeholder="ADM-001"
                  className={inputClass}
                />
              </Field>

              <Field label="Roll Number">
                <input
                  value={rollNo}
                  onChange={(event) => setRollNo(event.target.value)}
                  placeholder="1"
                  className={inputClass}
                />
              </Field>

              <Field label="First Name" required>
                <input
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                  placeholder="First name"
                  className={inputClass}
                />
              </Field>

              <Field label="Middle Name">
                <input
                  value={middleName}
                  onChange={(event) => setMiddleName(event.target.value)}
                  placeholder="Middle name"
                  className={inputClass}
                />
              </Field>

              <Field label="Last Name">
                <input
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  placeholder="Last name"
                  className={inputClass}
                />
              </Field>

              <Field label="Father&apos;s Name">
                <input
                  value={fatherName}
                  onChange={(event) => setFatherName(event.target.value)}
                  placeholder="Optional"
                  autoComplete="family-name"
                  className={inputClass}
                />
              </Field>

              <Field label="Mother&apos;s Name">
                <input
                  value={motherName}
                  onChange={(event) => setMotherName(event.target.value)}
                  placeholder="Optional"
                  className={inputClass}
                />
              </Field>

              <Field label="Parent / Guardian Mobile Number">
                <input
                  type="tel"
                  value={parentPhone}
                  onChange={(event) => setParentPhone(event.target.value)}
                  placeholder="9876543210"
                  autoComplete="tel"
                  className={inputClass}
                />
              </Field>

              <Field label="Gender">
                <select
                  value={gender}
                  onChange={(event) =>
                    setGender(event.target.value as Gender | "")
                  }
                  className={inputClass}
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </Field>

              <Field label="Date of Birth">
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(event) => setDateOfBirth(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Admission Date">
                <input
                  type="date"
                  value={admissionDate}
                  onChange={(event) => setAdmissionDate(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Status">
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as StudentStatus)
                  }
                  className={inputClass}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="transferred">Transferred</option>
                  <option value="completed">Completed</option>
                  <option value="alumni">Alumni</option>
                </select>
              </Field>

              <Field label="Blood Group">
                <input
                  value={bloodGroup}
                  onChange={(event) => setBloodGroup(event.target.value)}
                  placeholder="A+"
                  className={inputClass}
                />
              </Field>
            </div>
          </section>

          {hasFees && <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">
              Admission Fee Payment
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Optional. A successful payment creates a fee bill and downloads a school-branded A4 receipt.
            </p>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Field label="Admission Fee Paid Now">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={admissionFee}
                  onChange={(event) => setAdmissionFee(event.target.value)}
                  placeholder="0.00"
                  disabled={loading || Boolean(recoveryStudentId)}
                  className={inputClass}
                />
              </Field>

              <Field
                label="Manual Receipt Number"
                required={Number(admissionFee || 0) > 0}
              >
                <input
                  value={admissionReceiptNumber}
                  onChange={(event) => setAdmissionReceiptNumber(event.target.value)}
                  required={Number(admissionFee || 0) > 0}
                  disabled={loading || Number(admissionFee || 0) <= 0 || Boolean(recoveryStudentId)}
                  placeholder="ADM-REC-001"
                  className={inputClass}
                />
              </Field>

              <Field label="Payment Method">
                <select
                  value={admissionPaymentMethod}
                  onChange={(event) => {
                    setAdmissionPaymentMethod(event.target.value);
                    if (event.target.value === "cash") setUtrNumber("");
                  }}
                  disabled={loading || Number(admissionFee || 0) <= 0 || Boolean(recoveryStudentId)}
                  className={inputClass}
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank</option>
                </select>
              </Field>

              {admissionPaymentMethod === "bank_transfer" && (
                <>
                  <Field label="Bank Account" required>
                    <select
                      value={bankAccountId}
                      onChange={(event) => setBankAccountId(event.target.value)}
                      required={Number(admissionFee || 0) > 0}
                      disabled={loading || Number(admissionFee || 0) <= 0 || Boolean(recoveryStudentId)}
                      className={inputClass}
                    >
                      <option value="">Select the receiving bank account</option>
                      {bankAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                          {account.code ? ` (${account.code})` : ""}
                        </option>
                      ))}
                    </select>
                    {bankAccounts.length === 0 && (
                      <p className="mt-1 text-xs text-amber-700">
                        Add an active bank account in Accounting before recording a bank payment.
                      </p>
                    )}
                  </Field>

                  <Field label="UTR Number" required>
                    <input
                      type="text"
                      value={utrNumber}
                      onChange={(event) => setUtrNumber(event.target.value)}
                      required={Number(admissionFee || 0) > 0}
                      disabled={loading || Number(admissionFee || 0) <= 0 || Boolean(recoveryStudentId)}
                      placeholder="Enter bank transfer UTR"
                      className={inputClass}
                    />
                  </Field>
                </>
              )}
            </div>
          </section>}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">
              Academic Placement
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Select the academic year, class and section for this student.
            </p>

            <div className="mt-5 grid gap-5 md:grid-cols-3">
              <Field label="Academic Year" required>
                <select
                  value={academicYearId}
                  onChange={(event) => setAcademicYearId(event.target.value)}
                  disabled={academicYearsLoading || loading}
                  required
                  className={inputClass}
                >
                  <option value="">
                    {academicYearsLoading
                      ? "Loading academic years..."
                      : academicYears.length === 0
                        ? "No academic years"
                        : "Select academic year"}
                  </option>

                  {academicYears.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.name}
                      {year.is_current ? " (Current)" : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Class" required>
                <select
                  value={classId}
                  onChange={(event) => void handleClassChange(event.target.value)}
                  disabled={classesLoading || loading}
                  required
                  className={inputClass}
                >
                  <option value="">
                    {classesLoading ? "Loading classes..." : "Select class"}
                  </option>

                  {classes.map((schoolClass) => (
                    <option key={schoolClass.id} value={schoolClass.id}>
                      {schoolClass.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Section" required>
                <select
                  value={sectionId}
                  onChange={(event) => setSectionId(event.target.value)}
                  disabled={!classId || sectionsLoading || loading}
                  required
                  className={inputClass}
                >
                  <option value="">
                    {!classId
                      ? "Select class first"
                      : sectionsLoading
                        ? "Loading sections..."
                        : sections.length === 0
                          ? "No sections"
                          : "Select section"}
                  </option>

                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Address</h2>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field label="Address">
                  <textarea
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    rows={3}
                    placeholder="Full address"
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="City">
                <input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  placeholder="City"
                  className={inputClass}
                />
              </Field>

              <Field label="State">
                <input
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                  placeholder="State"
                  className={inputClass}
                />
              </Field>

              <Field label="Postal Code">
                <input
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  placeholder="Postal code"
                  className={inputClass}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Notes</h2>

            <div className="mt-5">
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                placeholder="Additional notes..."
                className={inputClass}
              />
            </div>
          </section>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link
              href="/dashboard/students"
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={loading || Boolean(recoveryStudentId)}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {loading
                ? "Saving..."
                : recoveryStudentId
                  ? "Student Created"
                  : "Save Student"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
