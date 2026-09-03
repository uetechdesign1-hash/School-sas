"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Crosshair,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  user_id: string | null;
  employee_no: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  department: string | null;
  photo_url: string | null;
  status: string | null;
};

type Attendance = {
  id: string;
  staff_id: string | null;
  employee_id: string;
  attendance_date: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  check_in_latitude: number | null;
  check_in_longitude: number | null;
  check_in_accuracy_meters: number | null;
  check_out_latitude: number | null;
  check_out_longitude: number | null;
  check_out_accuracy_meters: number | null;
  check_in_distance_meters: number | null;
  check_out_distance_meters: number | null;
  working_minutes: number | null;
  is_late: boolean | null;
  is_early_checkout: boolean | null;
};

type LocationState = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function getName(staff: Staff | null) {
  if (!staff) return "Staff Member";

  return [staff.first_name, staff.middle_name, staff.last_name]
    .filter(Boolean)
    .join(" ");
}

function formatTime(value: string | null) {
  if (!value) return "--:--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "--:--";

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatMinutes(minutes: number | null) {
  if (minutes === null || minutes === undefined) {
    return "--h --m";
  }

  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;

  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

function formatDistance(distance: number | null) {
  if (distance === null || distance === undefined) return "—";

  if (distance < 1000) {
    return `${Math.round(distance)} m`;
  }

  return `${(distance / 1000).toFixed(2)} km`;
}

function statusLabel(status: string | null) {
  if (!status) return "Not checked in";

  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);

  if (parts.length === 1) {
    return parts[0]?.slice(0, 2).toUpperCase() || "ST";
  }

  return `${parts[0]?.[0] || ""}${
    parts[parts.length - 1]?.[0] || ""
  }`.toUpperCase();
}

function getLocation(): Promise<LocationState> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          "GPS is not supported by this device. Please use a device with location services."
        )
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        let message = "Unable to get your location.";

        switch (error.code) {
          case error.PERMISSION_DENIED:
            message =
              "Location permission was denied. Please allow location access and try again.";
            break;

          case error.POSITION_UNAVAILABLE:
            message =
              "Your current location is unavailable. Please check GPS/location services.";
            break;

          case error.TIMEOUT:
            message =
              "GPS location request timed out. Please try again.";
            break;
        }

        reject(new Error(message));
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });
}

export default function StaffDailyAttendancePage() {
  const supabase = useMemo(() => createClient(), []);

  const [staff, setStaff] = useState<Staff | null>(null);
  const [attendance, setAttendance] = useState<Attendance | null>(null);

  const [loading, setLoading] = useState(true);
  const [locationLoading, setLocationLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [location, setLocation] = useState<LocationState | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [currentTime, setCurrentTime] = useState(new Date());

  /*
   * Update the visible clock every second.
   *
   * This clock is ONLY UI.
   * Attendance timestamps come from the secure database/RPC.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      /*
       * Resolve the active school from the logged-in account.
       */
      const { data: schoolUser, error: schoolError } = await supabase
        .from("school_users")
        .select("school_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (schoolError) throw schoolError;

      if (!schoolUser) {
        throw new Error("No active school is assigned to your account.");
      }

      /*
       * IMPORTANT:
       * Staff must be connected through staff.user_id.
       *
       * We do NOT identify staff using name, email or employee number.
       */
      const { data: staffRow, error: staffError } = await supabase
        .from("staff")
        .select(
          `
            id,
            school_id,
            user_id,
            employee_no,
            first_name,
            middle_name,
            last_name,
            designation,
            department,
            photo_url,
            status
          `
        )
        .eq("school_id", schoolUser.school_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (staffError) throw staffError;

      if (!staffRow) {
        throw new Error(
          "Your login account is not assigned to a staff member. Please contact the school administrator."
        );
      }

      setStaff(staffRow);

      /*
       * Use the school's local date.
       *
       * The database stores the actual attendance timestamp.
       * This date is only used to retrieve today's record.
       */
      const today = new Date();

      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, "0");
      const day = String(today.getDate()).padStart(2, "0");

      const dateString = `${year}-${month}-${day}`;

      const { data: attendanceRow, error: attendanceError } =
        await supabase
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
              check_in_latitude,
              check_in_longitude,
              check_in_accuracy_meters,
              check_out_latitude,
              check_out_longitude,
              check_out_accuracy_meters,
              check_in_distance_meters,
              check_out_distance_meters,
              working_minutes,
              is_late,
              is_early_checkout
            `
          )
          .eq("school_id", schoolUser.school_id)
          .eq("staff_id", staffRow.id)
          .eq("attendance_date", dateString)
          .maybeSingle();

      if (attendanceError) throw attendanceError;

      setAttendance(attendanceRow);
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message || "Unable to load today's attendance."
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  /*
   * Get fresh GPS coordinates.
   *
   * We deliberately do NOT reuse an old browser position.
   */
  const refreshLocation = async () => {
    setLocationLoading(true);
    setError("");
    setSuccess("");

    try {
      const position = await getLocation();

      setLocation(position);

      setSuccess(
        `Location detected. Accuracy ±${Math.round(
          position.accuracy
        )}m`
      );
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message || "Unable to determine your current location."
      );
    } finally {
      setLocationLoading(false);
    }
  };

  /*
   * CHECK IN
   *
   * Browser sends only:
   * latitude
   * longitude
   * accuracy
   *
   * Server RPC decides:
   * - correct staff
   * - correct school
   * - attendance date
   * - geofence
   * - GPS accuracy
   * - late status
   * - server timestamp
   */
  const checkIn = async () => {
    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      const freshLocation = await getLocation();

      setLocation(freshLocation);

      const { data, error: rpcError } = await supabase.rpc(
        "staff_check_in",
        {
          p_latitude: freshLocation.latitude,
          p_longitude: freshLocation.longitude,
          p_accuracy_meters: freshLocation.accuracy,
        }
      );

      if (rpcError) throw rpcError;

      if (data?.success === false) {
        throw new Error(
          data?.message || "Check-in was not completed."
        );
      }

      setSuccess(
        data?.message || "Check-in successful."
      );

      await loadAttendance();
    } catch (err: any) {
      console.error(err);

      setError(
        err?.message ||
          "Check-in failed. Please make sure GPS is enabled and you are inside the school area."
      );
    } finally {
      setActionLoading(false);
    }
  };

  /*
   * CHECK OUT
   */
  const checkOut = async () => {
    setActionLoading(true);
    setError("");
    setSuccess("");

    try {
      const freshLocation = await getLocation();

      setLocation(freshLocation);

      const { data, error: rpcError } = await supabase.rpc(
        "staff_check_out",
        {
          p_latitude: freshLocation.latitude,
          p_longitude: freshLocation.longitude,
          p_accuracy_meters: freshLocation.accuracy,
        }
      );

      if (rpcError) throw rpcError;

      if (data?.success === false) {
        throw new Error(
          data?.message || "Check-out was not completed."
        );
      }

      setSuccess(
        data?.message || "Check-out successful."
      );

      await loadAttendance();
    } catch (err: any) {
      console.error(err);

      setError(
        err?.message ||
          "Check-out failed. Please make sure GPS is enabled and you are inside the school area."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const name = getName(staff);

  const isCheckedIn =
    !!attendance?.check_in_at && !attendance?.check_out_at;

  const isCompleted =
    !!attendance?.check_in_at && !!attendance?.check_out_at;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl animate-pulse">
          <div className="h-7 w-40 rounded bg-slate-200" />

          <div className="mt-6 h-72 rounded-3xl bg-white" />

          <div className="mt-6 h-48 rounded-2xl bg-white" />
        </div>
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto h-12 w-12 text-red-500" />

          <h1 className="mt-4 text-xl font-bold text-slate-900">
            Attendance Access Unavailable
          </h1>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            {error ||
              "Your login account is not connected to a staff member."}
          </p>

          <Link
            href="/dashboard"
            className="mt-6 inline-flex rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Top navigation */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/dashboard/staff"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Staff
          </Link>

          <button
            type="button"
            onClick={loadAttendance}
            disabled={loading || actionLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {/* Staff header */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {staff.photo_url ? (
                <img
                  src={staff.photo_url}
                  alt={name}
                  className="h-16 w-16 rounded-2xl object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
                  {initials(name)}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Staff Attendance
                </p>

                <h1 className="mt-1 text-xl font-bold text-slate-900">
                  {name}
                </h1>

                <p className="mt-1 text-sm text-slate-500">
                  {staff.designation || "Staff Member"}
                  {staff.department
                    ? ` • ${staff.department}`
                    : ""}
                </p>

                {staff.employee_no && (
                  <p className="mt-1 text-xs text-slate-400">
                    Employee No: {staff.employee_no}
                  </p>
                )}
              </div>
            </div>

            <div className="text-left sm:text-right">
              <p className="text-2xl font-bold text-slate-900">
                {currentTime.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: true,
                })}
              </p>

              <p className="mt-1 text-xs text-slate-500">
                {formatDate(currentTime)}
              </p>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <p className="font-semibold">
                Attendance action failed
              </p>

              <p className="mt-1 leading-5">
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <p className="font-semibold">Success</p>

              <p className="mt-1 leading-5">
                {success}
              </p>
            </div>
          </div>
        )}

        {/* Main attendance card */}
        <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-7">
            <div className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-slate-700" />

              <h2 className="text-base font-bold text-slate-900">
                Today's Attendance
              </h2>
            </div>

            <p className="mt-1 text-sm text-slate-500">
              GPS verification is required for check-in and check-out.
            </p>
          </div>

          <div className="p-5 sm:p-7">
            {/* GPS status */}
            <div
              className={`rounded-2xl border p-5 ${
                location
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                      location
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-white text-slate-600"
                    }`}
                  >
                    {location ? (
                      <MapPin className="h-5 w-5" />
                    ) : (
                      <Crosshair className="h-5 w-5" />
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {location
                        ? "Location detected"
                        : "Location not detected"}
                    </p>

                    {location ? (
                      <p className="mt-1 text-xs text-slate-600">
                        GPS accuracy ±
                        {Math.round(location.accuracy)}m
                      </p>
                    ) : (
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Your current location will be checked before
                        attendance is recorded.
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={refreshLocation}
                  disabled={locationLoading || actionLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {locationLoading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                      Detecting...
                    </>
                  ) : (
                    <>
                      <Navigation className="h-4 w-4" />
                      Detect Location
                    </>
                  )}
                </button>
              </div>

              {location && (
                <div className="mt-4 grid gap-3 border-t border-emerald-200 pt-4 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Latitude
                    </p>

                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {location.latitude.toFixed(7)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Longitude
                    </p>

                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {location.longitude.toFixed(7)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Accuracy
                    </p>

                    <p className="mt-1 text-sm font-medium text-slate-700">
                      ±{Math.round(location.accuracy)}m
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Action */}
            <div className="mt-7 text-center">
              {!attendance && (
                <>
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <LogIn className="h-7 w-7" />
                  </div>

                  <h3 className="mt-4 text-xl font-bold text-slate-900">
                    Ready to Check In?
                  </h3>

                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                    Allow GPS access and check in when you arrive at
                    school. Your location will be verified against the
                    school's attendance area.
                  </p>

                  <button
                    type="button"
                    onClick={checkIn}
                    disabled={actionLoading}
                    className="mt-6 inline-flex min-w-48 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-7 py-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <>
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Verifying GPS...
                      </>
                    ) : (
                      <>
                        <LogIn className="h-5 w-5" />
                        CHECK IN
                      </>
                    )}
                  </button>
                </>
              )}

              {isCheckedIn && (
                <>
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>

                  <p className="mt-4 text-xs font-bold uppercase tracking-wider text-emerald-600">
                    Checked In
                  </p>

                  <p className="mt-1 text-3xl font-bold text-slate-900">
                    {formatTime(attendance.check_in_at)}
                  </p>

                  <p className="mt-2 text-sm text-slate-500">
                    Your attendance has been recorded.
                  </p>

                  <button
                    type="button"
                    onClick={checkOut}
                    disabled={actionLoading}
                    className="mt-6 inline-flex min-w-48 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-7 py-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <>
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Verifying GPS...
                      </>
                    ) : (
                      <>
                        <LogOut className="h-5 w-5" />
                        CHECK OUT
                      </>
                    )}
                  </button>
                </>
              )}

              {isCompleted && (
                <>
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-8 w-8" />
                  </div>

                  <p className="mt-4 text-xs font-bold uppercase tracking-wider text-emerald-600">
                    Attendance Complete
                  </p>

                  <h3 className="mt-1 text-2xl font-bold text-slate-900">
                    Today's attendance is complete
                  </h3>

                  <p className="mt-2 text-sm text-slate-500">
                    No further action is required.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Today's summary */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <LogIn className="h-4 w-4" />
            </div>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Check In
            </p>

            <p className="mt-1 text-xl font-bold text-slate-900">
              {formatTime(attendance?.check_in_at || null)}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <LogOut className="h-4 w-4" />
            </div>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Check Out
            </p>

            <p className="mt-1 text-xl font-bold text-slate-900">
              {formatTime(attendance?.check_out_at || null)}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Clock3 className="h-4 w-4" />
            </div>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Working Time
            </p>

            <p className="mt-1 text-xl font-bold text-slate-900">
              {formatMinutes(attendance?.working_minutes ?? null)}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <ShieldCheck className="h-4 w-4" />
            </div>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Status
            </p>

            <p className="mt-1 text-xl font-bold text-slate-900">
              {statusLabel(attendance?.status || null)}
            </p>
          </div>
        </div>

        {/* Verification information */}
        {attendance && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-slate-600" />

                <h2 className="text-sm font-semibold text-slate-900">
                  Attendance Verification
                </h2>
              </div>
            </div>

            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Check-in Location
                </p>

                <p className="mt-1 text-sm font-medium text-slate-700">
                  {formatDistance(
                    attendance.check_in_distance_meters
                  )}{" "}
                  from school
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  GPS accuracy ±
                  {attendance.check_in_accuracy_meters !== null
                    ? Math.round(
                        attendance.check_in_accuracy_meters
                      )
                    : "—"}
                  m
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Check-out Location
                </p>

                {attendance.check_out_at ? (
                  <>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {formatDistance(
                        attendance.check_out_distance_meters
                      )}{" "}
                      from school
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      GPS accuracy ±
                      {attendance.check_out_accuracy_meters !== null
                        ? Math.round(
                            attendance.check_out_accuracy_meters
                          )
                        : "—"}
                      m
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    Not checked out yet
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Late Arrival
                </p>

                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {attendance.is_late ? "Yes" : "No"}
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Early Checkout
                </p>

                <p className="mt-1 text-sm font-semibold text-slate-800">
                  {attendance.is_early_checkout ? "Yes" : "No"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Security notice */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-100 p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />

            <div>
              <p className="text-sm font-semibold text-slate-800">
                Secure Attendance
              </p>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                Attendance time and location verification are processed
                by the school's secure attendance service. The time
                shown above is only a live display and is not used as
                the attendance timestamp.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}