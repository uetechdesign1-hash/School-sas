"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Mail, ShieldCheck, School, Phone } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [verificationType, setVerificationType] = useState("email");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [phone, setPhone] = useState("");
  const [schoolCode, setSchoolCode] = useState("");

  async function sendResetEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSending(true);

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (verificationType === "verification") {
        if (!phone || !schoolCode) {
          throw new Error("Please enter both phone number and school code.");
        }
        const res = await fetch(`${window.location.origin}/api/auth/forgot-password`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cleanEmail, phone, school_code: schoolCode.trim().toUpperCase() }),
        });
        const data = await res.json();
        if (data.show_verification || !res.ok) {
          throw new Error(data.message || "Verification failed.");
        }
        setMessage(data.message || "Verification successful!");
        setSending(false);
        return;
      }

      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error("Please enter a valid email address.");
      }

      const res = await fetch(`${window.location.origin}/api/auth/forgot-password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: cleanEmail, verification_type: "email" }),
        });

        const data = await res.json();

        if (data.fallback) {
          setVerificationType("verification");
          setMessage(data.message || "Email reset not available. Please verify using phone and school code.");
          setSending(false);
          return;
        }

        if (!res.ok) {
          throw new Error(data.error || "Unable to send reset email.");
        }

        setMessage(data.message || "If an account uses this email, a password reset link has been sent.");
    } catch (err) {
      console.error("FORGOT PASSWORD ERROR:", err);
      setError(err instanceof Error ? err.message : "Unable to send reset email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/85 p-6 shadow-xl shadow-indigo-500/10 backdrop-blur-xl sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/40">
            <ShieldCheck className="h-7 w-7" />
          </div>
          {verificationType === "verification" ? (
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Verify Your Account</h1>
          ) : (
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Reset your password</h1>
          )}
          <p className="mt-2 text-sm text-slate-500">
            {verificationType === "email"
              ? "Enter the same email used when your staff or school principal account was created."
              : "We'll verify your phone number and school code to send you a password reset link."}
          </p>
        </div>

        {verificationType === "email" ? (
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
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/40 transition hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send reset email"}
            </button>
          </form>
        ) : null}

        {verificationType === "verification" && (
          <form onSubmit={sendResetEmail} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Phone className="absolute left-3 top/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+1 555-123-4567"
                  autoComplete="tel"
                  disabled={sending}
                  className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 pl-12"
                />
              </div>
              <div>
                <School className="absolute left-3 top/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={schoolCode}
                  onChange={(event) => setSchoolCode(event.target.value)}
                  placeholder="SCH001"
                  autoComplete="off"
                  disabled={sending}
                  className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 pl-12 uppercase"
                />
              </div>
            </div>

            {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            {message && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

            <button
              type="submit"
              disabled={sending || !phone.trim() || !schoolCode.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/40 transition hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Verifying..." : "Verify & Send Reset Link"}
            </button>
          </form>
        )}

        {verificationType === "verification" && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-xs text-blue-700">
              We'll verify your phone number and school code against our records. If verified,
              a password reset link will be sent to your email on file.
            </p>
          </div>
        )}

        <Link href="/login" className="mt-5 block text-center text-sm font-semibold text-slate-600 hover:text-slate-900">
          Back to login
        </Link>
      </div>
    </main>
  );
}
