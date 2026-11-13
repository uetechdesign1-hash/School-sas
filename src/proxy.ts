import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  getAnonymousRedirectPath,
  getAuthenticatedLoginRedirectPath,
} from "@/lib/auth/proxy-access";

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
  const anonymousRedirectPath = getAnonymousRedirectPath(
    pathname,
    Boolean(user),
  );

  if (anonymousRedirectPath) {
    const loginUrl = request.nextUrl.clone();

    loginUrl.pathname = anonymousRedirectPath;
    loginUrl.search = "";

    return NextResponse.redirect(loginUrl);
  }

  /*
   * If already logged in and opening login/signup,
   * send user to the normal school dashboard.
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

    const redirectPath = getAuthenticatedLoginRedirectPath(
      memberships?.map(({ role }) => role) || null,
      Boolean(membershipError),
    );
    const dashboardUrl = request.nextUrl.clone();

    dashboardUrl.pathname = redirectPath;
    dashboardUrl.search = "";

    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/accounting/:path*",
    "/login",
    "/signup",
    "/onboarding/:path*",
  ],
};
