"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Mail } from "lucide-react";
import { useRouter } from "next/navigation";

import { changeAccountEmail } from "@/lib/auth/change-account-email";
import { createClient } from "@/lib/supabase/client";

export default function PrincipalProfilePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [currentEmail, setCurrentEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
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

        const { data: membership, error: membershipError } = await supabase
          .from("school_users")
          .select("user_id")
          .eq("user_id", user.id)
          .eq("role", "owner")
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (membershipError) throw membershipError;
        if (!membership) {
          throw new Error("This page is available to school principals only.");
        }

        if (active) setCurrentEmail(user.email || "");
      } catch (loadError) {
        console.error("LOAD PRINCIPAL PROFILE ERROR:", loadError);
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load your profile.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, [router, supabase]);

  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const email = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Please sign in again.");

      const result = await changeAccountEmail(session.access_token, {
        target_type: "self",
        email,
      });

      setNewEmail("");
      setCurrentEmail(email);
      setMessage(result.warning || "Login email updated immediately. No confirmation email is sent.");
    } catch (requestError) {
      console.error("REQUEST PRINCIPAL EMAIL CHANGE ERROR:", requestError);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to request an email change.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6">Loading profile...</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <Mail className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Principal Profile</h1>
              <p className="mt-1 text-sm text-slate-500">
                Manage your account login email.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Current login email
            </p>
            <p className="mt-1 break-all text-sm font-semibold text-slate-900">
              {currentEmail || "No email address"}
            </p>
          </div>

          <form onSubmit={requestEmailChange} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                New email address
              </span>
              <input
                type="email"
                autoComplete="email"
                required
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                disabled={saving}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={saving || !newEmail.trim()}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Updating..." : "Update login email"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
