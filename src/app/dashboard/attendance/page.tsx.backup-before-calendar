"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  employee_no: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  status: string;
};

type AttendanceRecord = {
  staff_id: string;
  attendance_date: string;
  status: "present" | "absent" | "late" | "half_day";
  check_in_at: string | null;
  check_out_at: string | null;
  working_minutes: number | null;
  is_late: boolean;
  is_early_checkout: boolean;
};

type OverrideRecord = {
  id: string;
  staff_id: string;
  attendance_date: string;
  status: "present" | "absent" | "holiday" | "week_off" | "half_day";
  notes: string | null;
};

type SchoolCalendarEntry = {
  id: string;
  school_id: string;
  attendance_date: string;
  type: "holiday" | "week_off" | "working_day";
  title: string | null;
};

type CellStatus =
  | "present"
  | "absent"
  | "holiday"
  | "week_off"
  | "half_day"
  | "auto";

const STATUS_LABEL: Record<CellStatus, string> = {
  present: "P",
  absent: "A",
  holiday: "H",
  week_off: "W/O",
  half_day: "½",
  auto: "Auto",
};

const STATUS_FULL: Record<CellStatus, string> = {
  present: "Present",
  absent: "Absent",
  holiday: "Holiday",
  week_off: "Week Off",
  half_day: "Half Day",
  auto: "Automatic",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function monthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function dateFor(month: string, day: number) {
  return `${month}-${pad(day)}`;
}

function staffName(staff: Staff) {
  return [staff.first_name, staff.middle_name, staff.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatMinutes(value: number | null) {
  if (value == null) return "—";
  return `${Math.floor(value / 60)}h ${value % 60}m`;
}

function actualToStatus(record: AttendanceRecord | undefined): CellStatus {
  if (!record) return "auto";
  if (record.status === "half_day") return "half_day";
  if (record.status === "absent") return "absent";
  return "present";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export default function AdminAttendancePage() {
  const supabase = useMemo(() => createClient(), []);

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  });

  const [staff, setStaff] = useState<Staff[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [calendarEntries, setCalendarEntries] = useState<SchoolCalendarEntry[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState(0);
  const [schoolId, setSchoolId] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState("");
  const [calendarType, setCalendarType] = useState<"holiday" | "week_off" | "working_day">("holiday");
  const [calendarTitle, setCalendarTitle] = useState("");
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [calendarError, setCalendarError] = useState("");

  const [schoolName, setSchoolName] = useState("School");

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const days = useMemo(
    () => Array.from({ length: monthDays(month) }, (_, i) => i + 1),
    [month],
  );

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;
      if (!user) {
        window.location.assign("/login");
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from("school_users")
        .select("school_id, role")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;

      if (
        !membership?.school_id ||
        !["owner", "admin"].includes(String(membership.role))
      ) {
        throw new Error(
          "Only the school Owner or Admin can manage staff attendance.",
        );
      }

      const schoolId = membership.school_id;

      const { data: school } = await supabase
        .from("schools")
        .select("*")
        .eq("id", schoolId)
        .maybeSingle();

      const schoolRecord = (school || {}) as Record<string, unknown>;
      setSchoolName(
        String(
          schoolRecord.name ||
            schoolRecord.school_name ||
            schoolRecord.title ||
            "School",
        ).trim() || "School",
      );

      const { data: staffData, error: staffError } = await supabase
        .from("staff")
        .select(
          "id, employee_no, first_name, middle_name, last_name, designation, status",
        )
        .eq("school_id", schoolId)
        .order("first_name", { ascending: true });

      if (staffError) throw staffError;

      const firstDate = `${month}-01`;
      const lastDate = `${month}-${pad(monthDays(month))}`;

      const { data: attendanceData, error: attendanceError } = await supabase
        .from("staff_attendance")
        .select(
          "staff_id, attendance_date, status, check_in_at, check_out_at, working_minutes, is_late, is_early_checkout",
        )
        .eq("school_id", schoolId)
        .gte("attendance_date", firstDate)
        .lte("attendance_date", lastDate)
        .order("attendance_date", { ascending: true });

      if (attendanceError) throw attendanceError;

      const { data: overrideData, error: overrideError } = await supabase
        .from("staff_attendance_overrides")
        .select("id, staff_id, attendance_date, status, notes")
        .eq("school_id", schoolId)
        .gte("attendance_date", firstDate)
        .lte("attendance_date", lastDate)
        .order("attendance_date", { ascending: true });

      if (overrideError) throw overrideError;

      const { data: calendarData, error: calendarError } = await supabase
        .from("school_attendance_calendar")
        .select("id, school_id, attendance_date, type, title")
        .eq("school_id", schoolId)
        .gte("attendance_date", firstDate)
        .lte("attendance_date", lastDate)
        .order("attendance_date", { ascending: true });

      if (calendarError) throw calendarError;

      const { data: settingsData, error: settingsError } = await supabase
        .from("school_attendance_settings")
        .select("weekly_off_day")
        .eq("school_id", schoolId)
        .maybeSingle();

      if (settingsError) throw settingsError;

      setSchoolId(schoolId);
      setWeeklyOffDay(Number(settingsData?.weekly_off_day ?? 0));
      setStaff((staffData || []) as Staff[]);
      setCalendarEntries((calendarData || []) as SchoolCalendarEntry[]);
      setAttendance((attendanceData || []) as AttendanceRecord[]);
      setOverrides((overrideData || []) as OverrideRecord[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load attendance.",
      );
    } finally {
      setLoading(false);
    }
  }, [month, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const staffMap = useMemo(
    () => new Map(staff.map((item) => [item.id, item])),
    [staff],
  );

  const attendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const item of attendance) {
      map.set(`${item.staff_id}|${item.attendance_date}`, item);
    }
    return map;
  }, [attendance]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, OverrideRecord>();
    for (const item of overrides) {
      map.set(`${item.staff_id}|${item.attendance_date}`, item);
    }
    return map;
  }, [overrides]);

  const filteredStaff = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return staff;
    return staff.filter((item) =>
      `${staffName(item)} ${item.employee_no || ""} ${
        item.designation || ""
      }`
        .toLowerCase()
        .includes(query),
    );
  }, [search, staff]);

  const calendarMap = useMemo(() => {
    const map = new Map<string, SchoolCalendarEntry>();
    for (const item of calendarEntries) map.set(item.attendance_date, item);
    return map;
  }, [calendarEntries]);

  function defaultCalendarStatus(date: string): CellStatus {
    const entry = calendarMap.get(date);
    if (entry?.type === "holiday") return "holiday";
    if (entry?.type === "week_off") return "week_off";
    if (entry?.type === "working_day") return "auto";

    const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
    return dayOfWeek === weeklyOffDay ? "week_off" : "auto";
  }

  function getCellStatus(staffId: string, date: string): CellStatus {
    // Priority: explicit staff override -> real GPS attendance -> school calendar -> weekly off -> automatic/unmarked.
    const override = overrideMap.get(`${staffId}|${date}`);
    if (override) return override.status;

    const actual = attendanceMap.get(`${staffId}|${date}`);
    if (actual) return actualToStatus(actual);

    return defaultCalendarStatus(date);
  }

  function getSummary(staffId: string) {
    let present = 0;
    let absent = 0;
    let holiday = 0;
    let weekOff = 0;
    let halfDay = 0;

    for (const day of days) {
      const date = dateFor(month, day);
      const status = getCellStatus(staffId, date);

      if (status === "present") present++;
      if (status === "absent") absent++;
      if (status === "holiday") holiday++;
      if (status === "week_off") weekOff++;
      if (status === "half_day") halfDay++;
    }

    const workingDays = Math.max(days.length - holiday - weekOff, 0);
    const workedDays = present + halfDay * 0.5;

    return {
      present,
      absent,
      holiday,
      weekOff,
      halfDay,
      workingDays,
      workedDays,
    };
  }

  async function schoolForAdmin() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) throw new Error("You are not signed in.");

    const { data, error } = await supabase
      .from("school_users")
      .select("school_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (
      !data?.school_id ||
      !["owner", "admin"].includes(String(data.role))
    ) {
      throw new Error("Only Owner/Admin can edit attendance.");
    }

    return data.school_id;
  }

  async function saveCell(
    staffId: string,
    date: string,
    status: CellStatus,
  ) {
    const key = `${staffId}|${date}`;
    try {
      setSavingKey(key);
      setError("");
      setSuccess("");

      const schoolId = await schoolForAdmin();
      const existing = overrideMap.get(key);

      if (status === "auto") {
        if (existing?.id) {
          const { error: deleteError } = await supabase
            .from("staff_attendance_overrides")
            .delete()
            .eq("id", existing.id)
            .eq("school_id", schoolId);

          if (deleteError) throw deleteError;
          setOverrides((current) =>
            current.filter((item) => item.id !== existing.id),
          );
        }
      } else {
        const payload = {
          school_id: schoolId,
          staff_id: staffId,
          attendance_date: date,
          status,
          notes: "Admin attendance entry",
        };

        if (existing?.id) {
          const { data, error: updateError } = await supabase
            .from("staff_attendance_overrides")
            .update(payload)
            .eq("id", existing.id)
            .eq("school_id", schoolId)
            .select("id, staff_id, attendance_date, status, notes")
            .single();

          if (updateError) throw updateError;

          setOverrides((current) =>
            current.map((item) => (item.id === existing.id ? (data as OverrideRecord) : item)),
          );
        } else {
          const { data, error: insertError } = await supabase
            .from("staff_attendance_overrides")
            .insert(payload)
            .select("id, staff_id, attendance_date, status, notes")
            .single();

          if (insertError) throw insertError;

          setOverrides((current) => [
            ...current,
            data as OverrideRecord,
          ]);
        }
      }

      await refreshMonthlySummary(staffId, schoolId);
      setSuccess("Attendance updated.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save attendance.",
      );
    } finally {
      setSavingKey("");
    }
  }

  async function refreshMonthlySummary(staffId: string, schoolId: string) {
    const { data: latestOverrides, error: overrideError } = await supabase
      .from("staff_attendance_overrides")
      .select("staff_id, attendance_date, status")
      .eq("school_id", schoolId)
      .eq("staff_id", staffId)
      .gte("attendance_date", `${month}-01`)
      .lte("attendance_date", `${month}-${pad(days.length)}`);

    if (overrideError) throw overrideError;

    const localOverrideMap = new Map<string, CellStatus>();
    for (const item of latestOverrides || []) {
      localOverrideMap.set(item.attendance_date, item.status as CellStatus);
    }

    const { data: latestAttendance, error: attendanceError } = await supabase
      .from("staff_attendance")
      .select(
        "attendance_date, status",
      )
      .eq("school_id", schoolId)
      .eq("staff_id", staffId)
      .gte("attendance_date", `${month}-01`)
      .lte("attendance_date", `${month}-${pad(days.length)}`);

    if (attendanceError) throw attendanceError;

    const actualMap = new Map<string, CellStatus>();
    for (const item of latestAttendance || []) {
      actualMap.set(
        item.attendance_date,
        actualToStatus(item as AttendanceRecord),
      );
    }

    let present = 0;
    let absent = 0;
    let holiday = 0;
    let weekOff = 0;
    let halfDay = 0;

    for (const day of days) {
      const date = dateFor(month, day);
      const calendarEntry = calendarMap.get(date);
      const calendarStatus =
        calendarEntry?.type === "holiday"
          ? "holiday"
          : calendarEntry?.type === "week_off"
            ? "week_off"
            : calendarEntry?.type === "working_day"
              ? "auto"
              : new Date(`${date}T00:00:00`).getDay() === weeklyOffDay
                ? "week_off"
                : "auto";
      const status =
        localOverrideMap.get(date) ||
        actualMap.get(date) ||
        calendarStatus;

      if (status === "present") present++;
      if (status === "absent") absent++;
      if (status === "holiday") holiday++;
      if (status === "week_off") weekOff++;
      if (status === "half_day") halfDay++;
    }

    const workingDays = Math.max(days.length - holiday - weekOff, 0);
    const workedDays = present + halfDay * 0.5;

    const { data: existing, error: findError } = await supabase
      .from("staff_monthly_attendance")
      .select("id")
      .eq("school_id", schoolId)
      .eq("staff_id", staffId)
      .eq("month", month)
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    const payload = {
      school_id: schoolId,
      staff_id: staffId,
      month,
      working_days: workingDays,
      worked_days: workedDays,
      paid_leave: 0,
      unpaid_leave: absent,
      school_holidays: holiday,
    };

    if (existing?.id) {
      const { error } = await supabase
        .from("staff_monthly_attendance")
        .update(payload)
        .eq("id", existing.id)
        .eq("school_id", schoolId);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("staff_monthly_attendance")
        .insert(payload);

      if (error) throw error;
    }
  }

  const calendarDays = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00`);
    const start = first.getDay();
    return [
      ...Array.from({ length: start }, () => null as number | null),
      ...days,
    ];
  }, [month, days]);

  function openCalendar() {
    const firstDate = dateFor(month, 1);
    const existing = calendarMap.get(firstDate);
    setCalendarDate(firstDate);
    setCalendarType(existing?.type || "holiday");
    setCalendarTitle(existing?.title || "");
    setCalendarError("");
    setCalendarOpen(true);
  }

  function selectCalendarDate(date: string) {
    const existing = calendarMap.get(date);
    setCalendarDate(date);
    setCalendarType(existing?.type || "holiday");
    setCalendarTitle(existing?.title || "");
    setCalendarError("");
  }

  async function saveCalendarEntry() {
    if (!calendarDate) return;

    try {
      setCalendarSaving(true);
      setCalendarError("");
      setError("");

      const activeSchoolId = schoolId || (await schoolForAdmin());
      const existing = calendarMap.get(calendarDate);

      const payload = {
        school_id: activeSchoolId,
        attendance_date: calendarDate,
        type: calendarType,
        title: calendarTitle.trim() || null,
      };

      const { data, error: upsertError } = await supabase
        .from("school_attendance_calendar")
        .upsert(payload, { onConflict: "school_id,attendance_date" })
        .select("id, school_id, attendance_date, type, title")
        .single();

      if (upsertError) throw upsertError;

      const nextEntries = existing
        ? calendarEntries.map((item) =>
            item.id === existing.id ? (data as SchoolCalendarEntry) : item,
          )
        : [...calendarEntries, data as SchoolCalendarEntry];

      setCalendarEntries(nextEntries);
      setSuccess(
        calendarType === "holiday"
          ? `Holiday added for ${calendarDate}. It now applies to all staff.`
          : calendarType === "week_off"
            ? `Week Off added for ${calendarDate}. It now applies to all staff.`
            : `Working Day set for ${calendarDate}.`,
      );

      await syncAllMonthlySummaries(activeSchoolId, nextEntries, weeklyOffDay);
    } catch (err) {
      setCalendarError(
        err instanceof Error ? err.message : "Unable to save calendar date.",
      );
    } finally {
      setCalendarSaving(false);
    }
  }

  async function clearCalendarEntry() {
    if (!calendarDate) return;

    try {
      setCalendarSaving(true);
      setCalendarError("");

      const activeSchoolId = schoolId || (await schoolForAdmin());
      const existing = calendarMap.get(calendarDate);
      if (!existing?.id) {
        setSuccess("This date is already using its normal calendar rule.");
        return;
      }

      const { error: deleteError } = await supabase
        .from("school_attendance_calendar")
        .delete()
        .eq("id", existing.id)
        .eq("school_id", activeSchoolId);

      if (deleteError) throw deleteError;

      const nextEntries = calendarEntries.filter((item) => item.id !== existing.id);
      setCalendarEntries(nextEntries);
      setSuccess(`Calendar rule cleared for ${calendarDate}.`);
      await syncAllMonthlySummaries(activeSchoolId, nextEntries, weeklyOffDay);
    } catch (err) {
      setCalendarError(
        err instanceof Error ? err.message : "Unable to clear calendar date.",
      );
    } finally {
      setCalendarSaving(false);
    }
  }

  async function saveWeeklyOffDay(value: number) {
    try {
      setSettingsSaving(true);
      setCalendarError("");
      const activeSchoolId = schoolId || (await schoolForAdmin());

      const { error: settingsError } = await supabase
        .from("school_attendance_settings")
        .upsert(
          { school_id: activeSchoolId, weekly_off_day: value },
          { onConflict: "school_id" },
        );

      if (settingsError) throw settingsError;

      setWeeklyOffDay(value);
      await syncAllMonthlySummaries(activeSchoolId, calendarEntries, value);
      setSuccess(`Weekly Off changed to ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][value]}.`);
    } catch (err) {
      setCalendarError(
        err instanceof Error ? err.message : "Unable to save weekly off day.",
      );
    } finally {
      setSettingsSaving(false);
    }
  }

  async function syncAllMonthlySummaries(
    activeSchoolId: string,
    calendarForSummary: SchoolCalendarEntry[],
    weeklyOffForSummary: number,
  ) {
    const localCalendarMap = new Map<string, SchoolCalendarEntry>();
    for (const item of calendarForSummary) {
      localCalendarMap.set(item.attendance_date, item);
    }

    for (const item of staff) {
      let present = 0;
      let absent = 0;
      let holiday = 0;
      let weekOff = 0;
      let halfDay = 0;

      for (const day of days) {
        const date = dateFor(month, day);
        const key = `${item.id}|${date}`;
        const override = overrideMap.get(key);
        const actual = attendanceMap.get(key);
        const calendarEntry = localCalendarMap.get(date);
        const calendarStatus =
          calendarEntry?.type === "holiday"
            ? "holiday"
            : calendarEntry?.type === "week_off"
              ? "week_off"
              : calendarEntry?.type === "working_day"
                ? "auto"
                : new Date(`${date}T00:00:00`).getDay() === weeklyOffForSummary
                  ? "week_off"
                  : "auto";
        const status = override?.status || (actual ? actualToStatus(actual) : calendarStatus);

        if (status === "present") present++;
        if (status === "absent") absent++;
        if (status === "holiday") holiday++;
        if (status === "week_off") weekOff++;
        if (status === "half_day") halfDay++;
      }

      const workingDays = Math.max(days.length - holiday - weekOff, 0);
      const workedDays = present + halfDay * 0.5;

      const { data: existing, error: findError } = await supabase
        .from("staff_monthly_attendance")
        .select("id")
        .eq("school_id", activeSchoolId)
        .eq("staff_id", item.id)
        .eq("month", month)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      const payload = {
        school_id: activeSchoolId,
        staff_id: item.id,
        month,
        working_days: workingDays,
        worked_days: workedDays,
        paid_leave: 0,
        unpaid_leave: absent,
        school_holidays: holiday,
      };

      if (existing?.id) {
        const { error } = await supabase
          .from("staff_monthly_attendance")
          .update(payload)
          .eq("id", existing.id)
          .eq("school_id", activeSchoolId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("staff_monthly_attendance")
          .insert(payload);
        if (error) throw error;
      }
    }
  }

  function openDetails(staffId: string) {
    setSelectedStaffId(staffId);
    setDetailsOpen(true);
  }

  function exportCsv() {
    const rows: string[][] = [];

    rows.push([
      schoolName,
      "Staff Monthly Attendance",
      month,
    ]);

    rows.push([
      "Employee No",
      "Staff Name",
      ...days.map((day) => dateFor(month, day)),
      "Present",
      "Half Day",
      "Absent",
      "Holiday",
      "Week Off",
      "Working Days",
      "Worked Days",
    ]);

    for (const item of filteredStaff) {
      const summary = getSummary(item.id);
      rows.push([
        item.employee_no || "",
        staffName(item),
        ...days.map((day) => {
          const date = dateFor(month, day);
          const status = getCellStatus(item.id, date);
          if (status === "auto") {
            const actual = attendanceMap.get(`${item.id}|${date}`);
            return actual ? STATUS_LABEL[actualToStatus(actual)] : "";
          }
          return STATUS_LABEL[status];
        }),
        String(summary.present),
        String(summary.halfDay),
        String(summary.absent),
        String(summary.holiday),
        String(summary.weekOff),
        String(summary.workingDays),
        String(summary.workedDays),
      ]);
    }

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${schoolName.replace(/\s+/g, "-")}-staff-attendance-${month}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const selectedStaff = selectedStaffId
    ? staffMap.get(selectedStaffId) || null
    : null;

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl rounded-2xl border bg-white p-16 text-center shadow-sm">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-3 text-sm font-semibold text-slate-600">
            Loading staff attendance...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-600">
              <CalendarDays size={17} />
              Admin Attendance
            </div>
            <h1 className="mt-1 text-3xl font-black text-slate-900">
              Staff Monthly Attendance
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage Present, Absent, Holiday, Week Off and Half Day. Teacher
              GPS check-in/out remains automatic.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              School calendar: {(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const)[weeklyOffDay]} is the default Weekly Off. Holidays added here apply to all staff.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"
            />
            <button
              type="button"
              onClick={openCalendar}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100"
            >
              <CalendarDays size={16} />
              Manage Calendar
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Download size={16} />
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Save size={16} />
              Print / PDF
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search staff name, employee number or designation..."
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 md:max-w-md"
          />

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-emerald-700">
              P = Present
            </span>
            <span className="rounded-lg bg-red-50 px-2.5 py-1.5 text-red-700">
              A = Absent
            </span>
            <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-700">
              H = Holiday
            </span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-700">
              W/O = Week Off
            </span>
            <span className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-violet-700">
              ½ = Half Day
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
            <Check size={17} />
            {success}
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b bg-slate-50 px-5 py-4">
            <div>
              <p className="font-bold text-slate-900">{schoolName}</p>
              <p className="text-xs text-slate-500">
                {month} • {staff.length} staff members
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <ShieldCheck size={16} className="text-blue-600" />
              Admin editing only
            </div>
          </div>

          <div className="overflow-auto">
            <table className="min-w-[1500px] border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50">
                  <th className="sticky left-0 z-20 min-w-[230px] border-b border-r bg-slate-50 px-4 py-3 text-left font-black text-slate-500">
                    STAFF
                  </th>

                  {days.map((day) => {
                    const date = dateFor(month, day);
                    const weekday = new Intl.DateTimeFormat("en-IN", {
                      weekday: "short",
                    }).format(new Date(`${date}T00:00:00`));

                    return (
                      <th
                        key={day}
                        className={`min-w-[55px] border-b px-1 py-2 text-center font-black ${
                          date === today
                            ? "bg-blue-50 text-blue-700"
                            : "text-slate-500"
                        }`}
                      >
                        <div>{day}</div>
                        <div className="text-[9px] font-semibold">
                          {weekday}
                        </div>
                      </th>
                    );
                  })}

                  <th className="min-w-[70px] border-b bg-emerald-50 px-2 text-center font-black text-emerald-700">
                    P
                  </th>
                  <th className="min-w-[70px] border-b bg-violet-50 px-2 text-center font-black text-violet-700">
                    ½
                  </th>
                  <th className="min-w-[70px] border-b bg-red-50 px-2 text-center font-black text-red-700">
                    A
                  </th>
                  <th className="min-w-[70px] border-b bg-amber-50 px-2 text-center font-black text-amber-700">
                    H
                  </th>
                  <th className="min-w-[70px] border-b bg-slate-100 px-2 text-center font-black text-slate-700">
                    W/O
                  </th>
                  <th className="min-w-[80px] border-b px-2 text-center font-black text-slate-600">
                    WORKING
                  </th>
                  <th className="min-w-[80px] border-b px-2 text-center font-black text-slate-600">
                    WORKED
                  </th>
                  <th className="sticky right-0 z-20 min-w-[95px] border-b border-l bg-slate-50 px-2 text-center font-black text-slate-500">
                    DETAILS
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredStaff.map((item) => {
                  const summary = getSummary(item.id);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-10 border-b border-r bg-white px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDetails(item.id)}
                          className="text-left"
                        >
                          <p className="font-bold text-slate-900">
                            {staffName(item)}
                          </p>
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            {item.employee_no || "—"} •{" "}
                            {item.designation || "Staff"}
                          </p>
                        </button>
                      </td>

                      {days.map((day) => {
                        const date = dateFor(month, day);
                        const key = `${item.id}|${date}`;
                        const status = getCellStatus(item.id, date);
                        const saving = savingKey === key;
                        const override = overrideMap.get(key);

                        return (
                          <td
                            key={day}
                            className={`border-b px-1 py-1 text-center ${
                              date === today ? "bg-blue-50/50" : ""
                            }`}
                          >
                            <select
                              value={status}
                              disabled={saving}
                              onChange={(event) =>
                                void saveCell(
                                  item.id,
                                  date,
                                  event.target.value as CellStatus,
                                )
                              }
                              title={
                                override
                                  ? `Admin: ${STATUS_FULL[status]}`
                                  : attendanceMap.get(key)
                                    ? `GPS: ${STATUS_FULL[status]}`
                                    : "Not marked"
                              }
                              className={`h-9 w-[52px] rounded-lg border px-1 text-center text-[11px] font-black outline-none ${
                                status === "present"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : status === "absent"
                                    ? "border-red-200 bg-red-50 text-red-700"
                                    : status === "holiday"
                                      ? "border-amber-200 bg-amber-50 text-amber-700"
                                      : status === "week_off"
                                        ? "border-slate-200 bg-slate-100 text-slate-700"
                                        : status === "half_day"
                                          ? "border-violet-200 bg-violet-50 text-violet-700"
                                          : "border-slate-200 bg-white text-slate-400"
                              }`}
                            >
                              <option value="auto">
                                {saving ? "…" : "-"}
                              </option>
                              <option value="present">P</option>
                              <option value="absent">A</option>
                              <option value="half_day">½</option>
                              <option value="holiday">H</option>
                              <option value="week_off">W/O</option>
                            </select>
                          </td>
                        );
                      })}

                      <td className="border-b bg-emerald-50/40 px-2 text-center font-black text-emerald-700">
                        {summary.present}
                      </td>
                      <td className="border-b bg-violet-50/40 px-2 text-center font-black text-violet-700">
                        {summary.halfDay}
                      </td>
                      <td className="border-b bg-red-50/40 px-2 text-center font-black text-red-700">
                        {summary.absent}
                      </td>
                      <td className="border-b bg-amber-50/40 px-2 text-center font-black text-amber-700">
                        {summary.holiday}
                      </td>
                      <td className="border-b bg-slate-50 px-2 text-center font-black text-slate-700">
                        {summary.weekOff}
                      </td>
                      <td className="border-b px-2 text-center font-bold text-slate-700">
                        {summary.workingDays}
                      </td>
                      <td className="border-b px-2 text-center font-bold text-slate-700">
                        {summary.workedDays}
                      </td>
                      <td className="sticky right-0 z-10 border-b border-l bg-white px-2 text-center">
                        <button
                          type="button"
                          onClick={() => openDetails(item.id)}
                          className="rounded-lg border px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredStaff.length === 0 && (
                  <tr>
                    <td
                      colSpan={days.length + 9}
                      className="px-6 py-16 text-center text-sm text-slate-500"
                    >
                      No staff members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t bg-slate-50 px-5 py-3 text-xs text-slate-500">
            <strong>How it works:</strong> School Calendar holidays and weekly offs apply to all staff. Teacher GPS check-in/out remains the automatic source when a real attendance record exists. Admin can override any individual day with P, A, H, W/O or ½. Selecting “-” removes the staff override and returns to the calendar/GPS rule.
          </div>
        </section>

        {calendarOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b px-6 py-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                    School Calendar
                  </p>
                  <h2 className="mt-1 text-xl font-black text-slate-900">
                    Holidays & Weekly Off
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Add a holiday once and it applies to every staff member. GPS attendance still takes priority.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCalendarOpen(false)}
                  className="rounded-xl border p-2 text-slate-500 hover:bg-slate-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="font-black text-slate-900">
                        {new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`))}
                      </p>
                      <p className="text-xs text-slate-500">Click a date to manage it.</p>
                    </div>
                    <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                      Default W/O: {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weeklyOffDay]}
                    </span>
                  </div>

                  <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-black text-slate-400">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <div key={day} className="py-2">{day}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {calendarDays.map((day, index) => {
                      if (day == null) return <div key={`blank-${index}`} className="h-20" />;
                      const date = dateFor(month, day);
                      const entry = calendarMap.get(date);
                      const actualCount = attendance.filter((item) => item.attendance_date === date).length;
                      const baseStatus = defaultCalendarStatus(date);
                      const isSelected = calendarDate === date;
                      const statusText = entry?.type === "holiday" ? "H" : entry?.type === "week_off" ? "W/O" : entry?.type === "working_day" ? "Work" : baseStatus === "week_off" ? "W/O" : "";

                      return (
                        <button
                          key={date}
                          type="button"
                          onClick={() => selectCalendarDate(date)}
                          className={`h-20 rounded-xl border p-2 text-left transition ${
                            isSelected ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : entry?.type === "holiday" ? "border-amber-200 bg-amber-50" : statusText === "W/O" ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-black text-slate-800">{day}</span>
                            {actualCount > 0 && <span className="h-2 w-2 rounded-full bg-emerald-500" title="GPS attendance exists" />}
                          </div>
                          <div className="mt-2 text-[10px] font-black text-slate-500">{statusText || "Working"}</div>
                          {entry?.title && <div className="mt-1 truncate text-[9px] font-semibold text-slate-500">{entry.title}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border bg-slate-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Selected Date</p>
                  <p className="mt-1 text-lg font-black text-slate-900">
                    {calendarDate ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${calendarDate}T00:00:00`)) : "Select a date"}
                  </p>

                  <label className="mt-5 block text-xs font-bold text-slate-600">Calendar Rule</label>
                  <select
                    value={calendarType}
                    onChange={(event) => setCalendarType(event.target.value as typeof calendarType)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"
                  >
                    <option value="holiday">Holiday — H</option>
                    <option value="week_off">Weekly Off — W/O</option>
                    <option value="working_day">Working Day — override default W/O</option>
                  </select>

                  <label className="mt-4 block text-xs font-bold text-slate-600">Holiday / Event Name</label>
                  <input
                    value={calendarTitle}
                    onChange={(event) => setCalendarTitle(event.target.value)}
                    placeholder="e.g. Independence Day"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  />

                  {calendarError && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                      {calendarError}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={calendarSaving || !calendarDate}
                    onClick={() => void saveCalendarEntry()}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {calendarSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save Calendar Date
                  </button>

                  <button
                    type="button"
                    disabled={calendarSaving || !calendarDate || !calendarMap.get(calendarDate)}
                    onClick={() => void clearCalendarEntry()}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
                  >
                    <X size={16} />
                    Clear Date Rule
                  </button>

                  <div className="mt-6 border-t pt-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">School Weekly Off</p>
                    <p className="mt-1 text-xs text-slate-500">Default is Sunday. Change it once for the whole school.</p>
                    <select
                      value={weeklyOffDay}
                      disabled={settingsSaving}
                      onChange={(event) => void saveWeeklyOffDay(Number(event.target.value))}
                      className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"
                    >
                      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((name, index) => (
                        <option key={name} value={index}>{name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                    <strong>Rule:</strong> Admin override → GPS attendance → School Calendar → Weekly Off → unmarked. So a real teacher check-in remains P/½ even when the date is a holiday or weekly off.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {detailsOpen && selectedStaff && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b px-6 py-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                    Attendance Details
                  </p>
                  <h2 className="mt-1 text-xl font-black text-slate-900">
                    {staffName(selectedStaff)}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {selectedStaff.employee_no || "—"} • {month}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setDetailsOpen(false)}
                  className="rounded-xl border p-2 text-slate-500 hover:bg-slate-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-3 p-6 sm:grid-cols-5">
                {(() => {
                  const summary = getSummary(selectedStaff.id);

                  return (
                    <>
                      <div className="rounded-xl bg-emerald-50 p-4">
                        <p className="text-xs font-bold text-emerald-600">
                          PRESENT
                        </p>
                        <p className="mt-1 text-2xl font-black text-emerald-800">
                          {summary.present}
                        </p>
                      </div>
                      <div className="rounded-xl bg-violet-50 p-4">
                        <p className="text-xs font-bold text-violet-600">
                          HALF DAY
                        </p>
                        <p className="mt-1 text-2xl font-black text-violet-800">
                          {summary.halfDay}
                        </p>
                      </div>
                      <div className="rounded-xl bg-red-50 p-4">
                        <p className="text-xs font-bold text-red-600">
                          ABSENT
                        </p>
                        <p className="mt-1 text-2xl font-black text-red-800">
                          {summary.absent}
                        </p>
                      </div>
                      <div className="rounded-xl bg-amber-50 p-4">
                        <p className="text-xs font-bold text-amber-600">
                          HOLIDAY
                        </p>
                        <p className="mt-1 text-2xl font-black text-amber-800">
                          {summary.holiday}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-100 p-4">
                        <p className="text-xs font-bold text-slate-600">
                          WEEK OFF
                        </p>
                        <p className="mt-1 text-2xl font-black text-slate-800">
                          {summary.weekOff}
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="divide-y border-t">
                {days.map((day) => {
                  const date = dateFor(month, day);
                  const key = `${selectedStaff.id}|${date}`;
                  const actual = attendanceMap.get(key);
                  const override = overrideMap.get(key);
                  const status = getCellStatus(selectedStaff.id, date);

                  return (
                    <div
                      key={date}
                      className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-bold text-slate-900">
                          {new Intl.DateTimeFormat("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          }).format(new Date(`${date}T00:00:00`))}
                        </p>
                        <p className="text-xs text-slate-500">
                          {override
                            ? `Admin override: ${STATUS_FULL[status]}`
                            : actual
                              ? `GPS attendance: ${STATUS_FULL[status]}`
                              : "No attendance record"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                        {actual && (
                          <>
                            <span>
                              In:{" "}
                              <strong>{formatTime(actual.check_in_at)}</strong>
                            </span>
                            <span>
                              Out:{" "}
                              <strong>{formatTime(actual.check_out_at)}</strong>
                            </span>
                            <span>
                              Work:{" "}
                              <strong>
                                {formatMinutes(actual.working_minutes)}
                              </strong>
                            </span>
                            {actual.is_late && (
                              <span className="font-bold text-amber-700">
                                Late
                              </span>
                            )}
                            {actual.is_early_checkout && (
                              <span className="font-bold text-red-700">
                                Early
                              </span>
                            )}
                          </>
                        )}

                        <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-black">
                          {STATUS_LABEL[status]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 border-t bg-slate-50 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setDetailsOpen(false)}
                  className="rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  <Download size={16} />
                  Download Monthly
                </button>
              </div>
            </div>
          </div>
        )}


        <style>{`
          @media print {
            @page {
              size: A4 landscape;
              margin: 8mm;
            }

            body {
              background: white !important;
            }

            .no-print {
              display: none !important;
            }

            header,
            nav,
            aside {
              display: none !important;
            }

            main {
              padding: 0 !important;
              min-height: 0 !important;
            }

            main > div {
              max-width: none !important;
            }

            section {
              box-shadow: none !important;
              border: 1px solid #cbd5e1 !important;
            }

            .overflow-auto {
              overflow: visible !important;
            }

            table {
              min-width: 0 !important;
              width: 100% !important;
              font-size: 7px !important;
            }

            th,
            td {
              padding: 3px 2px !important;
            }

            th:first-child,
            td:first-child {
              position: static !important;
            }
          }
        `}</style>
      </div>
    </main>
  );
}
