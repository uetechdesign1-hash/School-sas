const fs = require("fs");
const path = require("path");

const filePath = path.resolve(__dirname, "..", "src", "app", "accounting", "receipt", "page.tsx");

let c = fs.readFileSync(filePath, "utf8");
// Normalize CRLF -> LF so string matching works.
c = c.replace(/\r\n/g, "\n");

// ------------------------------------------------------------------
// PART 1: Add totalCash, totalBank, totalAmount after the rows map.
// ------------------------------------------------------------------
const rowsMapEndMarker = "      Amount: getDisplayedHistoryAmount(row),\n    }));\n\n    if (rows.length === 0) {";

const totalsBlock =
    "      Amount: getDisplayedHistoryAmount(row),\n    }));\n\n" +
    "    const totalCash = filteredHistory.reduce(\n" +
    "      (sum, row) => sum + Number(row.cash_amount || 0),\n" +
    "      0,\n" +
    "    );\n" +
    "    const totalBank = filteredHistory.reduce(\n" +
    "      (sum, row) => sum + Number(row.bank_amount || 0),\n" +
    "      0,\n" +
    "    );\n" +
    "    const totalAmount = filteredHistory.reduce(\n" +
    "      (sum, row) => sum + getDisplayedHistoryAmount(row),\n" +
    "      0,\n" +
    "    );\n\n" +
    "    if (rows.length === 0) {";

if (!c.includes(rowsMapEndMarker)) {
  console.error("rows map marker not found");
  process.exit(1);
}
c = c.replace(rowsMapEndMarker, totalsBlock);

// ------------------------------------------------------------------
// PART 2: Replace the HTML-table export with the json_to_sheet workbook export.
// ------------------------------------------------------------------
const htmlStart = c.indexOf("const html = `");
if (htmlStart === -1) {
  console.error("html start marker not found");
  process.exit(1);
}
const revokeIndex = c.indexOf("URL.revokeObjectURL(url);", htmlStart);
if (revokeIndex === -1) {
  console.error("revoke marker not found");
  process.exit(1);
}
// End of the block: after "URL.revokeObjectURL(blob);" there is a newline.
let cut = revokeIndex + "URL.revokeObjectURL(blob);".length + 1;
// Include any trailing blank lines up to the next non-blank line that starts
// with 'const blob' or similar. Actually the revoke line is immediately followed
// by a blank line then 'const blob'. We cut after the newline following revoke.
while (cut < c.length && c[cut] === "\n") {
  cut++;
}

const blockToReplace = c.slice(htmlStart, cut);

// Build the new content line by line (no backslashes, no template literals).
const lines = [
  "    // SpreadsheetML/HTML is directly readable by Microsoft Excel without",
  "    // requiring an additional XLSX package in the Next.js bundle.",
  "    const sheetData = [",
  "      {",
  '        Date: "Date",',
  '        "Receipt No.": "Receipt No.",',
  '        "Bill No.": "Bill No.",',
  '        Student: "Student",',
  '        Class: "Class",',
  '        "Fee Categories Paid": "Fee Categories Paid",',
  '        Debit: "Debit",',
  '        Credit: "Credit",',
  '        Cash: "Cash",',
  '        Bank: "Bank",',
  '        Amount: "Amount",',
  "      },",
  "      ...rows,",
  "      {},",
  "      {",
  '        "Receipt No.": "Total",',
  "        Cash: totalCash,",
  "        Bank: totalBank,",
  "        Amount: totalAmount,",
  "      },",
  "    ];",
  "",
  "    const worksheet = XLSX.utils.json_to_sheet(sheetData, { skipHeader: true });",
  "",
  "    worksheet[\"!cols\"] = [",
  "      { wch: 14 },",
  "      { wch: 16 },",
  "      { wch: 16 },",
  "      { wch: 22 },",
  "      { wch: 18 },",
  "      { wch: 26 },",
  "      { wch: 14 },",
  "      { wch: 14 },",
  "      { wch: 12 },",
  "      { wch: 12 },",
  "      { wch: 14 },",
  "    ];",
  "",
  "    const workbook = XLSX.utils.book_new();",
  "    XLSX.utils.book_append_sheet(workbook, worksheet, \"Receipt History\");",
  "",
  "    XLSX.writeFile(",
  "      workbook,",
  "      `receipt-history-${historyFromDate || \"all\"}-${historyToDate || \"all\"}.xlsx`,",
  "    );",
];
const newBlock = lines.join("\n");

c = c.replace(blockToReplace, newBlock);

fs.writeFileSync(filePath, c, "utf8");
console.log("Patched receipt page Excel export successfully.");
