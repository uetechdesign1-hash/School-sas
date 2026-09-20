import jsPDF from "jspdf";

export type FeeLedgerEntry = {
  date: string;
  particulars: string;
  reference: string;
  debit: number;
  credit: number;
};

export type FeeLedgerData = {
  schoolName: string;
  schoolAddress?: string;
  schoolPhone?: string;
  schoolEmail?: string;

  studentName: string;
  admissionNumber: string;
  className?: string | null;
  section?: string | null;

  academicYear?: string | null;

  entries: FeeLedgerEntry[];

  summary: {
    overall: number;
    collected: number;
    pending: number;
    concession: number;
  };
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDate(value: string) {
  const parsed = new Date(
    value.includes("T") ? value : `${value}T00:00:00`,
  );
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

export function generateFeeLedgerPDF(data: FeeLedgerData) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const margin = 12;
  const left = margin;
  const right = pageWidth - margin;
  const contentWidth = right - left;

  // Column layout: Date | Particulars | Reference | Debit | Credit
  const colDate = left;
  const colParticulars = left + 26;
  const colReference = left + 100;
  const colDebit = left + 140;
  const colCredit = right;

  let y = 14;

  // ------------------------------------------------------------
  // HEADER
  // ------------------------------------------------------------
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(safeText(data.schoolName).toUpperCase(), pageWidth / 2, y, {
    align: "center",
  });

  y += 5;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(90, 90, 90);

  const headerLines = [
    data.schoolAddress || "",
    [
      data.schoolPhone ? `Phone: ${data.schoolPhone}` : "",
      data.schoolEmail ? `Email: ${data.schoolEmail}` : "",
    ]
      .filter(Boolean)
      .join("  |  "),
  ].filter(Boolean);

  for (const line of headerLines) {
    pdf.text(
      pdf.splitTextToSize(line, contentWidth).slice(0, 1),
      pageWidth / 2,
      y,
      { align: "center" },
    );
    y += 4;
  }

  pdf.setTextColor(0, 0, 0);
  y += 2;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("STUDENT FEE LEDGER", pageWidth / 2, y, { align: "center" });

  y += 6;

  // ------------------------------------------------------------
  // STUDENT DETAILS
  // ------------------------------------------------------------
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.text("STUDENT NAME", left, y);
  pdf.text("ADMISSION NO.", left + 70, y);
  pdf.text("CLASS / SECTION", left + 130, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(
    pdf.splitTextToSize(safeText(data.studentName), 65).slice(0, 1),
    left,
    y + 4,
  );
  pdf.text(safeText(data.admissionNumber), left + 70, y + 4);
  pdf.text(
    [data.className, data.section].filter(Boolean).join(" - ") || "—",
    left + 130,
    y + 4,
  );

  y += 10;

  if (data.academicYear) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.text("ACADEMIC YEAR", left, y);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(safeText(data.academicYear), left + 30, y);

    y += 6;
  }

  // ------------------------------------------------------------
  // TABLE
  // ------------------------------------------------------------
  pdf.setFillColor(241, 245, 249);
  pdf.rect(left, y, contentWidth, 7, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.text("DATE", colDate, y + 4.8);
  pdf.text("PARTICULARS", colParticulars, y + 4.8);
  pdf.text("REFERENCE", colReference, y + 4.8);
  pdf.text("DEBIT", colDebit, y + 4.8, { align: "right" });
  pdf.text("CREDIT", colCredit, y + 4.8, { align: "right" });

  y += 7;

  pdf.setFont("helvetica", "normal");

  const rowHeight = 7;
  const maxRowsPerPage = Math.floor((pageHeight - y - 45) / rowHeight);

  data.entries.forEach((entry, index) => {
    if (index > 0 && index % maxRowsPerPage === 0) {
      pdf.addPage();
      y = 16;
    }

    if (index % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(left, y, contentWidth, rowHeight, "F");
    }

    pdf.setFontSize(8);
    pdf.text(formatDate(entry.date), colDate, y + 4.8);

    pdf.text(
      pdf
        .splitTextToSize(safeText(entry.particulars), colReference - colParticulars - 3)
        .slice(0, 1),
      colParticulars,
      y + 4.8,
    );

    pdf.setTextColor(100, 100, 100);
    pdf.text(
      pdf
        .splitTextToSize(safeText(entry.reference), colDebit - colReference - 3)
        .slice(0, 1),
      colReference,
      y + 4.8,
    );
    pdf.setTextColor(0, 0, 0);

    if (entry.debit > 0) {
      pdf.text(money(entry.debit), colDebit, y + 4.8, { align: "right" });
    }

    if (entry.credit > 0) {
      pdf.text(money(entry.credit), colCredit, y + 4.8, { align: "right" });
    }

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(left, y + rowHeight, right, y + rowHeight);

    y += rowHeight;
  });

  if (data.entries.length === 0) {
    pdf.setTextColor(130, 130, 130);
    pdf.setFontSize(8);
    pdf.text("No ledger entries found.", pageWidth / 2, y + 8, {
      align: "center",
    });
    pdf.setTextColor(0, 0, 0);
    y += 14;
  }

  // ------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------
  y += 6;

  if (y > pageHeight - 45) {
    pdf.addPage();
    y = 16;
  }

  const summaryX = right - 85;
  const summaryW = 85;

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(summaryX, y, summaryW, 26, 1.5, 1.5, "F");

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);

  pdf.text("Overall Fee Assigned", summaryX + 3, y + 6);
  pdf.text(money(data.summary.overall), summaryX + summaryW - 3, y + 6, {
    align: "right",
  });

  pdf.text("Fee Collection", summaryX + 3, y + 11);
  pdf.text(money(data.summary.collected), summaryX + summaryW - 3, y + 11, {
    align: "right",
  });

  pdf.text("Concession Given", summaryX + 3, y + 16);
  pdf.text(money(data.summary.concession), summaryX + summaryW - 3, y + 16, {
    align: "right",
  });

  pdf.setFont("helvetica", "bold");
  pdf.text("Pending Collection", summaryX + 3, y + 22);
  pdf.text(money(data.summary.pending), summaryX + summaryW - 3, y + 22, {
    align: "right",
  });

  // ------------------------------------------------------------
  // FOOTER
  // ------------------------------------------------------------
  pdf.setTextColor(105, 105, 105);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text(
    `Generated on ${new Date().toLocaleString("en-IN")}`,
    pageWidth / 2,
    pageHeight - 8,
    { align: "center" },
  );
  pdf.setTextColor(0, 0, 0);

  const safeName = safeText(data.studentName).replace(/[^a-zA-Z0-9-_ ]/g, "");
  pdf.save(`Fee-Ledger-${safeName || "Student"}.pdf`);

  return pdf;
}
