import { NextRequest, NextResponse } from "next/server";
import {
  requireSchoolRole,
  UnauthenticatedError,
  UnauthorizedError,
} from "@/lib/auth/server";
import { requireSchoolModule } from "@/lib/auth/module";

export const dynamic = "force-dynamic";

type OfflineAttendanceRequest = {
  request_id?: unknown;
  user_id?: unknown;
  staff_id?: unknown;
  action?: unknown;
  captured_at?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracy_meters?: unknown;
};

function json(
  data: { success: boolean; error?: string; result?: unknown },
  status = 200,
) {
  return NextResponse.json(data, { status });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSchoolRole(request, [
      "owner", "admin", "principal", "accountant", "staff", "teacher", "employee",
    ]);
    await requireSchoolModule(auth, "payroll");

    let body: OfflineAttendanceRequest;
    try {
      body = (await request.json()) as OfflineAttendanceRequest;
    } catch {
      return json({ success: false, error: "Invalid request body." }, 400);
    }

    const requestId =
      typeof body.request_id === "string" ? body.request_id : "";
    const ownerUserId =
      typeof body.user_id === "string" ? body.user_id : "";
    const staffId =
      typeof body.staff_id === "string" ? body.staff_id : "";
    const action =
      body.action === "check_in" || body.action === "check_out"
        ? body.action
        : "";
    const capturedAt =
      typeof body.captured_at === "string" ? body.captured_at : "";
    const capturedAtDate = new Date(capturedAt);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const accuracyMeters = Number(body.accuracy_meters);
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(requestId)) {
      return json({ success: false, error: "Invalid attendance request ID." }, 400);
    }
    if (ownerUserId !== auth.userId) {
      return json(
        { success: false, error: "Sign in with the staff account that captured this attendance." },
        409,
      );
    }
    if (!uuidPattern.test(staffId)) {
      return json({ success: false, error: "Invalid staff profile ID." }, 400);
    }
    if (!action) {
      return json({ success: false, error: "Invalid attendance action." }, 400);
    }
    if (!capturedAt || Number.isNaN(capturedAtDate.getTime())) {
      return json({ success: false, error: "Invalid capture time." }, 400);
    }
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(accuracyMeters)
    ) {
      return json({ success: false, error: "Valid GPS coordinates are required." }, 400);
    }

    const { data: staff, error: staffError } = await auth.admin
      .from("staff")
      .select("id")
      .eq("id", staffId)
      .eq("school_id", auth.schoolId)
      .maybeSingle();
    if (staffError) throw new Error(`Unable to verify staff school: ${staffError.message}`);
    if (!staff) return json({ success: false, error: "Staff profile is not in your active school." }, 403);

    const { data, error } = await auth.admin.rpc(
      "sync_staff_offline_attendance",
      {
        p_user_id: auth.userId,
        p_staff_id: staffId,
        p_request_id: requestId,
        p_action: action,
        p_captured_at: capturedAtDate.toISOString(),
        p_latitude: latitude,
        p_longitude: longitude,
        p_accuracy_meters: accuracyMeters,
      },
    );

    if (error) {
      const clientError =
        /outside the school geofence|school day|already recorded|must be synced|device time|GPS|attendance is not enabled|timezone|profile configured|geofence is not configured|check-out time|attendance mode/i.test(
          error.message,
        );
      return json(
        { success: false, error: error.message },
        clientError ? 422 : 500,
      );
    }

    return json({ success: true, result: data });
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof UnauthorizedError) {
      return json({ success: false, error: error.message }, error.status);
    }
    console.error("OFFLINE STAFF ATTENDANCE SYNC ERROR:", error);
    return json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to sync offline attendance.",
      },
      500,
    );
  }
}
