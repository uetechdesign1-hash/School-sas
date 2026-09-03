"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ResetStaffPasswordPage() {
  const params = useParams();
  const router = useRouter();

  const staffId = Array.isArray(params.id)
    ? params.id[0]
    : params.id;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirm, setShowConfirm] =
    useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function resetPassword() {
    try {
      setSaving(true);
      setError("");
      setSuccess("");

      if (password.length < 8) {
        throw new Error(
          "Password must contain at least 8 characters."
        );
      }

      if (password !== confirmPassword) {
        throw new Error(
          "Passwords do not match."
        );
      }

      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          "Your login session has expired. Please log in again."
        );
      }

      const response = await fetch(
        "/api/staff/reset-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            staff_id: staffId,
            password,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error ||
            "Unable to reset password."
        );
      }

      setSuccess(
        "Staff login password changed successfully."
      );

      setPassword("");
      setConfirmPassword("");

      setTimeout(() => {
        router.push(
          `/dashboard/staff/${staffId}`
        );
      }, 1200);
    } catch (err) {
      console.error(
        "RESET STAFF PASSWORD ERROR:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Unable to reset password."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-xl">
        <Link
          href={`/dashboard/staff/${staffId}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Staff Profile
        </Link>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="bg-slate-950 px-6 py-7 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
              <KeyRound className="h-6 w-6" />
            </div>

            <h1 className="mt-5 text-2xl font-bold">
              Reset Staff Password
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-300">
              Set a new password for this staff
              member's login account.
            </p>
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                {success}
              </div>
            )}

            <label className="block text-sm font-semibold text-slate-700">
              New Password
            </label>

            <div className="relative mt-2">
              <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <input
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                placeholder="Minimum 8 characters"
                disabled={saving}
                className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-11 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    (value) => !value
                  )
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            <p className="mt-1 text-xs text-slate-400">
              Minimum 8 characters.
            </p>

            <label className="mt-5 block text-sm font-semibold text-slate-700">
              Confirm New Password
            </label>

            <div className="relative mt-2">
              <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <input
                type={
                  showConfirm
                    ? "text"
                    : "password"
                }
                value={confirmPassword}
                onChange={(e) =>
                  setConfirmPassword(
                    e.target.value
                  )
                }
                placeholder="Enter password again"
                disabled={saving}
                className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-11 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirm(
                    (value) => !value
                  )
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              >
                {showConfirm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Link
                href={`/dashboard/staff/${staffId}`}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Link>

              <button
                type="button"
                onClick={() =>
                  void resetPassword()
                }
                disabled={
                  saving ||
                  password.length < 8 ||
                  !confirmPassword
                }
                className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? "Changing Password..."
                  : "Change Password"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
