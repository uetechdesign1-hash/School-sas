"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, MapPin } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
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

        setAttendance(
          rows || []
        );
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
  }, [supabase]);

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

          <p className="mt-1 text-sm text-slate-500">
            {staff
              ? formatName(staff)
              : "Staff Member"}
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          {attendance.length === 0 ? (
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

                    {attendance.map(
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

                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-700">
                              {String(
                                row.status || "present"
                              ).replaceAll(
                                "_",
                                " "
                              )}
                            </span>

                            {row.is_late && (
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

                {attendance.map(
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

                          <p className="mt-1 text-xs capitalize text-slate-500">
                            {String(
                              row.status || "present"
                            ).replaceAll(
                              "_",
                              " "
                            )}
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