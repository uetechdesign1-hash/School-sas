"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, MapPin } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
};

type Attendance = {
  id: string;
  attendance_date: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  working_minutes: number | null;
  check_in_distance_meters: number | null;
  check_out_distance_meters: number | null;
  is_late: boolean | null;
  is_early_checkout: boolean | null;
};

type AttendanceOverride = {
  id: string;
  staff_id: string;
  attendance_date: string;
  status: "present" | "absent" | "holiday" | "week_off" | "half_day" | "paid_leave";
  notes: string | null;
};

type SchoolCalendarEntry = {
  attendance_date: string;
  type: "holiday" | "week_off" | "working_day";
  title: string | null;
};

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function formatEffectiveStatus(status: string) {
  switch (status) {
    case "present":
      return "Present";
    case "absent":
      return "Absent";
    case "half_day":
      return "Half Day";
    case "paid_leave":
      return "Casual Leave";
    case "holiday":
      return "Holiday";
    case "week_off":
      return "Week Off";
    default:
      return "Absent";
  }
}

function formatName(staff: Staff) {
  return [
    staff.first_name,
    staff.middle_name,
    staff.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatTime(value: string | null) {
  if (!value) return "—";

  return new Date(value).toLocaleTimeString(
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function formatDate(value: string) {
  return new Date(
    `${value}T00:00:00`
  ).toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
}

function formatMinutes(minutes: number | null) {
  if (
    minutes === null ||
    minutes === undefined
  ) {
    return "—";
  }

  const hours = Math.floor(
    minutes / 60
  );

  const mins = minutes % 60;

  return `${hours}h ${String(mins).padStart(
    2,
    "0"
  )}m`;
}

export default function StaffAttendanceHistoryPage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [staff, setStaff] =
    useState<Staff | null>(null);

  const [attendance, setAttendance] =
    useState<Attendance[]>([]);

  const [overrides, setOverrides] =
    useState<AttendanceOverride[]>([]);

  const [calendarEntries, setCalendarEntries] =
    useState<SchoolCalendarEntry[]>([]);

  const [weeklyOffDay, setWeeklyOffDay] =
    useState(0);

  const [selectedMonth, setSelectedMonth] =
    useState(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const {
          data: {
            user,
          },
        } =
          await supabase.auth.getUser();

        if (!user) {
          window.location.href = "/login";
          return;
        }

        const {
          data: staffRow,
          error: staffError,
        } =
          await supabase
            .from("staff")
            .select(
              `
                id,
                school_id,
                first_name,
                middle_name,
                last_name
              `
            )
            .eq(
              "user_id",
              user.id
            )
            .maybeSingle();

        if (staffError) {
          throw staffError;
        }

        if (!staffRow) {
          throw new Error(
            "Your login is not linked to a staff member."
          );
        }

        setStaff(staffRow);

        const [selectedYear, selectedMonthNumber] =
          selectedMonth.split("-").map(Number);
        const firstDate = `${selectedMonth}-01`;
        const lastDay = new Date(selectedYear, selectedMonthNumber, 0).getDate();
        const lastDate = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

        const {
          data: rows,
          error: attendanceError,
        } =
          await supabase
            .from("staff_attendance")
            .select(
              `
                id,
                attendance_date,
                status,
                check_in_at,
                check_out_at,
                working_minutes,
                check_in_distance_meters,
                check_out_distance_meters,
                is_late,
                is_early_checkout
              `
            )
            .eq(
              "staff_id",
              staffRow.id
            )
            .gte("attendance_date", firstDate)
            .lte("attendance_date", lastDate)
            .order(
              "attendance_date",
              {
                ascending: false,
              }
            )
            .limit(100);

        if (attendanceError) {
          throw attendanceError;
        }

        const {
          data: overrideRows,
          error: overrideError,
        } =
          await supabase
            .from("staff_attendance_overrides")
            .select(
              "id, staff_id, attendance_date, status, notes"
            )
            .eq(
              "staff_id",
              staffRow.id
            )
            .gte("attendance_date", firstDate)
            .lte("attendance_date", lastDate)
            .order(
              "attendance_date",
              {
                ascending: false,
              }
            );

        if (overrideError) {
          throw overrideError;
        }

        const {
          data: calendarRows,
          error: calendarError,
        } =
          await supabase
            .from("school_attendance_calendar")
            .select(
              "attendance_date, type, title"
            )
            .gte("attendance_date", firstDate)
            .lte("attendance_date", lastDate)
            .order(
              "attendance_date",
              {
                ascending: true,
              }
            );

        if (calendarError) {
          throw calendarError;
        }

        const {
          data: settingsRow,
          error: settingsError,
        } =
          await supabase
            .from("school_attendance_settings")
            .select("weekly_off_day")
            .eq(
              "school_id",
              staffRow.school_id
            )
            .maybeSingle();

        if (settingsError) {
          throw settingsError;
        }

        setAttendance(rows || []);
        setOverrides((overrideRows || []) as AttendanceOverride[]);
        setCalendarEntries((calendarRows || []) as SchoolCalendarEntry[]);
        setWeeklyOffDay(Number(settingsRow?.weekly_off_day ?? 0));
      } catch (err: any) {
        console.error(
          "ATTENDANCE HISTORY ERROR:",
          err
        );

        setError(
          err?.message ||
            "Unable to load attendance history."
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [selectedMonth, supabase]);

  const effectiveRows = useMemo(() => {
    const attendanceMap = new Map(
      attendance.map((row) => [row.attendance_date, row]),
    );

    const overrideMap = new Map(
      overrides.map((row) => [row.attendance_date, row]),
    );

    const calendarMap = new Map(
      calendarEntries.map((row) => [row.attendance_date, row]),
    );

    const [selectedYear, selectedMonthNumber] =
      selectedMonth.split("-").map(Number);
    const from = new Date(selectedYear, selectedMonthNumber - 1, 1);
    const to = new Date(selectedYear, selectedMonthNumber, 0);
    const rows: Array<Attendance & { effectiveStatus: string; source: string; synthetic: boolean }> = [];

    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      const date = dateKey(cursor);
      const actual = attendanceMap.get(date);
      const override = overrideMap.get(date);
      const calendar = calendarMap.get(date);

      let effectiveStatus: string;
      let source: string;

      if (override) {
        effectiveStatus = override.status;
        source = "Admin override";
      } else if (actual) {
        effectiveStatus =
          actual.status === "half_day" ||
          actual.status === "late" ||
          actual.is_late
            ? "half_day"
            : actual.status === "absent"
              ? "absent"
              : "present";
        source = "GPS attendance";
      } else if (calendar?.type === "holiday") {
        effectiveStatus = "holiday";
        source = "School calendar";
      } else if (calendar?.type === "week_off") {
        effectiveStatus = "week_off";
        source = "School calendar";
      } else if (cursor.getDay() === weeklyOffDay) {
        effectiveStatus = "week_off";
        source = "Weekly off";
      } else {
        effectiveStatus = "absent";
        source = "No check-in";
      }

      rows.push({
        id: actual?.id || `missing-${date}`,
        attendance_date: date,
        status: actual?.status || effectiveStatus,
        check_in_at: actual?.check_in_at || null,
        check_out_at: actual?.check_out_at || null,
        working_minutes: actual?.working_minutes || null,
        check_in_distance_meters: actual?.check_in_distance_meters || null,
        check_out_distance_meters: actual?.check_out_distance_meters || null,
        is_late: actual?.is_late || false,
        is_early_checkout: actual?.is_early_checkout || false,
        effectiveStatus,
        source,
        synthetic: !actual,
      });
    }

    return rows.reverse();
  }, [attendance, overrides, calendarEntries, weeklyOffDay, selectedMonth]);

  if (loading) {
    return (
      <div className="p-6">
        Loading attendance history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      <div className="mx-auto max-w-6xl">

        <div className="mb-6">
          <p className="text-sm text-slate-500">
            Staff Portal
          </p>

          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Attendance History
          </h1>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <p className="mt-1 text-sm text-slate-500">
              {staff
                ? formatName(staff)
                : "Staff Member"}
            </p>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Month & Year
              </label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          {effectiveRows.length === 0 ? (
            <div className="p-12 text-center">

              <CalendarDays className="mx-auto h-10 w-10 text-slate-300" />

              <h2 className="mt-4 font-semibold text-slate-900">
                No attendance records
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Your attendance records will appear here.
              </p>

            </div>
          ) : (
            <>
              {/* DESKTOP */}

              <div className="hidden overflow-x-auto md:block">

                <table className="min-w-full">

                  <thead className="border-b border-slate-200 bg-slate-50">

                    <tr>
                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">
                        Date
                      </th>

                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">
                        Check In
                      </th>

                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">
                        Check Out
                      </th>

                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">
                        Working
                      </th>

                      <th className="px-5 py-4 text-left text-xs font-semibold uppercase text-slate-500">
                        Status
                      </th>
                    </tr>

                  </thead>

                  <tbody className="divide-y divide-slate-100">

                    {effectiveRows.map(
                      (row) => (
                        <tr key={row.id}>

                          <td className="px-5 py-4 text-sm font-medium text-slate-900">
                            {formatDate(
                              row.attendance_date
                            )}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {formatTime(
                              row.check_in_at
                            )}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {formatTime(
                              row.check_out_at
                            )}
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {formatMinutes(
                              row.working_minutes
                            )}
                          </td>

                          <td className="px-5 py-4">

                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                row.effectiveStatus === "present"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : row.effectiveStatus === "absent"
                                    ? "bg-red-50 text-red-700"
                                    : row.effectiveStatus === "half_day"
                                      ? "bg-violet-50 text-violet-700"
                                      : row.effectiveStatus === "holiday"
                                        ? "bg-amber-50 text-amber-700"
                                        : row.effectiveStatus === "week_off"
                                          ? "bg-slate-100 text-slate-700"
                                          : "bg-sky-50 text-sky-700"
                              }`}
                              title={row.source}
                            >
                              {formatEffectiveStatus(row.effectiveStatus)}
                            </span>

                            {row.source !== "GPS attendance" && (
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                                {row.source}
                              </span>
                            )}

                            {row.is_late && row.effectiveStatus === "half_day" && (
                              <span className="ml-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                                Late
                              </span>
                            )}

                          </td>

                        </tr>
                      )
                    )}

                  </tbody>

                </table>

              </div>

              {/* MOBILE */}

              <div className="divide-y divide-slate-100 md:hidden">

                {effectiveRows.map(
                  (row) => (
                    <div
                      key={row.id}
                      className="p-5"
                    >

                      <div className="flex items-center justify-between">

                        <div>
                          <p className="font-semibold text-slate-900">
                            {formatDate(
                              row.attendance_date
                            )}
                          </p>

                          <p className="mt-1 text-xs text-slate-500">
                            <span className="font-semibold">
                              {formatEffectiveStatus(row.effectiveStatus)}
                            </span>
                            <span className="ml-2">
                              • {row.source}
                            </span>
                          </p>
                        </div>

                        {row.is_late && (
                          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                            Late
                          </span>
                        )}

                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-3">

                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs text-slate-400">
                            In
                          </p>

                          <p className="mt-1 text-sm font-semibold">
                            {formatTime(
                              row.check_in_at
                            )}
                          </p>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs text-slate-400">
                            Out
                          </p>

                          <p className="mt-1 text-sm font-semibold">
                            {formatTime(
                              row.check_out_at
                            )}
                          </p>
                        </div>

                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs text-slate-400">
                            Working
                          </p>

                          <p className="mt-1 text-sm font-semibold">
                            {formatMinutes(
                              row.working_minutes
                            )}
                          </p>
                        </div>

                      </div>

                      {row.synthetic && row.effectiveStatus === "absent" && (
                        <div className="mt-3 text-xs font-semibold text-red-600">
                          No check-in recorded for this working day.
                        </div>
                      )}

                      {(row.check_in_distance_meters !== null ||
                        row.check_out_distance_meters !== null) && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                          <MapPin className="h-3.5 w-3.5" />

                          GPS verified
                        </div>
                      )}

                    </div>
                  )
                )}

              </div>
            </>
          )}

        </div>

      </div>

    </div>
  );
}