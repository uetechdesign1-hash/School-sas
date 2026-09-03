"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  IndianRupee,
  Search,
  UserRound,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type ClassRow = {
  id: string;
  school_id: string;
  name: string;
  display_order: number | null;
};

type SectionRow = {
  id: string;
  school_id: string;
  class_id: string;
  name: string;
};

type StudentRow = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  admission_no: string;
  roll_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  class_id: string | null;
  section_id: string | null;
  status: string | null;
};

/*
|--------------------------------------------------------------------------
| Main dynamic module page
|--------------------------------------------------------------------------
*/

export default function ModulePage() {
  const params = useParams();

  const module =
    typeof params?.module === "string"
      ? params.module
      : "";

  /*
   * Fees gets the real fee collection screen.
   */
  if (module === "fees") {
    return <FeesCollectionPage />;
  }

  const modules: Record<
    string,
    {
      title: string;
      description: string;
    }
  > = {
    attendance: {
      title: "Attendance",
      description:
        "Manage daily student attendance.",
    },

    expenses: {
      title: "Expenses",
      description:
        "Record and manage school expenses.",
    },

    "cash-book": {
      title: "Cash Book",
      description:
        "View and manage cash transactions.",
    },

    "bank-book": {
      title: "Bank Book",
      description:
        "View and manage bank transactions.",
    },

    staff: {
      title: "Staff",
      description:
        "Manage school staff members.",
    },

    reports: {
      title: "Reports",
      description:
        "View school management reports.",
    },
  };

  const info = modules[module];

  if (!info) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <h1 className="text-2xl font-bold text-slate-900">
            Page Not Found
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            This school module does not exist.
          </p>

          <Link
            href="/dashboard"
            className="mt-5 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mx-auto max-w-6xl">

        <div className="rounded-3xl bg-blue-600 p-8 text-white shadow-lg">
          <p className="text-sm text-blue-100">
            School Management
          </p>

          <h1 className="mt-2 text-3xl font-bold">
            {info.title}
          </h1>

          <p className="mt-2 text-blue-100">
            {info.description}
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">

          <div className="rounded-2xl bg-slate-50 p-8 text-center">

            <h2 className="text-xl font-bold text-slate-900">
              {info.title}
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              This module is ready.
            </p>

            <p className="mt-1 text-xs text-slate-400">
              We will connect this module to your
              actual school database.
            </p>

          </div>

          <Link
            href="/dashboard"
            className="mt-6 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            ← Back to Dashboard
          </Link>

        </div>
      </div>
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| Fees Collection
|--------------------------------------------------------------------------
|
| Database relationships:
|
| students.class_id   -> classes.id
| students.section_id -> sections.id
| sections.class_id   -> classes.id
|
| Every query is additionally restricted by school_id.
|
*/

function FeesCollectionPage() {
  const [classes, setClasses] =
    useState<ClassRow[]>([]);

  const [sections, setSections] =
    useState<SectionRow[]>([]);

  const [students, setStudents] =
    useState<StudentRow[]>([]);

  const [selectedClass, setSelectedClass] =
    useState("");

  const [selectedSection, setSelectedSection] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  /*
   * --------------------------------------------------------
   * LOAD SCHOOL + CLASSES + SECTIONS + STUDENTS
   * --------------------------------------------------------
   */

  useEffect(() => {
    let mounted = true;

    async function loadFeesPage() {
      const supabase = createClient();

      try {
        setLoading(true);
        setError("");

        /*
         * Current authenticated user
         */

        const {
          data: {
            user,
          },
          error: userError,
        } =
          await supabase.auth.getUser();

        if (userError) {
          throw userError;
        }

        if (!user) {
          window.location.href =
            "/login";
          return;
        }

        /*
         * Current school
         */

        const {
          data: membership,
          error: membershipError,
        } =
          await supabase
            .from("school_users")
            .select(
              "school_id, role, is_active",
            )
            .eq(
              "user_id",
              user.id,
            )
            .eq(
              "is_active",
              true,
            )
            .limit(1)
            .maybeSingle();

        if (membershipError) {
          throw membershipError;
        }

        if (!membership?.school_id) {
          throw new Error(
            "Your account is not assigned to a school.",
          );
        }

        const schoolId =
          membership.school_id;

        /*
         * --------------------------------------------------
         * LOAD CLASSES
         * --------------------------------------------------
         */

        const {
          data: classData,
          error: classError,
        } =
          await supabase
            .from("classes")
            .select(
              `
                id,
                school_id,
                name,
                display_order
              `,
            )
            .eq(
              "school_id",
              schoolId,
            )
            .order(
              "display_order",
              {
                ascending: true,
              },
            )
            .order(
              "name",
              {
                ascending: true,
              },
            );

        if (classError) {
          throw classError;
        }

        /*
         * --------------------------------------------------
         * LOAD SECTIONS
         * --------------------------------------------------
         */

        const {
          data: sectionData,
          error: sectionError,
        } =
          await supabase
            .from("sections")
            .select(
              `
                id,
                school_id,
                class_id,
                name
              `,
            )
            .eq(
              "school_id",
              schoolId,
            )
            .order(
              "name",
              {
                ascending: true,
              },
            );

        if (sectionError) {
          throw sectionError;
        }

        /*
         * --------------------------------------------------
         * LOAD STUDENTS
         * --------------------------------------------------
         */

        const {
          data: studentData,
          error: studentError,
        } =
          await supabase
            .from("students")
            .select(
              `
                id,
                school_id,
                academic_year_id,
                admission_no,
                roll_no,
                first_name,
                middle_name,
                last_name,
                class_id,
                section_id,
                status
              `,
            )
            .eq(
              "school_id",
              schoolId,
            )
            .order(
              "first_name",
              {
                ascending: true,
              },
            );

        if (studentError) {
          throw studentError;
        }

        if (!mounted) {
          return;
        }

        setClasses(
          (classData ||
            []) as ClassRow[],
        );

        setSections(
          (sectionData ||
            []) as SectionRow[],
        );

        setStudents(
          (studentData ||
            []) as StudentRow[],
        );
      } catch (err) {
        console.error(
          "FEES PAGE LOADING ERROR:",
          err,
        );

        if (!mounted) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load fee collection data.",
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadFeesPage();

    return () => {
      mounted = false;
    };
  }, []);

  /*
   * --------------------------------------------------------
   * CLASS DROPDOWN
   * --------------------------------------------------------
   */

  const classOptions = useMemo(() => {
    return classes;
  }, [classes]);

  /*
   * --------------------------------------------------------
   * SECTION DROPDOWN
   *
   * If Class 1 is selected:
   *
   * sections where section.class_id === Class 1
   *
   * --------------------------------------------------------
   */

  const sectionOptions =
    useMemo(() => {
      if (!selectedClass) {
        return sections;
      }

      return sections.filter(
        (section) =>
          section.class_id ===
          selectedClass,
      );
    }, [
      sections,
      selectedClass,
    ]);

  /*
   * --------------------------------------------------------
   * RESET SECTION WHEN CLASS CHANGES
   * --------------------------------------------------------
   */

  useEffect(() => {
    if (!selectedSection) {
      return;
    }

    const sectionStillValid =
      sectionOptions.some(
        (section) =>
          section.id ===
          selectedSection,
      );

    if (!sectionStillValid) {
      setSelectedSection("");
    }
  }, [
    selectedSection,
    sectionOptions,
  ]);

  /*
   * --------------------------------------------------------
   * STUDENT FILTERING
   * --------------------------------------------------------
   */

  const filteredStudents =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      return students.filter(
        (student) => {
          /*
           * Search
           */

          const fullName = [
            student.first_name,
            student.middle_name,
            student.last_name,
          ]
            .filter(Boolean)
            .join(" ")
            .trim();

          const matchesSearch =
            !query ||
            fullName
              .toLowerCase()
              .includes(query) ||
            student.admission_no
              .toLowerCase()
              .includes(query) ||
            String(
              student.roll_no ||
              "",
            )
              .toLowerCase()
              .includes(query);

          /*
           * Class
           */

          const matchesClass =
            !selectedClass ||
            student.class_id ===
              selectedClass;

          /*
           * Section
           */

          const matchesSection =
            !selectedSection ||
            student.section_id ===
              selectedSection;

          return (
            matchesSearch &&
            matchesClass &&
            matchesSection
          );
        },
      );
    }, [
      students,
      search,
      selectedClass,
      selectedSection,
    ]);

  /*
   * --------------------------------------------------------
   * DISPLAY HELPERS
   * --------------------------------------------------------
   */

  function getStudentName(
    student: StudentRow,
  ) {
    return [
      student.first_name,
      student.middle_name,
      student.last_name,
    ]
      .filter(
        (
          value,
        ) =>
          value &&
          value.trim(),
      )
      .join(" ")
      .trim() || "Unnamed Student";
  }

  function getClassName(
    classId: string | null,
  ) {
    if (!classId) {
      return "—";
    }

    return (
      classes.find(
        (item) =>
          item.id === classId,
      )?.name || "—"
    );
  }

  function getSectionName(
    sectionId: string | null,
  ) {
    if (!sectionId) {
      return "—";
    }

    return (
      sections.find(
        (item) =>
          item.id === sectionId,
      )?.name || "—"
    );
  }

  /*
   * --------------------------------------------------------
   * PAGE
   * --------------------------------------------------------
   */

  return (
    <div className="min-h-full bg-slate-50">

      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">

        {/* HEADER */}

        <div className="mb-6">

          <p className="text-sm font-medium text-slate-500">
            Dashboard / Fees
          </p>

          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Fees
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Search students, view bills, record payments
            and download receipts.
          </p>

        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">

            <p className="text-sm font-semibold text-red-700">
              Unable to load fee collection
            </p>

            <p className="mt-1 text-sm text-red-600">
              {error}
            </p>

          </div>
        )}

        {/* FIND STUDENT */}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

          {/* TITLE */}

          <div className="mb-5 flex items-center gap-3">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <UserRound size={19} />
            </div>

            <div>

              <h2 className="font-bold text-slate-900">
                Find Student
              </h2>

              <p className="text-xs text-slate-500">
                Filter by class and section or search by
                student details.
              </p>

            </div>

          </div>

          {/* FILTER ROW */}

          <div className="grid gap-4 md:grid-cols-2">

            {/* CLASS */}

            <div>

              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                Class
              </label>

              <select
                value={selectedClass}
                onChange={(event) =>
                  setSelectedClass(
                    event.target.value,
                  )
                }
                disabled={loading}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              >

                <option value="">
                  All Classes
                </option>

                {classOptions.map(
                  (classItem) => (
                    <option
                      key={
                        classItem.id
                      }
                      value={
                        classItem.id
                      }
                    >
                      {
                        classItem.name
                      }
                    </option>
                  ),
                )}

              </select>

            </div>

            {/* SECTION */}

            <div>

              <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                Section
              </label>

              <select
                value={selectedSection}
                onChange={(event) =>
                  setSelectedSection(
                    event.target.value,
                  )
                }
                disabled={
                  loading ||
                  sectionOptions.length ===
                    0
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
              >

                <option value="">
                  All Sections
                </option>

                {sectionOptions.map(
                  (section) => (
                    <option
                      key={
                        section.id
                      }
                      value={
                        section.id
                      }
                    >
                      {
                        section.name
                      }
                    </option>
                  ),
                )}

              </select>

            </div>

          </div>

          {/* SEARCH */}

          <div className="relative mt-4">

            <Search
              size={19}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value,
                )
              }
              placeholder="Search by student name, admission number or roll number..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />

          </div>

          {/* CLEAR */}

          {(selectedClass ||
            selectedSection ||
            search) && (
            <div className="mt-3 flex justify-end">

              <button
                type="button"
                onClick={() => {
                  setSelectedClass("");
                  setSelectedSection("");
                  setSearch("");
                }}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Clear Filters
              </button>

            </div>
          )}

          {/* LOADING */}

          {loading && (
            <div className="mt-5 rounded-xl bg-slate-50 p-8 text-center">

              <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

              <p className="text-sm text-slate-500">
                Loading students...
              </p>

            </div>
          )}

          {/* COUNT */}

          {!loading &&
            !error && (
              <div className="mb-2 mt-5 flex items-center justify-between">

                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Students
                </p>

                <p className="text-xs font-semibold text-slate-500">
                  {
                    filteredStudents.length
                  }{" "}
                  found
                </p>

              </div>
            )}

          {/* STUDENT LIST */}

          {!loading &&
            filteredStudents.length >
              0 && (
              <div className="overflow-hidden rounded-xl border border-slate-200">

                {filteredStudents.map(
                  (student) => {
                    const studentName =
                      getStudentName(
                        student,
                      );

                    const className =
                      getClassName(
                        student.class_id,
                      );

                    const sectionName =
                      getSectionName(
                        student.section_id,
                      );

                    return (
                      <Link
                        key={
                          student.id
                        }
                        href={`/dashboard/students/${student.id}/fees`}
                        className="group flex items-center justify-between gap-4 border-b border-slate-100 bg-white px-4 py-4 transition last:border-b-0 hover:bg-blue-50"
                      >

                        {/* STUDENT */}

                        <div className="flex min-w-0 items-center gap-3">

                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-600">

                            {studentName
                              .charAt(
                                0,
                              )
                              .toUpperCase()}

                          </div>

                          <div className="min-w-0">

                            <p className="truncate text-sm font-bold text-slate-900">
                              {
                                studentName
                              }
                            </p>

                            <p className="mt-1 text-xs text-slate-500">

                              Admission:{" "}

                              <span className="font-semibold text-slate-700">
                                {
                                  student.admission_no
                                }
                              </span>

                              {" • "}

                              Roll:{" "}

                              <span className="font-semibold text-slate-700">
                                {
                                  student.roll_no ||
                                  "—"
                                }
                              </span>

                            </p>

                          </div>

                        </div>

                        {/* CLASS / SECTION / OPEN */}

                        <div className="flex shrink-0 items-center gap-4">

                          <div className="text-right">

                            <p className="text-xs font-semibold text-slate-700">
                              {
                                className
                              }
                            </p>

                            <p className="mt-0.5 text-xs text-slate-500">

                              {sectionName !==
                              "—"
                                ? `Section ${sectionName}`
                                : "No section"}

                            </p>

                          </div>

                          <span className="hidden rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white sm:block">
                            Open Fees
                          </span>

                          <ArrowRight
                            size={18}
                            className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600"
                          />

                        </div>

                      </Link>
                    );
                  },
                )}

              </div>
            )}

          {/* NO RESULTS */}

          {!loading &&
            !error &&
            filteredStudents.length ===
              0 && (
              <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">

                <p className="text-sm font-semibold text-slate-700">
                  No students found
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  Try changing the class, section or
                  search filter.
                </p>

              </div>
            )}

        </section>

        {/* FEE STRUCTURE */}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

            <div>

              <h2 className="font-bold text-slate-900">
                Fee Structure
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Create and manage class-wise fee
                structures separately.
              </p>

            </div>

            <Link
              href="/dashboard/fees/structure"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-100"
            >
              Manage Fee Structure
              <ArrowRight size={16} />
            </Link>

          </div>

        </section>

      </div>
    </div>
  );
}