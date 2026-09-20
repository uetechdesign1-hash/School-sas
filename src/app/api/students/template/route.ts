import * as XLSX from "xlsx";
import { getStudentImportAuth } from "@/lib/students/import-auth";

function errorJson(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const { admin, schoolId } = await getStudentImportAuth(request);

    // Reference data so the school knows which values will pass validation.
    const { data: classes } = await admin
      .from("classes")
      .select("id, name, display_order")
      .eq("school_id", schoolId)
      .order("display_order", { ascending: true });

    const { data: sections } = await admin
      .from("sections")
      .select("id, class_id, name")
      .eq("school_id", schoolId)
      .order("name", { ascending: true });

    const classList = classes || [];
    const sectionList = sections || [];

    const workbook = XLSX.utils.book_new();

    // ---------------------------------------------
    // Students sheet (the one the school fills in)
    // ---------------------------------------------
    const studentHeaders = [
      "admission_no",
      "first_name",
      "middle_name",
      "last_name",
      "gender",
      "class_name",
      "section_name",
      "date_of_birth",
      "email",
      "phone",
      "address",
      "city",
      "parent_name",
      "parent_phone",
    ];

    const firstClassName = classList[0]?.name || "1";
    const firstClassId = classList[0]?.id;
    const firstSectionName =
      sectionList.find((section) => section.class_id === firstClassId)?.name ||
      "";

    const sampleRow = [
      "STU001",
      "Rahul",
      "",
      "Sharma",
      "male",
      firstClassName,
      firstSectionName,
      "2012-05-14",
      "rahul@example.com",
      "9876543210",
      "12 Main Street",
      "Delhi",
      "Ramesh Sharma",
      "9876543210",
    ];

    const studentsSheet = XLSX.utils.aoa_to_sheet([
      studentHeaders,
      sampleRow,
    ]);

    studentsSheet["!cols"] = studentHeaders.map((header) => ({
      wch: Math.max(header.length + 4, 16),
    }));

    XLSX.utils.book_append_sheet(workbook, studentsSheet, "Students");

    // ---------------------------------------------
    // Instructions sheet
    // ---------------------------------------------
    const instructions = [
      ["Student Import Instructions"],
      [""],
      ["1. Fill the 'Students' sheet. Keep row 1 (the header row) unchanged."],
      ["2. Delete the sample row before uploading."],
      ["3. Required columns: admission_no, first_name, gender, class_name"],
      [
        "4. gender accepts: male, female, other (lowercase or uppercase is fine)",
      ],
      [
        "5. class_name must exactly match one of the class names listed in the 'Classes' sheet.",
      ],
      [
        "6. section_name (optional) must belong to the chosen class_name. See the 'Sections' sheet.",
      ],
      ["7. date_of_birth must use the YYYY-MM-DD format (optional)."],
      ["8. admission_no must be unique and not already used in the school."],
      ["9. Save the file as .xlsx and upload it on the Import Students page."],
    ];

    const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
    instructionsSheet["!cols"] = [{ wch: 90 }];

    XLSX.utils.book_append_sheet(
      workbook,
      instructionsSheet,
      "Instructions",
    );

    // ---------------------------------------------
    // Classes sheet (valid class names)
    // ---------------------------------------------
    const classesSheet = XLSX.utils.aoa_to_sheet([
      ["class_name"],
      ...classList.map((item) => [item.name]),
    ]);
    classesSheet["!cols"] = [{ wch: 24 }];

    XLSX.utils.book_append_sheet(workbook, classesSheet, "Classes");

    // ---------------------------------------------
    // Sections sheet (valid class + section pairs)
    // ---------------------------------------------
    const classNamesById = new Map(
      classList.map((item) => [item.id, item.name]),
    );

    const sectionsSheet = XLSX.utils.aoa_to_sheet([
      ["class_name", "section_name"],
      ...sectionList.map((section) => [
        classNamesById.get(section.class_id) || "",
        section.name,
      ]),
    ]);
    sectionsSheet["!cols"] = [{ wch: 24 }, { wch: 24 }];

    XLSX.utils.book_append_sheet(workbook, sectionsSheet, "Sections");

    const fileBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="student_import_template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("STUDENT TEMPLATE ERROR:", error);

    return errorJson(
      error instanceof Error
        ? error.message
        : "Unable to generate the student import template.",
      500,
    );
  }
}
