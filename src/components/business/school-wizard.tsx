"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, ErrorBanner, Field, LoadingBlock, PageHeader, buttonClass, inputClass } from "@/components/business/ui";
import { callRpc, getErrorMessage, newIdempotencyKey } from "@/lib/business/rpc";
import { formatInr, planLabel, pricingUnitLabel } from "@/lib/business/format";
import { runProvisioningJob } from "@/lib/business/provisioning-client";
import type { Lead, PlanWithPrice, Quote, SaleResult, SalesRep } from "@/lib/business/types";

const STEPS = [
  "School details",
  "Student & staff strength",
  "Subscription",
  "Pricing negotiation",
  "Payment terms",
  "Sales discussion",
  "Review & create",
] as const;

type Form = {
  schoolName: string;
  schoolCode: string;
  address: string;
  city: string;
  district: string;
  state: string;
  postalCode: string;
  contactPerson: string;
  contactPhone: string;
  email: string;
  principalName: string;
  branchCount: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  loginMode: "invite" | "password";
  ownerPassword: string;
  studentStrength: string;
  staffStrength: string;
  planCode: string;
  unitPrice: string;
  discount: string;
  termYears: string;
  billingFrequency: "yearly" | "monthly";
  monthlyAllowed: boolean;
  paymentArrangement: "single" | "installments";
  installmentCount: string;
  paymentDay: string;
  startDate: string;
  paymentTerms: string;
  specialConditions: string;
  confirmed: boolean;
  representativeId: string;
};

const initialForm = (): Form => ({
  schoolName: "",
  schoolCode: "",
  address: "",
  city: "",
  district: "",
  state: "",
  postalCode: "",
  contactPerson: "",
  contactPhone: "",
  email: "",
  principalName: "",
  branchCount: "1",
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  loginMode: "invite",
  ownerPassword: "",
  studentStrength: "",
  staffStrength: "",
  planCode: "",
  unitPrice: "",
  discount: "0",
  termYears: "1",
  billingFrequency: "yearly",
  monthlyAllowed: false,
  paymentArrangement: "single",
  installmentCount: "2",
  paymentDay: "5",
  startDate: new Date().toISOString().slice(0, 10),
  paymentTerms: "",
  specialConditions: "",
  confirmed: false,
  representativeId: "",
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SchoolWizard({ basePath, isAdmin }: { basePath: "/sales" | "/super-admin"; isAdmin: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const idempotencyKey = useRef(newIdempotencyKey());

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(initialForm);
  const [plans, setPlans] = useState<PlanWithPrice[]>([]);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [loginState, setLoginState] = useState<{ ok: boolean; message: string } | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const paymentTermsWithSchedule = () => {
    const schedule = form.paymentArrangement === "installments"
      ? `Agreed payment arrangement: ${form.installmentCount} instalments, due on the ${form.paymentDay}${Number(form.paymentDay) === 1 ? "st" : Number(form.paymentDay) === 2 ? "nd" : Number(form.paymentDay) === 3 ? "rd" : "th"} of each month.`
      : `Agreed payment arrangement: one payment, due on the ${form.paymentDay}${Number(form.paymentDay) === 1 ? "st" : Number(form.paymentDay) === 2 ? "nd" : Number(form.paymentDay) === 3 ? "rd" : "th"} of the billing period.`;
    return `${form.paymentTerms.trim()}\n\n${schedule}`;
  };

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [planResult, repResult] = await Promise.all([
          supabase.from("subscription_plans").select("*").eq("is_active", true).order("sort_order"),
          isAdmin ? supabase.from("sales_representatives").select("*").eq("status", "active").order("full_name") : Promise.resolve({ data: [], error: null }),
        ]);
        if (planResult.error) throw planResult.error;
        if (repResult.error) throw repResult.error;
        const leadId = search.get("lead");
        let leadRow: Lead | null = null;
        if (leadId) {
          const { data, error: leadError } = await supabase.from("school_leads").select("*").eq("id", leadId).maybeSingle();
          if (leadError) throw leadError;
          leadRow = (data as Lead | null) ?? null;
        }
        if (!active) return;
        setPlans((planResult.data ?? []) as PlanWithPrice[]);
        setReps((repResult.data ?? []) as SalesRep[]);
        if (leadRow && leadRow.status !== "converted" && leadRow.status !== "not_interested") {
          setLead(leadRow);
          setForm((current) => ({
            ...current,
            schoolName: leadRow.school_name,
            address: leadRow.address ?? "",
            district: leadRow.district ?? "",
            state: leadRow.state ?? "",
            contactPerson: leadRow.contact_person ?? "",
            contactPhone: leadRow.mobile ?? "",
            email: leadRow.email ?? "",
            studentStrength: leadRow.estimated_student_strength ? String(leadRow.estimated_student_strength) : "",
            staffStrength: leadRow.estimated_staff_strength != null ? String(leadRow.estimated_staff_strength) : "",
            representativeId: isAdmin ? leadRow.assigned_rep_id : "",
          }));
        }
      } catch (caught) {
        if (active) setError(getErrorMessage(caught, "Unable to load the form."));
      } finally {
        if (active) setReady(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [supabase, search, isAdmin]);

  // Server-side price preview. The browser never calculates the contract.
  const students = Number(form.studentStrength);
  useEffect(() => {
    if (!form.planCode || !Number.isInteger(students) || students < 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote(null);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const next = await callRpc<Quote>(supabase, "quote_subscription", {
          p_plan_code: form.planCode,
          p_student_count: students,
          p_unit_price: form.unitPrice === "" ? null : Number(form.unitPrice),
          p_discount: Number(form.discount || 0),
          p_term_months: Number(form.termYears || 1) * 12,
        });
        if (!active) return;
        setQuote(next);
        setQuoteError("");
      } catch (caught) {
        if (!active) return;
        setQuote(null);
        setQuoteError(getErrorMessage(caught));
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [supabase, form.planCode, form.unitPrice, form.discount, form.termYears, students]);

  function choosePlan(code: string) {
    setForm((current) => ({ ...current, planCode: code, unitPrice: "" }));
  }

  // Prefill the negotiable price with the configured default once it is known.
  useEffect(() => {
    if (quote && form.unitPrice === "") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm((current) => (current.unitPrice === "" ? { ...current, unitPrice: String(quote.default_unit_price) } : current));
    }
  }, [quote, form.unitPrice]);

  function validate(index: number): string {
    if (index === 0) {
      if (!form.schoolName.trim()) return "Enter the school name.";
      if (!/^[A-Za-z0-9_-]{3,30}$/.test(form.schoolCode.trim())) return "School ID must be 3-30 letters, numbers, - or _.";
      if (!form.contactPerson.trim() || !form.contactPhone.trim()) return "Enter the contact person and contact number.";
      if (form.email && !EMAIL.test(form.email)) return "Enter a valid school email address.";
      if (!form.ownerName.trim()) return "Enter the school owner's name.";
      if (!EMAIL.test(form.ownerEmail.trim())) return "Enter a valid owner email address.";
      if (form.loginMode === "password" && form.ownerPassword.length < 8) return "The temporary password must contain at least 8 characters.";
    }
    if (index === 1) {
      if (!Number.isInteger(Number(form.studentStrength)) || Number(form.studentStrength) < 1) return "Enter a student strength of at least 1.";
      if (form.staffStrength === "" || !Number.isInteger(Number(form.staffStrength)) || Number(form.staffStrength) < 0) return "Enter the staff strength.";
    }
    if (index === 2 && !form.planCode) return "Select a subscription plan.";
    if (index === 3) {
      if (form.unitPrice === "" || Number(form.unitPrice) < 0) return "Enter the agreed price.";
      if (!quote) return quoteError || "The price could not be calculated yet.";
    }
    if (index === 4) {
      if (!form.startDate) return "Select the contract start date.";
      if (!form.paymentTerms.trim()) return "Describe the agreed payment terms.";
      if (form.paymentArrangement === "installments" && ![2, 3, 4, 5, 6].includes(Number(form.installmentCount))) return "Select 2 to 6 instalments.";
      if (!Number.isInteger(Number(form.paymentDay)) || Number(form.paymentDay) < 1 || Number(form.paymentDay) > 28) return "Select a payment day from the 1st to the 28th.";
      if (form.billingFrequency === "monthly" && !form.monthlyAllowed) return "Monthly billing requires confirming that equal monthly instalments are permitted.";
    }
    if (index === 5 && !form.confirmed) return "Confirm the sales discussion before continuing.";
    return "";
  }

  function next() {
    const problem = validate(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  async function create() {
    for (let index = 0; index < STEPS.length - 1; index += 1) {
      const problem = validate(index);
      if (problem) {
        setStep(index);
        setError(problem);
        return;
      }
    }
    setSubmitting(true);
    setError("");
    try {
      const sale = await callRpc<SaleResult>(supabase, "create_school_sale", {
        p: {
          idempotency_key: idempotencyKey.current,
          school_name: form.schoolName.trim(),
          school_code: form.schoolCode.trim().toUpperCase(),
          email: form.email.trim() || null,
          phone: form.contactPhone.trim(),
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          district: form.district.trim() || null,
          state: form.state.trim() || null,
          postal_code: form.postalCode.trim() || null,
          contact_person: form.contactPerson.trim(),
          contact_phone: form.contactPhone.trim(),
          principal_name: form.principalName.trim() || null,
          branch_count: form.branchCount ? Number(form.branchCount) : null,
          student_strength: Number(form.studentStrength),
          staff_strength: Number(form.staffStrength),
          plan_code: form.planCode,
          negotiated_unit_price: Number(form.unitPrice),
          discount_amount: Number(form.discount || 0),
          term_months: Number(form.termYears) * 12,
          billing_frequency: form.billingFrequency,
          monthly_instalments_allowed: form.billingFrequency === "monthly" ? form.monthlyAllowed : false,
          start_date: form.startDate,
          payment_terms: paymentTermsWithSchedule(),
          special_conditions: form.specialConditions.trim() || null,
          sales_discussion_confirmed: form.confirmed,
          lead_id: lead?.id ?? null,
          representative_id: isAdmin && form.representativeId ? form.representativeId : null,
          owner: { name: form.ownerName.trim(), email: form.ownerEmail.trim().toLowerCase(), phone: form.ownerPhone.trim() || null },
        },
      });
      setResult(sale);

      const outcome = await runProvisioningJob(
        supabase,
        sale.job_id,
        form.loginMode,
        form.loginMode === "password" ? form.ownerPassword : undefined,
      );
      setLoginState(
        outcome.ok
          ? { ok: true, message: outcome.invited ? "An invitation email was sent to the owner." : "The owner login was created with the temporary password you set." }
          : { ok: false, message: outcome.error },
      );
    } catch (caught) {
      setError(getErrorMessage(caught, "Unable to create the school."));
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <LoadingBlock />;

  if (result) {
    return (
      <>
        <PageHeader title="School created" />
        <Card>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-600" />
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                <strong>{form.schoolName}</strong> was created with its agreement ({formatInr(result.quote.total_amount)}), ownership record and first invoice.
              </p>
              {loginState?.ok ? (
                <p className="text-emerald-700">{loginState.message}</p>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  The school is saved, but the owner login is not ready yet: {loginState?.message}. Open the school to retry — nothing is lost.
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Link className={buttonClass()} href={`${basePath}/schools/${result.school_id}`}>
                  Open school
                </Link>
                <Link className={buttonClass("secondary")} href={`${basePath}/schools/new`} onClick={() => router.refresh()}>
                  Add another school
                </Link>
              </div>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const selectedPlan = plans.find((plan) => plan.code === form.planCode);

  return (
    <>
      <PageHeader title="Add new school" description={lead ? `Converting lead: ${lead.school_name}` : "Complete each step with the school before creating the account."} />

      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Progress">
        {STEPS.map((name, index) => (
          <li key={name} aria-current={index === step ? "step" : undefined} className={`rounded-full px-3 py-1 text-xs font-semibold ${index === step ? "bg-blue-600 text-white" : index < step ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {index + 1}. {name}
          </li>
        ))}
      </ol>

      <ErrorBanner message={error} />

      <Card>
        {step === 0 ? (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="School name" required><input className={inputClass} value={form.schoolName} onChange={(e) => set("schoolName", e.target.value)} /></Field>
              <Field label="School ID" required hint="Used as the school's login ID. Cannot be changed later."><input className={inputClass} value={form.schoolCode} onChange={(e) => set("schoolCode", e.target.value.toUpperCase())} /></Field>
              <Field label="Address"><input className={inputClass} value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
              <Field label="City / town"><input className={inputClass} value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
              <Field label="District"><input className={inputClass} value={form.district} onChange={(e) => set("district", e.target.value)} /></Field>
              <Field label="State"><input className={inputClass} value={form.state} onChange={(e) => set("state", e.target.value)} /></Field>
              <Field label="PIN code"><input className={inputClass} inputMode="numeric" value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} /></Field>
              <Field label="Number of branches"><input className={inputClass} type="number" min={1} value={form.branchCount} onChange={(e) => set("branchCount", e.target.value)} /></Field>
              <Field label="Contact person" required><input className={inputClass} value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} /></Field>
              <Field label="Contact number" required><input className={inputClass} inputMode="tel" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
              <Field label="School email"><input className={inputClass} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Principal name"><input className={inputClass} value={form.principalName} onChange={(e) => set("principalName", e.target.value)} /></Field>
            </div>
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">The school can upload its logo from School Settings after its first login.</p>

            <div className="border-t border-slate-200 pt-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">School owner login</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Owner name" required><input className={inputClass} value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field>
                <Field label="Owner email" required hint="The owner signs in with this email."><input className={inputClass} type="email" value={form.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} /></Field>
                <Field label="Owner phone"><input className={inputClass} inputMode="tel" value={form.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} /></Field>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="loginMode" checked={form.loginMode === "invite"} onChange={() => set("loginMode", "invite")} /> Send an invitation email (recommended)</label>
                <label className="flex items-center gap-2"><input type="radio" name="loginMode" checked={form.loginMode === "password"} onChange={() => set("loginMode", "password")} /> Set a temporary password and share it with the owner</label>
                {form.loginMode === "password" ? (
                  <div className="max-w-sm pt-1"><Field label="Temporary password" required><input className={inputClass} type="text" autoComplete="off" value={form.ownerPassword} onChange={(e) => set("ownerPassword", e.target.value)} /></Field></div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <Field label="Student strength" required hint="Estimated strength used for the Initial MOU."><input className={inputClass} type="number" min={1} value={form.studentStrength} onChange={(e) => set("studentStrength", e.target.value)} /></Field>
            <Field label="Staff strength" required><input className={inputClass} type="number" min={0} value={form.staffStrength} onChange={(e) => set("staffStrength", e.target.value)} /></Field>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <button
                key={plan.code}
                type="button"
                onClick={() => choosePlan(plan.code)}
                aria-pressed={form.planCode === plan.code}
                className={`rounded-2xl border p-4 text-left transition ${form.planCode === plan.code ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}
              >
                <div className="font-semibold text-slate-900">{planLabel(plan.code)}</div>
                <div className="mt-1 text-sm text-slate-600">{plan.description}</div>
                <div className="mt-3"><Badge tone="blue">{pricingUnitLabel(plan.pricing_unit)}</Badge></div>
              </button>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Agreed price (${selectedPlan ? pricingUnitLabel(selectedPlan.pricing_unit) : ""})`} required hint={quote ? `List price ${formatInr(quote.default_unit_price)}` : undefined}>
                <input className={inputClass} type="number" min={0} step="0.01" value={form.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} />
              </Field>
              <Field label="Discount (flat amount)"><input className={inputClass} type="number" min={0} step="0.01" value={form.discount} onChange={(e) => set("discount", e.target.value)} /></Field>
              <Field label="Contract duration (years)"><select className={inputClass} value={form.termYears} onChange={(e) => set("termYears", e.target.value)}>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} year{y > 1 ? "s" : ""}</option>)}</select></Field>
            </div>
            {quoteError ? <ErrorBanner message={quoteError} /> : null}
            {quote ? <QuoteSummary quote={quote} students={students} /> : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment frequency" required>
              <select className={inputClass} value={form.billingFrequency} onChange={(e) => set("billingFrequency", e.target.value as Form["billingFrequency"])}>
                <option value="yearly">Yearly</option>
                <option value="monthly">Monthly (equal instalments)</option>
              </select>
            </Field>
            <Field label="Payment arrangement" required hint="This records the agreed terms in the contract. It does not create separate instalment invoices.">
              <select className={inputClass} value={form.paymentArrangement} onChange={(e) => set("paymentArrangement", e.target.value as Form["paymentArrangement"])}>
                <option value="single">One payment</option>
                <option value="installments">Term instalments (2–6 payments)</option>
              </select>
            </Field>
            {form.paymentArrangement === "installments" ? (
              <Field label="Number of instalments" required>
                <select className={inputClass} value={form.installmentCount} onChange={(e) => set("installmentCount", e.target.value)}>
                  {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} instalments</option>)}
                </select>
              </Field>
            ) : null}
            <Field label="Agreed payment day of the month" required hint="Choose a fixed day from the 1st to the 28th so it exists in every month.">
              <select className={inputClass} value={form.paymentDay} onChange={(e) => set("paymentDay", e.target.value)}>
                {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}{day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"} of each month</option>)}
              </select>
            </Field>
            <Field label="Contract start date" required><input className={inputClass} type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
            {form.billingFrequency === "monthly" ? (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-1" checked={form.monthlyAllowed} onChange={(e) => set("monthlyAllowed", e.target.checked)} />
                <span>The agreement explicitly permits equal monthly instalments of the agreed contract amount. The payment schedule is separate from the price: {quote ? formatInr(quote.total_amount) : "the contract amount"} is spread over {Number(form.termYears) * 12} months.</span>
              </label>
            ) : null}
            <div className="sm:col-span-2">
              <Field
                label="Payment terms"
                required
                hint="Write the agreed amount, number of payments, and the date each payment is due."
              >
                <textarea
                  className={inputClass}
                  rows={3}
                  value={form.paymentTerms}
                  onChange={(e) => set("paymentTerms", e.target.value)}
                  placeholder="Example: ₹1,20,000 total in 3 equal instalments of ₹40,000, due on the 5th of June, July, and August 2026."
                />
              </Field>
              <p className="mt-2 text-xs text-slate-500">
                Include the agreed payment dates so the school and sales team can clearly understand the schedule.
              </p>
            </div>
            <div className="sm:col-span-2"><Field label="Special conditions"><textarea className={inputClass} rows={3} value={form.specialConditions} onChange={(e) => set("specialConditions", e.target.value)} /></Field></div>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p>Before creating the school, confirm that you discussed all of the following with the school and that they agreed:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Available plans and the plan selected ({planLabel(form.planCode)})</li>
              <li>Student strength ({form.studentStrength})</li>
              <li>Pricing ({quote ? formatInr(quote.total_amount) : "-"}) and discount</li>
              <li>Payment frequency ({form.billingFrequency}) and subscription duration ({form.termYears} year(s))</li>
              <li>Terms and conditions of the school MOU</li>
            </ul>
            <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3">
              <input type="checkbox" className="mt-1" checked={form.confirmed} onChange={(e) => set("confirmed", e.target.checked)} />
              <span className="font-medium">I confirm the sales discussion took place and the school agreed to these terms.</span>
            </label>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-5">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {[
                ["School", `${form.schoolName} (${form.schoolCode.toUpperCase()})`],
                ["Contact", `${form.contactPerson}, ${form.contactPhone}`],
                ["Owner login", `${form.ownerName} - ${form.ownerEmail}`],
                ["Students / staff", `${form.studentStrength} / ${form.staffStrength}`],
                ["Plan", planLabel(form.planCode)],
                ["Frequency", `${form.billingFrequency}${form.billingFrequency === "monthly" ? " (equal instalments)" : ""}`],
                ["Payment arrangement", `${form.paymentArrangement === "installments" ? `${form.installmentCount} instalments` : "One payment"}, due on the ${form.paymentDay}${Number(form.paymentDay) === 1 ? "st" : Number(form.paymentDay) === 2 ? "nd" : Number(form.paymentDay) === 3 ? "rd" : "th"}`],
                ["Start date", form.startDate],
                ["Duration", `${form.termYears} year(s)`],
              ].map(([name, value]) => (
                <div key={name} className="flex justify-between gap-4 border-b border-slate-100 py-1.5"><dt className="text-slate-500">{name}</dt><dd className="text-right font-medium text-slate-900">{value}</dd></div>
              ))}
            </dl>
            {quote ? <QuoteSummary quote={quote} students={students} /> : null}
            {isAdmin ? (
              <Field label="Owning representative" hint="Leave as company-direct if no representative brought this school.">
                <select className={inputClass} value={form.representativeId} onChange={(e) => set("representativeId", e.target.value)} disabled={Boolean(lead)}>
                  <option value="">Company direct (no representative)</option>
                  {reps.map((rep) => <option key={rep.id} value={rep.user_id ?? ""}>{rep.full_name}</option>)}
                </select>
              </Field>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="mt-5 flex items-center justify-between">
        <button type="button" className={buttonClass("secondary")} onClick={() => { setError(""); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0 || submitting}>Back</button>
        {step < STEPS.length - 1 ? (
          <button type="button" className={buttonClass()} onClick={next}>Continue</button>
        ) : (
          <button type="button" className={buttonClass()} onClick={create} disabled={submitting}>{submitting ? "Creating..." : "Create school"}</button>
        )}
      </div>
    </>
  );
}

function QuoteSummary({ quote, students }: { quote: Quote; students: number }) {
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm">
      <div className="font-semibold text-blue-900">Calculation preview</div>
      <div className="mt-2 text-blue-900">
        {quote.pricing_unit === "per_student" ? `${students} students` : "1 school"} × {formatInr(quote.negotiated_unit_price)} × {quote.contract_years} year(s) = {formatInr(quote.gross_amount)}
      </div>
      {quote.discount_amount > 0 ? <div className="text-blue-900">Discount: − {formatInr(quote.discount_amount)}</div> : null}
      <div className="mt-1 text-lg font-bold text-blue-900">Total contract amount: {formatInr(quote.total_amount)}</div>
      {quote.price_outside_recommended_range ? (
        <div className="mt-2 text-xs text-amber-800">This price is outside the recommended range ({formatInr(quote.recommended_min_price)} - {formatInr(quote.recommended_max_price)}). It is allowed and will be flagged for review.</div>
      ) : null}
    </div>
  );
}
