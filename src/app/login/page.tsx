"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();

  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] = useState("");
  const [platformLogo, setPlatformLogo] = useState<string | null>(null);
  const [reasonDismissed, setReasonDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.rpc("get_platform_logo").then(({ data }) => {
      if (active) setPlatformLogo(typeof data === "string" ? data : null);
    });
    return () => { active = false; };
  }, [supabase]);

  const login = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setError("");
    setReasonDismissed(true);
    setLoading(true);

    try {
      const cleanEmail =
        email.trim().toLowerCase();

      if (!cleanEmail) {
        throw new Error(
          "Please enter your email address."
        );
      }

      if (!password) {
        throw new Error(
          "Please enter your password."
        );
      }

      // ==================================================
      // LOGIN
      // ==================================================

      const {
        data,
        error: loginError,
      } =
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

      if (loginError) {
        throw new Error(
          loginError.message
        );
      }

      if (!data.user) {
        throw new Error(
          "Login failed. User account was not found."
        );
      }

      const {
        data: platformProfile,
        error: platformProfileError,
      } = await supabase
        .from("user_profiles")
        .select("platform_role,is_active")
        .eq("id", data.user.id)
        .maybeSingle();

      if (platformProfileError) {
        throw new Error("Unable to verify your platform access.");
      }

      if (platformProfile?.platform_role === "sales_rep") {
        if (platformProfile.is_active !== true) {
          await supabase.auth.signOut();
          throw new Error(
            "Your Sales Team account is inactive. Contact a Super Admin."
          );
        }

        router.replace("/sales");
        return;
      }

      // ==================================================
      // GET SCHOOL ACCOUNT
      // ==================================================

      const {
        data: schoolUsers,
        error: schoolUserError,
      } = await supabase
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
        .eq(
          "user_id",
          data.user.id
        )
        .eq("is_active", true);

      if (schoolUserError) {
        console.error(
          "SCHOOL USER ERROR:",
          schoolUserError
        );

        await supabase.auth.signOut();

        throw new Error(
          "Unable to determine your school account."
        );
      }

      if (!schoolUsers?.length) {
        await supabase.auth.signOut();

        throw new Error(
          "Your account is not assigned to an active school."
        );
      }

      // ==================================================
      // NORMALIZE ROLE
      // ==================================================

      // A user can have more than one active school membership. Prefer the
      // staff membership so login never falls through to the Principal home.
      const schoolUser = schoolUsers.find((membership) =>
        ["staff", "teacher", "employee"].includes(
          String(membership.role || "").trim().toLowerCase()
        )
      ) || schoolUsers[0];

      const rawRole = String(
        schoolUser.role || ""
      ).trim().toLowerCase();
      const role = ["teacher", "employee"].includes(rawRole)
        ? "staff"
        : rawRole;

      console.log(
        "LOGIN USER:",
        data.user.id
      );

      console.log(
        "SCHOOL:",
        schoolUser.school_id
      );

      console.log(
        "ROLE:",
        role
      );

      // ==================================================
      // STAFF
      // ==================================================

      if (role === "staff") {
        // Make sure this login really belongs
        // to a staff record.

        const {
          data: staff,
          error: staffError,
        } = await supabase
          .from("staff")
          .select(
            `
              id,
              school_id,
              user_id,
              first_name,
              middle_name,
              last_name,
              status
            `
          )
          .eq(
            "user_id",
            data.user.id
          )
          .eq(
            "school_id",
            schoolUser.school_id
          )
          .maybeSingle();

        if (staffError) {
          console.error(
            "STAFF LOOKUP ERROR:",
            staffError
          );

          await supabase.auth.signOut();

          throw new Error(
            "Unable to identify your staff account."
          );
        }

        if (!staff) {
          await supabase.auth.signOut();

          throw new Error(
            "Your login account is not linked to a staff member."
          );
        }

        if (
          staff.status &&
          staff.status !== "active"
        ) {
          await supabase.auth.signOut();

          throw new Error(
            "Your staff account is currently inactive."
          );
        }

        // ================================================
        // STAFF DASHBOARD
        // ================================================

        router.replace(
          "/dashboard/staff/home"
        );

        return;
      }

      // ==================================================
      // OWNER / ADMIN
      // ==================================================

      if (
        role === "owner" ||
        role === "admin"
      ) {
        router.replace(
          "/dashboard"
        );

        return;
      }

      // ==================================================
      // OTHER SCHOOL ROLES
      // ==================================================

      router.replace(
        "/dashboard"
      );
    } catch (err: any) {
      console.error(
        "LOGIN ERROR:",
        err
      );

      setError(
        err?.message ||
          "Unable to login."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen items-center justify-center px-4 py-8">

        <div className="w-full max-w-md">

          {/* LOGO / HEADER */}

          <div className="mb-8 text-center">

            {platformLogo ? (
              <img src={platformLogo} alt="SCB platform logo" className="mx-auto h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-1 shadow-sm" />
            ) : (
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/40">
                <ShieldCheck className="h-7 w-7" />
              </div>
            )}

            <h1 className="mt-5 bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-500 bg-clip-text text-2xl font-bold text-transparent">
              Smart Campus Board
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Sign in to continue
            </p>

          </div>

          {/* LOGIN CARD */}

          <div className="rounded-3xl border border-white/70 bg-white/85 p-6 shadow-xl shadow-indigo-500/10 backdrop-blur-xl sm:p-8">

            <form
              onSubmit={login}
              className="space-y-5"
            >

              {/* EMAIL */}

              <div>

                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Email
                </label>

                <div className="relative">

                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                  <input
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
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50"
                  />

                </div>

              </div>

              {/* PASSWORD */}

              <div>

                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Password
                </label>

                <div className="relative">

                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                  <input
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    value={password}
                    onChange={(event) =>
                      setPassword(
                        event.target.value
                      )
                    }
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={loading}
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-11 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword(
                        (value) => !value
                      )
                    }
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>

                </div>

              </div>

              {/* ERROR */}

              {!reasonDismissed && !error && (
                <Suspense fallback={null}>
                  <AccessMessage />
                </Suspense>
              )}
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
                  {error}
                  {error === "Your account is not assigned to an active school." && (
                    <p className="mt-2">
                      This login is for school staff and principals.{" "}
                      <Link
                        href="/super-admin/login"
                        className="font-semibold underline"
                      >
                        Sales Team members, use the platform login.
                      </Link>
                    </p>
                  )}
                </div>
              )}

              {/* LOGIN */}

              <button
                type="submit"
                disabled={
                  loading ||
                  !email.trim() ||
                  !password
                }

                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/40 transition hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" />
                    Sign In
                  </>
                )}
              </button>

            </form>

            <Link
              href="/super-admin/login"
              className="mt-4 block text-center text-sm font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Sales Team or Super Admin? Use platform login
            </Link>

            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                router.push("/forgot-password");
              }}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 transition hover:bg-blue-100 active:bg-blue-200"
            >
              <Mail className="h-4 w-4" />
              Forgot password?
            </button>

            <p className="mt-2 text-xs text-slate-500">
              For staff accounts and school principal accounts. A reset link will be emailed to the address used when the account was created.
            </p>

            {/* STAFF INFO */}

            {/* STAFF INFO */}

            <div className="mt-6 rounded-xl bg-slate-50 p-4">

              <div className="flex gap-3">

                <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />

                <p className="text-xs leading-5 text-slate-500">
                  Staff accounts are automatically
                  connected to the staff member and
                  will open the teacher dashboard after
                  login.
                </p>

              </div>

            </div>

          </div>

        </div>
      </div>
    </main>
  );
}

function AccessMessage() {
  const reason = useSearchParams().get("reason");
  const message = reason === "no-school"
    ? "Your account is not assigned to an active school. Contact your school administrator."
    : reason === "access-check-failed"
      ? "Unable to verify your school access. Please try again."
      : "";

  if (!message) return null;

  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}
