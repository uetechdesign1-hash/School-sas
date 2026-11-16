import { jsPDF } from "jspdf";
import type {
  CompanyBranding,
  Invoice,
  InvoiceBalance,
  MouSnapshot,
  ReceiptSnapshot,
} from "@/lib/business/types";

// Self-contained so the builders can be unit-tested directly under Node.

export type PdfAssets = {
  logoDataUrl?: string | null;
  signatureDataUrl?: string | null;
};

const PAGE_W = 210;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BODY_BOTTOM = 272;

const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function pdfMoney(value: number | string | null | undefined): string {
  const parsed = Number(value ?? 0);
  return `Rs. ${money.format(Number.isFinite(parsed) ? parsed : 0)}`;
}

function pdfDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function label(value: string | null | undefined): string {
  return (value ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function text(value: string | null | undefined): string {
  return (value ?? "").trim() || "-";
}

function imageFormat(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

class Page {
  readonly doc: jsPDF;
  y = 0;
  private readonly company: CompanyBranding;
  private readonly assets: PdfAssets;
  private readonly docLabel: string;

  constructor(company: CompanyBranding, assets: PdfAssets, docLabel: string) {
    this.company = company;
    this.assets = assets;
    this.docLabel = docLabel;
    this.doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    this.header();
  }

  private fitImage(dataUrl: string, x: number, y: number, maxW: number, maxH: number) {
    try {
      const props = this.doc.getImageProperties(dataUrl);
      const ratio = Math.min(maxW / props.width, maxH / props.height);
      this.doc.addImage(dataUrl, imageFormat(dataUrl), x, y, props.width * ratio, props.height * ratio);
    } catch {
      // A missing or corrupt image must never block the document.
    }
  }

  private header() {
    const { doc, company } = this;
    let textX = MARGIN;
    if (this.assets.logoDataUrl) {
      this.fitImage(this.assets.logoDataUrl, MARGIN, 10, 22, 22);
      textX = MARGIN + 26;
    }
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(15, 23, 42);
    doc.text(text(company.legal_company_name), textX, 15);
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(text(company.registered_address), 95) as string[];
    doc.text(lines.slice(0, 3), textX, 20);
    const contact = [company.email, company.mobile, company.website].filter(Boolean).join("  |  ");
    if (contact) doc.text(contact, textX, 20 + Math.min(lines.length, 3) * 4);
    if (company.gstin) doc.text(`GSTIN: ${company.gstin}`, textX, 24 + Math.min(lines.length, 3) * 4);

    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(37, 99, 235);
    doc.text(this.docLabel, PAGE_W - MARGIN, 15, { align: "right" });
    doc.setDrawColor(203, 213, 225).setLineWidth(0.4).line(MARGIN, 36, PAGE_W - MARGIN, 36);
    doc.setTextColor(15, 23, 42);
    this.y = 44;
  }

  newPage() {
    this.doc.addPage();
    this.header();
  }

  ensure(height: number) {
    if (this.y + height > BODY_BOTTOM) this.newPage();
  }

  gap(height = 3) {
    this.y += height;
  }

  title(value: string) {
    this.ensure(14);
    this.doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(15, 23, 42);
    this.doc.text(value, PAGE_W / 2, this.y, { align: "center" });
    this.y += 9;
  }

  heading(value: string) {
    this.ensure(14);
    this.doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(30, 64, 175);
    this.doc.text(value.toUpperCase(), MARGIN, this.y);
    this.doc.setDrawColor(191, 219, 254).setLineWidth(0.3).line(MARGIN, this.y + 1.5, PAGE_W - MARGIN, this.y + 1.5);
    this.doc.setTextColor(15, 23, 42);
    this.y += 7;
  }

  paragraph(value: string, options: { size?: number; bold?: boolean; italic?: boolean; indent?: number } = {}) {
    const size = options.size ?? 9.5;
    const indent = options.indent ?? 0;
    this.doc
      .setFont("helvetica", options.bold ? "bold" : options.italic ? "italic" : "normal")
      .setFontSize(size)
      .setTextColor(30, 41, 59);
    const lineHeight = size * 0.45;
    for (const block of value.split("\n")) {
      const lines = (block.trim() ? this.doc.splitTextToSize(block, CONTENT_W - indent) : [""]) as string[];
      for (const line of lines) {
        this.ensure(lineHeight + 1);
        if (line) this.doc.text(line, MARGIN + indent, this.y);
        this.y += lineHeight + 0.8;
      }
    }
    this.doc.setTextColor(15, 23, 42);
  }

  rows(rows: readonly [string, string][], labelWidth = 62) {
    this.doc.setFontSize(9.5);
    for (const [name, value] of rows) {
      const lines = this.doc.splitTextToSize(text(value), CONTENT_W - labelWidth) as string[];
      this.ensure(lines.length * 4.6 + 1);
      this.doc.setFont("helvetica", "bold").setTextColor(71, 85, 105).text(name, MARGIN, this.y);
      this.doc.setFont("helvetica", "normal").setTextColor(15, 23, 42).text(lines, MARGIN + labelWidth, this.y);
      this.y += lines.length * 4.6 + 1.2;
    }
  }

  table(headers: readonly string[], widths: readonly number[], body: readonly (readonly string[])[], alignRight: readonly number[] = []) {
    const draw = (cells: readonly string[], bold: boolean, fill: boolean) => {
      const lines = cells.map((cell, index) => this.doc.splitTextToSize(cell, widths[index] - 3) as string[]);
      const height = Math.max(...lines.map((l) => l.length)) * 4.4 + 3;
      this.ensure(height);
      if (fill) {
        this.doc.setFillColor(241, 245, 249).rect(MARGIN, this.y - 4.2, CONTENT_W, height, "F");
      }
      this.doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(9).setTextColor(15, 23, 42);
      let x = MARGIN;
      cells.forEach((_, index) => {
        if (alignRight.includes(index)) {
          this.doc.text(lines[index], x + widths[index] - 1.5, this.y, { align: "right" });
        } else {
          this.doc.text(lines[index], x + 1.5, this.y);
        }
        x += widths[index];
      });
      this.doc.setDrawColor(226, 232, 240).setLineWidth(0.2).line(MARGIN, this.y - 4.2 + height, PAGE_W - MARGIN, this.y - 4.2 + height);
      this.y += height;
    };
    draw(headers, true, true);
    for (const row of body) draw(row, false, false);
  }

  signatureBlock(company: CompanyBranding, schoolName: string, notice: string | undefined) {
    this.ensure(52);
    const top = this.y;
    const colW = CONTENT_W / 2 - 4;
    this.doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(15, 23, 42);
    this.doc.text("For the Company", MARGIN, top);
    this.doc.text("For the School", MARGIN + colW + 8, top);
    if (this.assets.signatureDataUrl) {
      this.fitImage(this.assets.signatureDataUrl, MARGIN, top + 2, 45, 18);
    }
    this.doc.setDrawColor(100, 116, 139).setLineWidth(0.3);
    this.doc.line(MARGIN, top + 24, MARGIN + colW, top + 24);
    this.doc.line(MARGIN + colW + 8, top + 24, MARGIN + CONTENT_W, top + 24);
    this.doc.setFont("helvetica", "normal").setFontSize(9);
    this.doc.text(text(company.authorized_signatory_name), MARGIN, top + 29);
    this.doc.text(text(company.authorized_signatory_designation), MARGIN, top + 33.5);
    this.doc.text(text(company.legal_company_name), MARGIN, top + 38);
    this.doc.text("Authorised signatory, name, seal and date", MARGIN + colW + 8, top + 29);
    this.doc.text(schoolName, MARGIN + colW + 8, top + 33.5);
    this.y = top + 44;
    if (notice) {
      this.paragraph(notice, { size: 7.5, italic: true });
    }
  }

  finish(footerLabel: string): jsPDF {
    const { doc, company } = this;
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(203, 213, 225).setLineWidth(0.3).line(MARGIN, 282, PAGE_W - MARGIN, 282);
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(100, 116, 139);
      const footer = [company.legal_company_name, footerLabel].filter(Boolean).join("  |  ");
      doc.text(footer, MARGIN, 287);
      doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, 287, { align: "right" });
    }
    return doc;
  }
}

function addressLine(school: MouSnapshot["school"]): string {
  return [school.address, school.city, school.district, school.state, school.postal_code]
    .filter(Boolean)
    .join(", ");
}

export function createMouPdf(snapshot: MouSnapshot, assets: PdfAssets = {}) {
  const { company, school, commercial, terms } = snapshot;
  const page = new Page(company, assets, snapshot.document_label);
  const isFinal = snapshot.mou_type === "final";
  const planNames =
    commercial.plan_code === "both"
      ? "Plan 1 - School Management + Accounting, and Plan 2 - Staff Management"
      : commercial.plan_name;
  const perUnit = commercial.pricing_unit === "per_school_year" ? "per school per year" : "per student per year";

  page.title(snapshot.document_label);
  page.paragraph(
    `Version ${snapshot.version}  |  Generated on ${pdfDate(snapshot.generated_at)}  |  Terms version ${terms.version}`,
    { size: 8.5, italic: true },
  );
  page.gap(2);

  page.heading("Parties");
  page.rows([
    ["Company", text(company.legal_company_name)],
    ["Company address", text(company.registered_address)],
    ["School", text(school.name)],
    ["School address", text(addressLine(school))],
    ["Contact person", text(school.contact_person)],
    ["Contact details", [school.contact_phone, school.email].filter(Boolean).join("  |  ") || "-"],
  ]);
  page.gap();

  page.heading("Subscription");
  page.rows([
    ["Selected plans", planNames],
    [isFinal ? "Confirmed student strength" : "Estimated student strength", String(commercial.student_count)],
    ...(isFinal
      ? ([
          ["Initial MOU strength", String(snapshot.extra.initial_student_count ?? commercial.estimated_student_count)],
          ["Initial contract amount", pdfMoney(snapshot.extra.previous_amount)],
        ] as [string, string][])
      : []),
    ["Contract start date", pdfDate(commercial.start_date)],
    ["Contract end date", pdfDate(commercial.end_date)],
  ]);
  page.gap();

  page.heading("Commercial terms");
  const units = commercial.pricing_unit === "per_student" ? commercial.student_count : 1;
  const years = commercial.term_months / 12;
  page.rows([
    ["Negotiated price", `${pdfMoney(commercial.negotiated_unit_price)} ${perUnit}`],
    ["Calculation", `${units} x ${pdfMoney(commercial.negotiated_unit_price)} x ${years} year(s)`],
    ["Discount", pdfMoney(commercial.discount_amount)],
    ["Total contract amount", pdfMoney(commercial.total_amount)],
    ["Payment frequency", label(commercial.billing_frequency)],
    ["Payment terms", commercial.payment_terms],
  ]);
  page.gap();

  page.heading("Payment schedule");
  page.table(
    ["#", "Period", "Amount"],
    [14, 106, 60],
    snapshot.payment_schedule.map((row) => [
      String(row.sequence),
      `${pdfDate(row.period_start)} to ${pdfDate(row.period_end)}`,
      pdfMoney(row.amount),
    ]),
    [2],
  );
  page.gap(4);

  if (commercial.special_conditions) {
    page.heading("Special conditions");
    page.paragraph(commercial.special_conditions);
    page.gap();
  }

  page.heading(`Terms and conditions (version ${terms.version})`);
  page.paragraph(terms.title, { bold: true });
  page.paragraph(terms.content);
  page.gap(4);

  page.heading("Signatures");
  page.signatureBlock(company, text(school.name), company.signature_notice);
  page.paragraph(
    `Date: ${pdfDate(snapshot.generated_at)}        Place: ${text(snapshot.place)}`,
    { bold: true },
  );

  return page.finish(snapshot.document_label);
}

export function createInvoicePdf(
  invoice: Invoice,
  balance: Pick<InvoiceBalance, "paid_amount" | "balance_amount" | "display_status">,
  assets: PdfAssets = {},
) {
  const { company, school, subscription, period } = invoice.snapshot;
  const page = new Page(company, assets, "INVOICE");

  page.title("INVOICE");
  page.rows([
    ["Invoice number", invoice.invoice_number],
    ["Invoice date", pdfDate(invoice.invoice_date)],
    ["Due date", pdfDate(invoice.due_date)],
    ["Status", label(balance.display_status)],
  ]);
  page.gap();

  page.heading("Billed to");
  page.rows([
    ["School", text(school.name)],
    ["Address", text(addressLine(school))],
    ["Contact", [school.contact_person, school.contact_phone].filter(Boolean).join("  |  ") || "-"],
  ]);
  page.gap();

  page.heading("Details");
  const description = period.adjustment
    ? `Supplementary invoice for the approved contract revision (${label(subscription.plan_code)})`
    : `${label(subscription.plan_code)} subscription, period ${period.sequence} of ${period.of}: ${pdfDate(period.start)} to ${pdfDate(period.end)}`;
  page.table(["Description", "Amount"], [130, 50], [[description, pdfMoney(invoice.amount)]], [1]);
  page.gap(3);
  page.rows([
    [`Tax (${Number(invoice.tax_rate)}%)`, pdfMoney(invoice.tax_amount)],
    ["Invoice total", pdfMoney(invoice.total_amount)],
    ["Paid (verified)", pdfMoney(balance.paid_amount)],
    ["Balance due", pdfMoney(balance.balance_amount)],
  ]);
  page.gap(6);
  page.paragraph("Payments are treated as received only after the company has verified them.", {
    size: 8.5,
    italic: true,
  });

  return page.finish(invoice.invoice_number);
}

export function createReceiptPdf(receipt: ReceiptSnapshot, assets: PdfAssets = {}) {
  const { company, school, invoice, payment } = receipt;
  const page = new Page(company, assets, "PAYMENT RECEIPT");

  page.title("PAYMENT RECEIPT");
  page.rows([
    ["Receipt number", receipt.receipt_number],
    ["Receipt date", pdfDate(receipt.verified_at)],
    ["Received from", text(school.name)],
    ["Address", text(addressLine(school))],
  ]);
  page.gap();

  page.heading("Payment");
  page.rows([
    ["Amount received", pdfMoney(payment.amount)],
    ["Payment date", pdfDate(payment.payment_date)],
    ["Payment mode", label(payment.payment_mode)],
    ["Transaction reference", payment.transaction_reference],
    ["Towards invoice", invoice.invoice_number],
    ["Invoice period", `${pdfDate(invoice.period_start)} to ${pdfDate(invoice.period_end)}`],
    ["Invoice total", pdfMoney(invoice.total_amount)],
  ]);
  page.gap(8);
  page.signatureBlock(company, text(school.name), company.signature_notice);

  return page.finish(receipt.receipt_number);
}
