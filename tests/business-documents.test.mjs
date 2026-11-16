import assert from "node:assert/strict";
import test from "node:test";
import { toCsv } from "../src/lib/business/csv.ts";
import { formatInr, formatPdfInr, statusTone, toNumber } from "../src/lib/business/format.ts";
import { createInvoicePdf, createMouPdf, createReceiptPdf, pdfMoney } from "../src/lib/business/pdf/documents.ts";

// PDF content streams escape parentheses; undo that so assertions read naturally.
const plain = (pdf) => pdf.output().replace(/\\([()\\])/g, "$1");

const company = {
  legal_company_name: "SCB Technologies Pvt Ltd",
  brand_name: "SCB",
  registered_address: "1 Main Road, Bengaluru 560001",
  email: "hello@scb.test",
  mobile: "9999900000",
  website: "scb.test",
  gstin: "29ABCDE1234F1Z5",
  authorized_signatory_name: "R. Kumar",
  authorized_signatory_designation: "Director",
  logo_path: null,
  signature_path: null,
  signature_notice: "The signature image is a visual signature only and is not a legally verified electronic signature.",
};
const school = { name: "ABC International School", city: "Mysuru", state: "KA", contact_person: "P. Rao", contact_phone: "9000000000", email: "abc@school.test" };

function mouSnapshot(overrides = {}) {
  return {
    document_label: "INITIAL MOU / PROVISIONAL AGREEMENT",
    mou_type: "initial",
    version: 1,
    generated_at: "2026-11-20T10:00:00Z",
    place: "Bengaluru",
    company,
    school,
    representative: null,
    commercial: {
      plan_code: "both",
      plan_name: "Both Plans",
      enabled_modules: ["fees", "payroll"],
      pricing_unit: "per_student",
      student_count: 300,
      estimated_student_count: 300,
      default_unit_price: 150,
      negotiated_unit_price: 60,
      discount_amount: 0,
      total_amount: 18000,
      term_months: 12,
      billing_frequency: "yearly",
      monthly_instalments_allowed: false,
      payment_terms: "Annual in advance",
      special_conditions: "Free onboarding training",
      start_date: "2026-12-01",
      end_date: "2027-11-30",
      price_outside_recommended_range: false,
    },
    payment_schedule: [{ sequence: 1, period_start: "2026-12-01", period_end: "2027-11-30", amount: 18000 }],
    terms: { terms_version_id: "t1", version: 3, title: "Standard Terms", content: "1. Scope\nThe company grants access.\n\n2. Fees\nFees are payable as invoiced." },
    extra: {},
    ...overrides,
  };
}

test("MOU PDF is A4, carries the required content and numbers every page", () => {
  const pdf = createMouPdf(mouSnapshot());
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 297) < 0.1);
  const text = plain(pdf);
  for (const expected of [
    "INITIAL MOU / PROVISIONAL AGREEMENT",
    "SCB Technologies Pvt Ltd",
    "ABC International School",
    "Rs. 18,000.00",
    "Rs. 60.00",
    "300 x Rs. 60.00 x 1 year(s)",
    "Annual in advance",
    "Free onboarding training",
    "Standard Terms",
    "visual signature only",
    "Bengaluru",
    "TERMS AND CONDITIONS (VERSION 3)",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(/Page 1 of \d+/.test(text));
});

test("Final MOU shows the initial and confirmed strength and amounts", () => {
  const snapshot = mouSnapshot({
    document_label: "FINAL MOU",
    mou_type: "final",
    commercial: { ...mouSnapshot().commercial, student_count: 350, total_amount: 21000 },
    payment_schedule: [{ sequence: 1, period_start: "2026-12-01", period_end: "2027-11-30", amount: 21000 }],
    extra: { initial_student_count: 300, previous_amount: 18000 },
  });
  const text = plain(createMouPdf(snapshot));
  assert.ok(text.includes("Confirmed student strength"));
  assert.ok(text.includes("Rs. 21,000.00"));
  assert.ok(text.includes("Initial contract amount"));
  assert.ok(text.includes("Rs. 18,000.00"));
});

test("a long terms text continues across pages without truncation", () => {
  const long = `${"Clause text that repeats. ".repeat(900)} END-OF-TERMS`;
  const snapshot = mouSnapshot();
  snapshot.terms.content = long;
  const pdf = createMouPdf(snapshot);
  assert.ok(pdf.getNumberOfPages() > 1);
  const text = plain(pdf);
  assert.ok(text.includes("END-OF-TERMS"));
  assert.ok(text.includes(`Page ${pdf.getNumberOfPages()} of ${pdf.getNumberOfPages()}`));
});

test("a missing or corrupt logo never blocks document generation", () => {
  const pdf = createMouPdf(mouSnapshot(), { logoDataUrl: "data:image/png;base64,not-an-image", signatureDataUrl: "garbage" });
  assert.ok(pdf.output().includes("INITIAL MOU"));
});

test("invoice and receipt PDFs state amounts, references and balance", () => {
  const invoice = {
    id: "i1", invoice_number: "INV-2026-000001", school_id: "s1", subscription_id: "sub", period_sequence: 1,
    period_start: "2026-12-01", period_end: "2027-11-30", invoice_date: "2026-12-01", due_date: "2026-12-16",
    amount: 18000, tax_rate: 18, tax_amount: 3240, total_amount: 21240, status: "issued",
    snapshot: { company, school, subscription: { plan_code: "both", billing_frequency: "yearly" }, period: { sequence: 1, of: 1, start: "2026-12-01", end: "2027-11-30" } },
  };
  const invoicePdf = plain(createInvoicePdf(invoice, { paid_amount: 6000, balance_amount: 15240, display_status: "partially_paid" }));
  for (const expected of ["INVOICE", "INV-2026-000001", "Rs. 21,240.00", "Rs. 15,240.00", "Tax (18%)", "Partially Paid"]) {
    assert.ok(invoicePdf.includes(expected), `invoice missing: ${expected}`);
  }

  const receiptPdf = createReceiptPdf({
    receipt_number: "RCT-2026-000007", company, school,
    invoice: { invoice_number: "INV-2026-000001", total_amount: 21240, period_start: "2026-12-01", period_end: "2027-11-30" },
    payment: { amount: 6000, payment_date: "2026-12-05", payment_mode: "upi", transaction_reference: "UPI-1001" },
    verified_at: "2026-12-06T09:00:00Z",
  }).output();
  for (const expected of ["PAYMENT RECEIPT", "RCT-2026-000007", "UPI-1001", "Rs. 6,000.00", "visual signature only"]) {
    assert.ok(receiptPdf.includes(expected), `receipt missing: ${expected}`);
  }
});

test("currency helpers format Indian grouping and never produce NaN", () => {
  assert.equal(pdfMoney(1234567.5), "Rs. 12,34,567.50");
  assert.equal(formatPdfInr("18000"), "Rs. 18,000.00");
  assert.ok(formatInr(18000).includes("18,000.00"));
  assert.equal(toNumber("not a number"), 0);
  assert.equal(toNumber(null), 0);
  assert.equal(pdfMoney(undefined), "Rs. 0.00");
});

test("status tones separate verified revenue from pending money", () => {
  assert.equal(statusTone("verified"), "green");
  assert.equal(statusTone("pending_verification"), "amber");
  assert.equal(statusTone("rejected"), "red");
  assert.equal(statusTone("overdue"), "red");
});

test("CSV export escapes quotes and neutralises spreadsheet formulas", () => {
  const csv = toCsv(
    [{ name: '=HYPERLINK("http://evil")', note: 'He said "hi", ok', amount: 12.5 }, { name: "+1+1", note: "line\nbreak", amount: 0 }],
    [
      { header: "Name", value: (r) => r.name },
      { header: "Note", value: (r) => r.note },
      { header: "Amount", value: (r) => r.amount },
    ],
  );
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Name,Note,Amount");
  assert.ok(lines[1].startsWith(`"'=HYPERLINK(""http://evil"")"`), lines[1]);
  assert.ok(lines[1].includes('"He said ""hi"", ok"'));
  assert.ok(csv.includes("'+1+1"));
  assert.ok(csv.includes('"line\nbreak"'));
});
