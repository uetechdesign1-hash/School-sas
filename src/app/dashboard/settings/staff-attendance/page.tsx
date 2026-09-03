"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Crosshair,
  Loader2,
  MapPin,
  Save,
  ShieldCheck,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Settings = {
  school_id: string;
  attendance_enabled: boolean;
  gps_required: boolean;
  school_latitude: string;
  school_longitude: string;
  geofence_radius_meters: string;
  work_start_time: string;
  work_end_time: string;
  grace_period_minutes: string;
  minimum_work_minutes: string;
};

const initialSettings: Settings = {
  school_id: "",
  attendance_enabled: false,
  gps_required: true,
  school_latitude: "",
  school_longitude: "",
  geofence_radius_meters: "100",
  work_start_time: "09:00",
  work_end_time: "17:00",
  grace_period_minutes: "10",
  minimum_work_minutes: "450",
};

export default function StaffAttendanceSettingsPage() {
  const supabase = createClient();

  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void loadSettings();
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
      .select("school_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data?.school_id) {
      throw new Error("Your account is not assigned to an active school.");
    }

    if (!["owner", "admin"].includes(String(data.role))) {
      throw new Error(
        "Only the school owner or administrator can manage attendance settings.",
      );
    }

    return data.school_id;
  }

  async function loadSettings() {
    try {
      setLoading(true);
      setError("");

      const schoolId = await getSchoolId();

      if (!schoolId) return;

      const { data, error } = await supabase
        .from("staff_attendance_settings")
        .select("*")
        .eq("school_id", schoolId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          school_id: data.school_id,
          attendance_enabled: Boolean(data.attendance_enabled),
          gps_required: Boolean(data.gps_required),
          school_latitude:
            data.school_latitude == null
              ? ""
              : String(data.school_latitude),
          school_longitude:
            data.school_longitude == null
              ? ""
              : String(data.school_longitude),
          geofence_radius_meters: String(
            data.geofence_radius_meters ?? 100,
          ),
          work_start_time: String(data.work_start_time ?? "09:00").slice(
            0,
            5,
          ),
          work_end_time: String(data.work_end_time ?? "17:00").slice(
            0,
            5,
          ),
          grace_period_minutes: String(
            data.grace_period_minutes ?? 10,
          ),
          minimum_work_minutes: String(
            data.minimum_work_minutes ?? 450,
          ),
        });
      } else {
        setSettings((current) => ({
          ...current,
          school_id: schoolId,
        }));
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load attendance settings.",
      );
    } finally {
      setLoading(false);
    }
  }

  function useCurrentLocation() {
    setError("");
    setSuccess("");

    if (!navigator.geolocation) {
      setError("GPS is not supported by this browser.");
      return;
    }

    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSettings((current) => ({
          ...current,
          school_latitude: position.coords.latitude.toFixed(7),
          school_longitude: position.coords.longitude.toFixed(7),
        }));

        setLocating(false);
        setSuccess(
          `School location captured. Accuracy ±${Math.round(
            position.coords.accuracy,
          )}m.`,
        );
      },
      (err) => {
        setLocating(false);

        if (err.code === err.PERMISSION_DENIED) {
          setError("Location permission was denied.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError("Unable to determine your current location.");
        } else {
          setError("Unable to get your current location.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  }

  async function saveSettings() {
    try {
      setSaving(true);
      setError("");
      setSuccess("");

      if (!settings.school_id) {
        throw new Error("School could not be identified.");
      }

      if (settings.gps_required) {
        if (
          !settings.school_latitude ||
          !settings.school_longitude
        ) {
          throw new Error(
            "School latitude and longitude are required when GPS attendance is enabled.",
          );
        }
      }

      const radius = Number(settings.geofence_radius_meters);
      const grace = Number(settings.grace_period_minutes);
      const minimum = Number(settings.minimum_work_minutes);

      if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error("Geofence radius must be greater than zero.");
      }

      if (!Number.isFinite(grace) || grace < 0) {
        throw new Error("Grace period cannot be negative.");
      }

      if (!Number.isFinite(minimum) || minimum < 0) {
        throw new Error("Minimum working minutes cannot be negative.");
      }

      const { error } = await supabase
        .from("staff_attendance_settings")
        .upsert(
          {
            school_id: settings.school_id,
            attendance_enabled: settings.attendance_enabled,
            gps_required: settings.gps_required,
            school_latitude: settings.school_latitude
              ? Number(settings.school_latitude)
              : null,
            school_longitude: settings.school_longitude
              ? Number(settings.school_longitude)
              : null,
            geofence_radius_meters: radius,
            work_start_time: settings.work_start_time,
            work_end_time: settings.work_end_time,
            grace_period_minutes: grace,
            minimum_work_minutes: minimum,
          },
          {
            onConflict: "school_id",
          },
        );

      if (error) throw error;

      setSuccess("Staff attendance settings saved successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save attendance settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));

    setError("");
    setSuccess("");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border bg-white p-12 text-center shadow-sm">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-3 text-sm font-semibold text-slate-600">
            Loading attendance settings...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-4xl">

        <div className="mb-6">
          <p className="text-sm font-semibold text-blue-600">
            School Management
          </p>

          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            Staff Attendance Settings
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Configure GPS attendance, school location, working hours
            and late/half-day rules.
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

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
                <ShieldCheck size={20} />
              </div>

              <div>
                <h2 className="font-bold text-slate-900">
                  Attendance Control
                </h2>

                <p className="text-sm text-slate-500">
                  Enable GPS-based staff attendance for this school.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-5">

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-4">
              <div>
                <p className="font-bold text-slate-900">
                  Enable Staff Attendance
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  Staff can check in and check out when enabled.
                </p>
              </div>

              <input
                type="checkbox"
                checked={settings.attendance_enabled}
                onChange={(e) =>
                  update("attendance_enabled", e.target.checked)
                }
                className="h-5 w-5"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-4">
              <div>
                <p className="font-bold text-slate-900">
                  GPS Required
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  Staff must be physically inside the school geofence.
                </p>
              </div>

              <input
                type="checkbox"
                checked={settings.gps_required}
                onChange={(e) =>
                  update("gps_required", e.target.checked)
                }
                className="h-5 w-5"
              />
            </label>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">
                    School Location
                  </h3>

                  <p className="text-xs text-slate-500">
                    Set this while physically at the school.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={useCurrentLocation}
                  disabled={locating}
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-700 disabled:opacity-50"
                >
                  {locating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Crosshair size={16} />
                  )}

                  {locating
                    ? "Getting Location..."
                    : "Use My Current Location"}
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">
                    Latitude
                  </label>

                  <input
                    value={settings.school_latitude}
                    onChange={(e) =>
                      update("school_latitude", e.target.value)
                    }
                    placeholder="17.385044"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">
                    Longitude
                  </label>

                  <input
                    value={settings.school_longitude}
                    onChange={(e) =>
                      update("school_longitude", e.target.value)
                    }
                    placeholder="78.486671"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">
                    Geofence Radius (meters)
                  </label>

                  <input
                    type="number"
                    min="10"
                    value={settings.geofence_radius_meters}
                    onChange={(e) =>
                      update(
                        "geofence_radius_meters",
                        e.target.value,
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-4 flex items-center gap-2">
                <MapPin size={18} className="text-blue-600" />
                <h3 className="font-bold text-slate-900">
                  Working Hours
                </h3>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">
                    Work Start
                  </label>

                  <input
                    type="time"
                    value={settings.work_start_time}
                    onChange={(e) =>
                      update("work_start_time", e.target.value)
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">
                    Work End
                  </label>

                  <input
                    type="time"
                    value={settings.work_end_time}
                    onChange={(e) =>
                      update("work_end_time", e.target.value)
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">
                    Grace Period (minutes)
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={settings.grace_period_minutes}
                    onChange={(e) =>
                      update(
                        "grace_period_minutes",
                        e.target.value,
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  />

                  <p className="mt-1 text-xs text-slate-400">
                    Example: 10 means 09:10 is still on time.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase text-slate-500">
                    Minimum Work Minutes
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={settings.minimum_work_minutes}
                    onChange={(e) =>
                      update(
                        "minimum_work_minutes",
                        e.target.value,
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                  />

                  <p className="mt-1 text-xs text-slate-400">
                    Example: 450 = 7 hours 30 minutes.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <Save size={17} />
              )}

              {saving ? "Saving..." : "Save Attendance Settings"}
            </button>

          </div>
        </section>
      </div>
    </main>
  );
}