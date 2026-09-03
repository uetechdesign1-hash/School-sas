"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type StudentStatus =
  | "active"
  | "inactive"
  | "transferred"
  | "completed"
  | "alumni";

type Student = {
  id: string;
  school_id: string;
  admission_no: string;
  roll_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  gender: "male" | "female" | "other" | null;
  class_id: string | null;
  section_id: string | null;
  status: StudentStatus;
  photo_url: string | null;
  city: string | null;
};

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

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [classId, setClassId] = useState("all");
  const [sectionId, setSectionId] = useState("all");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadStudents();
  }, []);

  async function loadStudents() {
    try {
      setLoading(true);
      setError("");

      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.assign("/login");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
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
        throw new Error("Your account is not assigned to a school.");
      }

      const schoolId = membership.school_id;

      const [studentsResult, classesResult] = await Promise.all([
        supabase
          .from("students")
          .select(
            `
              id,
              school_id,
              admission_no,
              roll_no,
              first_name,
              middle_name,
              last_name,
              gender,
              class_id,
              section_id,
              status,
              photo_url,
              city
            `,
          )
          .eq("school_id", schoolId)
          .order("created_at", { ascending: false }),

        supabase
          .from("classes")
          .select("id, name, display_order")
          .eq("school_id", schoolId)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true }),
      ]);

      if (studentsResult.error) {
        throw studentsResult.error;
      }

      if (classesResult.error) {
        throw classesResult.error;
      }

      const loadedClasses = (classesResult.data || []) as SchoolClass[];
      setStudents((studentsResult.data || []) as Student[]);
      setClasses(loadedClasses);

      if (loadedClasses.length > 0) {
        const { data: sectionsData, error: sectionsError } = await supabase
          .from("sections")
          .select("id, class_id, name")
          .in(
            "class_id",
            loadedClasses.map((item) => item.id),
          )
          .order("name", { ascending: true });

        if (sectionsError) {
          throw sectionsError;
        }

        setSections((sectionsData || []) as Section[]);
      } else {
        setSections([]);
      }
    } catch (error) {
      console.error("STUDENTS ERROR:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Unable to load students.",
      );
    } finally {
      setLoading(false);
    }
  }

  const classMap = useMemo(() => {
    return new Map(classes.map((item) => [item.id, item]));
  }, [classes]);

  const sectionMap = useMemo(() => {
    return new Map(sections.map((item) => [item.id, item]));
  }, [sections]);

  const filteredSections = useMemo(() => {
    if (classId === "all") {
      return sections;
    }

    return sections.filter((section) => section.class_id === classId);
  }, [sections, classId]);

  useEffect(() => {
    if (
      sectionId !== "all" &&
      !filteredSections.some((section) => section.id === sectionId)
    ) {
      setSectionId("all");
    }
  }, [filteredSections, sectionId]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return students.filter((student) => {
      const fullName = [
        student.first_name,
        student.middle_name,
        student.last_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query ||
        fullName.includes(query) ||
        student.admission_no.toLowerCase().includes(query) ||
        (student.roll_no || "").toLowerCase().includes(query);

      const matchesStatus =
        status === "all" || student.status === status;

      const matchesClass =
        classId === "all" || student.class_id === classId;

      const matchesSection =
        sectionId === "all" || student.section_id === sectionId;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesClass &&
        matchesSection
      );
    });
  }, [students, search, status, classId, sectionId]);

  const activeCount = students.filter(
    (student) => student.status === "active",
  ).length;

  const inactiveCount = students.filter(
    (student) => student.status === "inactive",
  ).length;

  async function deleteStudent(student: Student) {
    const confirmed = window.confirm(
      `Delete ${getStudentName(student)}? This action cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const supabase = createClient();

      const { error: deleteError } = await supabase
        .from("students")
        .delete()
        .eq("id", student.id)
        .eq("school_id", student.school_id);

      if (deleteError) {
        throw deleteError;
      }

      setStudents((current) =>
        current.filter((item) => item.id !== student.id),
      );
    } catch (error) {
      console.error("DELETE STUDENT ERROR:", error);

      alert(
        error instanceof Error
          ? error.message
          : "Unable to delete student.",
      );
    }
  }

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setClassId("all");
    setSectionId("all");
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">School Management</p>

            <h1 className="mt-1 text-3xl font-bold text-slate-900">
              Students
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Manage students belonging to your school.
            </p>
          </div>

          <Link
            href="/dashboard/students/new"
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            + Add Student
          </Link>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat title="Total Students" value={students.length} />
          <Stat title="Active" value={activeCount} />
          <Stat title="Inactive" value={inactiveCount} />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, admission no. or roll no."
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            />

            <select
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSectionId("all");
              }}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">All Classes</option>

              {classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.name}
                </option>
              ))}
            </select>

            <select
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
              disabled={classId === "all" && sections.length === 0}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
            >
              <option value="all">
                {classId === "all"
                  ? "All Sections"
                  : "All Sections in Selected Class"}
              </option>

              {filteredSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>

            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="transferred">Transferred</option>
              <option value="completed">Completed</option>
              <option value="alumni">Alumni</option>
            </select>
          </div>

          {(search ||
            status !== "all" ||
            classId !== "all" ||
            sectionId !== "all") && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Showing {filteredStudents.length} of {students.length}{" "}
                students
              </p>

              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-semibold text-red-800">
              Unable to load students
            </p>

            <p className="mt-1 text-sm text-red-700">{error}</p>

            <button
              type="button"
              onClick={() => void loadStudents()}
              className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Try Again
            </button>
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-10 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

              <p className="mt-3 text-sm text-slate-500">
                Loading students...
              </p>
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
                👨‍🎓
              </div>

              <h2 className="mt-4 text-lg font-bold text-slate-900">
                No students found
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {students.length === 0
                  ? "Add your first student to get started."
                  : "Try changing your search or filters."}
              </p>

              {students.length === 0 ? (
                <Link
                  href="/dashboard/students/new"
                  className="mt-5 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
                >
                  + Add Student
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-5 rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700"
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Student
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Admission No.
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Roll No.
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Class
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Section
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Gender
                    </th>

                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Status
                    </th>

                    <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredStudents.map((student) => {
                    const schoolClass = student.class_id
                      ? classMap.get(student.class_id)
                      : null;

                    const section = student.section_id
                      ? sectionMap.get(student.section_id)
                      : null;

                    return (
                      <tr
                        key={student.id}
                        className="transition hover:bg-slate-50"
                      >
                        <td className="px-5 py-4">
                          <Link
                            href={`/dashboard/students/${student.id}`}
                            className="flex items-center gap-3"
                          >
                            {student.photo_url ? (
                              <img
                                src={student.photo_url}
                                alt=""
                                className="h-10 w-10 rounded-xl object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 font-bold text-blue-600">
                                {student.first_name
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}

                            <div>
                              <p className="font-semibold text-slate-900">
                                {getStudentName(student)}
                              </p>

                              <p className="text-xs text-slate-500">
                                {student.city || "No city"}
                              </p>
                            </div>
                          </Link>
                        </td>

                        <td className="px-5 py-4 text-sm font-medium text-slate-700">
                          {student.admission_no}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {student.roll_no || "—"}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {schoolClass?.name || "—"}
                        </td>

                        <td className="px-5 py-4 text-sm text-slate-600">
                          {section?.name || "—"}
                        </td>

                        <td className="px-5 py-4 text-sm capitalize text-slate-600">
                          {student.gender || "—"}
                        </td>

                        <td className="px-5 py-4">
                          <StatusBadge status={student.status} />
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <Link
                              href={`/dashboard/students/${student.id}`}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              View
                            </Link>

                            <Link
                              href={`/dashboard/students/${student.id}`}
                              className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                            >
                              Edit
                            </Link>

                            <button
                              type="button"
                              onClick={() => void deleteStudent(student)}
                              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getStudentName(student: Student) {
  return [
    student.first_name,
    student.middle_name,
    student.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function StatusBadge({ status }: { status: StudentStatus }) {
  const styles: Record<StudentStatus, string> = {
    active: "bg-green-50 text-green-700 border-green-200",
    inactive: "bg-slate-100 text-slate-600 border-slate-200",
    transferred: "bg-yellow-50 text-yellow-700 border-yellow-200",
    completed: "bg-blue-50 text-blue-700 border-blue-200",
    alumni: "bg-purple-50 text-purple-700 border-purple-200",
  };

  return (
    <span
      className={
        "rounded-full border px-3 py-1 text-xs font-semibold capitalize " +
        styles[status]
      }
    >
      {status}
    </span>
  );
}

function Stat({
  title,
  value,
}: {
  title: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{title}</p>

      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}