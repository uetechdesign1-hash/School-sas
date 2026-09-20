import * as XLSX from "xlsx";
import { getStudentImportAuth } from "@/lib/students/import-auth";

function errorJson(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

const REQUIRED_HEADERS = [
  "admission_no",
  "first_name",
  "gender",
  "class_name",
];

const VALID_GENDERS = ["male", "female", "other"];

export type ParsedRow = {
  row_number: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
};

export async function POST(request: Request) {
  try {
    const { admin, schoolId } = await getStudentImportAuth(request);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return errorJson("Please upload an Excel file.");
    }

    const buffer = await file.arrayBuffer();

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer);
    } catch {
      return errorJson(
        "Unable to read the Excel file. Please upload a valid .xlsx or .xls file.",
      );
    }

    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return errorJson("The Excel file does not contain any sheet.");
    }

    const worksheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });

    if (rows.length < 2) {
      return errorJson(
        "The Excel file is empty. Add at least one student row below the header row.",
      );
    }

    const headerRow = (rows[0] || []).map((value) =>
      String(value || "").trim().toLowerCase(),
    );

    const missingHeaders = REQUIRED_HEADERS.filter(
      (header) => !headerRow.includes(header),
    );

    if (missingHeaders.length > 0) {
      return errorJson(
        `Missing required column(s): ${missingHeaders.join(", ")}. Download the template for the correct format.`,
      );
    }

    const headerIndex: Record<string, number> = {};
    headerRow.forEach((header, index) => {
      if (header) {
        headerIndex[header] = index;
      }
    });

    const { data: classRows, error: classError } = await admin
      .from("classes")
      .select("id, name")
      .eq("school_id", schoolId);

    if (classError) {
      return errorJson(`Unable to load classes: ${classError.message}`, 500);
    }

    const { data: sectionRows, error: sectionError } = await admin
      .from("sections")
      .select("id, class_id, name")
      .eq("school_id", schoolId);

    if (sectionError) {
      return errorJson(`Unable to load sections: ${sectionError.message}`, 500);
    }

    const classNameToId = new Map<string, string>();
    (classRows || []).forEach((row) => {
      classNameToId.set(String(row.name).trim().toLowerCase(), row.id);
    });

    const sectionLookup = new Map<string, string>();
    (sectionRows || []).forEach((row) => {
      sectionLookup.set(
        `${row.class_id}::${String(row.name).trim().toLowerCase()}`,
        row.id,
      );
    });

    const classNames = (classRows || []).map((row) => row.name);

    const { data: existingStudents } = await admin
      .from("students")
      .select("admission_no")
      .eq("school_id", schoolId);

    const existingAdmissionNos = new Set(
      (existingStudents || []).map((row) =>
        String(row.admission_no || "").trim().toLowerCase(),
      ),
    );

    const parsedData: ParsedRow[] = [];
    const seenAdmissionNos = new Set<string>();

    const read = (row: unknown[], key: string) => {
      const index = headerIndex[key];
      if (index === undefined) return "";
      return String(row[index] ?? "").trim();
    };

    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index] || [];
      const rowNumber = index + 1;

      const hasAnyValue = row.some(
        (cell) => String(cell ?? "").trim() !== "",
      );

      if (!hasAnyValue) {
        continue;
      }

      const admissionNo = read(row, "admission_no");
      const firstName = read(row, "first_name");
      const gender = read(row, "gender").toLowerCase();
      const className = read(row, "class_name");
      const sectionName = read(row, "section_name");

      const errors: string[] = [];

      if (!admissionNo) {
        errors.push("admission_no is required");
      } else if (existingAdmissionNos.has(admissionNo.toLowerCase())) {
        errors.push(`admission_no "${admissionNo}" already exists`);
      } else if (seenAdmissionNos.has(admissionNo.toLowerCase())) {
        errors.push(`duplicate admission_no "${admissionNo}" in this file`);
      }

      if (!firstName) {
        errors.push("first_name is required");
      }

      if (!gender) {
        errors.push("gender is required");
      } else if (!VALID_GENDERS.includes(gender)) {
        errors.push(`gender must be male, female or other (got "${gender}")`);
      }

      let classId: string | undefined;

      if (!className) {
        errors.push("class_name is required");
      } else {
        classId = classNameToId.get(className.toLowerCase());

        if (!classId) {
          errors.push(
            `class_name "${className}" does not exist${
              classNames.length > 0
                ? ` (available: ${classNames.slice(0, 8).join(", ")})`
                : ""
            }`,
          );
        }
      }

      if (sectionName && classId) {
        const sectionId = sectionLookup.get(
          `${classId}::${sectionName.toLowerCase()}`,
        );

        if (!sectionId) {
          errors.push(
            `section_name "${sectionName}" does not belong to class "${className}"`,
          );
        }
      }

      if (admissionNo) {
        seenAdmissionNos.add(admissionNo.toLowerCase());
      }

      parsedData.push({
        row_number: rowNumber,
        data: {
          admission_no: admissionNo,
          first_name: firstName,
          middle_name: read(row, "middle_name"),
          last_name: read(row, "last_name"),
          gender,
          class_name: className,
          section_name: sectionName,
          date_of_birth: read(row, "date_of_birth"),
          email: read(row, "email"),
          phone: read(row, "phone"),
          address: read(row, "address"),
          city: read(row, "city"),
          parent_name: read(row, "parent_name"),
          parent_phone: read(row, "parent_phone"),
        },
        valid: errors.length === 0,
        errors,
      });
    }

    if (parsedData.length === 0) {
      return errorJson(
        "No student rows were found in the Excel file. Add rows below the header row.",
      );
    }

    return Response.json({ data: parsedData });
  } catch (error) {
    console.error("STUDENT PARSE ERROR:", error);

    return errorJson(
      error instanceof Error
        ? error.message
        : "Unable to parse the Excel file.",
      500,
    );
  }
}

