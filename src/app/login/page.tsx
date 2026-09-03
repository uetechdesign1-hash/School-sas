"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function LoginPage() {
  const router = useRouter();

  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] = useState("");

  const login = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setError("");
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

      // ==================================================
      // GET SCHOOL ACCOUNT
      // ==================================================

      const {
        data: schoolUser,
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
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

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

      if (!schoolUser) {
        await supabase.auth.signOut();

        throw new Error(
          "Your account is not assigned to an active school."
        );
      }

      // ==================================================
      // NORMALIZE ROLE
      // ==================================================

      const role = String(
        schoolUser.role || ""
      ).toLowerCase();

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

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
              <ShieldCheck className="h-7 w-7" />
            </div>

            <h1 className="mt-5 text-2xl font-bold text-slate-900">
              School Management
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Sign in to continue
            </p>

          </div>

          {/* LOGIN CARD */}

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">

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

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
                  {error}
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
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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