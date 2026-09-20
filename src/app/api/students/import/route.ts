import { getStudentImportAuth } from "@/lib/students/import-auth";

function errorJson(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

type ImportStudent = {
  admission_no?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  gender?: string;
  class_name?: string;
  section_name?: string;
  date_of_birth?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  parent_name?: string;
  parent_phone?: string;
};

type ImportRowError = {
  row: number;
  admission_no: string;
  errors: string[];
};

const VALID_GENDERS = ["male", "female", "other"];

export async function POST(request: Request) {
  try {
    const { admin, schoolId } = await getStudentImportAuth(request);

    const body = await request.json();
    const students = (body?.students || []) as ImportStudent[];

    if (!Array.isArray(students) || students.length === 0) {
      return errorJson("No student rows were provided.");
    }

    // Resolve the active academic year (current year first).
    const { data: academicYears } = await admin
      .from("academic_years")
      .select("id, is_current, start_date")
      .eq("school_id", schoolId)
      .order("start_date", { ascending: false });

    const academicYearId =
      (academicYears || []).find((year) => year.is_current)?.id ||
      (academicYears || [])[0]?.id ||
      null;

    // Load classes and sections for this school.
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

    const { data: existingStudents } = await admin
      .from("students")
      .select("admission_no")
      .eq("school_id", schoolId);

    const existingAdmissionNos = new Set(
      (existingStudents || []).map((row) =>
        String(row.admission_no || "").trim().toLowerCase(),
      ),
    );

    const successDetails: Array<{
      row: number;
      admission_no: string;
      student_id: string;
    }> = [];
    const errorDetails: ImportRowError[] = [];
    const seenAdmissionNos = new Set<string>();

    const clean = (value?: string) => String(value ?? "").trim();

    for (let index = 0; index < students.length; index += 1) {
      const entry = students[index];
      const rowNumber = index + 1;

      const admissionNo = clean(entry.admission_no);
      const firstName = clean(entry.first_name);
      const middleName = clean(entry.middle_name);
      const lastName = clean(entry.last_name);
      const gender = clean(entry.gender).toLowerCase();
      const className = clean(entry.class_name);
      const sectionName = clean(entry.section_name);

      const errors: string[] = [];

      if (!admissionNo) {
        errors.push("admission_no is required");
      } else if (existingAdmissionNos.has(admissionNo.toLowerCase())) {
        errors.push(`admission_no "${admissionNo}" already exists`);
      } else if (seenAdmissionNos.has(admissionNo.toLowerCase())) {
        errors.push(`duplicate admission_no "${admissionNo}" in this request`);
      }

      if (!firstName) {
        errors.push("first_name is required");
      }

      if (!gender || !VALID_GENDERS.includes(gender)) {
        errors.push("gender must be male, female or other");
      }

      const classId = className
        ? classNameToId.get(className.toLowerCase())
        : undefined;

      if (!classId) {
        errors.push(`class_name "${className}" does not exist`);
      }

      let sectionId: string | null = null;

      if (sectionName && classId) {
        sectionId =
          sectionLookup.get(`${classId}::${sectionName.toLowerCase()}`) || null;

        if (!sectionId) {
          errors.push(
            `section_name "${sectionName}" does not belong to class "${className}"`,
          );
        }
      }

      if (errors.length > 0) {
        errorDetails.push({
          row: rowNumber,
          admission_no: admissionNo,
          errors,
        });
        continue;
      }

      seenAdmissionNos.add(admissionNo.toLowerCase());

      const { data: created, error: insertError } = await admin
        .from("students")
        .insert({
          school_id: schoolId,
          academic_year_id: academicYearId,
          admission_no: admissionNo,
          first_name: firstName,
          middle_name: middleName || null,
          last_name: lastName || null,
          gender,
          class_id: classId,
          section_id: sectionId,
          status: "active",
        })
        .select("id, admission_no")
        .single();

      if (insertError || !created) {
        errorDetails.push({
          row: rowNumber,
          admission_no: admissionNo,
          errors: [insertError?.message || "Unable to create the student."],
        });
        continue;
      }

      successDetails.push({
        row: rowNumber,
        admission_no: created.admission_no,
        student_id: created.id,
      });
    }

    return Response.json({
      total_rows: students.length,
      successful: successDetails.length,
      failed: errorDetails.length,
      success_details: successDetails,
      error_details: errorDetails,
    });
  } catch (error) {
    console.error("STUDENT IMPORT ERROR:", error);

    return errorJson(
      error instanceof Error ? error.message : "Unable to import students.",
      500,
    );
  }
}

