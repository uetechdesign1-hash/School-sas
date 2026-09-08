"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Edit3,
  Plus,
  Save,
  Star,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type AcademicYear = {
  id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  created_at: string;
};

type FormState = {
  name: string;
  start_date: string;
  end_date: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  start_date: "",
  end_date: "",
};

export default function AcademicYearsPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingCurrent, setSettingCurrent] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    void loadAcademicYears();
  }, []);

  async function getSchoolId() {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.assign("/login");
      return null;
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

    return membership.school_id as string;
  }

  async function loadAcademicYears() {
    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const supabase = createClient();

      const resolvedSchoolId = await getSchoolId();

      if (!resolvedSchoolId) {
        return;
      }

      setSchoolId(resolvedSchoolId);

      const { data, error: yearsError } = await supabase
        .from("academic_years")
        .select(
          "id, school_id, name, start_date, end_date, is_current, created_at",
        )
        .eq("school_id", resolvedSchoolId)
        .order("start_date", { ascending: false });

      if (yearsError) {
        throw yearsError;
      }

      setYears((data || []) as AcademicYear[]);
    } catch (loadError) {
      console.error("ACADEMIC YEARS ERROR:", loadError);

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load academic years.",
      );
    } finally {
      setLoading(false);
    }
  }

  function openAddForm() {
    setEditingYear(null);
    setForm(EMPTY_FORM);
    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function openEditForm(year: AcademicYear) {
    setEditingYear(year);

    setForm({
      name: year.name,
      start_date: year.start_date,
      end_date: year.end_date,
    });

    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) {
      return;
    }

    setShowForm(false);
    setEditingYear(null);
    setForm(EMPTY_FORM);
  }

  async function saveAcademicYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const name = form.name.trim();

      if (!name) {
        throw new Error("Academic year name is required.");
      }

      if (!form.start_date) {
        throw new Error("Start date is required.");
      }

      if (!form.end_date) {
        throw new Error("End date is required.");
      }

      if (form.end_date < form.start_date) {
        throw new Error("End date cannot be before start date.");
      }

      if (!schoolId) {
        throw new Error("School could not be identified.");
      }

      const supabase = createClient();

      if (editingYear) {
        const { data: duplicate } = await supabase
          .from("academic_years")
          .select("id")
          .eq("school_id", schoolId)
          .ilike("name", name)
          .neq("id", editingYear.id)
          .limit(1)
          .maybeSingle();

        if (duplicate) {
          throw new Error(
            "An academic year with this name already exists.",
          );
        }

        const { error: updateError } = await supabase
          .from("academic_years")
          .update({
            name,
            start_date: form.start_date,
            end_date: form.end_date,
          })
          .eq("id", editingYear.id)
          .eq("school_id", schoolId);

        if (updateError) {
          throw updateError;
        }

        setSuccess("Academic year updated successfully.");
      } else {
        const { data: duplicate } = await supabase
          .from("academic_years")
          .select("id")
          .eq("school_id", schoolId)
          .ilike("name", name)
          .limit(1)
          .maybeSingle();

        if (duplicate) {
          throw new Error(
            "An academic year with this name already exists.",
          );
        }

        const { error: insertError } = await supabase
          .from("academic_years")
          .insert({
            school_id: schoolId,
            name,
            start_date: form.start_date,
            end_date: form.end_date,
            is_current: false,
          });

        if (insertError) {
          throw insertError;
        }

        setSuccess("Academic year created successfully.");
      }

      setShowForm(false);
      setEditingYear(null);
      setForm(EMPTY_FORM);

      await loadAcademicYears();
    } catch (saveError) {
      console.error("SAVE ACADEMIC YEAR ERROR:", saveError);

      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save academic year.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function setAsCurrent(year: AcademicYear) {
    const confirmed = window.confirm(
      `Set "${year.name}" as the current academic year?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setSettingCurrent(year.id);
      setError("");
      setSuccess("");

      const supabase = createClient();

      const { error: rpcError } = await supabase.rpc(
        "set_academic_year_current",
        {
          p_school_id: schoolId,
          p_academic_year_id: year.id,
        },
      );

      if (rpcError) {
        throw rpcError;
      }

      setSuccess(`"${year.name}" is now the current academic year.`);

      await loadAcademicYears();
    } catch (currentError) {
      console.error("SET CURRENT ACADEMIC YEAR ERROR:", currentError);

      setError(
        currentError instanceof Error
          ? currentError.message
          : "Unable to set current academic year.",
      );
    } finally {
      setSettingCurrent(null);
    }
  }

  const currentYear = useMemo(
    () => years.find((year) => year.is_current),
    [years],
  );

  const previousYears = useMemo(
    () =>
      years.filter(
        (year) =>
          !year.is_current &&
          new Date(year.end_date) < new Date(),
      ),
    [years],
  );

  const upcomingYears = useMemo(
    () =>
      years.filter(
        (year) =>
          !year.is_current &&
          new Date(year.start_date) > new Date(),
      ),
    [years],
  );

  return (
    <div className="min-h-full bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        {/* HEADER */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">
              School Management
            </p>

            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              Academic Years
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Manage your school&apos;s academic years and current session.
            </p>
          </div>

          <button
            type="button"
            onClick={openAddForm}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus size={18} />
            Add Academic Year
          </button>
        </div>

        {/* MESSAGES */}
        {error && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">
              {error}
            </p>
          </div>
        )}

        {success && (
          <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2
                size={18}
                className="text-green-600"
              />

              <p className="text-sm font-semibold text-green-800">
                {success}
              </p>
            </div>
          </div>
        )}

        {/* CURRENT YEAR */}
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <Star size={18} className="text-amber-500" />

            <h2 className="text-lg font-bold text-slate-900">
              Current Academic Year
            </h2>
          </div>

          {loading ? (
            <LoadingCard />
          ) : currentYear ? (
            <div className="overflow-hidden rounded-3xl border border-blue-200 bg-blue-600 p-6 text-white shadow-lg">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wide">
                    <CheckCircle2 size={14} />
                    Current
                  </div>

                  <h3 className="mt-4 text-3xl font-bold">
                    {currentYear.name}
                  </h3>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-blue-100">
                    <CalendarDays size={16} />

                    <span>
                      {formatDate(currentYear.start_date)}
                    </span>

                    <span>→</span>

                    <span>
                      {formatDate(currentYear.end_date)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openEditForm(currentYear)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
                >
                  <Edit3 size={16} />
                  Edit
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
              <p className="font-bold text-amber-900">
                No current academic year
              </p>

              <p className="mt-1 text-sm text-amber-700">
                Create an academic year and set it as current before
                using student promotion.
              </p>
            </div>
          )}
        </section>

        {/* ALL YEARS */}
        <section className="mt-8">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-900">
              All Academic Years
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Previous and upcoming academic sessions for this school.
            </p>
          </div>

          {loading ? (
            <LoadingCard />
          ) : years.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <CalendarDays size={26} />
              </div>

              <h3 className="mt-4 text-lg font-bold text-slate-900">
                No academic years yet
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Add your school&apos;s first academic year.
              </p>

              <button
                type="button"
                onClick={openAddForm}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus size={17} />
                Add Academic Year
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Academic Year
                      </th>

                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Start Date
                      </th>

                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        End Date
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
                    {years.map((year) => {
                      const isCurrent = year.is_current;

                      const isPast =
                        !isCurrent &&
                        new Date(year.end_date) < new Date();

                      return (
                        <tr
                          key={year.id}
                          className="transition hover:bg-slate-50"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                <CalendarDays size={19} />
                              </div>

                              <div>
                                <p className="font-bold text-slate-900">
                                  {year.name}
                                </p>

                                <p className="text-xs text-slate-500">
                                  Created{" "}
                                  {formatDate(year.created_at)}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {formatDate(year.start_date)}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {formatDate(year.end_date)}
                          </td>

                          <td className="px-5 py-4">
                            {isCurrent ? (
                              <StatusBadge
                                label="Current"
                                className="border-green-200 bg-green-50 text-green-700"
                              />
                            ) : isPast ? (
                              <StatusBadge
                                label="Previous"
                                className="border-slate-200 bg-slate-100 text-slate-600"
                              />
                            ) : (
                              <StatusBadge
                                label="Upcoming"
                                className="border-blue-200 bg-blue-50 text-blue-700"
                              />
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEditForm(year)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                <Edit3 size={14} />
                                Edit
                              </button>

                              {!isCurrent && (
                                <button
                                  type="button"
                                  onClick={() => void setAsCurrent(year)}
                                  disabled={
                                    settingCurrent === year.id
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Star size={14} />

                                  {settingCurrent === year.id
                                    ? "Setting..."
                                    : "Set Current"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* SUMMARY */}
        {!loading && years.length > 0 && (
          <section className="mt-6 grid gap-4 sm:grid-cols-3">
            <SummaryCard
              icon={<CalendarDays size={20} />}
              title="Total Years"
              value={years.length}
            />

            <SummaryCard
              icon={<Clock3 size={20} />}
              title="Upcoming"
              value={upcomingYears.length}
            />

            <SummaryCard
              icon={<CheckCircle2 size={20} />}
              title="Previous"
              value={previousYears.length}
            />
          </section>
        )}
      </div>

      {/* ADD / EDIT MODAL */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
                  Academic Year
                </p>

                <h2 className="mt-1 text-xl font-bold text-slate-900">
                  {editingYear
                    ? "Edit Academic Year"
                    : "Add Academic Year"}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={saveAcademicYear}
              className="space-y-5 p-6"
            >
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Academic Year Name
                </label>

                <input
                  type="text"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Example: 2027-2028"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Start Date
                  </label>

                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        start_date: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    End Date
                  </label>

                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        end_date: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    required
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-900">
                  Current year
                </p>

                <p className="mt-1 text-xs leading-5 text-blue-700">
                  New academic years are created as upcoming years.
                  After saving, use &quot;Set Current&quot; when the
                  school starts that session.
                </p>
              </div>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save size={17} />
                      {editingYear ? "Save Changes" : "Create Year"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function LoadingCard() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

      <p className="mt-3 text-sm text-slate-500">
        Loading academic years...
      </p>
    </div>
  );
}

function StatusBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function SummaryCard({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          {icon}
        </div>

        <div>
          <p className="text-sm text-slate-500">{title}</p>

          <p className="mt-1 text-2xl font-bold text-slate-900">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}