import { jsPDF } from "jspdf";

export type AdmissionPdfData = {
  schoolName: string;
  schoolAddress?: string | null;
  schoolLogoDataUrl?: string | null;
  title?: string;
  sections: { title: string; fields: { label: string; value: string }[] }[];
};

export function createAdmissionPdf(data: AdmissionPdfData) {
  const pdf = new jsPDF({ format: "a4", unit: "mm", compress: false });
  const width = pdf.internal.pageSize.getWidth();
  const bottom = pdf.internal.pageSize.getHeight() - 15;
  const left = 15;
  const contentWidth = width - 30;
  let y = 15;

  function header() {
    if (data.schoolLogoDataUrl) {
      pdf.addImage(data.schoolLogoDataUrl, "PNG", left, 10, 20, 20);
    }
    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    const schoolName = pdf.splitTextToSize(data.schoolName, contentWidth - 50);
    pdf.text(schoolName, width / 2, 17, { align: "center" });
    y = 17 + schoolName.length * 6;
    if (data.schoolAddress) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      const address = pdf.splitTextToSize(data.schoolAddress, contentWidth - 50);
      pdf.text(address, width / 2, y, { align: "center" });
      y += address.length * 4;
    }
    y = Math.max(y + 5, 35);
    pdf.setFillColor(239, 246, 255);
    pdf.roundedRect(left, y, contentWidth, 10, 1, 1, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text(data.title || "STUDENT ADMISSION FORM", width / 2, y + 6.5, { align: "center" });
    y += 16;
  }

  function nextPage() {
    pdf.addPage();
    header();
  }

  header();
  for (const section of data.sections) {
    if (y + 17 > bottom) nextPage();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(30, 64, 175);
    pdf.text(section.title.toUpperCase(), left, y);
    pdf.setDrawColor(203, 213, 225);
    pdf.line(left, y + 2, width - left, y + 2);
    y += 8;

    for (const field of section.fields) {
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      const lines: string[] = pdf.splitTextToSize(field.value.trim() || "-", contentWidth - 54);
      let firstLine = true;
      while (lines.length > 0) {
        if (y + 6 > bottom) nextPage();
        const available = Math.max(1, Math.floor((bottom - y) / 5));
        const part = lines.splice(0, available);
        pdf.setTextColor(71, 85, 105);
        pdf.setFont("helvetica", "bold");
        pdf.text(firstLine ? field.label : `${field.label} (continued)`, left, y);
        pdf.setTextColor(15, 23, 42);
        pdf.setFont("helvetica", "normal");
        pdf.text(part, left + 54, y);
        y += part.length * 5 + 2;
        firstLine = false;
        if (lines.length > 0) nextPage();
      }
    }
    y += 3;
  }
  return pdf;
}
