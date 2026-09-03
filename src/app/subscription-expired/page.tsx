"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SubscriptionExpiredPage() {
  const [schoolName, setSchoolName] = useState("Your school");
  const [expiresOn, setExpiresOn] = useState("");

  useEffect(() => {
    setSchoolName(
      sessionStorage.getItem("school_expiry_name") || "Your school",
    );
    setExpiresOn(sessionStorage.getItem("school_expiry_date") || "");
  }, []);

  async function handleLogin() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  const formattedDate = expiresOn
    ? new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(new Date(`${expiresOn}T00:00:00`))
    : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-white to-blue-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-amber-700">
          Subscription Expired
        </p>

        <h1 className="mt-2 text-3xl font-bold text-slate-900">
          {schoolName}
        </h1>

        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-slate-600">
          Your school subscription has expired, so access to SchoolFlow is
          currently locked.
        </p>

        {formattedDate && (
          <div className="mt-5 rounded-2xl bg-slate-50 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Expired on
            </p>
            <p className="mt-1 text-lg font-bold text-slate-900">
              {formattedDate}
            </p>
          </div>
        )}

        <p className="mt-5 text-sm text-slate-500">
          Please contact your SchoolFlow administrator to renew your school
          subscription.
        </p>

        <button
          type="button"
          onClick={handleLogin}
          className="mt-7 w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700"
        >
          Back to Login
        </button>
      </section>
    </main>
  );
}
