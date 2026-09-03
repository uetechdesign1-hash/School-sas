"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, MapPin, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SchoolOnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [schoolName, setSchoolName] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { error } = await supabase.rpc("create_school_with_owner", {
      p_school_name: schoolName,
      p_school_code: schoolCode || null,
      p_email: user.email,
      p_phone: phone || null,
      p_city: city || null,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <Building2 size={26} />
          </div>

          <h1 className="mt-5 text-3xl font-bold text-slate-900">
            Set up your school
          </h1>

          <p className="mt-2 text-slate-500">
            Just a few details to get your school dashboard ready.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleCreateSchool} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                School Name *
              </label>

              <input
                required
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="Example: Bright Future School"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                School Code
              </label>

              <input
                value={schoolCode}
                onChange={(e) =>
                  setSchoolCode(e.target.value.toUpperCase())
                }
                placeholder="Example: BFS001"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 uppercase outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />

              <p className="mt-1 text-xs text-slate-400">
                Optional. You can change this later.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Phone
              </label>

              <div className="relative">
                <Phone
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="School phone number"
                  className="w-full rounded-xl border border-slate-300 py-3 pl-11 pr-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                City
              </label>

              <div className="relative">
                <MapPin
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="School city"
                  className="w-full rounded-xl border border-slate-300 py-3 pl-11 pr-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </div>

            <button
              disabled={loading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {loading ? "Creating school..." : "Create School & Continue"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}