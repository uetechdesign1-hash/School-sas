"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AttendanceSettings = {
  school_id: string;
  attendance_enabled: boolean;
  gps_required: boolean;
  school_latitude: number | null;
  school_longitude: number | null;
  geofence_radius_meters: number;
  work_start_time: string;
  work_end_time: string;
  grace_period_minutes: number;
  minimum_work_minutes: number;
};

export default function StaffAttendanceSettingsPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);

  const [schoolId, setSchoolId] = useState("");
  const [schoolName, setSchoolName] = useState("");

  const [attendanceEnabled, setAttendanceEnabled] = useState(false);
  const [gpsRequired, setGpsRequired] = useState(true);

  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  const [radius, setRadius] = useState("100");
  const [workStartTime, setWorkStartTime] = useState("09:00");
  const [workEndTime, setWorkEndTime] = useState("17:00");
  const [gracePeriod, setGracePeriod] = useState("10");
  const [minimumWorkMinutes, setMinimumWorkMinutes] = useState("450");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // ---------------------------------------------------------
  // LOAD SCHOOL
  // ---------------------------------------------------------

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) {
        throw authError;
      }

      if (!user) {
        throw new Error("You must be logged in.");
      }

      // Find active school for logged-in user
      const { data: schoolUser, error: schoolUserError } =
        await supabase
          .from("school_users")
          .select("school_id, role")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

      if (schoolUserError) {
        throw schoolUserError;
      }

      if (!schoolUser?.school_id) {
        throw new Error("No active school was found for your account.");
      }

      const activeSchoolId = schoolUser.school_id;

      // Only owner/admin can manage attendance settings
      const role = String(schoolUser.role || "").toLowerCase();

      if (!["owner", "admin"].includes(role)) {
        throw new Error(
          "You do not have permission to manage attendance settings."
        );
      }

      setSchoolId(activeSchoolId);

      // Load school name
      const { data: school, error: schoolError } = await supabase
        .from("schools")
        .select("id, name")
        .eq("id", activeSchoolId)
        .maybeSingle();

      if (schoolError) {
        throw schoolError;
      }

      setSchoolName(school?.name || "School");

      // Load attendance settings through secure RPC
      const { data, error: settingsError } = await supabase.rpc(
        "get_staff_attendance_settings",
        {
          p_school_id: activeSchoolId,
        }
      );

      if (settingsError) {
        console.error("ATTENDANCE SETTINGS LOAD ERROR:", {
          message: settingsError.message,
          details: settingsError.details,
          hint: settingsError.hint,
          code: settingsError.code,
        });

        throw settingsError;
      }

      if (!data) {
        throw new Error("Attendance settings could not be loaded.");
      }

      const settings = data as AttendanceSettings;

      setAttendanceEnabled(Boolean(settings.attendance_enabled));
      setGpsRequired(
        settings.gps_required === undefined
          ? true
          : Boolean(settings.gps_required)
      );

      setLatitude(
        settings.school_latitude !== null &&
          settings.school_latitude !== undefined
          ? String(settings.school_latitude)
          : ""
      );

      setLongitude(
        settings.school_longitude !== null &&
          settings.school_longitude !== undefined
          ? String(settings.school_longitude)
          : ""
      );

      setRadius(
        settings.geofence_radius_meters !== undefined &&
          settings.geofence_radius_meters !== null
          ? String(settings.geofence_radius_meters)
          : "100"
      );

      setWorkStartTime(
        settings.work_start_time
          ? String(settings.work_start_time).slice(0, 5)
          : "09:00"
      );

      setWorkEndTime(
        settings.work_end_time
          ? String(settings.work_end_time).slice(0, 5)
          : "17:00"
      );

      setGracePeriod(
        settings.grace_period_minutes !== undefined &&
          settings.grace_period_minutes !== null
          ? String(settings.grace_period_minutes)
          : "10"
      );

      setMinimumWorkMinutes(
        settings.minimum_work_minutes !== undefined &&
          settings.minimum_work_minutes !== null
          ? String(settings.minimum_work_minutes)
          : "450"
      );
    } catch (err: any) {
      console.error("ATTENDANCE SETTINGS LOAD ERROR:", {
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
        error: err,
      });

      setError(
        err?.message ||
          "Unable to load attendance settings."
      );
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------
  // CAPTURE SCHOOL GPS LOCATION
  // ---------------------------------------------------------

  const captureLocation = async () => {
    setGpsLoading(true);
    setError("");
    setMessage("");

    if (!navigator.geolocation) {
      setError(
        "GPS is not supported by this browser."
      );
      setGpsLoading(false);
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            {
              enableHighAccuracy: true,
              timeout: 20000,
              maximumAge: 0,
            }
          );
        }
      );

      const latitudeValue = position.coords.latitude;
      const longitudeValue = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      console.log("GPS LOCATION SUCCESS:", {
        latitude: latitudeValue,
        longitude: longitudeValue,
        accuracy,
      });

      setLatitude(latitudeValue.toFixed(7));
      setLongitude(longitudeValue.toFixed(7));

      setMessage(
        `School location captured successfully. GPS accuracy: ${Math.round(
          accuracy
        )} meters.`
      );
    } catch (err: any) {
      console.error("GPS LOCATION ERROR:", {
        error: err,
        code: err?.code,
        message: err?.message,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });

      let gpsError =
        "Unable to get your location.";

      if (err?.code === 1) {
        gpsError =
          "Location permission was denied. Please allow location access for this website in your browser.";
      } else if (err?.code === 2) {
        gpsError =
          "Your location could not be determined. Check that GPS/location services are enabled.";
      } else if (err?.code === 3) {
        gpsError =
          "GPS location request timed out. Please try again.";
      } else if (err?.message) {
        gpsError = err.message;
      }

      setError(gpsError);
    } finally {
      setGpsLoading(false);
    }
  };

  // ---------------------------------------------------------
  // SAVE SETTINGS
  // ---------------------------------------------------------

  const saveSettings = async () => {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      if (!schoolId) {
        throw new Error(
          "School information is not available."
        );
      }

      const radiusNumber = Number(radius);
      const graceNumber = Number(gracePeriod);
      const minimumMinutesNumber =
        Number(minimumWorkMinutes);

      if (!workStartTime || !workEndTime) {
        throw new Error(
          "Please enter the work start and end time."
        );
      }

      if (
        !Number.isFinite(radiusNumber) ||
        radiusNumber < 10
      ) {
        throw new Error(
          "Geofence radius must be at least 10 meters."
        );
      }

      if (
        !Number.isFinite(graceNumber) ||
        graceNumber < 0
      ) {
        throw new Error(
          "Grace period cannot be negative."
        );
      }

      if (
        !Number.isFinite(minimumMinutesNumber) ||
        minimumMinutesNumber <= 0
      ) {
        throw new Error(
          "Minimum work minutes must be greater than 0."
        );
      }

      let latitudeNumber: number | null = null;
      let longitudeNumber: number | null = null;

      if (latitude.trim() !== "") {
        latitudeNumber = Number(latitude);

        if (
          !Number.isFinite(latitudeNumber) ||
          latitudeNumber < -90 ||
          latitudeNumber > 90
        ) {
          throw new Error(
            "Please enter a valid latitude between -90 and 90."
          );
        }
      }

      if (longitude.trim() !== "") {
        longitudeNumber = Number(longitude);

        if (
          !Number.isFinite(longitudeNumber) ||
          longitudeNumber < -180 ||
          longitudeNumber > 180
        ) {
          throw new Error(
            "Please enter a valid longitude between -180 and 180."
          );
        }
      }

      // GPS is required when attendance + GPS are enabled
      if (
        attendanceEnabled &&
        gpsRequired &&
        (latitudeNumber === null ||
          longitudeNumber === null)
      ) {
        throw new Error(
          "Enter the school GPS location before enabling GPS attendance."
        );
      }

      const { data, error: saveError } =
        await supabase.rpc(
          "save_staff_attendance_settings",
          {
            p_school_id: schoolId,
            p_attendance_enabled:
              attendanceEnabled,
            p_gps_required: gpsRequired,
            p_school_latitude:
              latitudeNumber,
            p_school_longitude:
              longitudeNumber,
            p_geofence_radius_meters:
              radiusNumber,
            p_work_start_time:
              workStartTime,
            p_work_end_time:
              workEndTime,
            p_grace_period_minutes:
              graceNumber,
            p_minimum_work_minutes:
              minimumMinutesNumber,
          }
        );

      if (saveError) {
        console.error(
          "ATTENDANCE SETTINGS SAVE ERROR:",
          {
            message: saveError.message,
            details: saveError.details,
            hint: saveError.hint,
            code: saveError.code,
            error: saveError,
          }
        );

        throw saveError;
      }

      console.log(
        "ATTENDANCE SETTINGS SAVED:",
        data
      );

      setMessage(
        "Attendance settings saved successfully."
      );

      // Reload values from database
      await loadSettings();
    } catch (err: any) {
      console.error(
        "ATTENDANCE SETTINGS SAVE ERROR:",
        {
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
          code: err?.code,
          error: err,
        }
      );

      setError(
        err?.message ||
          "Unable to save attendance settings."
      );
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------
  // LOADING
  // ---------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border bg-white p-8 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
              <p className="text-sm text-slate-600">
                Loading attendance settings...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // PAGE
  // ---------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        {/* HEADER */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-1 text-sm font-medium text-blue-600">
              Staff Management
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
              Attendance Settings
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Configure daily staff attendance and GPS
              geofencing for {schoolName}.
            </p>
          </div>

          <a
            href="/dashboard/staff"
            className="inline-flex items-center justify-center rounded-xl border bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            ← Back to Staff
          </a>
        </div>

        {/* ERROR */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex gap-3">
              <div className="text-lg">⚠️</div>

              <div>
                <p className="font-semibold text-red-800">
                  Attendance Settings Error
                </p>

                <p className="mt-1 text-sm text-red-700">
                  {error}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* SUCCESS */}
        {message && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="flex gap-3">
              <div className="text-lg">✓</div>

              <p className="text-sm font-medium text-green-800">
                {message}
              </p>
            </div>
          </div>
        )}

        {/* ENABLE ATTENDANCE */}
        <section className="rounded-2xl border bg-white shadow-sm">
          <div className="border-b p-5 md:p-6">
            <h2 className="text-lg font-bold text-slate-900">
              Daily Attendance
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Enable the new daily staff attendance system.
            </p>
          </div>

          <div className="p-5 md:p-6">
            <div className="flex flex-col gap-4 rounded-xl border bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-900">
                  Staff Daily Attendance
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Staff can check in and check out from
                  their staff attendance page.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setAttendanceEnabled(
                    !attendanceEnabled
                  )
                }
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  attendanceEnabled
                    ? "bg-blue-600"
                    : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                    attendanceEnabled
                      ? "left-6"
                      : "left-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* GPS SETTINGS */}
        <section className="rounded-2xl border bg-white shadow-sm">
          <div className="border-b p-5 md:p-6">
            <h2 className="text-lg font-bold text-slate-900">
              GPS & Geofence
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Staff location is checked when they check
              in and check out.
            </p>
          </div>

          <div className="space-y-6 p-5 md:p-6">
            {/* GPS REQUIRED */}
            <div className="flex flex-col gap-4 rounded-xl border bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-900">
                  Require GPS Location
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Staff must be physically inside the
                  school geofence to check in/out.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setGpsRequired(!gpsRequired)
                }
                disabled={!attendanceEnabled}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  gpsRequired
                    ? "bg-blue-600"
                    : "bg-slate-300"
                } ${
                  !attendanceEnabled
                    ? "cursor-not-allowed opacity-50"
                    : ""
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                    gpsRequired
                      ? "left-6"
                      : "left-1"
                  }`}
                />
              </button>
            </div>

            {/* LOCATION */}
            <div>
              <div className="mb-3">
                <h3 className="font-semibold text-slate-900">
                  School GPS Location
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  Stand inside the school and capture the
                  current GPS coordinates.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Latitude
                  </label>

                  <input
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) =>
                      setLatitude(e.target.value)
                    }
                    placeholder="17.3850440"
                    className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Longitude
                  </label>

                  <input
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) =>
                      setLongitude(e.target.value)
                    }
                    placeholder="78.4866710"
                    className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={captureLocation}
                disabled={gpsLoading}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {gpsLoading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Getting Location...
                  </>
                ) : (
                  <>📍 Capture Current Location</>
                )}
              </button>

              <p className="mt-2 text-xs text-slate-500">
                Browser location permission is required.
                For best accuracy, enable GPS/location
                services on the device.
              </p>
            </div>

            {/* GEOFENCE */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Geofence Radius
              </label>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="10"
                  value={radius}
                  onChange={(e) =>
                    setRadius(e.target.value)
                  }
                  className="w-full max-w-xs rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                <span className="text-sm text-slate-500">
                  meters
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                Example: 100 meters means staff must be
                within approximately 100m of the school
                location.
              </p>
            </div>
          </div>
        </section>

        {/* WORKING HOURS */}
        <section className="rounded-2xl border bg-white shadow-sm">
          <div className="border-b p-5 md:p-6">
            <h2 className="text-lg font-bold text-slate-900">
              Working Hours
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              These values are used to calculate late
              arrival and early checkout.
            </p>
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-2 md:p-6">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Work Start Time
              </label>

              <input
                type="time"
                value={workStartTime}
                onChange={(e) =>
                  setWorkStartTime(e.target.value)
                }
                className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Work End Time
              </label>

              <input
                type="time"
                value={workEndTime}
                onChange={(e) =>
                  setWorkEndTime(e.target.value)
                }
                className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Grace Period
              </label>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  value={gracePeriod}
                  onChange={(e) =>
                    setGracePeriod(e.target.value)
                  }
                  className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                <span className="text-sm text-slate-500">
                  minutes
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                Example: 10 means a 9:10 arrival is still
                within the grace period.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Minimum Work Time
              </label>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  value={minimumWorkMinutes}
                  onChange={(e) =>
                    setMinimumWorkMinutes(
                      e.target.value
                    )
                  }
                  className="w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                <span className="text-sm text-slate-500">
                  minutes
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                Current default: 450 minutes = 7.5 hours.
              </p>
            </div>
          </div>
        </section>

        {/* SUMMARY */}
        <section className="rounded-2xl border bg-white shadow-sm">
          <div className="border-b p-5 md:p-6">
            <h2 className="text-lg font-bold text-slate-900">
              Configuration Summary
            </h2>
          </div>

          <div className="grid gap-3 p-5 md:grid-cols-2 lg:grid-cols-4 md:p-6">
            <SummaryItem
              label="Attendance"
              value={
                attendanceEnabled
                  ? "Enabled"
                  : "Disabled"
              }
            />

            <SummaryItem
              label="GPS"
              value={
                gpsRequired ? "Required" : "Optional"
              }
            />

            <SummaryItem
              label="Geofence"
              value={`${radius || "0"} meters`}
            />

            <SummaryItem
              label="Working Time"
              value={`${workStartTime} - ${workEndTime}`}
            />
          </div>
        </section>

        {/* SAVE */}
        <div className="sticky bottom-4 z-10">
          <div className="flex flex-col gap-3 rounded-2xl border bg-white/95 p-4 shadow-lg backdrop-blur md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-slate-900">
                Save Attendance Configuration
              </p>

              <p className="text-sm text-slate-500">
                Changes apply to the staff daily attendance
                system.
              </p>
            </div>

            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Saving...
                </>
              ) : (
                "Save Settings"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// SUMMARY ITEM
// ---------------------------------------------------------

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <p className="mt-1 text-sm font-bold text-slate-900">
        {value}
      </p>
    </div>
  );
}