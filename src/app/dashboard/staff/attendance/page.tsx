"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  Navigation,
  ShieldCheck,
  LogIn,
  LogOut,
  AlertTriangle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  deleteOfflineAttendanceEvent,
  getOfflineAttendanceProfile,
  listOfflineAttendanceEvents,
  saveOfflineAttendanceEvent,
  saveOfflineAttendanceProfile,
  updateOfflineAttendanceEvent,
  type OfflineAttendanceEvent,
} from "@/lib/staff/offline-attendance";

type Staff = {
  id: string;
  school_id: string;
  employee_no: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  designation: string | null;
  email: string | null;
  attendance_mode: "online" | "offline";
};

type Attendance = {
  id: string;
  attendance_date: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;

  check_in_latitude: number | null;
  check_in_longitude: number | null;
  check_in_accuracy_meters: number | null;
  check_in_distance_meters: number | null;

  check_out_latitude: number | null;
  check_out_longitude: number | null;
  check_out_accuracy_meters: number | null;
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

function staffName(staff: Staff) {
  return [
    staff.first_name,
    staff.middle_name,
    staff.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function today() {
  const now = new Date();

  const year =
    now.getFullYear();

  const month = String(
    now.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    now.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isToday(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` === today();
}

function formatTime(
  value: string | null
) {
  if (!value) return "â€”";

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "â€”";
  }

  return date.toLocaleTimeString(
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }
  );
}

function formatMinutes(
  value: number | null
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "â€”";
  }

  const hours =
    Math.floor(
      value / 60
    );

  const minutes =
    value % 60;

  return `${hours}h ${String(
    minutes
  ).padStart(2, "0")}m`;
}

function distanceText(
  value: number | null
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "â€”";
  }

  if (value < 1000) {
    return `${Math.round(
      value
    )} m`;
  }

  return `${(
    value / 1000
  ).toFixed(2)} km`;
}

export default function StaffAttendancePage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const [staff, setStaff] =
    useState<Staff | null>(null);

  const [attendance, setAttendance] =
    useState<Attendance | null>(null);

  const [location, setLocation] =
    useState<LocationState | null>(
      null
    );

  const [locating, setLocating] =
    useState(false);

  const [processing, setProcessing] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  const [offlineEvents, setOfflineEvents] =
    useState<OfflineAttendanceEvent[]>([]);

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState(
      "Get your current location before checking in."
    );

  /* =====================================================
     LOAD STAFF + TODAY
     ===================================================== */

  const loadToday =
    useCallback(async () => {
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
          window.location.href =
            "/login";
          return;
        }
        setCurrentUserId(user.id);

        const activeSchoolId =
         (await supabase.rpc("get_my_school_id")).data ||
         (
           await supabase
             .from("school_users")
             .select("school_id")
             .eq("user_id", user.id)
             .eq("is_active", true)
             .order("created_at", { ascending: true })
             .limit(1)
             .maybeSingle()
         ).data?.school_id;

        if (!activeSchoolId) {
         throw new Error(
           "No active school found for this user."
         );
        }

        const staffSelect = `
          id,
          school_id,
          employee_no,
          first_name,
          middle_name,
          last_name,
          designation,
          email,
          attendance_mode
        `;

        const {
         data: linkedStaff,
         error: linkedStaffError,
        } = await supabase
         .from("staff")
         .select(staffSelect)
         .eq("school_id", activeSchoolId)
         .eq("user_id", user.id)
         .maybeSingle();

        if (linkedStaffError) {
          throw linkedStaffError;
        }

        let staffRow = linkedStaff;

        if (!staffRow && user.email) {
          const {
            data: emailStaff,
            error: emailStaffError,
          } = await supabase
            .from("staff")
            .select(staffSelect)
            .eq("school_id", activeSchoolId)
            .eq("email", user.email)
            .is("user_id", null)
            .limit(1)
            .maybeSingle();

          if (emailStaffError) {
            throw emailStaffError;
          }

          staffRow = emailStaff;
        }

        if (!staffRow) {
          throw new Error(
            "No staff profile matches this login in your active school. Ask an administrator to assign your login account to the correct staff profile."
          );
        }

        const staffProfile = staffRow as Staff;
        setStaff(staffProfile);

        const {
          data: attendanceRow,
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

                check_in_latitude,
                check_in_longitude,
                check_in_accuracy_meters,
                check_in_distance_meters,

                check_out_latitude,
                check_out_longitude,
                check_out_accuracy_meters,
                check_out_distance_meters,

                working_minutes,
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
              today()
            )
            .maybeSingle();

        if (attendanceError) {
          throw attendanceError;
        }

        const todayAttendance = attendanceRow as Attendance | null;
        setAttendance(todayAttendance);
        await saveOfflineAttendanceProfile({
          user_id: user.id,
          staff: staffProfile,
          attendance_mode: staffProfile.attendance_mode || "online",
          attendance_date: today(),
          check_in_at: todayAttendance?.check_in_at || null,
          check_out_at: todayAttendance?.check_out_at || null,
        });
        setOfflineEvents(await listOfflineAttendanceEvents());
      } catch (err: unknown) {
        console.error(
          "STAFF ATTENDANCE LOAD ERROR:",
          err
        );

        const cachedProfile = await getOfflineAttendanceProfile().catch(
          (storageError: unknown) => {
            console.error("OFFLINE ATTENDANCE PROFILE LOAD ERROR:", storageError);
            return null;
          },
        );
        const {
          data: { session },
          error: offlineSessionError,
        } = await supabase.auth.getSession();
        if (offlineSessionError) {
          console.error("OFFLINE ATTENDANCE SESSION ERROR:", offlineSessionError);
        }
        if (
          cachedProfile?.attendance_mode === "offline" &&
          cachedProfile.user_id === session?.user.id
        ) {
          setCurrentUserId(cachedProfile.user_id);
          setStaff({
            ...cachedProfile.staff,
            attendance_mode: cachedProfile.attendance_mode,
          });
          setAttendance({
            id: "offline-cache",
            attendance_date: cachedProfile.attendance_date,
            status: cachedProfile.check_in_at ? "present" : "pending",
            check_in_at: cachedProfile.check_in_at,
            check_out_at: cachedProfile.check_out_at,
            check_in_latitude: null,
            check_in_longitude: null,
            check_in_accuracy_meters: null,
            check_in_distance_meters: null,
            check_out_latitude: null,
            check_out_longitude: null,
            check_out_accuracy_meters: null,
            check_out_distance_meters: null,
            working_minutes: null,
            is_late: null,
            is_early_checkout: null,
          });
          setOfflineEvents(await listOfflineAttendanceEvents().catch(() => []));
          setMessage("Offline profile loaded. New attendance records remain pending until server validation.");
        } else {
          setError(getRpcErrorMessage(err, "Unable to load today's attendance."));
        }
      } finally {
        setLoading(false);
      }
    }, [supabase]);

  const syncOfflineAttendance = useCallback(async () => {
    if (!navigator.onLine) return;
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.access_token) return;

    const events = (await listOfflineAttendanceEvents()).sort((left, right) =>
      left.captured_at.localeCompare(right.captured_at),
    );
    for (const event of events) {
      if (event.status !== "pending") continue;
      if (event.user_id !== session.user.id) continue;
      let response: Response;
      try {
        response = await fetch("/api/staff/attendance/offline-sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            request_id: event.request_id,
            user_id: event.user_id,
            staff_id: event.staff_id,
            action: event.action,
            captured_at: event.captured_at,
            latitude: event.latitude,
            longitude: event.longitude,
            accuracy_meters: event.accuracy_meters,
          }),
        });
      } catch {
        break;
      }

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (response.ok && result.success) {
        await deleteOfflineAttendanceEvent(event.request_id);
      } else if (response.status === 422) {
        await updateOfflineAttendanceEvent(event.request_id, {
          status: "rejected",
          error: result.error || "Server rejected this attendance record.",
        });
        setSuccess("");
        setError(
          `Offline attendance was not accepted: ${result.error || "The server rejected the GPS or school-day validation."}`,
        );
      } else {
        throw new Error(result.error || "Unable to sync offline attendance.");
      }
    }
    setOfflineEvents(await listOfflineAttendanceEvents());
  }, [supabase]);

  useEffect(() => {
    async function initializeAttendance() {
      try {
        await loadToday();
        await syncOfflineAttendance();
        if (navigator.onLine) await loadToday();
      } catch (loadError: unknown) {
        console.error("STAFF ATTENDANCE INITIAL LOAD ERROR:", loadError);
        setError(getRpcErrorMessage(loadError, "Unable to sync offline attendance."));
      }
    }
    void initializeAttendance();
  }, [loadToday, syncOfflineAttendance]);

  useEffect(() => {
    const onOnline = () => {
      void syncOfflineAttendance().then(() => loadToday()).catch((syncError: unknown) => {
        console.error("OFFLINE ATTENDANCE SYNC ERROR:", syncError);
        setError(getRpcErrorMessage(syncError, "Unable to sync offline attendance."));
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [loadToday, syncOfflineAttendance]);

  /* =====================================================
     GET GPS
     ===================================================== */

  function getLocation(): Promise<LocationState> {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        if (
          !navigator.geolocation
        ) {
          reject(
            new Error(
              "Your browser does not support GPS location."
            )
          );

          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              latitude:
                position.coords.latitude,

              longitude:
                position.coords.longitude,

              accuracy:
                position.coords.accuracy,
            });
          },
          (positionError) => {
            let message =
              "Unable to get your location.";

            switch (
              positionError.code
            ) {
              case positionError.PERMISSION_DENIED:
                message =
                  "Location permission was denied. Please allow location access for this site.";
                break;

              case positionError.POSITION_UNAVAILABLE:
                message =
                  "Your current location is unavailable. Please check GPS/location services.";
                break;

              case positionError.TIMEOUT:
                message =
                  "Location request timed out. Please try again.";
                break;
            }

            reject(
              new Error(message)
            );
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
          }
        );
      }
    );
  }

  async function refreshLocation() {
    try {
      setLocating(true);
      setError("");
      setSuccess("");

      const current =
        await getLocation();

      setLocation(
        current
      );

      setMessage(
        `GPS ready. Accuracy Â±${Math.round(
          current.accuracy
        )} m`
      );
    } catch (err: unknown) {
      console.error(
        "GPS ERROR:",
        err
      );

      setError(getRpcErrorMessage(err, "Unable to get your location."));

      setLocation(null);
    } finally {
      setLocating(false);
    }
  }

  /* =====================================================
     ENSURE EMPLOYEE BRIDGE
     ===================================================== */

  const ensureEmployeeRecord = useCallback(async (staffRow: Staff) => {
    const { data: authData, error: authError } =
      await supabase.auth.getUser();

    if (authError) throw authError;

    const user = authData.user;

    if (!user) {
      throw new Error("Your login session has expired. Please log in again.");
    }

    const employeeCode = String(staffRow.employee_no || "").trim();
    const fullName = staffName(staffRow).trim();

    /*
     * The attendance RPC uses the separate employees master.
     * Staff is the portal master, so make sure the corresponding Employee
     * record exists before calling the secure attendance RPC.
     *
     * We match by the real Employees.employee_code and by user_id.
     * We never change the Staff record or the attendance table here.
     */
    const { data: byUser, error: byUserError } = await supabase
      .from("employees")
      .select("id, school_id, user_id, employee_code")
      .eq("school_id", staffRow.school_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (byUserError) {
      throw new Error(
        `Unable to verify employee record: ${byUserError.message}`,
      );
    }

    if (byUser?.id) {
      return byUser;
    }

    let employee: {
      id: string;
      school_id: string;
      user_id: string | null;
      employee_code: string | null;
    } | null = null;

    if (employeeCode) {
      const { data: byCode, error: byCodeError } = await supabase
        .from("employees")
        .select("id, school_id, user_id, employee_code")
        .eq("school_id", staffRow.school_id)
        .eq("employee_code", employeeCode)
        .maybeSingle();

      if (byCodeError) {
        throw new Error(
          `Unable to find employee ${employeeCode}: ${byCodeError.message}`,
        );
      }

      employee = byCode;
    }

    if (employee?.id) {
      if (employee.user_id !== user.id) {
        const { data: updatedEmployee, error: updateError } =
          await supabase
            .from("employees")
            .update({ user_id: user.id })
            .eq("id", employee.id)
            .eq("school_id", staffRow.school_id)
            .select("id, school_id, user_id, employee_code")
            .single();

        if (updateError) {
          throw new Error(
            `Unable to link employee account: ${updateError.message}`,
          );
        }

        employee = updatedEmployee;
      }

      return employee;
    }

    const { data: createdEmployee, error: createError } =
      await supabase
        .from("employees")
        .insert({
          school_id: staffRow.school_id,
          user_id: user.id,
          employee_code: employeeCode || null,
          name: fullName || employeeCode || "Staff",
          designation: staffRow.designation || null,
          monthly_salary: 0,
          status: "active",
        })
        .select("id, school_id, user_id, employee_code")
        .single();

    if (createError) {
      throw new Error(
        `Unable to create the employee record required for attendance: ${createError.message}`,
      );
    }

    if (!createdEmployee?.id) {
      throw new Error("Employee record could not be created for this staff member.");
    }

    return createdEmployee;
  }, [supabase]);

  async function captureOfflineAction(action: "check_in" | "check_out") {
    if (!staff) throw new Error("Staff record not found.");
    const current = await getLocation();
    const capturedAt = new Date().toISOString();
    const cachedProfile = await getOfflineAttendanceProfile();
    if (!cachedProfile) {
      throw new Error("Offline attendance profile is not ready. Reload this page while connected to the internet.");
    }
    if (
      cachedProfile.user_id !== currentUserId ||
      cachedProfile.staff.id !== staff.id
    ) {
      throw new Error("The saved offline profile belongs to a different staff login. Reconnect and open attendance with the correct account.");
    }
    const event: OfflineAttendanceEvent = {
      request_id: crypto.randomUUID(),
      user_id: cachedProfile.user_id,
      staff_id: staff.id,
      action,
      captured_at: capturedAt,
      latitude: current.latitude,
      longitude: current.longitude,
      accuracy_meters: current.accuracy,
      status: "pending",
      error: null,
    };

    await saveOfflineAttendanceEvent(event);
    await saveOfflineAttendanceProfile({
      ...cachedProfile,
      attendance_date: today(),
      check_in_at:
        action === "check_in" ? capturedAt : cachedProfile.check_in_at,
      check_out_at:
        action === "check_out" ? capturedAt : cachedProfile.check_out_at,
    });
    setLocation(current);
    setSuccess(
      "Saved on this device. This attendance is pending server GPS/geofence validation until it syncs.",
    );
    setMessage("Attendance saved locally; it is not official until the server accepts it.");
    setOfflineEvents(await listOfflineAttendanceEvents());

    if (navigator.onLine) {
      await syncOfflineAttendance();
      await loadToday();
    } else {
      setAttendance((currentAttendance) => ({
        ...(currentAttendance || {
          id: "offline-cache",
          attendance_date: today(),
          status: "pending",
          check_in_latitude: null,
          check_in_longitude: null,
          check_in_accuracy_meters: null,
          check_in_distance_meters: null,
          check_out_latitude: null,
          check_out_longitude: null,
          check_out_accuracy_meters: null,
          check_out_distance_meters: null,
          working_minutes: null,
          is_late: null,
          is_early_checkout: null,
        }),
        check_in_at:
          action === "check_in"
            ? capturedAt
            : currentAttendance?.check_in_at || null,
        check_out_at:
          action === "check_out"
            ? capturedAt
            : currentAttendance?.check_out_at || null,
      }));
    }
  }

  /* =====================================================
     CHECK IN
     ===================================================== */

  async function checkIn() {
    try {
      setProcessing(true);
      setError("");
      setSuccess("");

      if (staff?.attendance_mode === "offline") {
        setMessage("Capturing GPS for an offline attendance record...");
        await captureOfflineAction("check_in");
        return;
      }

      /*
       * Always obtain a fresh location.
       * Never trust a location stored from an earlier attempt.
       */

      setMessage(
        "Getting your current GPS location..."
      );

      const current =
        await getLocation();

      setLocation(
        current
      );

      setMessage(
        "Preparing your attendance account..."
      );

      if (!staff) {
      throw new Error("Staff record not found.");
    }

    await ensureEmployeeRecord(staff);

      setMessage(
        "Verifying your location with the school..."
      );

      const {
        data,
        error: rpcError,
      } =
        await supabase.rpc(
          "staff_check_in",
          {
            p_latitude:
              current.latitude,

            p_longitude:
              current.longitude,

            p_accuracy_meters:
              current.accuracy,
          }
        );

      if (rpcError) {
        throw rpcError;
      }

      /*
       * RPC decides whether the location
       * is actually inside the configured
       * school geofence.
       */

      console.log(
        "STAFF CHECK-IN RESULT:",
        data
      );

      setSuccess(
        getRpcSuccessMessage(
          data,
          "Check-in successful."
        )
      );

      setMessage(
        "Attendance recorded successfully."
      );

      await loadToday();
    } catch (err: unknown) {
      console.error(
        "STAFF CHECK-IN ERROR:",
        err
      );

      setError(
        getRpcErrorMessage(
          err,
          "Unable to check in."
        )
      );

      setMessage(
        "Check-in was not completed."
      );
    } finally {
      setProcessing(false);
    }
  }

  /* =====================================================
     CHECK OUT
     ===================================================== */

  async function checkOut() {
    try {
      setProcessing(true);
      setError("");
      setSuccess("");

      if (staff?.attendance_mode === "offline") {
        setMessage("Capturing GPS for an offline attendance record...");
        await captureOfflineAction("check_out");
        return;
      }

      setMessage(
        "Getting your current GPS location..."
      );

      const current =
        await getLocation();

      setLocation(
        current
      );

      setMessage(
        "Preparing your attendance account..."
      );

      if (!staff) {
      throw new Error("Staff record not found.");
    }

    await ensureEmployeeRecord(staff);

      setMessage(
        "Verifying your location with the school..."
      );

      const {
        data,
        error: rpcError,
      } =
        await supabase.rpc(
          "staff_check_out",
          {
            p_latitude:
              current.latitude,

            p_longitude:
              current.longitude,

            p_accuracy_meters:
              current.accuracy,
          }
        );

      if (rpcError) {
        throw rpcError;
      }

      console.log(
        "STAFF CHECK-OUT RESULT:",
        data
      );

      setSuccess(
        getRpcSuccessMessage(
          data,
          "Check-out successful."
        )
      );

      setMessage(
        "Check-out recorded successfully."
      );

      await loadToday();
    } catch (err: unknown) {
      console.error(
        "STAFF CHECK-OUT ERROR:",
        err
      );

      setError(
        getRpcErrorMessage(
          err,
          "Unable to check out."
        )
      );

      setMessage(
        "Check-out was not completed."
      );
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">

        <div className="flex items-center gap-3 text-sm text-slate-500">

          <Loader2
            size={18}
            className="animate-spin"
          />

          Loading attendance...

        </div>

      </main>
    );
  }

  if (!staff) {
    return (
      <main className="p-6">

        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Staff account could not be identified.
        </div>

      </main>
    );
  }

  const pendingCheckIn = offlineEvents.some(
    (event) =>
      event.user_id === currentUserId &&
      isToday(event.captured_at) &&
      event.action === "check_in" &&
      event.status === "pending",
  );
  const pendingCheckOut = offlineEvents.some(
    (event) =>
      event.user_id === currentUserId &&
      isToday(event.captured_at) &&
      event.action === "check_out" &&
      event.status === "pending",
  );
  const hasPendingOfflineAttendance = offlineEvents.some(
    (event) =>
      event.user_id === currentUserId &&
      isToday(event.captured_at) &&
      event.status === "pending",
  );
  const checkedIn =
    Boolean(attendance?.check_in_at) || pendingCheckIn;

  const checkedOut =
    Boolean(attendance?.check_out_at) || pendingCheckOut;

  const canCheckIn =
    !checkedIn;

  const canCheckOut =
    checkedIn &&
    !checkedOut;

  return (
    <main className="p-4 sm:p-6 lg:p-8">

      <div className="mx-auto max-w-5xl">

        {/* HEADER */}

        <div className="mb-6">

          <p className="text-sm text-slate-500">
            Staff Portal
          </p>

          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            My Attendance
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            {staffName(staff)}
            {staff.designation
              ? ` â€¢ ${staff.designation}`
              : ""}
          </p>

        </div>

        {staff.attendance_mode === "offline" && (
          <section className="mb-6 rounded-2xl border border-violet-200 bg-violet-50 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-bold text-violet-950">Offline attendance is enabled</p>
                <p className="mt-1 text-sm text-violet-800">
                  Visit the offline attendance screen once while online so it is available after the connection drops.
                </p>
              </div>
              <a
                href="/offline-attendance.html"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800"
              >
                Open offline attendance screen
              </a>
            </div>
            {offlineEvents.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm text-violet-950">
                {offlineEvents
                  .filter((event) => event.user_id === currentUserId)
                  .map((event) => (
                  <li key={event.request_id} className="rounded-lg bg-white/80 p-3">
                    {event.action === "check_in" ? "Check-in" : "Check-out"} at{" "}
                    {formatTime(event.captured_at)} —{" "}
                    {event.status === "pending"
                      ? "pending server verification"
                      : `rejected: ${event.error || "GPS/time validation failed"}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* STATUS */}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

          <div className="p-6 sm:p-8">

            {/* STATUS ICON */}

            <div className="flex flex-col items-center text-center">

              <div
                className={`flex h-20 w-20 items-center justify-center rounded-full ${
                  checkedOut
                    ? "bg-blue-50 text-blue-600"
                    : checkedIn
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-slate-100 text-slate-500"
                }`}
              >

                {checkedOut ? (
                  <CheckCircle2 size={38} />
                ) : checkedIn ? (
                  <Clock3 size={38} />
                ) : (
                  <MapPin size={38} />
                )}

              </div>

              <h2 className="mt-5 text-2xl font-bold text-slate-900">

                {hasPendingOfflineAttendance
                  ? "Attendance Pending Verification"
                  : checkedOut
                  ? "Attendance Completed"
                  : checkedIn
                  ? "You are Checked In"
                  : "Ready for Attendance"}

              </h2>

              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">

                {hasPendingOfflineAttendance
                  ? "Saved locally. This record is not official until the server validates its GPS and school-day eligibility."
                  : checkedOut
                  ? "Your check-in and check-out have both been recorded for today."
                  : checkedIn
                  ? "Keep working normally. Check out when you leave the school."
                  : "Your location will be verified against the configured school attendance area."}

              </p>

            </div>

            {/* MESSAGES */}

            {error && (
              <div className="mt-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">

                <AlertTriangle
                  size={18}
                  className="mt-0.5 shrink-0"
                />

                <p>
                  {error}
                </p>

              </div>
            )}

            {success && (
              <div className="mt-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">

                <CheckCircle2
                  size={18}
                  className="mt-0.5 shrink-0"
                />

                <p>
                  {success}
                </p>

              </div>
            )}

            {/* GPS STATUS */}

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                <div className="flex items-center gap-3">

                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
                    <Navigation size={19} />
                  </div>

                  <div>

                    <p className="font-semibold text-slate-900">
                      GPS Location
                    </p>

                    <p className="text-xs text-slate-500">
                      {message}
                    </p>

                  </div>

                </div>

                <button
                  type="button"
                  onClick={
                    refreshLocation
                  }
                  disabled={
                    locating ||
                    processing
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >

                  {locating ? (
                    <Loader2
                      size={16}
                      className="animate-spin"
                    />
                  ) : (
                    <Navigation
                      size={16}
                    />
                  )}

                  {locating
                    ? "Getting GPS..."
                    : "Refresh Location"}

                </button>

              </div>

              {location && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">

                  <div className="rounded-xl bg-white p-3">

                    <p className="text-xs text-slate-400">
                      Latitude
                    </p>

                    <p className="mt-1 break-all text-sm font-semibold text-slate-800">
                      {location.latitude.toFixed(
                        7
                      )}
                    </p>

                  </div>

                  <div className="rounded-xl bg-white p-3">

                    <p className="text-xs text-slate-400">
                      Longitude
                    </p>

                    <p className="mt-1 break-all text-sm font-semibold text-slate-800">
                      {location.longitude.toFixed(
                        7
                      )}
                    </p>

                  </div>

                  <div className="rounded-xl bg-white p-3">

                    <p className="text-xs text-slate-400">
                      Accuracy
                    </p>

                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      Â±
                      {Math.round(
                        location.accuracy
                      )}
                      {" "}
                      m
                    </p>

                  </div>

                </div>
              )}

            </div>

            {/* ACTION BUTTONS */}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">

              <button
                type="button"
                onClick={checkIn}
                disabled={
                  !canCheckIn ||
                  processing
                }
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 py-4 text-base font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >

                {processing &&
                canCheckIn ? (
                  <Loader2
                    size={21}
                    className="animate-spin"
                  />
                ) : (
                  <LogIn
                    size={21}
                  />
                )}

                Check In

              </button>

              <button
                type="button"
                onClick={checkOut}
                disabled={
                  !canCheckOut ||
                  processing
                }
                className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-slate-900 px-6 py-4 text-base font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >

                {processing &&
                canCheckOut ? (
                  <Loader2
                    size={21}
                    className="animate-spin"
                  />
                ) : (
                  <LogOut
                    size={21}
                  />
                )}

                Check Out

              </button>

            </div>

          </div>

        </section>

        {/* TODAY DETAILS */}

        {attendance && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-200 p-5">

              <div className="flex items-center gap-3">

                <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                  <CalendarCheck size={20} />
                </div>

                <div>

                  <h2 className="font-bold text-slate-900">
                    Today&apos;s Attendance
                  </h2>

                  <p className="text-sm text-slate-500">
                    {today()}
                  </p>

                </div>

              </div>

            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">

              <Detail
                label="Check In"
                value={formatTime(
                  attendance.check_in_at
                )}
              />

              <Detail
                label="Check Out"
                value={formatTime(
                  attendance.check_out_at
                )}
              />

              <Detail
                label="Working Time"
                value={formatMinutes(
                  attendance.working_minutes
                )}
              />

              <Detail
                label="Status"
                value={
                  String(
                    attendance.status ||
                      "present"
                  ).replaceAll(
                    "_",
                    " "
                  )
                }
              />

            </div>

            {/* GPS RECORD */}

            <div className="border-t border-slate-200 p-5">

              <h3 className="text-sm font-bold text-slate-900">
                GPS Verification
              </h3>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">

                <GpsDetail
                  title="Check-in"
                  distance={
                    attendance.check_in_distance_meters
                  }
                  accuracy={
                    attendance.check_in_accuracy_meters
                  }
                />

                <GpsDetail
                  title="Check-out"
                  distance={
                    attendance.check_out_distance_meters
                  }
                  accuracy={
                    attendance.check_out_accuracy_meters
                  }
                />

              </div>

            </div>

            {/* FLAGS */}

            {(attendance.is_late ||
              attendance.is_early_checkout) && (
              <div className="border-t border-slate-200 p-5">

                <div className="flex flex-wrap gap-2">

                  {attendance.is_late && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                      Late Check-in
                    </span>
                  )}

                  {attendance.is_early_checkout && (
                    <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                      Early Check-out
                    </span>
                  )}

                </div>

              </div>
            )}

          </section>
        )}

        {/* SECURITY NOTE */}

        <div className="mt-6 flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-5">

          <ShieldCheck className="mt-0.5 shrink-0 text-blue-600" />

          <div>

            <h3 className="font-semibold text-blue-900">
              Secure GPS Attendance
            </h3>

            <p className="mt-1 text-sm leading-6 text-blue-700">
              Your browser provides the GPS coordinates,
              but the school server verifies the location
              and records the attendance. Changing the
              displayed time or location in the browser
              does not bypass the attendance verification.
            </p>

          </div>

        </div>

      </div>

    </main>
  );
}

/* =========================================================
   SMALL COMPONENTS
   ========================================================= */

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">

      <p className="text-xs text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-lg font-bold capitalize text-slate-900">
        {value}
      </p>

    </div>
  );
}

function GpsDetail({
  title,
  distance,
  accuracy,
}: {
  title: string;
  distance: number | null;
  accuracy: number | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">

      <div className="flex items-center gap-2">

        <MapPin
          size={16}
          className="text-emerald-600"
        />

        <p className="font-semibold text-slate-800">
          {title}
        </p>

      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">

        <div>

          <p className="text-xs text-slate-400">
            Distance
          </p>

          <p className="mt-1 text-sm font-bold text-slate-900">
            {distanceText(
              distance
            )}
          </p>

        </div>

        <div>

          <p className="text-xs text-slate-400">
            GPS Accuracy
          </p>

          <p className="mt-1 text-sm font-bold text-slate-900">
            {accuracy ===
            null ||
            accuracy ===
              undefined
              ? "â€”"
              : `Â±${Math.round(
                  accuracy
                )} m`}
          </p>

        </div>

      </div>

    </div>
  );
}

/* =========================================================
   RPC RESPONSE HELPERS
   ========================================================= */

function getRpcSuccessMessage(
  data: unknown,
  fallback: string
) {
  if (
    data &&
    typeof data === "object"
  ) {
    const row =
      data as Record<
        string,
        unknown
      >;

    if (
      typeof row.message ===
      "string"
    ) {
      return row.message;
    }

    if (
      typeof row.status_message ===
      "string"
    ) {
      return row.status_message;
    }

    if (
      typeof row.result_message ===
      "string"
    ) {
      return row.result_message;
    }
  }

  return fallback;
}

function getRpcErrorMessage(
  error: unknown,
  fallback: string
) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  if (
    typeof error === "string"
  ) {
    return error;
  }

  return fallback;
}
