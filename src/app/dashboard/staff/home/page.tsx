"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  LogOut,
  MapPin,
  UserRound,
  WalletCards,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  user_id: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  department: string | null;
  status: string | null;
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

function staffName(staff: Staff) {
  return [
    staff.first_name,
    staff.middle_name,
    staff.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatTime(value: string | null) {
  if (!value) return "--:--";

  return new Date(value).toLocaleTimeString(
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function formatMinutes(
  minutes: number | null
) {
  if (
    minutes === null ||
    minutes === undefined
  ) {
    return "--h --m";
  }

  const hours = Math.floor(minutes / 60);

  const mins = minutes % 60;

  return `${hours}h ${mins
    .toString()
    .padStart(2, "0")}m`;
}

export default function StaffHomePage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [staff, setStaff] =
    useState<Staff | null>(null);

  const [attendance, setAttendance] =
    useState<Attendance | null>(null);

  const [schoolName, setSchoolName] =
    useState("School");

  const [loading, setLoading] =
    useState(true);

  const [clock, setClock] =
    useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const {
          data: {
            user,
          },
        } = await supabase.auth.getUser();

        if (!user) {
          window.location.href =
            "/login";

          return;
        }

        // ==========================================
        // FIND STAFF BY AUTH USER
        // ==========================================

        const {
          data: staffRow,
          error: staffError,
        } = await supabase
          .from("staff")
          .select(
            `
              id,
              school_id,
              user_id,
              first_name,
              middle_name,
              last_name,
              designation,
              department,
              status
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
            "This login account is not linked to a staff member."
          );
        }

        setStaff(staffRow);

        // ==========================================
        // SCHOOL
        // ==========================================

        const {
          data: school,
        } = await supabase
          .from("schools")
          .select("name")
          .eq(
            "id",
            staffRow.school_id
          )
          .maybeSingle();

        if (school?.name) {
          setSchoolName(
            school.name
          );
        }

        // ==========================================
        // TODAY
        // ==========================================

        const today =
          new Date()
            .toISOString()
            .slice(0, 10);

        const {
          data: attendanceRow,
          error: attendanceError,
        } = await supabase
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
          .eq(
            "attendance_date",
            today
          )
          .maybeSingle();

        if (
          attendanceError &&
          attendanceError.code !==
            "PGRST116"
        ) {
          console.error(
            attendanceError
          );
        }

        setAttendance(
          attendanceRow || null
        );
      } catch (error) {
        console.error(
          "STAFF HOME ERROR:",
          error
        );

        window.location.href =
          "/login";
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [supabase]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl animate-pulse">
          <div className="h-32 rounded-2xl bg-white" />

          <div className="mt-6 h-64 rounded-2xl bg-white" />
        </div>
      </div>
    );
  }

  if (!staff) {
    return null;
  }

  const name = staffName(staff);

  const checkedIn =
    !!attendance?.check_in_at &&
    !attendance?.check_out_at;

  const completed =
    !!attendance?.check_in_at &&
    !!attendance?.check_out_at;

  return (
    <main className="min-h-screen bg-slate-50">

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">

        {/* HEADER */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

          <div>

            <p className="text-sm font-medium text-slate-500">
              {clock.toLocaleDateString(
                "en-IN",
                {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }
              )}
            </p>

            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Good Morning,{" "}
              {staff.first_name ||
                "Teacher"}
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              {schoolName}
            </p>

          </div>

          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">

            <Clock3 className="h-4 w-4 text-slate-500" />

            <span className="text-sm font-bold text-slate-800">
              {clock.toLocaleTimeString(
                "en-IN",
                {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }
              )}
            </span>

          </div>

        </div>

        {/* ATTENDANCE CARD */}

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="p-6 sm:p-8">

            {!attendance && (
              <>
                <div className="flex flex-col items-center text-center">

                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <MapPin className="h-7 w-7" />
                  </div>

                  <h2 className="mt-4 text-xl font-bold text-slate-900">
                    Ready for Attendance
                  </h2>

                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                    Your attendance is recorded
                    using your school location.
                    Open attendance to check in.
                  </p>

                  <Link
                    href="/dashboard/staff/attendance"
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-7 py-3.5 text-sm font-bold text-white hover:bg-slate-800"
                  >
                    <MapPin className="h-4 w-4" />
                    Open Attendance
                  </Link>

                </div>
              </>
            )}

            {checkedIn && (
              <div>

                <div className="flex items-center gap-3">

                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>

                  <div>
                    <p className="text-lg font-bold text-slate-900">
                      Checked In
                    </p>

                    <p className="text-sm text-slate-500">
                      {formatTime(
                        attendance.check_in_at
                      )}
                    </p>
                  </div>

                </div>

                <div className="mt-7 grid gap-4 sm:grid-cols-3">

                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-400">
                      Check In
                    </p>

                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {formatTime(
                        attendance.check_in_at
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-400">
                      Working
                    </p>

                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {formatMinutes(
                        attendance.working_minutes
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-400">
                      Status
                    </p>

                    <p className="mt-1 text-lg font-bold capitalize text-emerald-600">
                      {attendance.status ||
                        "Present"}
                    </p>
                  </div>

                </div>

                <Link
                  href="/dashboard/staff/attendance"
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-bold text-white hover:bg-slate-800"
                >
                  <Clock3 className="h-4 w-4" />
                  Open Attendance
                </Link>

              </div>
            )}

            {completed && (
              <div>

                <div className="flex items-center gap-3">

                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>

                  <div>
                    <p className="text-lg font-bold text-slate-900">
                      Attendance Complete
                    </p>

                    <p className="text-sm text-emerald-600">
                      {String(
                        attendance.status ||
                          "Present"
                      ).replace(
                        "_",
                        " "
                      )}
                    </p>
                  </div>

                </div>

                <div className="mt-7 grid gap-4 sm:grid-cols-3">

                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-400">
                      Check In
                    </p>

                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {formatTime(
                        attendance.check_in_at
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-400">
                      Check Out
                    </p>

                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {formatTime(
                        attendance.check_out_at
                      )}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-400">
                      Working
                    </p>

                    <p className="mt-1 text-lg font-bold text-slate-900">
                      {formatMinutes(
                        attendance.working_minutes
                      )}
                    </p>
                  </div>

                </div>

              </div>
            )}

          </div>
        </div>

        {/* QUICK LINKS */}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

          <Link
            href="/dashboard/staff/attendance"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:bg-slate-50"
          >
            <Clock3 className="h-5 w-5 text-slate-600" />

            <p className="mt-4 text-sm font-bold text-slate-900">
              My Attendance
            </p>

            <p className="mt-1 text-xs text-slate-500">
              Check-in and attendance history
            </p>
          </Link>

          <Link
            href="/dashboard/staff/my-attendance"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:bg-slate-50"
          >
            <CalendarDays className="h-5 w-5 text-slate-600" />

            <p className="mt-4 text-sm font-bold text-slate-900">
              Attendance History
            </p>

            <p className="mt-1 text-xs text-slate-500">
              View previous attendance
            </p>
          </Link>

          <Link
            href="/dashboard/staff/my-salary"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:bg-slate-50"
          >
            <WalletCards className="h-5 w-5 text-slate-600" />

            <p className="mt-4 text-sm font-bold text-slate-900">
              My Salary
            </p>

            <p className="mt-1 text-xs text-slate-500">
              View salary information
            </p>
          </Link>

          <Link
            href="/dashboard/staff/profile"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:bg-slate-50"
          >
            <UserRound className="h-5 w-5 text-slate-600" />

            <p className="mt-4 text-sm font-bold text-slate-900">
              My Profile
            </p>

            <p className="mt-1 text-xs text-slate-500">
              View your profile
            </p>
          </Link>

        </div>

        {/* LOGOUT */}

        <div className="mt-8 text-center">

          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();

              window.location.href =
                "/login";
            }}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>

        </div>

      </div>
    </main>
  );
}