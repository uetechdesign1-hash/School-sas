"use client";

import Link from "next/link";
import {
  FormEvent,
  useEffect,
  useState,
} from "react";
import {
  useParams,
  useRouter,
} from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Gender =
  | "male"
  | "female"
  | "other";

type StudentStatus =
  | "active"
  | "inactive"
  | "transferred"
  | "completed"
  | "alumni";

type SchoolClass = {
  id: string;
  name: string;
  display_order: number;
};

type Section = {
  id: string;
  class_id: string;
  name: string;
};

type Student = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  admission_no: string;
  roll_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  class_id: string | null;
  section_id: string | null;
  admission_date: string | null;
  status: StudentStatus;
  photo_url: string | null;
  blood_group: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  notes: string | null;
};

export default function StudentDetailsPage() {
  const params = useParams();
  const router = useRouter();

  const studentId =
    typeof params.id === "string"
      ? params.id
      : "";

  const [student, setStudent] =
    useState<Student | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [editing, setEditing] =
    useState(false);

  const [error, setError] =
    useState("");

  const [admissionNo, setAdmissionNo] =
    useState("");

  const [rollNo, setRollNo] =
    useState("");

  const [firstName, setFirstName] =
    useState("");

  const [middleName, setMiddleName] =
    useState("");

  const [lastName, setLastName] =
    useState("");

  const [dateOfBirth, setDateOfBirth] =
    useState("");

  const [gender, setGender] =
    useState<Gender | "">("");

  const [admissionDate, setAdmissionDate] =
    useState("");

  const [status, setStatus] =
    useState<StudentStatus>("active");

  const [bloodGroup, setBloodGroup] =
    useState("");

  const [classId, setClassId] =
    useState("");

  const [sectionId, setSectionId] =
    useState("");

  const [classes, setClasses] =
    useState<SchoolClass[]>([]);

  const [sections, setSections] =
    useState<Section[]>([]);

  const [classesLoading, setClassesLoading] =
    useState(true);

  const [sectionsLoading, setSectionsLoading] =
    useState(false);

  const [address, setAddress] =
    useState("");

  const [city, setCity] =
    useState("");

  const [state, setState] =
    useState("");

  const [postalCode, setPostalCode] =
    useState("");

  const [notes, setNotes] =
    useState("");

  useEffect(() => {
    if (studentId) {
      loadStudent();
    }
  }, [studentId]);

  async function getSchoolId(
    supabase: ReturnType<
      typeof createClient
    >
  ) {
    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      window.location.href =
        "/login";

      return null;
    }

    const {
      data: membership,
      error: membershipError,
    } =
      await supabase
        .from("school_users")
        .select(
          "school_id, role, is_active"
        )
        .eq(
          "user_id",
          user.id
        )
        .eq(
          "is_active",
          true
        )
        .limit(1)
        .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership) {
      throw new Error(
        "Your account is not assigned to a school."
      );
    }

    return membership.school_id;
  }

  async function loadClasses(
    supabase: ReturnType<
      typeof createClient
    >,
    schoolId: string
  ) {
    const {
      data,
      error: classesError,
    } =
      await supabase
        .from("classes")
        .select(
          "id, name, display_order"
        )
        .eq(
          "school_id",
          schoolId
        )
        .order("display_order", {
          ascending: true,
        })
        .order("name", {
          ascending: true,
        });

    if (classesError) {
      throw classesError;
    }

    setClasses(
      (data || []) as SchoolClass[]
    );
  }

  async function loadSections(
    supabase: ReturnType<
      typeof createClient
    >,
    schoolId: string,
    selectedClassId: string
  ) {
    if (!selectedClassId) {
      setSections([]);
      return;
    }

    setSectionsLoading(true);

    try {
      const {
        data,
        error: sectionsError,
      } =
        await supabase
          .from("sections")
          .select(
            "id, class_id, name"
          )
          .eq(
            "school_id",
            schoolId
          )
          .eq(
            "class_id",
            selectedClassId
          )
          .order("name", {
            ascending: true,
          });

      if (sectionsError) {
        throw sectionsError;
      }

      setSections(
        (data || []) as Section[]
      );
    } finally {
      setSectionsLoading(false);
    }
  }

  async function handleClassChange(
    value: string
  ) {
    setClassId(value);
    setSectionId("");
    setSections([]);

    if (!value) {
      return;
    }

    try {
      setError("");

      const supabase =
        createClient();

      const schoolId =
        await getSchoolId(
          supabase
        );

      if (!schoolId) {
        return;
      }

      await loadSections(
        supabase,
        schoolId,
        value
      );
    } catch (error) {
      console.error(
        "LOAD SECTIONS ERROR:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to load sections."
      );
    }
  }

  async function loadStudent() {
    try {
      setLoading(true);
      setError("");

      const supabase =
        createClient();

      const schoolId =
        await getSchoolId(
          supabase
        );

      if (!schoolId) {
        return;
      }

      setClassesLoading(true);

      await loadClasses(
        supabase,
        schoolId
      );

      const {
        data,
        error: studentError,
      } =
        await supabase
          .from("students")
          .select(`
            id,
            school_id,
            academic_year_id,
            admission_no,
            roll_no,
            first_name,
            middle_name,
            last_name,
            date_of_birth,
            gender,
            class_id,
            section_id,
            admission_date,
            status,
            photo_url,
            blood_group,
            address,
            city,
            state,
            postal_code,
            notes
          `)
          .eq(
            "id",
            studentId
          )
          .eq(
            "school_id",
            schoolId
          )
          .maybeSingle();

      if (studentError) {
        throw studentError;
      }

      if (!data) {
        setError(
          "Student not found."
        );

        return;
      }

      const record =
        data as Student;

      setStudent(record);

      fillForm(record);

      setClassId(
        record.class_id || ""
      );

      setSectionId(
        record.section_id || ""
      );

      if (record.class_id) {
        await loadSections(
          supabase,
          schoolId,
          record.class_id
        );
      }
    } catch (error) {
      console.error(
        "LOAD STUDENT ERROR:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to load student."
      );
    } finally {
      setClassesLoading(false);
      setLoading(false);
    }
  }

  function fillForm(
    record: Student
  ) {
    setAdmissionNo(
      record.admission_no || ""
    );

    setRollNo(
      record.roll_no || ""
    );

    setFirstName(
      record.first_name || ""
    );

    setMiddleName(
      record.middle_name || ""
    );

    setLastName(
      record.last_name || ""
    );

    setDateOfBirth(
      record.date_of_birth || ""
    );

    setGender(
      record.gender || ""
    );

    setAdmissionDate(
      record.admission_date || ""
    );

    setStatus(
      record.status
    );

    setBloodGroup(
      record.blood_group || ""
    );

    setClassId(
      record.class_id || ""
    );

    setSectionId(
      record.section_id || ""
    );

    setAddress(
      record.address || ""
    );

    setCity(
      record.city || ""
    );

    setState(
      record.state || ""
    );

    setPostalCode(
      record.postal_code || ""
    );

    setNotes(
      record.notes || ""
    );
  }

  async function handleSave(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!student) {
      return;
    }

    setError("");

    if (!admissionNo.trim()) {
      setError(
        "Admission number is required."
      );
      return;
    }

    if (!firstName.trim()) {
      setError(
        "First name is required."
      );
      return;
    }

    try {
      setSaving(true);

      const supabase =
        createClient();

      const schoolId =
        await getSchoolId(
          supabase
        );

      if (!schoolId) {
        return;
      }

      const updates = {
        admission_no:
          admissionNo.trim(),

        roll_no:
          rollNo.trim() || null,

        first_name:
          firstName.trim(),

        middle_name:
          middleName.trim() || null,

        last_name:
          lastName.trim() || null,

        date_of_birth:
          dateOfBirth || null,

        gender:
          gender || null,

        class_id:
          classId || null,

        section_id:
          sectionId || null,

        admission_date:
          admissionDate || null,

        status,

        blood_group:
          bloodGroup.trim() || null,

        address:
          address.trim() || null,

        city:
          city.trim() || null,

        state:
          state.trim() || null,

        postal_code:
          postalCode.trim() || null,

        notes:
          notes.trim() || null,
      };

      const {
        data,
        error: updateError,
      } =
        await supabase
          .from("students")
          .update(updates)
          .eq(
            "id",
            student.id
          )
          .eq(
            "school_id",
            schoolId
          )
          .select(`
            id,
            school_id,
            academic_year_id,
            admission_no,
            roll_no,
            first_name,
            middle_name,
            last_name,
            date_of_birth,
            gender,
            class_id,
            section_id,
            admission_date,
            status,
            photo_url,
            blood_group,
            address,
            city,
            state,
            postal_code,
            notes
          `)
          .single();

      if (updateError) {
        throw updateError;
      }

      setStudent(
        data as Student
      );

      setClassId(
        data.class_id || ""
      );

      setSectionId(
        data.section_id || ""
      );

      setEditing(false);
    } catch (error) {
      console.error(
        "UPDATE STUDENT ERROR:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to update student."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!student) {
      return;
    }

    const confirmed =
      window.confirm(
        `Delete ${getStudentName(
          student
        )}? This action cannot be undone.`
      );

    if (!confirmed) {
      return;
    }

    try {
      const supabase =
        createClient();

      const schoolId =
        await getSchoolId(
          supabase
        );

      if (!schoolId) {
        return;
      }

      const {
        error: deleteError,
      } =
        await supabase
          .from("students")
          .delete()
          .eq(
            "id",
            student.id
          )
          .eq(
            "school_id",
            schoolId
          );

      if (deleteError) {
        throw deleteError;
      }

      router.replace(
        "/dashboard/students"
      );

      router.refresh();
    } catch (error) {
      console.error(
        "DELETE STUDENT ERROR:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to delete student."
      );
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">

          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

          <p className="mt-3 text-sm text-slate-500">
            Loading student...
          </p>

        </div>
      </div>
    );
  }

  if (error && !student) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6">

          <h1 className="text-lg font-bold text-red-800">
            Unable to load student
          </h1>

          <p className="mt-2 text-sm text-red-700">
            {error}
          </p>

          <Link
            href="/dashboard/students"
            className="mt-5 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
          >
            ← Back to Students
          </Link>

        </div>
      </div>
    );
  }

  if (!student) {
    return null;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-5xl">

        {/* HEADER */}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

          <div>
            <Link
              href="/dashboard/students"
              className="text-sm font-semibold text-blue-600"
            >
              ← Back to Students
            </Link>

            <h1 className="mt-3 text-3xl font-bold text-slate-900">
              {getStudentName(student)}
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Admission No:{" "}
              {student.admission_no}
            </p>
          </div>

          {!editing && (
            <div className="flex gap-2">

              <button
                type="button"
                onClick={() =>
                  setEditing(true)
                }
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Edit Student
              </button>

              <button
                type="button"
                onClick={
                  handleDelete
                }
                className="rounded-xl border border-red-200 bg-white px-5 py-3 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Delete
              </button>

            </div>
          )}

        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {editing ? (
          <form
            onSubmit={handleSave}
            className="mt-6 space-y-6"
          >

            {/* EDIT BASIC INFORMATION */}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <h2 className="text-lg font-bold text-slate-900">
                Edit Student
              </h2>

              <div className="mt-5 grid gap-5 md:grid-cols-2">

                <Field
                  label="Admission Number"
                  required
                >
                  <input
                    value={admissionNo}
                    onChange={(event) =>
                      setAdmissionNo(
                        event.target.value
                      )
                    }
                    required
                    className={inputClass}
                  />
                </Field>

                <Field label="Roll Number">
                  <input
                    value={rollNo}
                    onChange={(event) =>
                      setRollNo(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field
                  label="First Name"
                  required
                >
                  <input
                    value={firstName}
                    onChange={(event) =>
                      setFirstName(
                        event.target.value
                      )
                    }
                    required
                    className={inputClass}
                  />
                </Field>

                <Field label="Middle Name">
                  <input
                    value={middleName}
                    onChange={(event) =>
                      setMiddleName(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Last Name">
                  <input
                    value={lastName}
                    onChange={(event) =>
                      setLastName(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Gender">
                  <select
                    value={gender}
                    onChange={(event) =>
                      setGender(
                        event.target
                          .value as Gender | ""
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">
                      Select gender
                    </option>

                    <option value="male">
                      Male
                    </option>

                    <option value="female">
                      Female
                    </option>

                    <option value="other">
                      Other
                    </option>
                  </select>
                </Field>

                <Field label="Date of Birth">
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(event) =>
                      setDateOfBirth(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Admission Date">
                  <input
                    type="date"
                    value={admissionDate}
                    onChange={(event) =>
                      setAdmissionDate(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Status">
                  <select
                    value={status}
                    onChange={(event) =>
                      setStatus(
                        event.target
                          .value as StudentStatus
                      )
                    }
                    className={inputClass}
                  >
                    <option value="active">
                      Active
                    </option>

                    <option value="inactive">
                      Inactive
                    </option>

                    <option value="transferred">
                      Transferred
                    </option>

                    <option value="completed">
                      Completed
                    </option>

                    <option value="alumni">
                      Alumni
                    </option>
                  </select>
                </Field>

                <Field label="Blood Group">
                  <input
                    value={bloodGroup}
                    onChange={(event) =>
                      setBloodGroup(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                {/* CLASS */}

                <Field label="Class">
                  <select
                    value={classId}
                    onChange={(event) =>
                      handleClassChange(
                        event.target.value
                      )
                    }
                    disabled={
                      classesLoading ||
                      saving
                    }
                    className={inputClass}
                  >
                    <option value="">
                      {classesLoading
                        ? "Loading classes..."
                        : "Select class"}
                    </option>

                    {classes.map(
                      (schoolClass) => (
                        <option
                          key={
                            schoolClass.id
                          }
                          value={
                            schoolClass.id
                          }
                        >
                          {
                            schoolClass.name
                          }
                        </option>
                      )
                    )}
                  </select>
                </Field>

                {/* SECTION */}

                <Field label="Section">
                  <select
                    value={sectionId}
                    onChange={(event) =>
                      setSectionId(
                        event.target.value
                      )
                    }
                    disabled={
                      !classId ||
                      sectionsLoading ||
                      saving
                    }
                    className={inputClass}
                  >
                    <option value="">
                      {!classId
                        ? "Select class first"
                        : sectionsLoading
                        ? "Loading sections..."
                        : sections.length ===
                          0
                        ? "No sections"
                        : "Select section"}
                    </option>

                    {sections.map(
                      (section) => (
                        <option
                          key={
                            section.id
                          }
                          value={
                            section.id
                          }
                        >
                          {section.name}
                        </option>
                      )
                    )}
                  </select>
                </Field>

              </div>
            </section>

            {/* ADDRESS */}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <h2 className="text-lg font-bold text-slate-900">
                Address
              </h2>

              <div className="mt-5 grid gap-5 md:grid-cols-2">

                <div className="md:col-span-2">
                  <Field label="Address">
                    <textarea
                      value={address}
                      onChange={(event) =>
                        setAddress(
                          event.target.value
                        )
                      }
                      rows={3}
                      className={inputClass}
                    />
                  </Field>
                </div>

                <Field label="City">
                  <input
                    value={city}
                    onChange={(event) =>
                      setCity(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="State">
                  <input
                    value={state}
                    onChange={(event) =>
                      setState(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Postal Code">
                  <input
                    value={postalCode}
                    onChange={(event) =>
                      setPostalCode(
                        event.target.value
                      )
                    }
                    className={inputClass}
                  />
                </Field>

              </div>
            </section>

            {/* NOTES */}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <Field label="Notes">

                <textarea
                  value={notes}
                  onChange={(event) =>
                    setNotes(
                      event.target.value
                    )
                  }
                  rows={4}
                  className={inputClass}
                />

              </Field>

            </section>

            {/* ACTIONS */}

            <div className="flex justify-end gap-3">

              <button
                type="button"
                onClick={() => {
                  if (student) {
                    fillForm(student);
                  }

                  setEditing(false);
                  setError("");
                }}
                className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white disabled:bg-blue-400"
              >
                {saving
                  ? "Saving..."
                  : "Save Changes"}
              </button>

            </div>

          </form>
        ) : (
          <div className="mt-6 space-y-6">

            {/* PROFILE */}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <div className="flex items-center gap-5">

                {student.photo_url ? (
                  <img
                    src={
                      student.photo_url
                    }
                    alt=""
                    className="h-20 w-20 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-50 text-2xl font-bold text-blue-600">
                    {student.first_name
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                )}

                <div>

                  <h2 className="text-xl font-bold text-slate-900">
                    {getStudentName(
                      student
                    )}
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Admission No:{" "}
                    {
                      student.admission_no
                    }
                  </p>

                  <div className="mt-2">
                    <StatusBadge
                      status={
                        student.status
                      }
                    />
                  </div>

                </div>

              </div>

            </section>

            {/* DETAILS */}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <h2 className="text-lg font-bold text-slate-900">
                Student Information
              </h2>

              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

                <Info
                  label="Admission Number"
                  value={
                    student.admission_no
                  }
                />

                <Info
                  label="Roll Number"
                  value={
                    student.roll_no ||
                    "—"
                  }
                />

                <Info
                  label="Gender"
                  value={
                    student.gender ||
                    "—"
                  }
                />

                <Info
                  label="Date of Birth"
                  value={formatDate(
                    student.date_of_birth
                  )}
                />

                <Info
                  label="Admission Date"
                  value={formatDate(
                    student.admission_date
                  )}
                />

                <Info
                  label="Blood Group"
                  value={
                    student.blood_group ||
                    "—"
                  }
                />

                <Info
                  label="Class"
                  value={
                    getClassName(
                      classes,
                      student.class_id
                    )
                  }
                />

                <Info
                  label="Section"
                  value={
                    getSectionName(
                      sections,
                      student.section_id
                    )
                  }
                />

              </div>

            </section>

            {/* ADDRESS */}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <h2 className="text-lg font-bold text-slate-900">
                Address
              </h2>

              <div className="mt-5">

                <p className="text-sm leading-6 text-slate-700">
                  {student.address ||
                    "No address provided."}
                </p>

                <p className="mt-2 text-sm text-slate-500">
                  {[
                    student.city,
                    student.state,
                    student.postal_code,
                  ]
                    .filter(Boolean)
                    .join(", ") ||
                    "No location provided."}
                </p>

              </div>

            </section>

            {/* NOTES */}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <h2 className="text-lg font-bold text-slate-900">
                Notes
              </h2>

              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {student.notes ||
                  "No notes."}
              </p>

            </section>

            {/* FEES */}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

              <h2 className="text-lg font-bold text-slate-900">
                Student Fees
              </h2>

              <p className="mt-2 text-sm text-slate-500">
                Manage this student's fees and payments.
              </p>

              <Link
                href={`/dashboard/students/${student.id}/fees`}
                className="mt-5 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Open Fees
              </Link>

            </section>

          </div>
        )}

      </div>
    </div>
  );
}

function getStudentName(
  student: Student
) {
  return [
    student.first_name,
    student.middle_name,
    student.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function getClassName(
  classes: SchoolClass[],
  classId: string | null
) {
  if (!classId) {
    return "—";
  }

  return (
    classes.find(
      (item) => item.id === classId
    )?.name || "—"
  );
}

function getSectionName(
  sections: Section[],
  sectionId: string | null
) {
  if (!sectionId) {
    return "—";
  }

  return (
    sections.find(
      (item) => item.id === sectionId
    )?.name || "—"
  );
}

function formatDate(
  value: string | null
) {
  if (!value) {
    return "—";
  }

  const date = new Date(
    `${value}T00:00:00`
  );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
}

function StatusBadge({
  status,
}: {
  status: StudentStatus;
}) {
  const styles: Record<
    StudentStatus,
    string
  > = {
    active:
      "bg-green-50 text-green-700 border-green-200",
    inactive:
      "bg-slate-100 text-slate-600 border-slate-200",
    transferred:
      "bg-yellow-50 text-yellow-700 border-yellow-200",
    completed:
      "bg-blue-50 text-blue-700 border-blue-200",
    alumni:
      "bg-purple-50 text-purple-700 border-purple-200",
  };

  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">

      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-2 text-sm font-semibold capitalize text-slate-800">
        {value}
      </p>

    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>

      <label className="mb-2 block text-sm font-semibold text-slate-700">

        {label}

        {required && (
          <span className="ml-1 text-red-500">
            *
          </span>
        )}

      </label>

      {children}

    </div>
  );
}