import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getTransportMemberships } from "@/lib/transport/memberships";
import { transportDestination } from "@/lib/transport/roles";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  /*
   * Protect school dashboard
   */
  if (
    (pathname.startsWith("/dashboard") ||
      pathname === "/driver" || pathname.startsWith("/driver/") ||
      pathname === "/parent" || pathname.startsWith("/parent/")) &&
    !user
  ) {
    const loginUrl = request.nextUrl.clone();

    loginUrl.pathname = "/login";
    loginUrl.search = "";

    return NextResponse.redirect(loginUrl);
  }

  /*
   * If already logged in and opening login/signup,
   * send user to the normal school dashboard.
   */
  if (user && (
    pathname === "/login" || pathname === "/signup" ||
    pathname === "/dashboard" || pathname.startsWith("/dashboard/")
  )) {
    const { data: memberships, error: membershipError } = await supabase
      .from("school_users")
      .select("role")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (membershipError && pathname.startsWith("/dashboard")) {
      console.error("DASHBOARD MEMBERSHIP ERROR:", membershipError);
      return new NextResponse("Unable to verify school access.", { status: 503 });
    }

    let transportPath: string | null = null;
    if (!membershipError && !memberships?.length) {
      try {
        const transportMemberships = await getTransportMemberships(supabase, user.id);
        transportPath = transportDestination(transportMemberships[0]?.role);
        if (transportMemberships.length && !transportPath) {
          throw new Error("Invalid transport membership role.");
        }
      } catch (error) {
        console.error("TRANSPORT MEMBERSHIP ERROR:", error);
        return new NextResponse("Unable to verify transport access.", { status: 503 });
      }
    }
    if (pathname.startsWith("/dashboard")) {
      if (!transportPath) return response;
      const portalUrl = request.nextUrl.clone();
      portalUrl.pathname = transportPath;
      portalUrl.search = "";
      return NextResponse.redirect(portalUrl);
    }

    const hasStaffMembership = !membershipError && memberships?.some(
      ({ role }) => ["staff", "teacher", "employee"].includes(String(role || "").trim().toLowerCase())
    );

    const dashboardUrl = request.nextUrl.clone();

    dashboardUrl.pathname = hasStaffMembership
      ? "/dashboard/staff/home"
      : transportPath || "/dashboard";
    dashboardUrl.search = "";

    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/driver/:path*",
    "/parent/:path*",
    "/login",
    "/signup",
    "/onboarding/:path*",
  ],
};
