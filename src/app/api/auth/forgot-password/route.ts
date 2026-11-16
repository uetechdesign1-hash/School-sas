import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL!;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function POST(request: Request) {
  try {
    if (!supabaseUrl) {
      return NextResponse.json(
        { error: "Supabase server configuration is incomplete." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { email, verification_type, phone, school_code } = body;
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    // If email provided and verification_type is "email", try email reset
    if (email && verification_type === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return NextResponse.json(
          { error: "Please enter a valid email address." },
          { status: 400 }
        );
      }

      if (!publishableKey) {
        return NextResponse.json(
          { error: "Supabase client configuration is incomplete." },
          { status: 500 }
        );
      }

      const supabase = createClient(supabaseUrl, publishableKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      // Determine redirect URL - use BASE_URL env var or fallback to request origin
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;

      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo: `${baseUrl}/auth/update-password` }
      );

      if (error) {
        console.error("PASSWORD RESET LINK ERROR:", error);
        // If email reset fails (e.g., no SMTP configured), fall back to alternative verification
        return NextResponse.json({
          fallback: true,
          message: "Email reset not available. Please verify using phone and school code.",
        });
      }

      return NextResponse.json({
        success: true,
        message: "If an account uses this email, a password reset link has been sent.",
        use_email: true,
      });
    }

    // Alternative verification: phone + school code

    if (!email && (!phone || !school_code)) {
      return NextResponse.json({
        fallback: true,
        show_verification: true,
        message: "Enter your email or verify with phone and school code.",
      });
    }

    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server configuration is incomplete." },
        { status: 500 }
      );
    }

    // If phone and school_code provided, verify against staff and schools tables
    if (phone && school_code) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      // Normalize phone: keep only digits
      const normalizedPhone =
        typeof phone === "string" ? phone.replace(/\D/g, "") : "";
      const normalizedSchoolCode =
        typeof school_code === "string"
          ? school_code.trim().toUpperCase()
          : "";

      if (!normalizedPhone || !normalizedSchoolCode) {
        return NextResponse.json(
          { error: "Enter a valid phone number and school code." },
          { status: 400 }
        );
      }

      // Look up school by school_code
      const { data: school, error: schoolError } = await adminClient
        .from("schools")
        .select("id, name")
        .eq("school_code", normalizedSchoolCode)
        .maybeSingle();

      if (schoolError) {
        console.error("SCHOOL LOOKUP ERROR:", schoolError);
        return NextResponse.json(
          { error: "Unable to verify your identity." },
          { status: 500 }
        );
      }

      if (!school) {
        return NextResponse.json({
          fallback: true,
          show_verification: true,
          message: "School code not found.",
        });
      }

      // Look up staff record by normalized phone and school_id
      const { data: staff, error: staffError } = await adminClient
        .from("staff")
        .select("id, email, user_id, school_id")
        .eq("phone", normalizedPhone)
        .eq("school_id", school.id)
        .maybeSingle();

      if (staffError) {
        console.error("STAFF LOOKUP ERROR:", staffError);
        return NextResponse.json(
          { error: "Unable to verify your identity." },
          { status: 500 }
        );
      }

      if (!staff) {
        return NextResponse.json({
          fallback: true,
          show_verification: true,
          message: "Phone number does not match our records for this school.",
        });
      }

      if (!staff.user_id) {
        return NextResponse.json({
          fallback: true,
          show_verification: true,
          message: "This staff member does not have a login account yet.",
        });
      }

      const { data: authUser, error: authUserError } =
        await adminClient.auth.admin.getUserById(staff.user_id);

      if (authUserError || !authUser.user?.email) {
        console.error("STAFF AUTH USER LOOKUP ERROR:", authUserError);
        return NextResponse.json(
          { error: "Unable to find the login email for this staff account." },
          { status: 500 }
        );
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
      if (!publishableKey) {
        return NextResponse.json(
          { error: "Supabase client configuration is incomplete." },
          { status: 500 }
        );
      }

      const mailClient = createClient(supabaseUrl, publishableKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      const { error } = await mailClient.auth.resetPasswordForEmail(
        authUser.user.email,
        { redirectTo: `${baseUrl}/auth/update-password` }
      );

      if (error) {
        console.error("PASSWORD RESET LINK ERROR:", error);
        return NextResponse.json(
          { error: error.message || "Unable to send password reset email." },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Verification successful! Password reset link sent to your email.",
        use_email: true,
      });
    }

    // Email provided but reset failed - show verification options
    return NextResponse.json({
      fallback: true,
      show_verification: true,
      message: "Email reset not available. Please verify using phone and school code.",
    });
  } catch (error) {
    console.error("FORGOT PASSWORD API ERROR:", error);
    return NextResponse.json(
      { error: "Unable to process the password reset request." },
      { status: 500 }
    );
  }
}