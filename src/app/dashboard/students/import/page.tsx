
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Users,
  Download,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";

type ParsedRow = {
  row_number: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
};

type ImportResult = {
  total_rows: number;
  successful: number;
  failed: number;
  error_details?: Array<{ row: number; admission_no: string; errors: string[] }>;
};

export default function StudentImportPage() {
  const router = useRouter();
  const supabase = createClient();

  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"upload" | "review" | "result">("upload");

  const validCount = parsedData.filter((p) => p.valid).length;
  const invalidCount = parsedData.filter((p) => !p.valid).length;

  async function handleDownloadTemplate() {
    try {
      setError("");
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/students/template", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        throw new Error("Unable to download template.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "student_import_template.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to download template.",
      );
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;

    if (!selected.name.endsWith(".xlsx") && !selected.name.endsWith(".xls")) {
      setError("Please upload an Excel file (.xlsx or .xls).");
      return;
    }

    if (selected.size > 5 * 1024 * 1024) {
      setError("File size must be less than 5MB.");
      return;
    }

    setFile(selected);
    setFileName(selected.name);
    setError("");
  }

  async function handleParse() {
    if (!file) return;

    setLoading(true);
    setError("");
    setParsedData([]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace("/login");
        return;
      }

      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/students/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to parse Excel file.");
      }

      setParsedData((payload.data || []) as ParsedRow[]);
      setStep("review");
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Unable to parse Excel file.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (parsedData.length === 0) return;

    setImporting(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace("/login");
        return;
      }

      const students = parsedData.filter((p) => p.valid).map((p) => p.data);

      const response = await fetch("/api/students/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ students }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to import students.");
      }

      setResult(payload as ImportResult);
      setStep("result");
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Unable to import students.",
      );
    } finally {
      setImporting(false);
    }
  }

  function resetImport() {
    setFile(null);
    setFileName("");
    setParsedData([]);
    setResult(null);
    setError("");
    setStep("upload");
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <button
          type="button"
          onClick={() => router.push("/dashboard/students")}
          className="mb-4 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft size={16} />
          Back to Students
        </button>

        <h1 className="text-2xl font-bold text-slate-900">Import Students</h1>
        <p className="mt-1 text-sm text-slate-500">
          Download the Excel template, fill in the student rows, then upload it
          here to add many students at once.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === "upload" && (
          <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              1. Upload Excel File
            </h2>

            <div className="rounded-xl border-2 border-dashed border-slate-300 p-8 text-center transition hover:border-blue-500">
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileSpreadsheet className="h-8 w-8 text-blue-600" />
                  <div className="text-left">
                    <p className="font-medium text-slate-900">{fileName}</p>
                    <p className="text-xs text-slate-500">
                      Click &quot;Parse File&quot; to preview the rows.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="mx-auto h-10 w-10 text-slate-400" />
                  <p className="mt-2 text-sm text-slate-600">
                    Drag your Excel file here or{" "}
                    <label className="cursor-pointer font-medium text-blue-600 hover:text-blue-700">
                      browse
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Supports .xlsx and .xls (maximum 5MB)
                  </p>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleDownloadTemplate()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Download size={16} />
                Download Excel Template
              </button>

              {file && (
                <button
                  type="button"
                  onClick={() => void handleParse()}
                  disabled={loading}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw
                    size={16}
                    className={loading ? "animate-spin" : ""}
                  />
                  {loading ? "Parsing..." : "Parse File"}
                </button>
              )}
            </div>

            <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-700">Required columns</p>
              <p className="mt-1">
                admission_no, first_name, gender, class_name
              </p>
              <p className="mt-3 font-semibold text-slate-700">
                Optional columns
              </p>
              <p className="mt-1">
                middle_name, last_name, section_name, email, phone, address,
                city, date_of_birth, parent_name, parent_phone
              </p>
            </div>
          </div>
        )}
{step === "review" && (
          <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              2. Review Data
            </h2>

            <div className="mb-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
                <span className="text-sm text-slate-700">
                  <strong className="text-emerald-700">{validCount}</strong>{" "}
                  valid rows
                </span>
              </div>

              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-600" />
                <span className="text-sm text-slate-700">
                  <strong className="text-red-700">{invalidCount}</strong>{" "}
                  invalid rows
                </span>
              </div>
            </div>

            {invalidCount > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                <strong>Note:</strong> invalid rows are skipped. Check that the
                class and section names already exist in your school.
              </div>
            )}

            <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                      Admission No.
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                      Name
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                      Class
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                      Gender
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.map((row) => (
                    <tr
                      key={row.row_number}
                      className={`border-t border-slate-100 ${
                        row.valid ? "" : "bg-red-50"
                      }`}
                    >
                      <td className="px-3 py-2 text-slate-700">
                        {row.data.admission_no || "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {[
                          row.data.first_name,
                          row.data.middle_name,
                          row.data.last_name,
                        ]
                          .filter(Boolean)
                          .join(" ") || "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {row.data.class_name || "-"}
                        {row.data.section_name
                          ? ` - ${row.data.section_name}`
                          : ""}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {row.data.gender || "-"}
                      </td>
                      <td className="px-3 py-2">
                        {row.valid ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Valid
                          </span>
                        ) : (
                          <span
                            className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                            title={row.errors.join(", ")}
                          >
                            {row.errors[0] || "Invalid"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={resetImport}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Upload Different File
              </button>

              {validCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={importing}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Users size={16} />
                  {importing
                    ? "Importing..."
                    : `Import ${validCount} Students`}
                </button>
              )}
            </div>
          </div>
        )}
{step === "result" && result && (
          <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              3. Import Complete
            </h2>

            <div className="mb-4 flex items-center gap-4">
              <CheckCircle className="h-8 w-8 text-emerald-600" />
              <div>
                <p className="text-sm text-slate-600">Import summary</p>
                <p className="text-2xl font-bold text-slate-900">
                  {result.successful} of {result.total_rows} students imported
                </p>
              </div>
            </div>

            {result.error_details && result.error_details.length > 0 && (
              <div className="rounded-lg bg-red-50 p-3">
                <h3 className="mb-2 font-medium text-red-700">
                  Failed rows ({result.error_details.length})
                </h3>
                <ul className="space-y-1 text-sm text-red-700">
                  {result.error_details.map((item) => (
                    <li key={`${item.row}-${item.admission_no}`}>
                      Row {item.row} ({item.admission_no || "no admission no"}):{" "}
                      {item.errors.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={resetImport}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Import More Students
              </button>

              <button
                type="button"
                onClick={() => router.push("/dashboard/students")}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                View All Students
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}


