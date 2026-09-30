"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function NewAdminPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdEmail, setCreatedEmail] = useState("");
  const [createdPassword, setCreatedPassword] = useState("");

  async function createAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreatedEmail("");

    try {
      setSaving(true);
      const supabase = createClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!session?.access_token) {
        throw new Error("Your login session expired. Please sign in again.");
      }

      const response = await fetch("/api/admins/create-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          password,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        email?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to create Admin login.");
      }

      setCreatedEmail(result.email || email.trim().toLowerCase());
      setCreatedPassword(password);
      setFullName("");
      setEmail("");
      setPassword("");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to create Admin login.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-full bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/dashboard/staff"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
        >
          <ArrowLeft size={16} />
          Back to Staff
        </Link>

        <section className="mt-5 overflow-hidden rounded-3xl border border-white bg-white shadow-xl shadow-indigo-900/5">
          <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white sm:p-8">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/20">
                <ShieldCheck size={28} />
              </div>
              <div>
                <p className="text-sm font-semibold text-indigo-100">
                  School access
                </p>
                <h1 className="text-2xl font-black tracking-tight">
                  Create Admin Login
                </h1>
              </div>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-indigo-50">
              Create credentials for an Admin. They can manage student fee
              collection and add payments or expenses, but cannot edit or delete
              existing transactions.
            </p>
          </div>

          <form onSubmit={createAdmin} className="space-y-5 p-6 sm:p-8">
            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
              >
                {error}
              </div>
            )}

            {createdEmail && (
              <div
                role="status"
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                <span className="font-bold">Admin login created.</span>
                <span className="mt-2 block">
                  Share these credentials securely:
                </span>
                <span className="mt-2 block font-semibold">
                  Email: {createdEmail}
                </span>
                <span className="block font-semibold">
                  Initial password:{" "}
                  <code className="rounded bg-white/70 px-1.5 py-0.5">
                    {createdPassword}
                  </code>
                </span>
              </div>
            )}

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Admin full name
              </span>
              <input
                required
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                placeholder="Enter the Admin's name"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Login email
              </span>
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                placeholder="admin@school.com"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <KeyRound size={15} />
                Temporary password
              </span>
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                placeholder="At least 8 characters"
              />
              <span className="mt-1.5 block text-xs text-slate-500">
                Share the password securely and ask the Admin to change it
                after signing in.
              </span>
            </label>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => router.push("/dashboard/staff")}
                className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UserPlus size={17} />
                {saving ? "Creating Admin..." : "Create Admin Login"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
