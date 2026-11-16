// Row shapes returned by the Phase 2 tables, views and RPCs.

export type SalesRep = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  mobile: string;
  address: string | null;
  employee_id: string | null;
  joining_date: string;
  status: "pending_account" | "active" | "inactive";
  created_by: string | null;
  created_at: string;
};

export type RepPerformance = {
  rep_user_id: string;
  rep_name: string;
  rep_status: string;
  schools_brought: number;
  schools_currently_owned: number;
  active_schools: number;
  total_contract_value: number | string;
  total_invoiced: number | string;
  total_collected: number | string;
  pending_verification: number | string;
  outstanding: number | string;
};

export type BillingSummary = {
  school_id: string;
  school_name: string;
  subscription_id: string;
  plan_code: string;
  subscription_status: string;
  billing_frequency: string | null;
  billing_student_count: number | null;
  negotiated_unit_price: number | string | null;
  contract_amount: number | string;
  invoiced_amount: number | string;
  collected_amount: number | string;
  pending_verification_amount: number | string;
  outstanding_amount: number | string;
  next_due_date: string | null;
};

export type InvoiceBalance = {
  invoice_id: string;
  invoice_number: string;
  school_id: string;
  subscription_id: string;
  period_sequence: number;
  period_start: string;
  period_end: string;
  invoice_date: string;
  due_date: string;
  amount: number | string;
  tax_amount: number | string;
  total_amount: number | string;
  invoice_status: string;
  paid_amount: number | string;
  pending_verification_amount: number | string;
  balance_amount: number | string;
  display_status: string;
};

export type CompanyBranding = {
  legal_company_name: string | null;
  brand_name: string | null;
  registered_address: string | null;
  email: string | null;
  mobile: string | null;
  website: string | null;
  gstin: string | null;
  authorized_signatory_name: string | null;
  authorized_signatory_designation: string | null;
  logo_path: string | null;
  signature_path: string | null;
  signature_notice?: string;
};

export type CompanySettings = CompanyBranding & {
  default_gst_rate: number | string;
  invoice_due_days: number;
};

export type SchoolSnapshot = {
  id?: string;
  name: string;
  code?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  postal_code?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
  email?: string | null;
  principal_name?: string | null;
  branch_count?: number | null;
};

export type InvoiceSnapshot = {
  company: CompanyBranding;
  school: SchoolSnapshot;
  subscription: {
    plan_code?: string;
    contract_amount?: number | string;
    billing_frequency?: string;
    billing_student_count?: number;
    agreement_version?: number;
  };
  period: { sequence: number; of: number; start: string; end: string; adjustment?: boolean };
};

export type Invoice = {
  id: string;
  invoice_number: string;
  school_id: string;
  subscription_id: string;
  period_sequence: number;
  period_start: string;
  period_end: string;
  invoice_date: string;
  due_date: string;
  amount: number | string;
  tax_rate: number | string;
  tax_amount: number | string;
  total_amount: number | string;
  status: string;
  snapshot: InvoiceSnapshot;
};

export type MouSnapshot = {
  document_label: string;
  mou_type: "initial" | "final";
  version: number;
  generated_at: string;
  place: string | null;
  company: CompanyBranding;
  school: SchoolSnapshot;
  representative: { user_id: string; name: string } | null;
  commercial: {
    plan_code: string;
    plan_name: string;
    enabled_modules: string[];
    pricing_unit: string;
    student_count: number;
    estimated_student_count: number;
    default_unit_price: number | string;
    negotiated_unit_price: number | string;
    discount_amount: number | string;
    total_amount: number | string;
    term_months: number;
    billing_frequency: string;
    monthly_instalments_allowed: boolean;
    payment_terms: string;
    special_conditions: string | null;
    start_date: string;
    end_date: string;
    price_outside_recommended_range: boolean;
  };
  payment_schedule: { sequence: number; period_start: string; period_end: string; amount: number | string }[];
  terms: { terms_version_id: string; version: number; title: string; content: string };
  extra: {
    initial_student_count?: number;
    observed_student_count?: number;
    previous_amount?: number | string;
  };
};

export type SchoolMou = {
  id: string;
  school_id: string;
  subscription_id: string;
  mou_type: "initial" | "final";
  version: number;
  mou_number: string;
  terms_version: number;
  student_count: number;
  total_amount: number | string;
  generated_at: string;
  snapshot: MouSnapshot;
};

export type ReceiptSnapshot = {
  receipt_number: string;
  company: CompanyBranding;
  school: SchoolSnapshot;
  invoice: { invoice_number: string; total_amount: number | string; period_start: string; period_end: string };
  payment: {
    amount: number | string;
    payment_date: string;
    payment_mode: string;
    transaction_reference: string;
  };
  verified_at: string;
};

export type SchoolPayment = {
  id: string;
  school_id: string;
  invoice_id: string;
  amount: number | string;
  payment_date: string;
  payment_mode: string;
  transaction_reference: string;
  remarks: string | null;
  status: string;
  submitted_by: string;
  collected_by_rep_id: string | null;
  submitted_at: string;
  verified_at: string | null;
  verification_note: string | null;
  receipt_number: string | null;
  receipt_snapshot: ReceiptSnapshot | null;
  rejection_reason: string | null;
};

export type PaymentReversal = {
  id: string;
  payment_id: string;
  reversal_type: "reversal" | "refund";
  reversal_number: string;
  amount: number | string;
  reversal_date: string;
  reason: string;
};

export type Lead = {
  id: string;
  school_name: string;
  contact_person: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  district: string | null;
  state: string | null;
  estimated_student_strength: number | null;
  estimated_staff_strength: number | null;
  notes: string | null;
  next_follow_up_date: string | null;
  assigned_rep_id: string;
  status: string;
  converted_school_id: string | null;
  created_at: string;
};

export type PlanWithPrice = {
  id: string;
  code: "plan1" | "plan2" | "both";
  name: string;
  description: string | null;
  enabled_modules: string[];
  pricing_unit: "per_student" | "per_school_year";
  is_active: boolean;
  sort_order: number;
};

export type PlanPrice = {
  id: string;
  plan_id: string;
  default_price: number | string;
  recommended_min_price: number | string | null;
  recommended_max_price: number | string | null;
  effective_from: string;
  effective_to: string | null;
};

export type Quote = {
  plan_id: string;
  plan_code: string;
  plan_name: string;
  enabled_modules: string[];
  pricing_unit: string;
  default_unit_price: number;
  recommended_min_price: number | null;
  recommended_max_price: number | null;
  negotiated_unit_price: number;
  billing_units: number;
  term_months: number;
  contract_years: number;
  gross_amount: number;
  discount_amount: number;
  total_amount: number;
  price_outside_recommended_range: boolean;
};

export type SaleResult = {
  school_id: string;
  subscription_id: string;
  invoice_id: string;
  job_id: string;
  quote: Quote;
  idempotent: boolean;
};

export type ProvisioningJob = {
  id: string;
  job_type: "sales_rep" | "school_owner";
  status: string;
  subject_id: string;
  target_email: string;
  display_name: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
};

export type DashboardTotals = {
  total_schools: number;
  active_schools: number;
  total_contract_value: number;
  total_invoiced: number;
  total_collected: number;
  pending_verification: number;
  total_outstanding: number;
  initial_mous: number;
  final_mous: number;
};

export type MonthlyCollection = {
  month: string;
  collected_amount: number | string;
  refunded_amount: number | string;
  net_amount: number | string;
};

export type PlanDistribution = {
  plan_code: string;
  plan_name: string;
  subscription_count: number;
  contract_value: number | string;
};

export type BillingConfirmation = {
  id: string;
  school_id: string;
  subscription_id: string;
  initial_student_count: number;
  previous_billing_student_count: number;
  observed_student_count: number;
  confirmed_student_count: number;
  previous_amount: number | string;
  revised_amount: number | string;
  status: string;
  requested_by: string;
  requested_at: string;
  request_note: string | null;
  decided_at: string | null;
  decision_note: string | null;
  mou_id: string | null;
};

export type WebsitePolicy = {
  id: string;
  policy_type: "privacy_policy" | "terms_and_conditions";
  version: number;
  title: string;
  content: string;
  status: "draft" | "published" | "archived";
  effective_date: string | null;
  published_at: string | null;
};

export type MouTerms = Omit<WebsitePolicy, "policy_type">;
