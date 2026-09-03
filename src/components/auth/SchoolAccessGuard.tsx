"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PUBLIC_PREFIXES = [
  "/login",
  "/subscription-expired",
  "/super-admin",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function SchoolAccessGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      if (isPublicPath(pathname)) {
        if (!cancelled) {
          setAllowed(true);
          setChecking(false);
        }
        return;
      }

      try {
        const supabase = createClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (!cancelled) {
            setAllowed(false);
            setChecking(false);
          }
          router.replace("/login");
          return;
        }

        const { data: profile } = await supabase
          .from("user_profiles")
          .select("platform_role, is_active")
          .eq("id", user.id)
          .maybeSingle();

        if (profile?.platform_role === "super_admin") {
          if (!cancelled) {
            setAllowed(true);
            setChecking(false);
          }
          return;
        }

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

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const expiresOn = school.expires_on
          ? new Date(`${school.expires_on}T00:00:00`)
          : null;

        const expired =
          school.status === "suspended" ||
          (expiresOn !== null && expiresOn < today);

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

        if (!cancelled) {
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
  }, [pathname, router]);

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
