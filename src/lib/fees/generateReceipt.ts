import jsPDF from "jspdf";

export type ReceiptFeeItem = {
  description: string;
  amount: number;
};

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

  // Student + class + fee categories line, printed below student details.
  particulars?: string | null;

  feeItems?: ReceiptFeeItem[];

  amount: number;
  concessionAmount?: number;
  paymentMode: string;
  referenceNumber?: string | null;

  // IMPORTANT:
  // previousOutstanding is the balance BEFORE this payment.
  // remainingOutstanding is the balance AFTER this payment.
  previousOutstanding: number;
  remainingOutstanding: number;

  remarks?: string | null;
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "—";

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function safeText(value: string | null | undefined) {
  return (value || "—").trim() || "—";
}

export function generateReceiptPDF(data: ReceiptData) {
  // EXACT A5 LANDSCAPE:
  // width  = 210 mm
  // height = 148.5 mm
  //
  // This is intentionally NOT 105 x 148.5 portrait.
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [210, 148.5],
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();   // 210
  const pageHeight = pdf.internal.pageSize.getHeight(); // 148.5

  const margin = 7;
  const left = margin;
  const right = pageWidth - margin;
  const contentWidth = right - left;

  // Outer receipt border.
  pdf.setDrawColor(150, 150, 150);
  pdf.setLineWidth(0.45);
  pdf.roundedRect(
    4,
    4,
    pageWidth - 8,
    pageHeight - 8,
    2,
    2,
    "S",
  );

  let y = 10;

  // ------------------------------------------------------------
  // SCHOOL HEADER
  // ------------------------------------------------------------
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(safeText(data.schoolName).toUpperCase(), pageWidth / 2, y, {
    align: "center",
  });

  y += 4.5;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.2);

  if (data.schoolAddress) {
    const addressLines = pdf
      .splitTextToSize(safeText(data.schoolAddress), 125)
      .slice(0, 2);

    pdf.text(addressLines, pageWidth / 2, y, { align: "center" });
    y += Math.max(3.2, addressLines.length * 2.7);
  }

  const contact = [
    data.schoolPhone ? `Phone: ${data.schoolPhone}` : "",
    data.schoolEmail ? `Email: ${data.schoolEmail}` : "",
  ]
    .filter(Boolean)
    .join("  |  ");

  if (contact) {
    pdf.text(pdf.splitTextToSize(contact, 145).slice(0, 1), pageWidth / 2, y, {
      align: "center",
    });
    y += 3.5;
  }

  // ------------------------------------------------------------
  // TITLE
  // ------------------------------------------------------------
  pdf.setFillColor(245, 247, 250);
  pdf.roundedRect(left, y, contentWidth, 8, 1.4, 1.4, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.5);
  pdf.text("FEE PAYMENT RECEIPT", pageWidth / 2, y + 5.3, {
    align: "center",
  });

  y += 11;

  // ------------------------------------------------------------
  // RECEIPT / BILL / DATE
  // ------------------------------------------------------------
  const idCol1 = left;
  const idCol2 = 78;
  const idCol3 = 145;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(5.8);
  pdf.text("RECEIPT NO.", idCol1, y);
  pdf.text("BILL NO.", idCol2, y);
  pdf.text("DATE", idCol3, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.5);
  pdf.text(safeText(data.receiptNumber), idCol1, y + 3.5);
  pdf.text(safeText(data.billNumber), idCol2, y + 3.5);
  pdf.text(formatDate(data.receiptDate), idCol3, y + 3.5);

  y += 8.5;

  // ------------------------------------------------------------
  // STUDENT DETAILS
  // ------------------------------------------------------------
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.8);
  pdf.text("STUDENT DETAILS", left, y);

  y += 3;

  pdf.setDrawColor(210, 210, 210);
  pdf.line(left, y, right, y);
  y += 4;

  const studentNameX = left;
  const admissionX = 70;
  const classX = 125;
  const sectionX = 165;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(5.5);
  pdf.text("STUDENT", studentNameX, y);
  pdf.text("ADMISSION NO.", admissionX, y);
  pdf.text("CLASS", classX, y);
  pdf.text("SECTION", sectionX, y);

  y += 3.2;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.5);

  pdf.text(
    pdf.splitTextToSize(safeText(data.studentName), 58).slice(0, 1),
    studentNameX,
    y,
  );
  pdf.text(safeText(data.admissionNumber), admissionX, y);
  pdf.text(safeText(data.className), classX, y);
  pdf.text(safeText(data.section), sectionX, y);

  if (data.particulars) {
    const particularsText = pdf
      .splitTextToSize(safeText(data.particulars), 150)
      .slice(0, 1);

    if (particularsText.length > 0) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(4.8);
      pdf.text("PARTICULARS", left, y + 3.6);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(5.8);
      pdf.text(particularsText, left + 23, y + 3.6);
    }

    y += 3.4;
  }

  y += 7;

  // ------------------------------------------------------------
  // PAYMENT DETAILS / CATEGORY TABLE
  // ------------------------------------------------------------
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.8);
  pdf.text("PAYMENT DETAILS", left, y);

  y += 3;

  pdf.line(left, y, right, y);
  y += 3.5;

  // Table header
  pdf.setFillColor(245, 247, 250);
  pdf.rect(left, y - 2.8, contentWidth, 6, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(5.6);
  pdf.text("FEE CATEGORY", left + 2, y);
  pdf.text("AMOUNT", right - 2, y, { align: "right" });

  y += 5.2;

  const items =
    data.feeItems && data.feeItems.length > 0
      ? data.feeItems
      : [
          {
            description: data.feeDescription || "Fee Payment",
            amount: data.amount,
          },
        ];

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6);

  // Keep the category table inside the A5 landscape page.
  // If many categories exist, each is limited to one line.
  for (const item of items.slice(0, 6)) {
    const description = pdf
      .splitTextToSize(safeText(item.description), 125)
      .slice(0, 1);

    pdf.text(description, left + 2, y);
    pdf.text(money(item.amount), right - 2, y, { align: "right" });

    y += 4.3;
  }

  if (items.length > 6) {
    pdf.setFontSize(5);
    pdf.text(`+ ${items.length - 6} more fee item(s)`, left + 2, y);
    y += 4;
  }

  pdf.setDrawColor(205, 205, 205);
  pdf.line(left, y, right, y);
  y += 4;

  // ------------------------------------------------------------
  // PAYMENT METHOD / REFERENCE
  // ------------------------------------------------------------
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(5.8);
  pdf.text("PAYMENT METHOD", left, y);
  pdf.text("REFERENCE", 105, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6.3);

  pdf.text(
    pdf.splitTextToSize(safeText(data.paymentMode).toUpperCase(), 88).slice(0, 1),
    left,
    y + 3.3,
  );

  pdf.text(
    pdf.splitTextToSize(safeText(data.referenceNumber), 90).slice(0, 1),
    105,
    y + 3.3,
  );

  y += 8;

  // ------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------
  const summaryX = left;
  const summaryY = y;
  const summaryW = 105;
  const summaryH = 25;

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(summaryX, summaryY, summaryW, summaryH, 1.4, 1.4, "F");

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(5.8);

  pdf.text("Previous Outstanding", summaryX + 3, summaryY + 6);
  pdf.text(
    money(data.previousOutstanding),
    summaryX + summaryW - 3,
    summaryY + 6,
    { align: "right" },
  );

  pdf.text("Concession Given", summaryX + 3, summaryY + 11);
  pdf.text(
    money(data.concessionAmount || 0),
    summaryX + summaryW - 3,
    summaryY + 11,
    { align: "right" },
  );

  pdf.setFont("helvetica", "bold");
  pdf.text("Payment Received", summaryX + 3, summaryY + 16.5);
  pdf.text(
    money(data.amount),
    summaryX + summaryW - 3,
    summaryY + 16.5,
    { align: "right" },
  );

  pdf.text("Remaining Outstanding", summaryX + 3, summaryY + 22);
  pdf.text(
    money(data.remainingOutstanding),
    summaryX + summaryW - 3,
    summaryY + 22,
    { align: "right" },
  );

  // ------------------------------------------------------------
  // REMARKS + SIGNATURE
  // ------------------------------------------------------------
  const rightBlockX = 120;
  const rightBlockW = right - rightBlockX;

  if (data.remarks) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(5.8);
    pdf.text("REMARKS", rightBlockX, summaryY + 5);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    pdf.text(
      pdf.splitTextToSize(safeText(data.remarks), rightBlockW).slice(0, 3),
      rightBlockX,
      summaryY + 9,
    );
  }

  // Signature always stays inside the one-page receipt.
  const signatureY = pageHeight - 18;

  pdf.setDrawColor(130, 130, 130);
  pdf.line(right - 38, signatureY, right, signatureY);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(5.4);
  pdf.text("Authorized Signature", right - 38, signatureY + 3.5);

  pdf.setTextColor(105, 105, 105);
  pdf.setFontSize(4.8);
  pdf.text(
    "Computer-generated receipt",
    pageWidth / 2,
    pageHeight - 6,
    { align: "center" },
  );

  pdf.setTextColor(0, 0, 0);

  // File name is based ONLY on the receipt number.
  // Bill number must never replace the receipt number.
  const safeReceiptNumber = safeText(data.receiptNumber)
    .replace(/[^a-zA-Z0-9-_]/g, "-");

  pdf.save(`Fee-Receipt-${safeReceiptNumber}.pdf`);

  return pdf;
}
