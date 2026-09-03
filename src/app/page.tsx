"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function checkOldSession() {
      try {
        const supabase = createClient();

        /*
         * IMPORTANT:
         *
         * We deliberately do NOT redirect to
         * /setup-school here.
         *
         * If an old session exists, remove it so
         * the user gets the ONE normal login page.
         */

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          await supabase.auth.signOut();
        }
      } catch (error) {
        console.error(
          "SESSION CHECK ERROR:",
          error
        );
      } finally {
        setCheckingSession(false);
      }
    }

    checkOldSession();
  }, []);

  async function handleLogin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErrorMessage("");
    setLoading(true);

    try {
      const supabase = createClient();

      const cleanEmail =
        email.trim().toLowerCase();

      if (!cleanEmail) {
        setErrorMessage(
          "Please enter your email address."
        );

        setLoading(false);
        return;
      }

      if (!password) {
        setErrorMessage(
          "Please enter your password."
        );

        setLoading(false);
        return;
      }

      /*
       * ==========================================
       * SIGN IN
       * ==========================================
       */

      const {
        data,
        error,
      } =
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

      if (error) {
        setErrorMessage(
          error.message ||
            "Invalid login credentials."
        );

        setLoading(false);
        return;
      }

      if (!data.user) {
        setErrorMessage(
          "Login failed. Please try again."
        );

        setLoading(false);
        return;
      }

      const userId = data.user.id;

      /*
       * ==========================================
       * USER PROFILE
       * ==========================================
       */

      const {
        data: profile,
        error: profileError,
      } =
        await supabase
          .from("user_profiles")
          .select(
            `
              id,
              full_name,
              login_id,
              platform_role,
              is_active
            `
          )
          .eq("id", userId)
          .maybeSingle();

      if (profileError) {
        console.error(
          "PROFILE ERROR:",
          profileError
        );

        await supabase.auth.signOut();

        setErrorMessage(
          "Unable to load your account profile."
        );

        setLoading(false);
        return;
      }

      if (!profile) {
        await supabase.auth.signOut();

        setErrorMessage(
          "Your account profile was not found."
        );

        setLoading(false);
        return;
      }

      /*
       * ==========================================
       * INACTIVE ACCOUNT
       * ==========================================
       */

      if (!profile.is_active) {
        await supabase.auth.signOut();

        setErrorMessage(
          "Your account is inactive. Please contact the administrator."
        );

        setLoading(false);
        return;
      }

      /*
       * ==========================================
       * SUPER ADMIN
       * ==========================================
       */

      if (
        profile.platform_role ===
        "super_admin"
      ) {
        router.replace("/super-admin");
        router.refresh();

        return;
      }

      /*
       * ==========================================
       * SCHOOL USER
       * ==========================================
       */

      const {
        data: membership,
        error: membershipError,
      } =
        await supabase
          .from("school_users")
          .select(
            `
              id,
              user_id,
              school_id,
              role,
              is_active
            `
          )
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

      if (membershipError) {
        console.error(
          "SCHOOL MEMBERSHIP ERROR:",
          membershipError
        );

        await supabase.auth.signOut();

        setErrorMessage(
          "Unable to find your school account."
        );

        setLoading(false);
        return;
      }

      if (!membership) {
        await supabase.auth.signOut();

        setErrorMessage(
          "This user has not been assigned to a school yet."
        );

        setLoading(false);
        return;
      }

      /*
       * ==========================================
       * SCHOOL
       * ==========================================
       */

      const {
        data: school,
        error: schoolError,
      } =
        await supabase
          .from("schools")
          .select(
            `
              id,
              name,
              code,
              school_code,
              status,
              plan_code,
              student_limit,
              timezone,
              currency_code
            `
          )
          .eq(
            "id",
            membership.school_id
          )
          .maybeSingle();

      if (schoolError) {
        console.error(
          "SCHOOL ERROR:",
          schoolError
        );

        await supabase.auth.signOut();

        setErrorMessage(
          "Unable to load your school."
        );

        setLoading(false);
        return;
      }

      if (!school) {
        await supabase.auth.signOut();

        setErrorMessage(
          "Your school account could not be found."
        );

        setLoading(false);
        return;
      }

      /*
       * ==========================================
       * SUSPENDED SCHOOL
       * ==========================================
       */

      if (
        school.status ===
        "suspended"
      ) {
        await supabase.auth.signOut();

        setErrorMessage(
          "This school account has been suspended."
        );

        setLoading(false);
        return;
      }

      /*
       * ==========================================
       * SAVE SCHOOL CONTEXT
       * ==========================================
       */

      sessionStorage.setItem(
        "school_id",
        school.id
      );

      sessionStorage.setItem(
        "school_name",
        school.name
      );

      sessionStorage.setItem(
        "school_role",
        membership.role
      );

      /*
       * ==========================================
       * SCHOOL DASHBOARD
       * ==========================================
       */

      router.replace(
        "//dashboard"
      );

      router.refresh();

    } catch (error) {
      console.error(
        "LOGIN ERROR:",
        error
      );

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to sign in."
      );

      setLoading(false);
    }
  }

  /*
   * ==========================================
   * LOADING
   * ==========================================
   */

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">

        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 text-center shadow-sm">

          <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />

          <p className="text-sm text-slate-600">
            Opening login...
          </p>

        </div>

      </main>
    );
  }

  /*
   * ==========================================
   * LOGIN UI
   * ==========================================
   */

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-blue-100 px-4 py-10">

      <div className="w-full max-w-md">

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">

          {/* Header */}

          <div className="px-8 pb-6 pt-8 text-center">

            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">

              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-blue-600"
              >
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 21v-6h6v6" />
                <path d="M9 9h.01" />
                <path d="M15 9h.01" />
              </svg>

            </div>

            <h1 className="mt-5 text-3xl font-bold text-slate-900">
              SchoolFlow
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Sign in to your account
            </p>

          </div>

          {/* Form */}

          <form
            onSubmit={handleLogin}
            className="px-8 pb-8"
          >

            {errorMessage && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">

                <p className="text-sm font-medium text-red-700">
                  {errorMessage}
                </p>

              </div>
            )}

            {/* Email */}

            <div className="mb-5">

              <label
                htmlFor="email"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Email
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
                }
                placeholder="Enter your email"
                autoComplete="email"
                disabled={loading}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
              />

            </div>

            {/* Password */}

            <div className="mb-6">

              <label
                htmlFor="password"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                placeholder="Enter your password"
                autoComplete="current-password"
                disabled={loading}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
              />

            </div>

            {/* Button */}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-blue-600 px-5 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {loading
                ? "Signing in..."
                : "Sign In"}
            </button>

            {/* Contact */}

            <div className="mt-6 rounded-xl bg-slate-50 p-4 text-center">

              <p className="text-sm text-slate-600">
                Need a school account?
              </p>

              <a
                href="tel:7780670760"
                className="mt-1 inline-block text-sm font-semibold text-blue-600 hover:underline"
              >
                Contact us: 7780670760
              </a>

            </div>

          </form>

        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          School Management SaaS
        </p>

      </div>

    </main>
  );
}