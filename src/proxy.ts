import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  getAnonymousRedirectPath,
  getAuthenticatedLoginRedirectPath,
} from "./lib/auth/proxy-access";

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
  const anonymousRedirectPath = getAnonymousRedirectPath(pathname, Boolean(user));
  if (anonymousRedirectPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = anonymousRedirectPath;
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  /*
   * Only send signed-in users to the dashboard if they have a school.
   */
  if (
    (pathname === "/login" || pathname === "/signup") &&
    user
  ) {
    const { data: memberships, error: membershipError } = await supabase
      .from("school_users")
      .select("role")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (membershipError) {
      console.error("MEMBERSHIP LOOKUP ERROR:", membershipError);
      return new NextResponse("Unable to verify school access.", { status: 503 });
    }

    if (!memberships?.length) {
      return response;
    }

    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = getAuthenticatedLoginRedirectPath(
      memberships.map(({ role }) => role),
      false,
    );
    dashboardUrl.search = "";

    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/accounting/:path*",
    "/sales/:path*",
    "/sales",
    "/super-admin/:path*",
    "/super-admin",
    "/login",
    "/signup",
    "/onboarding/:path*",
  ],
};
