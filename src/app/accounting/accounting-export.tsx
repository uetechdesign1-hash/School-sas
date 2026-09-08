"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function exportAccountingExcel(fileName = "accounting-report") {
  if (typeof document === "undefined") return;

  const tables = Array.from(document.querySelectorAll("table"));
  const workbook = XLSX.utils.book_new();

  const visibleTables = tables.filter((table) => {
    const el = table as HTMLElement;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  });

  if (!visibleTables.length) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Accounting Export"],
      ["No tabular data is currently visible on this page."],
      ["Use the page filters/view options, then export again."],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  } else {
    visibleTables.forEach((table, index) => {
      const sheet = XLSX.utils.table_to_sheet(table, { raw: false });
      const rawName = `Report ${index + 1}`;
      XLSX.utils.book_append_sheet(workbook, sheet, rawName.slice(0, 31));
    });
  }

  XLSX.writeFile(workbook, `${safeFileName(fileName)}.xlsx`);
}

export function printAccountingPdf() {
  if (typeof window === "undefined") return;
  window.print();
}

export function AccountingExportActions({
  fileName,
  className = "",
}: {
  fileName: string;
  className?: string;
}) {
  return (
    <>
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
        }
      `}</style>
      <div className={`no-print fixed bottom-5 right-5 z-50 flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={printAccountingPdf}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-lg transition hover:bg-slate-50"
        title="Download this accounting page as PDF using the browser print dialog"
      >
        <FileText size={16} />
        PDF
      </button>

      <button
        type="button"
        onClick={() => exportAccountingExcel(fileName)}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800"
        title="Download the visible accounting tables as an Excel workbook"
      >
        <FileSpreadsheet size={16} />
        Excel
      </button>
      </div>
    </>
  );
}
