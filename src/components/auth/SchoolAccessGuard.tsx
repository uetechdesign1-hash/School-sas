"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/subscription-expired",
  "/super-admin",
];

function isPublicPath(pathname: string) {
  if (pathname === "/") {
    return true;
  }

  return PUBLIC_PREFIXES.some(
    (prefix) =>
      prefix !== "/" &&
      (pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );
}

export default function SchoolAccessGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const validatedAccess = useRef(false);
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        validatedAccess.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      // Public pages do not require school authentication.
      if (isPublicPath(pathname)) {
        if (!cancelled) {
          setAllowed(true);
          setChecking(false);
        }
        return;
      }

      // School access is independent of the current route. Keep the result
      // for this authenticated session so navigation does not block on the
      // same auth, membership, and school requests every time.
      if (validatedAccess.current) {
        if (!cancelled) {
          setAllowed(true);
          setChecking(false);
        }
        return;
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        // No logged-in user.
        if (!user) {
          if (!cancelled) {
            setAllowed(false);
            setChecking(false);
          }

          router.replace("/login");
          return;
        }

        // Check platform role.
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("platform_role, is_active")
          .eq("id", user.id)
          .maybeSingle();

        // Super Admin can access the platform regardless of school expiry.
        if (profile?.platform_role === "super_admin") {
          validatedAccess.current = true;
          if (!cancelled) {
            setAllowed(true);
            setChecking(false);
          }

          return;
        }

        // Find active school membership.
        const { data: membership, error: membershipError } = await supabase
          .from("school_users")
          .select("school_id")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (membershipError || !membership?.school_id) {
          if (!cancelled) {
            setAllowed(false);
            setChecking(false);
          }

          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        // Get school access information.
        const { data: school, error: schoolError } = await supabase
          .from("schools")
          .select("id, name, status, expires_on")
          .eq("id", membership.school_id)
          .maybeSingle();

        if (schoolError || !school) {
          if (!cancelled) {
            setAllowed(false);
            setChecking(false);
          }

          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        // Compare expiry date with today's date.
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const expiresOn = school.expires_on
          ? new Date(`${school.expires_on}T00:00:00`)
          : null;

        const expired =
          school.status === "suspended" ||
          (expiresOn !== null && expiresOn < today);

        // Expired/suspended school.
        if (expired) {
          sessionStorage.setItem(
            "school_expiry_name",
            school.name || "Your school",
          );

          sessionStorage.setItem(
            "school_expiry_date",
            school.expires_on || "",
          );

          if (!cancelled) {
            setAllowed(false);
            setChecking(false);
          }

          await supabase.auth.signOut();
          router.replace("/subscription-expired");
          return;
        }

        // School access is valid.
        if (!cancelled) {
          validatedAccess.current = true;
          setAllowed(true);
          setChecking(false);
        }
      } catch (error) {
        console.error("SCHOOL ACCESS CHECK ERROR:", error);

        if (!cancelled) {
          setAllowed(false);
          setChecking(false);
        }

        router.replace("/login");
      }
    }

    void checkAccess();

    return () => {
      cancelled = true;
    };
  }, [pathname, router, supabase]);

  // Public pages render immediately.
  if (isPublicPath(pathname)) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-center shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

          <p className="mt-3 text-sm font-medium text-slate-600">
            Checking school access...
          </p>
        </div>
      </main>
    );
  }

  if (!allowed) {
    return null;
  }

  return <>{children}</>;
}
