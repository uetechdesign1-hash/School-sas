const fs = require("fs");
const path = require("path");

const filePath = path.join(
  __dirname,
  "src/app/accounting/receipt/page.tsx"
);

let content = fs.readFileSync(filePath, "utf8");

// Replace the HTML-table-based Excel export with the json_to_sheet workbook approach.
const oldBlock = `
  function exportHistoryExcel() {
    if (filteredHistory.length === 0) {
      setError("No receipt history available for the selected filters.");
      return;
    }

    const rows = filteredHistory.map((row) => ({
      Date: row.transaction_date,
      "Receipt No.": row.transaction_number || row.id.slice(0, 8),
      "Bill No.": row.manual_bill_number || "",
      Student: row.student_name || "",
      Class: row.class_name || "",
      "Fee Categories Paid": getDisplayedHistoryCategories(row).join(", "),
      Debit: row.debit_account || "",
      Credit: row.credit_account || "",
      Particulars: row.receipt_type === "student_fee"
        ? [row.student_name, row.class_name].filter(Boolean).join(" \\u2022 ")
        : row.description || "",
      Amount: getDisplayedHistoryAmount(row),
    }));

    if (rows.length === 0) {
      setError("No receipt history available for the selected filters.");
      return;
    }

    const headers = Object.keys(rows[0]);
    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;");

    // SpreadsheetML/HTML is directly readable by Microsoft Excel without
    // requiring an additional XLSX package in the Next.js bundle.
    const html = \\uFEFF<html><head><meta charset="utf-8" /></head><body>
      <h2>Receipt History</h2>
      <p>Category: ${escapeHtml(historyCategoryFilter === "all" ? "All fee categories" : historyCategoryFilter)} | Date: ${escapeHtml(historyFromDate || "All")} to ${escapeHtml(historyToDate || "All")}</p>
      <table border="1" cellspacing="0" cellpadding="5">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header as keyof typeof row])}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </body></html>`;

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `receipt-history-${historyFromDate || "all"}-${historyToDate || "all"}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }`;

const newBlock = `
  function exportHistoryExcel() {
    if (filteredHistory.length === 0) {
      setError("No receipt history available for the selected filters.");
      return;
    }

    const rows = filteredHistory.map((row) => ({
      Date: row.transaction_date,
      "Receipt No.": formatReceiptNumber(row),
      "Bill No.": row.manual_bill_number || "",
      Student: row.student_name || "",
      Class: row.class_name || "",
      "Fee Categories Paid": getDisplayedHistoryCategories(row).join(", "),
      Debit: row.debit_account || "",
      Credit: row.credit_account || "",
      Cash: Number(row.cash_amount || 0),
      Bank: Number(row.bank_amount || 0),
      Amount: getDisplayedHistoryAmount(row),
    }));

    const totalCash = filteredHistory.reduce(
      (sum, row) => sum + Number(row.cash_amount || 0),
      0,
    );
    const totalBank = filteredHistory.reduce(
      (sum, row) => sum + Number(row.bank_amount || 0),
      0,
    );
    const totalAmount = filteredHistory.reduce(
      (sum, row) => sum + getDisplayedHistoryAmount(row),
      0,
    );

    const sheetData = [
      {
        Date: "Date",
        "Receipt No.": "Receipt No.",
        "Bill No.": "Bill No.",
        Student: "Student",
        Class: "Class",
        "Fee Categories Paid": "Fee Categories Paid",
        Debit: "Debit",
        Credit: "Credit",
        Cash: "Cash",
        Bank: "Bank",
        Amount: "Amount",
      },
      ...rows,
      {},
      {
        "Receipt No.": "Total",
        Cash: totalCash,
        Bank: totalBank,
        Amount: totalAmount,
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sheetData, { skipHeader: true });

    worksheet["!cols"] = [
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
      { wch: 18 },
      { wch: 26 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Receipt History");

    XLSX.writeFile(
      workbook,
      \`receipt-history-\${historyFromDate || "all"}-\${historyToDate || "all"}.xlsx\`,
    );
  }`;

const result = content.replace(oldBlock, newBlock);

if (result === content) {
  console.error("NO MATCH FOUND");
  process.exit(1);
}

fs.writeFileSync(filePath, result, "utf8");
console.log("Replaced exportHistoryExcel successfully.");
