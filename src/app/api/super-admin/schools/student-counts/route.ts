import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing.");
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Authorization token is required.");

    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) throw new Error("You must be signed in as Super Admin.");

    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("platform_role,is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || profile?.platform_role !== "super_admin" || profile.is_active !== true) {
      throw new Error("Active Super Admin access is required.");
    }

    const { data: schools, error: schoolsError } = await admin
      .from("schools")
      .select("id");
    if (schoolsError) throw schoolsError;

    const counts: Record<string, number> = {};
    const schoolIds = (schools || []).map((school) => school.id as string);
    for (let index = 0; index < schoolIds.length; index += 10) {
      const batch = schoolIds.slice(index, index + 10);
      const batchCounts = await Promise.all(batch.map(async (schoolId) => {
        const { count, error } = await admin
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId)
          .eq("status", "active");
        if (error) throw error;
        return [schoolId, count || 0] as const;
      }));
      for (const [schoolId, count] of batchCounts) counts[schoolId] = count;
    }

    return json({ success: true, counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load student counts.";
    return json({ success: false, error: message }, 400);
  }
}
