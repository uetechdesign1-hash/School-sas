"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SchoolOnboardingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function routeAccount() {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) {
          router.replace("/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("user_profiles")
          .select("platform_role,is_active")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) throw profileError;

        if (profile?.is_active === true) {
          if (profile.platform_role === "super_admin") {
            router.replace("/super-admin");
            return;
          }
          if (profile.platform_role === "sales_rep") {
            router.replace("/sales");
            return;
          }
        }

        const { data: membership, error: membershipError } = await supabase
          .from("school_users")
          .select("school_id")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (membershipError) throw membershipError;
        if (membership) {
          router.replace("/dashboard");
          return;
        }

        if (active) setLoading(false);
      } catch (routeError) {
        if (active) {
          setError(
            routeError instanceof Error
              ? routeError.message
              : "Unable to verify your account.",
          );
          setLoading(false);
        }
      }
    }

    void routeAccount();
    return () => {
      active = false;
    };
  }, [router, supabase]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={28} />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">
          <Building2 size={26} />
        </div>
        <h1 className="mt-5 text-3xl font-bold text-slate-900">
          School registration
        </h1>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        ) : (
          <p className="mt-4 text-slate-600">
            School setup is handled by an authorized Super Admin or Sales
            Representative. They will discuss subscription plans, pricing,
            student strength, and payment terms with you before creating the
            school and owner login.
          </p>
        )}
        <Link
          href="/login"
          className="mt-7 inline-flex rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
        >
          Return to sign in
        </Link>
      </div>
    </main>
  );
}
