"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ClassRow = {
  id: string;
  school_id: string;
  name: string;
  display_order: number;
  created_at: string;
};

type SectionRow = {
  id: string;
  school_id: string;
  class_id: string;
  name: string;
  created_at: string;
};

export default function ClassesPage() {
  const supabase = createClient();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<Record<string, SectionRow[]>>({});

  const [schoolId, setSchoolId] = useState("");

  const [className, setClassName] = useState("");
  const [sectionNames, setSectionNames] = useState<Record<string, string>>(
    {}
  );

  const [loading, setLoading] = useState(true);
  const [savingClass, setSavingClass] = useState(false);
  const [savingSection, setSavingSection] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function loadSchoolAndClasses() {
    setLoading(true);
    setErrorMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setErrorMessage("Please log in again.");
        setLoading(false);
        return;
      }

      /*
       * Find the school belonging to this logged-in user.
       *
       * school_users connects:
       * user_id -> school_id
       */
      const { data: schoolUser, error: schoolUserError } = await supabase
        .from("school_users")
        .select("school_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (schoolUserError) {
        console.error(schoolUserError);
        setErrorMessage(schoolUserError.message);
        setLoading(false);
        return;
      }

      if (!schoolUser?.school_id) {
        setErrorMessage("No school is assigned to this account.");
        setLoading(false);
        return;
      }

      setSchoolId(schoolUser.school_id);

      const { data: classData, error: classError } = await supabase
        .from("classes")
        .select(
          "id, school_id, name, display_order, created_at"
        )
        .eq("school_id", schoolUser.school_id)
        .order("display_order", {
          ascending: true,
        })
        .order("name", {
          ascending: true,
        });

      if (classError) {
        console.error(classError);
        setErrorMessage(classError.message);
        setLoading(false);
        return;
      }

      const loadedClasses = classData ?? [];

      setClasses(loadedClasses);

      if (loadedClasses.length === 0) {
        setSections({});
        setLoading(false);
        return;
      }

      const classIds = loadedClasses.map((item) => item.id);

      const { data: sectionData, error: sectionError } = await supabase
        .from("sections")
        .select(
          "id, school_id, class_id, name, created_at"
        )
        .eq("school_id", schoolUser.school_id)
        .in("class_id", classIds)
        .order("name", {
          ascending: true,
        });

      if (sectionError) {
        console.error(sectionError);
        setErrorMessage(sectionError.message);
        setLoading(false);
        return;
      }

      const grouped: Record<string, SectionRow[]> = {};

      for (const section of sectionData ?? []) {
        if (!grouped[section.class_id]) {
          grouped[section.class_id] = [];
        }

        grouped[section.class_id].push(section);
      }

      setSections(grouped);
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Unable to load classes.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSchoolAndClasses();
  }, []);

  async function handleCreateClass(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    const trimmedName = className.trim();

    if (!trimmedName) {
      setErrorMessage("Please enter a class name.");
      return;
    }

    if (!schoolId) {
      setErrorMessage("School information is not available.");
      return;
    }

    setSavingClass(true);

    try {
      const nextDisplayOrder =
        classes.length > 0
          ? Math.max(
              ...classes.map(
                (item) => item.display_order ?? 0
              )
            ) + 1
          : 1;

      const { data, error } = await supabase
        .from("classes")
        .insert({
          school_id: schoolId,
          name: trimmedName,
          display_order: nextDisplayOrder,
        })
        .select(
          "id, school_id, name, display_order, created_at"
        )
        .single();

      if (error) {
        console.error(error);
        setErrorMessage(error.message);
        return;
      }

      if (!data) {
        setErrorMessage("Class was not created.");
        return;
      }

      setClasses((current) => [...current, data]);

      setSections((current) => ({
        ...current,
        [data.id]: [],
      }));

      setClassName("");

      setSuccessMessage(
        `${data.name} created successfully.`
      );
    } catch (error) {
      console.error(error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create class."
      );
    } finally {
      setSavingClass(false);
    }
  }

  async function handleCreateSection(
    event: FormEvent<HTMLFormElement>,
    classId: string
  ) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    const name = (sectionNames[classId] ?? "").trim();

    if (!name) {
      setErrorMessage("Please enter a section name.");
      return;
    }

    if (!schoolId) {
      setErrorMessage("School information is not available.");
      return;
    }

    setSavingSection(classId);

    try {
      const { data, error } = await supabase
        .from("sections")
        .insert({
          school_id: schoolId,
          class_id: classId,
          name,
        })
        .select(
          "id, school_id, class_id, name, created_at"
        )
        .single();

      if (error) {
        console.error(error);
        setErrorMessage(error.message);
        return;
      }

      if (!data) {
        setErrorMessage("Section was not created.");
        return;
      }

      setSections((current) => ({
        ...current,
        [classId]: [
          ...(current[classId] ?? []),
          data,
        ],
      }));

      setSectionNames((current) => ({
        ...current,
        [classId]: "",
      }));

      setSuccessMessage(
        `${data.name} added successfully.`
      );
    } catch (error) {
      console.error(error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create section."
      );
    } finally {
      setSavingSection(null);
    }
  }

  async function handleDeleteSection(
    section: SectionRow
  ) {
    const confirmed = window.confirm(
      `Delete section "${section.name}"?`
    );

    if (!confirmed) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");

    const { error } = await supabase
      .from("sections")
      .delete()
      .eq("id", section.id);

    if (error) {
      console.error(error);
      setErrorMessage(error.message);
      return;
    }

    setSections((current) => ({
      ...current,
      [section.class_id]: (
        current[section.class_id] ?? []
      ).filter(
        (item) => item.id !== section.id
      ),
    }));

    setSuccessMessage(
      `${section.name} deleted.`
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm text-slate-500">
              Loading classes...
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Classes & Sections
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Create classes and organize students into sections.
          </p>
        </div>

        {/* Messages */}
        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">
              {errorMessage}
            </p>
          </div>
        )}

        {successMessage && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm font-medium text-green-700">
              {successMessage}
            </p>
          </div>
        )}

        {/* Create class */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

          <h2 className="text-xl font-bold text-slate-900">
            Add Class
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Example: Class 1, Class 2, Class 10.
          </p>

          <form
            onSubmit={handleCreateClass}
            className="mt-5 flex flex-col gap-3 sm:flex-row"
          >
            <input
              value={className}
              onChange={(event) =>
                setClassName(event.target.value)
              }
              placeholder="Enter class name"
              disabled={savingClass}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
            />

            <button
              type="submit"
              disabled={savingClass}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {savingClass
                ? "Creating..."
                : "Create Class"}
            </button>
          </form>
        </section>

        {/* Classes */}
        <section className="space-y-4">

          {classes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <h3 className="text-lg font-semibold text-slate-900">
                No classes yet
              </h3>

              <p className="mt-2 text-sm text-slate-500">
                Create your first class above.
              </p>
            </div>
          ) : (
            classes.map((classItem) => {
              const classSections =
                sections[classItem.id] ?? [];

              return (
                <div
                  key={classItem.id}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >

                  {/* Class header */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

                    <div>
                      <h2 className="text-xl font-bold text-slate-900">
                        {classItem.name}
                      </h2>

                      <p className="mt-1 text-xs text-slate-500">
                        {classSections.length}{" "}
                        {classSections.length === 1
                          ? "section"
                          : "sections"}
                      </p>
                    </div>

                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                      Class
                    </span>

                  </div>

                  {/* Sections */}
                  <div className="mt-5">

                    <h3 className="text-sm font-semibold text-slate-700">
                      Sections
                    </h3>

                    {classSections.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {classSections.map(
                          (section) => (
                            <div
                              key={section.id}
                              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                            >
                              <span className="text-sm font-medium text-slate-800">
                                {section.name}
                              </span>

                              <button
                                type="button"
                                onClick={() =>
                                  handleDeleteSection(
                                    section
                                  )
                                }
                                className="text-xs font-semibold text-red-500 hover:text-red-700"
                              >
                                Delete
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {/* Add section */}
                    <form
                      onSubmit={(event) =>
                        handleCreateSection(
                          event,
                          classItem.id
                        )
                      }
                      className="mt-4 flex flex-col gap-3 sm:flex-row"
                    >
                      <input
                        value={
                          sectionNames[
                            classItem.id
                          ] ?? ""
                        }
                        onChange={(event) =>
                          setSectionNames(
                            (current) => ({
                              ...current,
                              [classItem.id]:
                                event.target.value,
                            })
                          )
                        }
                        placeholder="Section name e.g. A"
                        disabled={
                          savingSection ===
                          classItem.id
                        }
                        className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
                      />

                      <button
                        type="submit"
                        disabled={
                          savingSection ===
                          classItem.id
                        }
                        className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingSection ===
                        classItem.id
                          ? "Adding..."
                          : "+ Add Section"}
                      </button>
                    </form>

                  </div>
                </div>
              );
            })
          )}

        </section>

      </div>
    </main>
  );
}