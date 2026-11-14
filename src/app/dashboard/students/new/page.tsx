"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadReceiptLogoDataUrl } from "@/lib/fees/generateReceipt";
import { createAdmissionPdf, type AdmissionPdfData } from "@/lib/students/admission-pdf";

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

type Account = {
  id: string;
  name: string;
  code: string;
  account_type: string;
};

type School = {
  name: string;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

type CompletedAdmission = {
  studentId: string;
  admissionNo: string;
  school: School;
  document: AdmissionPdfData;
  receipt: AdmissionPdfData | null;
};

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function getSchoolId(supabase: ReturnType<typeof createClient>) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) {
    window.location.href = "/login";
    return null;
  }
  const { data: membership, error: membershipError } = await supabase
    .from("school_users")
    .select("school_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership?.school_id) throw new Error("Your account is not assigned to a school.");
  return membership.school_id as string;
}

export default function NewStudentPage() {
  const [admissionNo, setAdmissionNo] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [admissionDate, setAdmissionDate] = useState("");
  const [admissionFee, setAdmissionFee] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [paymentMode, setPaymentMode] = useState<"cash" | "bank_transfer">("cash");
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(localDate);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [school, setSchool] = useState<School | null>(null);
  const [status, setStatus] = useState<StudentStatus>("active");
  const [bloodGroup, setBloodGroup] = useState("");
  const [fatherName, setFatherName] = useState("");
  const [motherName, setMotherName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [previousSchool, setPreviousSchool] = useState("");
  const [nationality, setNationality] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [medicalInformation, setMedicalInformation] = useState("");

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
  const [completed, setCompleted] = useState<CompletedAdmission | null>(null);

  const loadFormData = useCallback(async () => {
    try {
      const supabase = createClient();
      const schoolId = await getSchoolId(supabase);

      if (!schoolId) {
        return;
      }

      const [yearsResult, classesResult, accountsResult, schoolResult] = await Promise.all([
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
          .order("name"),
        supabase
          .from("schools")
          .select("name, logo_url, address, city, state, postal_code")
          .eq("id", schoolId)
          .single(),
      ]);

      if (yearsResult.error) {
        throw yearsResult.error;
      }

      if (classesResult.error) {
        throw classesResult.error;
      }
      if (accountsResult.error) throw accountsResult.error;
      if (schoolResult.error) throw schoolResult.error;

      const years = (yearsResult.data || []) as AcademicYear[];
      const loadedClasses = (classesResult.data || []) as SchoolClass[];

      setAcademicYears(years);
      setClasses(loadedClasses);
      setAccounts((accountsResult.data || []) as Account[]);
      setSchool(schoolResult.data as School);

      const currentYear = years.find((year) => year.is_current);
      if (currentYear) {
        setAcademicYearId(currentYear.id);
      } else if (years.length > 0) {
        setAcademicYearId(years[0].id);
      }
    } catch (loadError) {
      console.error("LOAD ADD STUDENT DATA ERROR:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load academic years and classes.",
      );
    } finally {
      setAcademicYearsLoading(false);
      setClassesLoading(false);
    }
  }, []);

  useEffect(() => {
    // The state updates occur after the asynchronous school-data request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFormData();
  }, [loadFormData]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    if (loading || completed) return;

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

    const admissionFeeAmount = Number(admissionFee || 0);
    if (!Number.isFinite(admissionFeeAmount) || admissionFeeAmount < 0 ||
        Math.abs(admissionFeeAmount * 100 - Math.round(admissionFeeAmount * 100)) > 0.000001) {
      setError("Admission fee must be non-negative with at most two decimal places.");
      return;
    }

    const account = accounts.find((item) => item.id === accountId);
    const expectedAccountType = paymentMode === "cash" ? "cash" : "bank";
    if (admissionFeeAmount > 0 && (
      !billNumber.trim() || !receiptNumber.trim() || !paymentDate ||
      billNumber.trim().length > 100 || receiptNumber.trim().length > 100 ||
      !account || account.account_type.toLowerCase() !== expectedAccountType
    )) {
      setError("Enter a bill number, receipt number, payment date and matching cash or bank account.");
      return;
    }
    if (!school) {
      setError("School details could not be loaded.");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const schoolId = await getSchoolId(supabase);

      if (!schoolId) {
        return;
      }

      const student = {
        school_id: schoolId,
        academic_year_id: academicYearId,
        admission_no: admissionNo.trim(),
        roll_no: rollNo.trim() || null,
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim() || null,
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
        father_name: fatherName.trim() || null,
        mother_name: motherName.trim() || null,
        parent_phone: parentPhone.trim() || null,
        previous_school: previousSchool.trim() || null,
        nationality: nationality.trim() || null,
        emergency_contact: emergencyContact.trim() || null,
        medical_information: medicalInformation.trim() || null,
      };

      const { data, error: createError } = await supabase.rpc("create_student_admission", {
        p_student: student,
        p_admission_fee: admissionFeeAmount,
        p_bill_number: admissionFeeAmount > 0 ? billNumber.trim() : null,
        p_receipt_number: admissionFeeAmount > 0 ? receiptNumber.trim() : null,
        p_payment_mode: admissionFeeAmount > 0 ? paymentMode : null,
        p_account_id: admissionFeeAmount > 0 ? accountId : null,
        p_payment_date: admissionFeeAmount > 0 ? paymentDate : null,
      });
      if (createError) throw new Error(createError.message);
      if (typeof data?.student_id !== "string") {
        throw new Error("Admission was saved, but no student ID was returned. Check the student list before retrying.");
      }

      const schoolAddress = [school.address, school.city, school.state, school.postal_code]
        .filter(Boolean).join(", ");
      const studentName = [firstName, middleName, lastName].map((part) => part.trim()).filter(Boolean).join(" ");
      const className = classes.find((item) => item.id === classId)?.name || "";
      const sectionName = sections.find((item) => item.id === sectionId)?.name || "";
      const yearName = academicYears.find((item) => item.id === academicYearId)?.name || "";
      const paymentFields = admissionFeeAmount > 0 ? [
        { label: "Admission fee", value: `INR ${admissionFeeAmount.toFixed(2)}` },
        { label: "Bill number", value: billNumber.trim() },
        { label: "Receipt number", value: receiptNumber.trim() },
        { label: "Payment date", value: paymentDate },
        { label: "Paid into", value: `${paymentMode === "cash" ? "Cash" : "Bank"} - ${account?.name || ""}` },
      ] : [{ label: "Admission fee", value: "No fee collected" }];
      const document: AdmissionPdfData = {
        schoolName: school.name,
        schoolAddress,
        sections: [
          { title: "Student information", fields: [
            { label: "Admission number", value: admissionNo.trim() },
            { label: "Roll number", value: rollNo.trim() },
            { label: "Student name", value: studentName },
            { label: "Date of birth", value: dateOfBirth },
            { label: "Gender", value: gender },
            { label: "Admission date", value: admissionDate },
            { label: "Status", value: status },
            { label: "Blood group", value: bloodGroup },
            { label: "Nationality", value: nationality },
            { label: "Previous school", value: previousSchool },
          ] },
          { title: "Academic placement", fields: [
            { label: "Academic year", value: yearName },
            { label: "Class", value: className },
            { label: "Section", value: sectionName },
          ] },
          { title: "Family and contact", fields: [
            { label: "Father's name", value: fatherName },
            { label: "Mother's name", value: motherName },
            { label: "Parent phone", value: parentPhone },
            { label: "Emergency contact", value: emergencyContact },
            { label: "Address", value: address },
            { label: "City", value: city },
            { label: "State", value: state },
            { label: "Postal code", value: postalCode },
          ] },
          { title: "Additional information", fields: [
            { label: "Medical information", value: medicalInformation },
            { label: "Notes", value: notes },
          ] },
          { title: "Admission fee", fields: paymentFields },
        ],
      };
      setCompleted({
        studentId: data.student_id,
        admissionNo: admissionNo.trim(),
        school,
        document,
        receipt: admissionFeeAmount > 0 ? {
          schoolName: school.name,
          schoolAddress,
          title: "ADMISSION FEE RECEIPT",
          sections: [
            { title: "Student", fields: [
              { label: "Student name", value: studentName },
              { label: "Admission number", value: admissionNo.trim() },
              { label: "Class / section", value: [className, sectionName].filter(Boolean).join(" / ") },
              { label: "Academic year", value: yearName },
            ] },
            { title: "Payment received", fields: paymentFields },
          ],
        } : null,
      });
    } catch (createError) {
      console.error("CREATE STUDENT ERROR:", createError);
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create student.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf(data: AdmissionPdfData, filename: string) {
    if (!completed) return;
    try {
      setError("");
      const logo = await loadReceiptLogoDataUrl(completed.school.logo_url);
      if (completed.school.logo_url && !logo) {
        throw new Error("The school logo could not be loaded. Please try again.");
      }
      createAdmissionPdf({ ...data, schoolLogoDataUrl: logo }).save(filename);
    } catch (pdfError) {
      console.error("ADMISSION PDF ERROR:", pdfError);
      setError(pdfError instanceof Error ? pdfError.message : "Unable to download the PDF.");
    }
  }

  if (completed) {
    const safeNumber = completed.admissionNo.replace(/[^a-zA-Z0-9-_]/g, "-");
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-green-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Student admitted</h1>
          <p className="mt-2 text-sm text-slate-600">
            The student{completed.receipt ? ", admission bill and payment have" : " has"} been saved.
          </p>
          {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white" onClick={() => void downloadPdf(completed.document, `Admission-${safeNumber}.pdf`)}>
              Download admission form
            </button>
            {completed.receipt && (
              <button type="button" className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white" onClick={() => void downloadPdf(completed.receipt!, `Admission-Receipt-${safeNumber}.pdf`)}>
                Download fee receipt
              </button>
            )}
            <Link href={`/dashboard/students/${completed.studentId}/fees`} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700">View student fees</Link>
            <Link href="/dashboard/students" className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700">Students</Link>
          </div>
        </div>
      </div>
    );
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

              <Field label="Admission Fee">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={admissionFee}
                  onChange={(event) => setAdmissionFee(event.target.value)}
                  placeholder="0.00"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Leave blank or enter 0 if no admission fee is due.
                </p>
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

              <Field label="Nationality">
                <input value={nationality} onChange={(event) => setNationality(event.target.value)} className={inputClass} />
              </Field>

              <Field label="Previous School">
                <input value={previousSchool} onChange={(event) => setPreviousSchool(event.target.value)} className={inputClass} />
              </Field>
            </div>
          </section>

          {Number(admissionFee) > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Admission Fee Collection</h2>
              <p className="mt-1 text-sm text-slate-500">The full admission fee will be collected when the student is saved.</p>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <Field label="Manual Bill Number" required>
                  <input value={billNumber} onChange={(event) => setBillNumber(event.target.value)} maxLength={100} required className={inputClass} />
                </Field>
                <Field label="Manual Receipt Number" required>
                  <input value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} maxLength={100} required className={inputClass} />
                </Field>
                <Field label="Payment Date" required>
                  <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required className={inputClass} />
                </Field>
                <Field label="Payment Type" required>
                  <select value={paymentMode} onChange={(event) => {
                    setPaymentMode(event.target.value as "cash" | "bank_transfer");
                    setAccountId("");
                  }} className={inputClass}>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank</option>
                  </select>
                </Field>
                <Field label={paymentMode === "cash" ? "Cash Account" : "Bank Account"} required>
                  <select value={accountId} onChange={(event) => setAccountId(event.target.value)} required className={inputClass}>
                    <option value="">Select an account</option>
                    {accounts.filter((account) => account.account_type.toLowerCase() === (paymentMode === "cash" ? "cash" : "bank")).map((account) => (
                      <option key={account.id} value={account.id}>{account.name} ({account.code})</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">Accounts are taken from your school&apos;s chart of accounts.</p>
                </Field>
              </div>
            </section>
          )}

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
            <h2 className="text-lg font-bold text-slate-900">Family and Emergency Details</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <Field label="Father's Name">
                <input value={fatherName} onChange={(event) => setFatherName(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Mother's Name">
                <input value={motherName} onChange={(event) => setMotherName(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Parent / Guardian Phone">
                <input type="tel" value={parentPhone} onChange={(event) => setParentPhone(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Emergency Contact">
                <input value={emergencyContact} onChange={(event) => setEmergencyContact(event.target.value)} placeholder="Name and phone" className={inputClass} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Medical Information">
                  <textarea value={medicalInformation} onChange={(event) => setMedicalInformation(event.target.value)} rows={3} className={inputClass} />
                </Field>
              </div>
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
              disabled={loading}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {loading ? "Saving..." : "Save Student"}
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
