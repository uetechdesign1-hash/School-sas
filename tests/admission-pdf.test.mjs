import assert from "node:assert/strict";
import test from "node:test";
import { createAdmissionPdf } from "../src/lib/students/admission-pdf.ts";

test("admission form uses A4 and includes student, family and payment details", () => {
  const pdf = createAdmissionPdf({
    schoolName: "Example School",
    schoolAddress: "School Road",
    sections: [
      { title: "Student", fields: [{ label: "Name", value: "Sample Student" }] },
      { title: "Family", fields: [{ label: "Father", value: "Sample Parent" }] },
      { title: "Payment", fields: [{ label: "Receipt", value: "REC-123" }] },
    ],
  });
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 210) < 0.1);
  assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 297) < 0.1);
  const contents = pdf.output();
  for (const text of ["Example School", "Sample Student", "Sample Parent", "REC-123"]) {
    assert.ok(contents.includes(text));
  }
});

test("long admission information continues on additional pages without truncation", () => {
  const pdf = createAdmissionPdf({
    schoolName: "Example School",
    sections: [{
      title: "Notes",
      fields: [{ label: "Details", value: `${"Long detail ".repeat(600)} END-OF-NOTES` }],
    }],
  });
  assert.ok(pdf.getNumberOfPages() > 1);
  assert.ok(pdf.output().includes("END-OF-NOTES"));
});

test("the school logo is embedded in the admission form", () => {
  const pdf = createAdmissionPdf({
    schoolName: "Example School",
    schoolLogoDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEA43qFxAAAAABJRU5ErkJggg==",
    sections: [],
  });
  assert.ok(pdf.output().includes("/Subtype /Image"));
});
