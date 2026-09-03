import jsPDF from "jspdf";

export type ReceiptData = {
  schoolName: string;
  schoolAddress?: string;
  schoolPhone?: string;
  schoolEmail?: string;

  receiptNumber: string;
  receiptDate: string;

  studentName: string;
  admissionNumber: string;

  className?: string | null;
  section?: string | null;

  billNumber: string;
  feeDescription: string;

  amount: number;
  paymentMode: string;

  referenceNumber?: string | null;

  previousOutstanding: number;
  remainingOutstanding: number;

  remarks?: string | null;
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function date(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value || "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

export function generateReceiptPDF(data: ReceiptData) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const left = 18;
  const right = pageWidth - 18;

  pdf.setDrawColor(210, 210, 210);
  pdf.setLineWidth(0.5);

  pdf.roundedRect(12, 12, pageWidth - 24, 273, 3, 3);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);

  pdf.text(
    data.schoolName || "SCHOOL NAME",
    pageWidth / 2,
    28,
    { align: "center" },
  );

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  if (data.schoolAddress) {
    pdf.text(
      data.schoolAddress,
      pageWidth / 2,
      35,
      { align: "center" },
    );
  }

  let contactLine = "";

  if (data.schoolPhone) {
    contactLine = "Phone: " + data.schoolPhone;
  }

  if (data.schoolEmail) {
    if (contactLine) {
      contactLine += "   |   ";
    }

    contactLine += "Email: " + data.schoolEmail;
  }

  if (contactLine) {
    pdf.text(
      contactLine,
      pageWidth / 2,
      41,
      { align: "center" },
    );
  }

  pdf.setFillColor(245, 247, 250);

  pdf.roundedRect(
    left,
    48,
    right - left,
    13,
    2,
    2,
    "F",
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);

  pdf.text(
    "FEE PAYMENT RECEIPT",
    pageWidth / 2,
    56,
    { align: "center" },
  );

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");

  pdf.text("Receipt Number", left, 73);
  pdf.text("Date", right - 55, 73);

  pdf.setFont("helvetica", "normal");

  pdf.text(data.receiptNumber || "—", left, 79);
  pdf.text(date(data.receiptDate), right - 55, 79);

  let y = 91;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);

  pdf.text("Student Details", left, y);

  y += 8;

  pdf.setDrawColor(225, 225, 225);
  pdf.line(left, y, right, y);

  y += 8;

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");

  pdf.text("Student Name", left, y);
  pdf.text("Admission No.", 110, y);

  pdf.setFont("helvetica", "normal");

  pdf.text(data.studentName || "—", left, y + 6);
  pdf.text(data.admissionNumber || "—", 110, y + 6);

  y += 19;

  pdf.setFont("helvetica", "bold");

  pdf.text("Class", left, y);
  pdf.text("Section", 110, y);

  pdf.setFont("helvetica", "normal");

  pdf.text(data.className || "—", left, y + 6);
  pdf.text(data.section || "—", 110, y + 6);

  y += 22;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);

  pdf.text("Payment Details", left, y);

  y += 8;

  pdf.setDrawColor(225, 225, 225);
  pdf.line(left, y, right, y);

  y += 9;

  pdf.setFillColor(245, 247, 250);

  pdf.rect(
    left,
    y - 6,
    right - left,
    10,
    "F",
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);

  pdf.text("DESCRIPTION", left + 3, y);
  pdf.text("BILL", 105, y);

  pdf.text(
    "AMOUNT",
    right - 3,
    y,
    { align: "right" },
  );

  y += 10;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  pdf.text(
    data.feeDescription || "Fee Payment",
    left + 3,
    y,
  );

  pdf.text(data.billNumber || "—", 105, y);

  pdf.text(
    money(data.amount),
    right - 3,
    y,
    { align: "right" },
  );

  y += 13;

  pdf.setDrawColor(225, 225, 225);
  pdf.line(left, y, right, y);

  y += 10;

  pdf.setFont("helvetica", "bold");

  pdf.text("Payment Method", left, y);
  pdf.text("Reference", 110, y);

  pdf.setFont("helvetica", "normal");

  pdf.text(
    (data.paymentMode || "other").toUpperCase(),
    left,
    y + 6,
  );

  pdf.text(
    data.referenceNumber || "—",
    110,
    y + 6,
  );

  y += 22;

  pdf.setFillColor(248, 250, 252);

  pdf.roundedRect(
    left,
    y,
    right - left,
    42,
    2,
    2,
    "F",
  );

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  pdf.text(
    "Previous Outstanding",
    left + 6,
    y + 10,
  );

  pdf.text(
    money(data.previousOutstanding),
    right - 6,
    y + 10,
    { align: "right" },
  );

  pdf.text(
    "Payment Received",
    left + 6,
    y + 20,
  );

  pdf.setFont("helvetica", "bold");

  pdf.text(
    money(data.amount),
    right - 6,
    y + 20,
    { align: "right" },
  );

  pdf.text(
    "Remaining Outstanding",
    left + 6,
    y + 32,
  );

  pdf.text(
    money(data.remainingOutstanding),
    right - 6,
    y + 32,
    { align: "right" },
  );

  y += 53;

  if (data.remarks) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);

    pdf.text("Remarks", left, y);

    pdf.setFont("helvetica", "normal");

    const lines = pdf.splitTextToSize(
      data.remarks,
      right - left,
    );

    pdf.text(lines, left, y + 6);

    y += 6 + Math.max(lines.length * 5, 8);
  }

  const signatureY = 246;

  pdf.setDrawColor(150, 150, 150);

  pdf.line(
    right - 50,
    signatureY,
    right,
    signatureY,
  );

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);

  pdf.text(
    "Authorized Signature",
    right - 50,
    signatureY + 5,
  );

  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 120);

  pdf.text(
    "This is a computer-generated receipt.",
    pageWidth / 2,
    268,
    { align: "center" },
  );

  pdf.setTextColor(0, 0, 0);

  const safeReceiptNumber = (
    data.receiptNumber || "receipt"
  ).replace(
    /[^a-zA-Z0-9-_]/g,
    "-",
  );

  pdf.save(
    "Fee-Receipt-" + safeReceiptNumber + ".pdf",
  );

  return pdf;
}