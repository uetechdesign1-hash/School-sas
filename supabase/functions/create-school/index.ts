import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { parseSchoolModules } from "../_shared/school-modules.ts";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);

  let schoolId: string | undefined;
  let ownerId: string | undefined;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !publishableKey) {
      throw new Error("Supabase server configuration is missing.");
    }

    const authorization = request.headers.get("Authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ success: false, error: "Authentication required." }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ success: false, error: "Invalid authentication." }, 401);

    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("platform_role,is_active")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw new Error(`Unable to verify Super Admin: ${profileError.message}`);
    if (profile?.platform_role !== "super_admin" || profile.is_active !== true) {
      return json({ success: false, error: "Only an active Super Admin can create schools." }, 403);
    }

    const body = await request.json();
    const schoolName = clean(body.school_name);
    const schoolCode = clean(body.school_code).toUpperCase();
    const schoolEmail = clean(body.email).toLowerCase();
    const schoolPhone = clean(body.phone);
    const ownerName = clean(body.owner_name);
    const ownerEmail = clean(body.owner_email).toLowerCase();
    const ownerPhone = clean(body.owner_phone);
    const password = String(body.owner_password ?? "");
    const planCode = clean(body.plan_code) || "starter";
    const studentLimit = Number(body.student_limit || 300);
    const modules = parseSchoolModules(
      body.enabled_modules !== undefined
        ? body.enabled_modules
        : body.enabledModules !== undefined
          ? body.enabledModules
          : ["fees", "payroll"],
    );

    if (!schoolName || !/^[A-Z0-9_-]{3,30}$/.test(schoolCode)) {
      return json({ success: false, error: "A school name and valid school code are required." }, 400);
    }
    if (!ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || password.length < 8) {
      return json({ success: false, error: "A valid owner name, email and password are required." }, 400);
    }
    if (!Number.isInteger(studentLimit) || studentLimit < 1 || !modules) {
      return json({ success: false, error: "A valid student limit and at least one valid module are required." }, 400);
    }

    const { data: existingSchools, error: lookupError } = await admin
      .from("schools")
      .select("id")
      .or(`code.ilike.${schoolCode},school_code.ilike.${schoolCode}`)
      .limit(1);
    if (lookupError) throw new Error(`Unable to check school code: ${lookupError.message}`);
    if (existingSchools?.length) {
      return json({ success: false, error: "This school code already exists." }, 409);
    }

    let page = 1;
    while (true) {
      const { data, error: usersError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (usersError) throw new Error(`Unable to check owner login: ${usersError.message}`);
      if (data.users.some((existing) => existing.email?.trim().toLowerCase() === ownerEmail)) {
        return json({ success: false, error: "An account already uses this owner email. No existing account was changed." }, 409);
      }
      if (data.users.length < 1000) break;
      page += 1;
    }

    const authenticated = createClient(url, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: school, error: schoolError } = await authenticated
      .from("schools")
      .insert({
        name: schoolName,
        code: schoolCode,
        school_code: schoolCode,
        email: schoolEmail || null,
        contact_email: schoolEmail || null,
        phone: schoolPhone || null,
        contact_phone: schoolPhone || null,
        status: "trial",
        plan_code: planCode,
        student_limit: studentLimit,
        starts_on: new Date().toISOString().slice(0, 10),
        created_by: user.id,
        enabled_modules: modules,
      })
      .select("id,name,code,school_code")
      .single();
    if (schoolError || !school) throw new Error(schoolError?.message || "Unable to create school.");
    schoolId = school.id;

    const { data: authData, error: createError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: ownerName, phone: ownerPhone || null },
    });
    if (createError || !authData.user) throw new Error(createError?.message || "Unable to create owner login.");
    ownerId = authData.user.id;

    const { error: ownerProfileError } = await admin.from("user_profiles").upsert({
      id: ownerId,
      full_name: ownerName,
      login_id: ownerEmail,
      phone: ownerPhone || null,
      platform_role: "user",
      is_active: true,
    }, { onConflict: "id" });
    if (ownerProfileError) throw new Error(`Unable to create owner profile: ${ownerProfileError.message}`);

    const { error: membershipError } = await admin.from("school_users").insert({
      user_id: ownerId,
      school_id: schoolId,
      role: "owner",
      is_active: true,
    });
    if (membershipError) throw new Error(`Unable to assign school owner: ${membershipError.message}`);

    return json({
      success: true,
      message: "School and owner created successfully.",
      school: { id: school.id, name: school.name, code: school.code || school.school_code },
      owner: { id: ownerId, email: ownerEmail, name: ownerName },
      enabled_modules: modules,
    }, 200);
  } catch (error) {
    console.error("CREATE SCHOOL ERROR:", error);
    const message = error instanceof Error ? error.message : "Unable to create school.";
    const retained = schoolId
      ? " Created records were retained for Super Admin review; no Auth account was deleted."
      : "";
    return json({ success: false, error: `${message}${retained}`, schoolId, ownerId }, 500);
  }
});
