"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  MapPin,
  Users,
  XCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  employee_no: string | null;
  department: string | null;
  designation: string | null;
};

type Attendance = {
  id: string;
  staff_id: string | null;
  employee_id: string;
  attendance_date: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  check_in_distance_meters: number | null;
  check_out_distance_meters: number | null;
  check_in_accuracy_meters: number | null;
  check_out_accuracy_meters: number | null;
  working_minutes: number | null;
  is_late: boolean | null;
  is_early_checkout: boolean | null;
};

type ReportRow = {
  staff: Staff;
  attendance: Attendance | null;
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

function formatTime(
  value: string | null
) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString(
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
    return "—";
  }

  const hours = Math.floor(
    minutes / 60
  );

  const mins = minutes % 60;

  return `${hours}h ${String(
    mins
  ).padStart(2, "0")}m`;
}

function formatDistance(
  meters: number | null
) {
  if (
    meters === null ||
    meters === undefined
  ) {
    return "—";
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(
    meters / 1000
  ).toFixed(2)} km`;
}

function statusLabel(
  value: string
) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) =>
      c.toUpperCase()
    );
}

function statusClass(
  value: string
) {
  switch (value.toLowerCase()) {
    case "present":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";

    case "late":
      return "border-amber-200 bg-amber-50 text-amber-700";

    case "half_day":
      return "border-orange-200 bg-orange-50 text-orange-700";

    case "absent":
      return "border-red-200 bg-red-50 text-red-700";

    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function localDate(
  date: Date
) {
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export default function AttendanceReportsPage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const today = new Date();

  const [fromDate, setFromDate] =
    useState(
      localDate(
        new Date(
          today.getFullYear(),
          today.getMonth(),
          1
        )
      )
    );

  const [toDate, setToDate] =
    useState(
      localDate(today)
    );

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("all");

  const [rows, setRows] =
    useState<ReportRow[]>([]);

  const [schoolName, setSchoolName] =
    useState("School");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    void loadReport();
  }, [fromDate, toDate]);

  async function loadReport() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.assign("/login");
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
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membership) {
        throw new Error(
          "No active school membership found."
        );
      }

      const role =
        String(
          membership.role || ""
        ).toLowerCase();

      if (
        role !== "owner" &&
        role !== "admin"
      ) {
        throw new Error(
          "Only school owners and administrators can view staff attendance reports."
        );
      }

      const {
        data: school,
        error: schoolError,
      } = await supabase
        .from("schools")
        .select("id, name")
        .eq(
          "id",
          membership.school_id
        )
        .maybeSingle();

      if (schoolError) {
        throw schoolError;
      }

      setSchoolName(
        school?.name || "School"
      );

      const {
        data: staffData,
        error: staffError,
      } = await supabase
        .from("staff")
        .select(
          `
            id,
            first_name,
            middle_name,
            last_name,
            employee_no,
            department,
            designation
          `
        )
        .eq(
          "school_id",
          membership.school_id
        )
        .order("first_name", {
          ascending: true,
        });

      if (staffError) {
        throw staffError;
      }

      const {
        data: attendanceData,
        error: attendanceError,
      } = await supabase
        .from("staff_attendance")
        .select(
          `
            id,
            staff_id,
            employee_id,
            attendance_date,
            status,
            check_in_at,
            check_out_at,
            check_in_distance_meters,
            check_out_distance_meters,
            check_in_accuracy_meters,
            check_out_accuracy_meters,
            working_minutes,
            is_late,
            is_early_checkout
          `
        )
        .eq(
          "school_id",
          membership.school_id
        )
        .gte(
          "attendance_date",
          fromDate
        )
        .lte(
          "attendance_date",
          toDate
        )
        .order(
          "attendance_date",
          {
            ascending: false,
          }
        );

      if (attendanceError) {
        throw attendanceError;
      }

      const staffList =
        (staffData || []) as Staff[];

      const attendanceList =
        (attendanceData ||
          []) as Attendance[];

      const result: ReportRow[] = [];

      for (const staff of staffList) {
        const records =
          attendanceList.filter(
            (record) =>
              record.staff_id ===
              staff.id
          );

        if (records.length === 0) {
          result.push({
            staff,
            attendance: null,
          });
        } else {
          for (const record of records) {
            result.push({
              staff,
              attendance: record,
            });
          }
        }
      }

      setRows(result);
    } catch (err) {
      console.error(
        "ATTENDANCE REPORT ERROR:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load attendance report."
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    const query =
      search.trim().toLowerCase();

    return rows.filter((row) => {
      const text =
        `${staffName(row.staff)} ${
          row.staff.employee_no || ""
        } ${
          row.staff.department || ""
        } ${
          row.staff.designation || ""
        }`.toLowerCase();

      const matchesSearch =
        !query ||
        text.includes(query);

      const rowStatus =
        row.attendance?.status ||
        "absent";

      const matchesStatus =
        statusFilter === "all" ||
        rowStatus.toLowerCase() ===
          statusFilter;

      return (
        matchesSearch &&
        matchesStatus
      );
    });
  }, [
    rows,
    search,
    statusFilter,
  ]);

  const stats = useMemo(() => {
    const records =
      rows.filter(
        (row) =>
          row.attendance !== null
      );

    return {
      records: records.length,

      present: records.filter(
        (row) =>
          row.attendance?.status ===
          "present"
      ).length,

      late: records.filter(
        (row) =>
          row.attendance?.status ===
          "late" ||
          row.attendance?.is_late
      ).length,

      absent: records.filter(
        (row) =>
          row.attendance?.status ===
          "absent"
      ).length,

      halfDay: records.filter(
        (row) =>
          row.attendance?.status ===
          "half_day"
      ).length,
    };
  }, [rows]);

  function exportCsv() {
    const header = [
      "Date",
      "Employee No",
      "Staff",
      "Department",
      "Designation",
      "Status",
      "Check In",
      "Check Out",
      "Working",
      "Check In Distance",
      "Check Out Distance",
      "Late",
      "Early Checkout",
    ];

    const lines =
      filteredRows.map(
        (row) => {
          const a =
            row.attendance;

          const values = [
            a?.attendance_date || "",
            row.staff.employee_no ||
              "",
            staffName(row.staff),
            row.staff.department ||
              "",
            row.staff.designation ||
              "",
            a?.status || "Absent",
            formatTime(
              a?.check_in_at || null
            ),
            formatTime(
              a?.check_out_at || null
            ),
            a?.working_minutes ??
              "",
            a?.check_in_distance_meters ??
              "",
            a?.check_out_distance_meters ??
              "",
            a?.is_late
              ? "Yes"
              : "No",
            a?.is_early_checkout
              ? "Yes"
              : "No",
          ];

          return values
            .map(
              (value) =>
                `"${String(
                  value
                ).replaceAll(
                  '"',
                  '""'
                )}"`
            )
            .join(",");
        }
      );

    const csv = [
      header.join(","),
      ...lines,
    ].join("\n");

    const blob =
      new Blob([csv], {
        type: "text/csv;charset=utf-8",
      });

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;
    link.download =
      `staff-attendance-${fromDate}-to-${toDate}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2
            size={18}
            className="animate-spin"
          />
          Loading attendance report...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">

      <div className="mx-auto max-w-7xl">

        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">

          <div>

            <Link
              href="/dashboard/staff"
              className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft size={16} />
              Back to Staff
            </Link>

            <p className="text-sm text-slate-500">
              {schoolName}
            </p>

            <div className="mt-1 flex items-center gap-3">

              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <BarChart3 size={22} />
              </div>

              <div>
                <h1 className="text-2xl font-black text-slate-900">
                  Attendance Reports
                </h1>

                <p className="text-sm text-slate-500">
                  Staff attendance and GPS records.
                </p>
              </div>

            </div>

          </div>

          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Download size={17} />
            Export CSV
          </button>

        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* FILTERS */}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

          <div className="grid gap-4 md:grid-cols-4">

            <Field
              label="From"
              type="date"
              value={fromDate}
              onChange={setFromDate}
            />

            <Field
              label="To"
              type="date"
              value={toDate}
              onChange={setToDate}
            />

            <Field
              label="Search"
              type="search"
              value={search}
              onChange={setSearch}
              placeholder="Name / employee no."
            />

            <div>
              <label className="text-xs font-bold text-slate-500">
                Status
              </label>

              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value
                  )
                }
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
              >
                <option value="all">
                  All Status
                </option>
                <option value="present">
                  Present
                </option>
                <option value="late">
                  Late
                </option>
                <option value="half_day">
                  Half Day
                </option>
                <option value="absent">
                  Absent
                </option>
              </select>
            </div>

          </div>

        </section>

        {/* STATS */}

        <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">

          <ReportStat
            icon={<Users size={19} />}
            label="Records"
            value={stats.records}
          />

          <ReportStat
            icon={
              <CheckCircle2 size={19} />
            }
            label="Present"
            value={stats.present}
          />

          <ReportStat
            icon={<Clock3 size={19} />}
            label="Late"
            value={stats.late}
          />

          <ReportStat
            icon={<XCircle size={19} />}
            label="Absent"
            value={stats.absent}
          />

          <ReportStat
            icon={
              <CalendarDays size={19} />
            }
            label="Half Day"
            value={stats.halfDay}
          />

        </section>

        {/* TABLE */}

        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 p-5">

            <h2 className="font-black text-slate-900">
              Staff Attendance
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              {filteredRows.length} records shown
            </p>

          </div>

          <div className="overflow-x-auto">

            <table className="w-full min-w-[1100px]">

              <thead className="bg-slate-50">

                <tr>

                  <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Date
                  </th>

                  <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Staff
                  </th>

                  <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Status
                  </th>

                  <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Check In
                  </th>

                  <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Check Out
                  </th>

                  <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Working
                  </th>

                  <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-wider text-slate-400">
                    GPS
                  </th>

                </tr>

              </thead>

              <tbody className="divide-y divide-slate-100">

                {filteredRows.map(
                  (row, index) => {
                    const a =
                      row.attendance;

                    return (
                      <tr
                        key={
                          a?.id ||
                          `${row.staff.id}-${index}`
                        }
                        className="hover:bg-slate-50"
                      >

                        <td className="px-5 py-4 text-sm font-semibold text-slate-700">
                          {a?.attendance_date ||
                            "—"}
                        </td>

                        <td className="px-5 py-4">

                          <p className="font-bold text-slate-900">
                            {staffName(
                              row.staff
                            )}
                          </p>

                          <p className="mt-1 text-xs text-slate-400">
                            {row.staff
                              .employee_no ||
                              "No employee number"}
                          </p>

                        </td>

                        <td className="px-5 py-4">

                          <span
                            className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${statusClass(
                              a?.status ||
                                "absent"
                            )}`}
                          >
                            {statusLabel(
                              a?.status ||
                                "absent"
                            )}
                          </span>

                          {a?.is_late && (
                            <p className="mt-1 text-[10px] font-bold text-amber-600">
                              Late arrival
                            </p>
                          )}

                        </td>

                        <td className="px-5 py-4 text-sm font-semibold text-slate-700">
                          {formatTime(
                            a?.check_in_at ||
                              null
                          )}
                        </td>

                        <td className="px-5 py-4 text-sm font-semibold text-slate-700">
                          {formatTime(
                            a?.check_out_at ||
                              null
                          )}
                        </td>

                        <td className="px-5 py-4 text-sm font-bold text-slate-700">
                          {formatMinutes(
                            a?.working_minutes ||
                              null
                          )}
                        </td>

                        <td className="px-5 py-4">

                          {a ? (
                            <div className="text-xs">

                              <div className="flex items-center gap-1 font-bold text-emerald-700">
                                <MapPin
                                  size={13}
                                />
                                In{" "}
                                {formatDistance(
                                  a.check_in_distance_meters
                                )}
                              </div>

                              <div className="mt-1 text-slate-400">
                                Out{" "}
                                {formatDistance(
                                  a.check_out_distance_meters
                                )}
                              </div>

                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">
                              No record
                            </span>
                          )}

                        </td>

                      </tr>
                    );
                  }
                )}

              </tbody>

            </table>

          </div>

          {filteredRows.length === 0 && (
            <div className="p-12 text-center">

              <CalendarDays
                size={40}
                className="mx-auto text-slate-300"
              />

              <p className="mt-3 font-bold text-slate-700">
                No attendance records
              </p>

              <p className="mt-1 text-sm text-slate-400">
                Try another date range or search.
              </p>

            </div>
          )}

        </section>

      </div>

    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (
    value: string
  ) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-500">
        {label}
      </label>

      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) =>
          onChange(e.target.value)
        }
        className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      />
    </div>
  );
}

function ReportStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="flex items-center justify-between">

        <div className="text-slate-500">
          {icon}
        </div>

        <p className="text-2xl font-black text-slate-900">
          {value}
        </p>

      </div>

      <p className="mt-3 text-[10px] font-black uppercase tracking-wider text-slate-400">
        {label}
      </p>

    </div>
  );
}