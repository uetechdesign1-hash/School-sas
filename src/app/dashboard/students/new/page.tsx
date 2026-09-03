"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function NewStudentPage() {
  const router = useRouter();

  const [admissionNo, setAdmissionNo] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [admissionDate, setAdmissionDate] = useState("");
  const [status, setStatus] =
    useState<StudentStatus>("active");
  const [bloodGroup, setBloodGroup] = useState("");

  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  const [classesLoading, setClassesLoading] =
    useState(true);
  const [sectionsLoading, setSectionsLoading] =
    useState(false);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadClasses();
  }, []);

  async function getSchoolId() {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/login";
      return null;
    }

    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from("school_users")
      .select("school_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
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

  async function loadClasses() {
    try {
      setClassesLoading(true);
      setError("");

      const supabase = createClient();
      const schoolId = await getSchoolId();

      if (!schoolId) {
        return;
      }

      const {
        data,
        error: classesError,
      } = await supabase
        .from("classes")
        .select(
          "id, name, display_order"
        )
        .eq("school_id", schoolId)
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
    } catch (error) {
      console.error(
        "LOAD CLASSES ERROR:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to load classes."
      );
    } finally {
      setClassesLoading(false);
    }
  }

  async function loadSections(
    selectedClassId: string
  ) {
    if (!selectedClassId) {
      setSections([]);
      return;
    }

    try {
      setSectionsLoading(true);
      setError("");

      const supabase = createClient();
      const schoolId = await getSchoolId();

      if (!schoolId) {
        return;
      }

      const {
        data,
        error: sectionsError,
      } = await supabase
        .from("sections")
        .select(
          "id, class_id, name"
        )
        .eq("school_id", schoolId)
        .eq("class_id", selectedClassId)
        .order("name", {
          ascending: true,
        });

      if (sectionsError) {
        throw sectionsError;
      }

      setSections(
        (data || []) as Section[]
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

      setSections([]);
    } finally {
      setSectionsLoading(false);
    }
  }

  async function handleClassChange(
    value: string
  ) {
    setClassId(value);

    // Section must belong to selected class.
    setSectionId("");
    setSections([]);

    if (value) {
      await loadSections(value);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

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

    setLoading(true);

    try {
      const supabase = createClient();

      const {
        data: { user },
      } =
        await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const {
        data: membership,
        error: membershipError,
      } = await supabase
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

      const student = {
        school_id:
          membership.school_id,

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
        error: insertError,
      } =
        await supabase
          .from("students")
          .insert(student);

      if (insertError) {
        throw insertError;
      }

      router.replace(
        "/dashboard/students"
      );

      router.refresh();
    } catch (error) {
      console.error(
        "CREATE STUDENT ERROR:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "Unable to create student."
      );

      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-5xl">

        {/* HEADER */}

        <div className="mb-6">
          <Link
            href="/dashboard/students"
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            ← Back to Students
          </Link>

          <h1 className="mt-3 text-3xl font-bold text-slate-900">
            Add Student
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Create a student record for your school.
          </p>
        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">
              {error}
            </p>
          </div>
        )}

        {/* FORM */}

        <form
          onSubmit={handleSubmit}
          className="space-y-6"
        >

          {/* BASIC INFORMATION */}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <h2 className="text-lg font-bold text-slate-900">
              Basic Information
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
                  placeholder="ADM-001"
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
                  placeholder="1"
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
                  placeholder="First name"
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
                  placeholder="Middle name"
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
                  placeholder="Last name"
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
                  placeholder="A+"
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
                    loading
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
                        {schoolClass.name}
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
                    loading
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
                        key={section.id}
                        value={section.id}
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
                    placeholder="Full address"
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
                  placeholder="City"
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
                  placeholder="State"
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
                  placeholder="Postal code"
                  className={inputClass}
                />
              </Field>

            </div>
          </section>

          {/* NOTES */}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

            <h2 className="text-lg font-bold text-slate-900">
              Notes
            </h2>

            <div className="mt-5">
              <textarea
                value={notes}
                onChange={(event) =>
                  setNotes(
                    event.target.value
                  )
                }
                rows={4}
                placeholder="Additional notes..."
                className={inputClass}
              />
            </div>

          </section>

          {/* ACTIONS */}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">

            <Link
              href="/dashboard/students"
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {loading
                ? "Saving..."
                : "Save Student"}
            </button>

          </div>

        </form>
      </div>
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