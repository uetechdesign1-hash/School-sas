"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function sendResetEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSending(true);

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error("Please enter a valid email address.");
      }

      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        {
          redirectTo: `${window.location.origin}/auth/update-password`,
        }
      );

      if (resetError) {
        throw resetError;
      }

      setMessage("If an account uses this email, a password reset link has been sent.");
    } catch (err) {
      console.error("SEND PASSWORD RESET EMAIL ERROR:", err);
      setError(err instanceof Error ? err.message : "Unable to send reset email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-900" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Reset your password</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter the same email used when your staff account was created.
          </p>
        </div>

        <form onSubmit={sendResetEmail} className="mt-6 space-y-4">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@school.com"
              autoComplete="email"
              disabled={sending}
              className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            />
          </div>

          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {message && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="w-full rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send reset email"}
          </button>
        </form>

        <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-900">
          Back to login
        </Link>
      </div>
    </main>
  );
}
