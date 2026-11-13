"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  generateAdmissionReceiptPDF,
  loadReceiptLogoDataUrl,
} from "@/lib/fees/generateReceipt";

type AdmissionStudent = {
  id: string;
  school_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  admission_no: string | null;
  parent_phone: string | null;
  admission_date: string | null;
  class_id: string | null;
  section_id: string | null;
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
  address: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
};

export default function StudentAdmissionPaymentPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.id as string;
  const [student, setStudent] = useState<AdmissionStudent | null>(null);
  const [school, setSchool] = useState<SchoolReceiptDetails | null>(null);
  const [className, setClassName] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState<string | null>(null);
  const [cashAccountId, setCashAccountId] = useState("");
  const [bankAccounts, setBankAccounts] = useState<PaymentAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [utrNumber, setUtrNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const getSchoolId = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;
    if (!user) {
      router.replace("/login");
      return null;
    }

    const { data: membership, error: membershipError } = await supabase
      .from("school_users")
      .select("school_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!membership?.school_id) {
      throw new Error("Your account is not assigned to a school.");
    }

    return membership.school_id as string;
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const supabase = createClient();
        const schoolId = await getSchoolId();
        if (!schoolId || cancelled) return;

        const { data: loadedStudent, error: studentError } = await supabase
          .from("students")
          .select(
            "id, school_id, first_name, middle_name, last_name, admission_no, parent_phone, admission_date, class_id, section_id",
          )
          .eq("id", studentId)
          .eq("school_id", schoolId)
          .maybeSingle();

        if (studentError) throw studentError;
        if (!loadedStudent) throw new Error("Student was not found in your school.");

        const [schoolResult, accountsResult] = await Promise.all([
          supabase
            .from("schools")
            .select("name, logo_url, address, city, state, postal_code, phone, email")
            .eq("id", schoolId)
            .maybeSingle(),
          supabase
            .from("accounts")
            .select("id, name, code, account_type")
            .eq("school_id", schoolId)
            .eq("is_active", true)
            .order("name", { ascending: true }),
        ]);

        if (schoolResult.error) throw schoolResult.error;
        if (accountsResult.error) throw accountsResult.error;
        if (!schoolResult.data) throw new Error("School details could not be loaded.");
        if (cancelled) return;

        const loadedAccounts = (accountsResult.data || []) as PaymentAccount[];
        const cashAccounts = loadedAccounts.filter(
          (account) => account.account_type.toLowerCase() === "cash",
        );
        const loadedBankAccounts = loadedAccounts.filter(
          (account) => account.account_type.toLowerCase() === "bank",
        );

        setStudent(loadedStudent as AdmissionStudent);
        setSchool(schoolResult.data as SchoolReceiptDetails);
        setBankAccounts(loadedBankAccounts);
        setCashAccountId(
          (
            cashAccounts.find((account) =>
              account.name.toLowerCase().includes("main cash"),
            ) || cashAccounts[0]
          )?.id || "",
        );
        setBankAccountId(
          loadedBankAccounts.length === 1 ? loadedBankAccounts[0].id : "",
        );

        if (loadedStudent.class_id) {
          const { data: classRow, error: classError } = await supabase
            .from("classes")
            .select("name")
            .eq("id", loadedStudent.class_id)
            .eq("school_id", schoolId)
            .maybeSingle();
          if (classError) throw classError;
          if (!cancelled) setClassName(classRow?.name || null);
        }

        if (loadedStudent.section_id) {
          const { data: sectionRow, error: sectionError } = await supabase
            .from("sections")
            .select("name")
            .eq("id", loadedStudent.section_id)
            .eq("school_id", schoolId)
            .maybeSingle();
          if (sectionError) throw sectionError;
          if (!cancelled) setSectionName(sectionRow?.name || null);
        }
      } catch (loadError) {
        console.error("LOAD ADMISSION PAYMENT ERROR:", loadError);
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load admission payment details.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [getSchoolId, studentId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid positive admission fee amount.");
      return;
    }
    if (!receiptNumber.trim()) {
      setError("Enter the manual receipt number.");
      return;
    }
    if (paymentMethod === "bank_transfer" && (!bankAccountId || !utrNumber.trim())) {
      setError("Select the receiving bank account and enter the UTR number.");
      return;
    }
    if (paymentMethod === "cash" && !cashAccountId) {
      setError("No active cash account is configured for this school.");
      return;
    }
    if (!student || !school) {
      setError("Student or school details are not loaded.");
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const schoolId = await getSchoolId();
      if (!schoolId || schoolId !== student.school_id) {
        throw new Error("The student does not belong to your active school.");
      }

      const accountId =
        paymentMethod === "cash" ? cashAccountId : bankAccountId;
      const expectedAccountType =
        paymentMethod === "cash" ? "cash" : "bank";
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
        String(account.account_type || "").toLowerCase() !== expectedAccountType
      ) {
        throw new Error(`The selected ${expectedAccountType} account is unavailable.`);
      }

      const paymentDate =
        student.admission_date || new Date().toISOString().slice(0, 10);
      const { data: admissionBill, error: billCreateError } = await supabase.rpc(
        "create_admission_fee_bill",
        {
          p_student_id: student.id,
          p_amount: numericAmount,
          p_bill_date: paymentDate,
        },
      );

      if (billCreateError) throw billCreateError;
      if (!admissionBill?.id) {
        throw new Error("The admission fee bill was not returned.");
      }

      const { data: bill, error: billError } = await supabase
        .from("fee_bills")
        .select("id, bill_number, balance_amount")
        .eq("id", admissionBill.id)
        .eq("school_id", schoolId)
        .eq("student_id", student.id)
        .maybeSingle();

      if (billError) throw billError;
      if (!bill) throw new Error("The admission fee bill could not be verified.");

      if (Number(bill.balance_amount || 0) <= 0.005) {
        const { data: existingPayment, error: existingPaymentError } = await supabase
          .from("fee_payments")
          .select("receipt_number, payment_date, amount, payment_method, reference_number, account_id")
          .eq("school_id", schoolId)
          .eq("bill_id", bill.id)
          .order("payment_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingPaymentError) throw existingPaymentError;
        if (!existingPayment) {
          throw new Error("This admission bill is already paid, but its receipt could not be loaded.");
        }

        const { data: existingAccount, error: existingAccountError } = await supabase
          .from("accounts")
          .select("name")
          .eq("id", existingPayment.account_id)
          .eq("school_id", schoolId)
          .maybeSingle();

        if (existingAccountError) throw existingAccountError;
        await downloadReceipt(
          student,
          school,
          bill.bill_number || "",
          existingPayment.receipt_number,
          existingPayment.payment_date,
          Number(existingPayment.amount),
          existingPayment.payment_method,
          existingAccount?.name || null,
          existingPayment.reference_number,
        );
        router.replace(`/dashboard/students/${student.id}/fees`);
        return;
      }

      if (Number(bill.balance_amount || 0) + 0.005 < numericAmount) {
        throw new Error("The admission fee bill has a different remaining balance.");
      }

      const { data: admissionItem, error: itemError } = await supabase
        .from("fee_bill_items")
        .select("id")
        .eq("school_id", schoolId)
        .eq("bill_id", bill.id)
        .eq("description", "Admission Fee")
        .limit(1)
        .maybeSingle();

      if (itemError) throw itemError;
      if (!admissionItem) {
        throw new Error("The admission fee bill has no Admission Fee line.");
      }

      const { data: payment, error: paymentError } = await supabase.rpc(
        "record_fee_payment_collection",
        {
          p_student_id: student.id,
          p_bill_id: bill.id,
          p_amount: numericAmount,
          p_payment_mode: paymentMethod,
          p_account_id: account.id,
          p_receipt_number: receiptNumber.trim(),
          p_payment_date: paymentDate,
          p_reference_number:
            paymentMethod === "bank_transfer" ? utrNumber.trim() : null,
          p_remarks: "Admission Fee",
          p_allocations: [
            {
              fee_bill_item_id: admissionItem.id,
              amount: numericAmount,
            },
          ],
        },
      );

      if (paymentError) throw paymentError;
      if (!payment?.success || !payment.payment_id) {
        throw new Error("Admission fee payment was not confirmed by the accounting system.");
      }

      await downloadReceipt(
        student,
        school,
        bill.bill_number || "",
        receiptNumber.trim(),
        paymentDate,
        numericAmount,
        paymentMethod,
        account.name,
        paymentMethod === "bank_transfer" ? utrNumber.trim() : null,
      );
      router.replace(`/dashboard/students/${student.id}/fees`);
    } catch (submitError) {
      console.error("RECORD ADMISSION PAYMENT ERROR:", submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to record the admission payment.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function downloadReceipt(
    studentData: AdmissionStudent,
    schoolData: SchoolReceiptDetails,
    billNumber: string,
    receipt: string,
    receiptDate: string,
    paidAmount: number,
    method: string,
    accountName: string | null,
    reference: string | null,
  ) {
    const logoDataUrl = await loadReceiptLogoDataUrl(schoolData.logo_url);
    generateAdmissionReceiptPDF({
      schoolName: schoolData.name || "School",
      schoolLogoDataUrl: logoDataUrl,
      schoolAddress: [
        schoolData.address,
        schoolData.city,
        schoolData.state,
        schoolData.postal_code,
      ]
        .filter(Boolean)
        .join(", "),
      schoolPhone: schoolData.phone,
      schoolEmail: schoolData.email,
      receiptNumber: receipt,
      receiptDate,
      billNumber,
      studentName: [
        studentData.first_name,
        studentData.middle_name,
        studentData.last_name,
      ]
        .filter(Boolean)
        .join(" "),
      admissionNumber: studentData.admission_no || "",
      className,
      section: sectionName,
      mobileNumber: studentData.parent_phone,
      amount: paidAmount,
      paymentMode: method,
      paymentAccountName: accountName,
      referenceNumber: reference,
    });
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-slate-500">
        Loading student and school details...
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/dashboard/students/${studentId}/fees`}
          className="text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          ← Back to Student Fees
        </Link>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">
            Record Admission Fee
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            This records payment for the existing student and does not create another student.
          </p>

          {student && (
            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-slate-900">
                {[student.first_name, student.middle_name, student.last_name]
                  .filter(Boolean)
                  .join(" ")}
              </p>
              <p className="mt-1 text-slate-600">
                Admission No: {student.admission_no || "—"}
              </p>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Admission Fee Collected *
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Manual Receipt Number *
              <input
                type="text"
                required
                value={receiptNumber}
                onChange={(event) => setReceiptNumber(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Payment Method *
              <select
                value={paymentMethod}
                onChange={(event) => {
                  setPaymentMethod(event.target.value);
                  if (event.target.value === "cash") setUtrNumber("");
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank</option>
              </select>
            </label>

            {paymentMethod === "bank_transfer" && (
              <>
                <label className="text-sm font-medium text-slate-700">
                  Bank Account *
                  <select
                    value={bankAccountId}
                    onChange={(event) => setBankAccountId(event.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">Select a bank account</option>
                    {bankAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                        {account.code ? ` (${account.code})` : ""}
                      </option>
                    ))}
                  </select>
                  {bankAccounts.length === 0 && (
                    <span className="mt-1 block text-xs text-amber-700">
                      No active bank accounts are configured for this school.
                    </span>
                  )}
                </label>
                <label className="text-sm font-medium text-slate-700">
                  UTR Number *
                  <input
                    type="text"
                    required
                    value={utrNumber}
                    onChange={(event) => setUtrNumber(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </>
            )}

            <div className="flex items-end sm:col-span-2">
              <button
                type="submit"
                disabled={saving || loading}
                className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Recording payment..." : "Record Payment & Download A4 Receipt"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
