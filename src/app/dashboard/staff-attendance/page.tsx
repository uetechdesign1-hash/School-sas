"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  ShieldCheck,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Attendance = {
  id: string;
  attendance_date: string;
  status: "present" | "absent" | "late" | "half_day";
  check_in_at: string | null;
  check_out_at: string | null;
  working_minutes: number | null;
  is_late: boolean;
  is_early_checkout: boolean;
  check_in_distance_meters: number | null;
  check_out_distance_meters: number | null;
};

function formatTime(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatMinutes(minutes: number | null) {
  if (minutes == null) return "—";

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${hours}h ${mins}m`;
}

export default function StaffAttendancePage() {
  const supabase = createClient();

  const [attendance, setAttendance] =
    useState<Attendance | null>(null);

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void loadToday();
  }, []);

  async function getSchoolId() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.assign("/login");
      return null;
    }

    const { data, error } = await supabase
      .from("school_users")
      .select("school_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data?.school_id) {
      throw new Error(
        "Your account is not assigned to an active school.",
      );
    }

    return data.school_id;
  }

  async function loadToday() {
    try {
      setLoading(true);
      setError("");

      const schoolId = await getSchoolId();

      if (!schoolId) return;

      /*
       * We intentionally do not query by staff_id here.
       * RLS determines whether this authenticated staff member
       * can see the record.
       */
      const today = new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("staff_attendance")
        .select(
          `
            id,
            attendance_date,
            status,
            check_in_at,
            check_out_at,
            working_minutes,
            is_late,
            is_early_checkout,
            check_in_distance_meters,
            check_out_distance_meters
          `,
        )
        .eq("school_id", schoolId)
        .eq("attendance_date", today)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      setAttendance((data as Attendance | null) ?? null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load today's attendance.",
      );
    } finally {
      setLoading(false);
    }
  }

  function getLocation(): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
  }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            "GPS is not supported by this browser.",
          ),
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
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            reject(
              new Error(
                "Location permission was denied. Please allow GPS access.",
              ),
            );
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            reject(
              new Error(
                "Your location could not be determined.",
              ),
            );
          } else {
            reject(
              new Error(
                "GPS request timed out. Please try again.",
              ),
            );
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        },
      );
    });
  }

  async function checkIn() {
    try {
      setProcessing(true);
      setLocationLoading(true);
      setError("");
      setSuccess("");

      const location = await getLocation();

      setLocationLoading(false);

      const { data, error } = await supabase.rpc(
        "staff_check_in",
        {
          p_latitude: location.latitude,
          p_longitude: location.longitude,
          p_accuracy_meters: location.accuracy,
        },
      );

      if (error) throw error;

      const result = data as {
        success: boolean;
        status: string;
        is_late: boolean;
        distance_meters: number | null;
      };

      setSuccess(
        result.is_late
          ? "Check-in successful. You are marked Late."
          : "Check-in successful. You are marked Present.",
      );

      await loadToday();
    } catch (err) {
      setLocationLoading(false);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to check in.",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function checkOut() {
    try {
      setProcessing(true);
      setLocationLoading(true);
      setError("");
      setSuccess("");

      const location = await getLocation();

      setLocationLoading(false);

      const { data, error } = await supabase.rpc(
        "staff_check_out",
        {
          p_latitude: location.latitude,
          p_longitude: location.longitude,
          p_accuracy_meters: location.accuracy,
        },
      );

      if (error) throw error;

      const result = data as {
        success: boolean;
        status: string;
        working_minutes: number;
        is_early_checkout: boolean;
      };

      setSuccess(
        result.status === "half_day"
          ? "Checkout successful. Your working time results in a Half Day."
          : result.is_early_checkout
            ? "Checkout successful. You checked out before the scheduled end time."
            : "Checkout successful.",
      );

      await loadToday();
    } catch (err) {
      setLocationLoading(false);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to check out.",
      );
    } finally {
      setProcessing(false);
    }
  }

  const checkedIn =
    Boolean(attendance?.check_in_at) &&
    !attendance?.check_out_at;

  const checkedOut =
    Boolean(attendance?.check_in_at) &&
    Boolean(attendance?.check_out_at);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 md:p-8">
        <div className="mx-auto max-w-3xl rounded-2xl border bg-white p-12 text-center shadow-sm">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />

          <p className="mt-3 text-sm font-semibold text-slate-600">
            Loading attendance...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-3xl">

        <div className="mb-6">
          <p className="text-sm font-semibold text-blue-600">
            Staff Attendance
          </p>

          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Today's Attendance
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Check in and check out from inside the school premises.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
            <CheckCircle2 size={17} />
            {success}
          </div>
        )}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 bg-slate-50 p-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Clock3 size={30} />
            </div>

            <h2 className="mt-4 text-xl font-bold text-slate-900">
              {attendance
                ? attendance.status.replace("_", " ").toUpperCase()
                : "NOT MARKED"}
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              GPS location is verified by the school attendance system.
            </p>
          </div>

          <div className="grid gap-4 p-6 sm:grid-cols-3">

            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase text-slate-400">
                Check In
              </p>

              <p className="mt-2 text-xl font-bold text-slate-900">
                {formatTime(attendance?.check_in_at ?? null)}
              </p>

              {attendance?.check_in_distance_meters != null && (
                <p className="mt-1 text-xs text-slate-500">
                  {Math.round(
                    attendance.check_in_distance_meters,
                  )}
                  m from school
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase text-slate-400">
                Check Out
              </p>

              <p className="mt-2 text-xl font-bold text-slate-900">
                {formatTime(attendance?.check_out_at ?? null)}
              </p>

              {attendance?.check_out_distance_meters != null && (
                <p className="mt-1 text-xs text-slate-500">
                  {Math.round(
                    attendance.check_out_distance_meters,
                  )}
                  m from school
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase text-slate-400">
                Working Time
              </p>

              <p className="mt-2 text-xl font-bold text-slate-900">
                {formatMinutes(
                  attendance?.working_minutes ?? null,
                )}
              </p>
            </div>

          </div>

          <div className="border-t border-slate-200 p-6">

            {!attendance && (
              <button
                type="button"
                onClick={() => void checkIn()}
                disabled={processing}
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 py-5 text-lg font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processing ? (
                  <Loader2
                    size={24}
                    className="animate-spin"
                  />
                ) : (
                  <LogIn size={24} />
                )}

                {locationLoading
                  ? "Getting GPS Location..."
                  : "CHECK IN"}
              </button>
            )}

            {checkedIn && (
              <button
                type="button"
                onClick={() => void checkOut()}
                disabled={processing}
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-red-600 px-6 py-5 text-lg font-bold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processing ? (
                  <Loader2
                    size={24}
                    className="animate-spin"
                  />
                ) : (
                  <LogOut size={24} />
                )}

                {locationLoading
                  ? "Getting GPS Location..."
                  : "CHECK OUT"}
              </button>
            )}

            {checkedOut && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <CheckCircle2 className="mx-auto text-emerald-600" size={30} />

                <p className="mt-2 font-bold text-emerald-800">
                  Attendance Completed
                </p>

                <p className="mt-1 text-sm text-emerald-700">
                  Your check-in and check-out have been recorded.
                </p>
              </div>
            )}

          </div>

          <div className="border-t border-slate-200 p-5">
            <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-4">
              <ShieldCheck
                size={20}
                className="mt-0.5 shrink-0 text-blue-600"
              />

              <div>
                <p className="text-sm font-bold text-slate-800">
                  GPS Attendance Protection
                </p>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Your location is checked against the school's
                  configured attendance area. The attendance time is
                  generated by the server, not by your device.
                </p>
              </div>
            </div>
          </div>

        </section>
      </div>
    </main>
  );
}