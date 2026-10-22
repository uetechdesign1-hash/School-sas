"use client";



import { FormEvent, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Loader2, ShieldCheck, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [canManageBranding, setCanManageBranding] = useState(false);
  const [platformLogo, setPlatformLogo] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoMessage, setLogoMessage] = useState("");
  const [error, setError] = useState("");
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim();

  useEffect(() => {
    let mounted = true;

    async function checkExistingSession() {
      try {
        const { data: logoData } = await supabase.rpc("get_platform_logo");
        if (mounted) setPlatformLogo(typeof logoData === "string" ? logoData : null);

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (mounted) setLoading(false);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("user_profiles")
          .select("full_name, platform_role, is_active")
          .eq("id", user.id)
          .maybeSingle();

        if (
          !profileError &&
          profile &&
          profile.platform_role === "super_admin" &&
          profile.is_active === true
        ) {
          if (mounted) setCanManageBranding(true);
          return;
        }

        if (mounted) setLoading(false);
      } catch {
        if (mounted) setLoading(false);
      }
    }

    void checkExistingSession();

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setSubmitting(true);

    try {
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

      if (signInError) {
        throw new Error(signInError.message);
      }

      if (!data.user) {
        throw new Error("Unable to sign in. Please try again.");
      }

      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("full_name, platform_role, is_active")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError) {
        await supabase.auth.signOut();
        throw new Error(
          profileError.message ||
            "Unable to verify your administrator account."
        );
      }

      if (
        !profile ||
        profile.platform_role !== "super_admin" ||
        profile.is_active !== true
      ) {
        await supabase.auth.signOut();
        throw new Error(
          "This account does not have active Super Administrator access."
        );
      }

      setCanManageBranding(true);
    } catch (err: any) {
      setError(
        err?.message ||
          "Unable to sign in. Please check your credentials."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadPlatformLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setLogoMessage("");

    if (!canManageBranding) {
      setError("Sign in as an active Super Administrator before uploading the platform logo.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("The logo must be 2 MB or smaller.");
      return;
    }
    if (!cloudName || !uploadPreset) {
      setError("Cloudinary is not configured. Add the Cloud Name and unsigned upload preset to the app environment.");
      return;
    }

    setUploadingLogo(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("upload_preset", uploadPreset);
      form.append("folder", "platform/logo");
      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok || !result.secure_url) {
        throw new Error(result.error?.message || "Cloudinary could not upload this logo.");
      }

      const { error: saveError } = await supabase.rpc("update_platform_logo", {
        p_logo_url: result.secure_url,
      });
      if (saveError) {
        if (saveError.code === "PGRST202" || saveError.message?.includes("update_platform_logo")) {
          throw new Error("Apply supabase/migrations/20261022120000_platform_logo_cloudinary.sql in Supabase, then try again.");
        }
        throw saveError;
      }
      setPlatformLogo(result.secure_url);
      window.dispatchEvent(new CustomEvent("platform-logo-updated", { detail: result.secure_url }));
      setLogoMessage("Platform logo saved. It will appear on login screens and dashboards.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload the platform logo.");
    } finally {
      setUploadingLogo(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Checking administrator session...
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
          <div className="flex justify-center">
            {platformLogo ? (
              <img src={platformLogo} alt="EduNexa platform logo" className="h-16 w-16 rounded-2xl border border-slate-200 bg-white object-contain p-1 shadow-sm" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-200">
                <ShieldCheck className="h-8 w-8" />
              </div>
            )}
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm font-semibold tracking-wide text-emerald-600">
              EduNexa
            </p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">
              Super Admin Login
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Sign in to manage schools, subscriptions and platform
              administration.
            </p>
          </div>

          {canManageBranding && (
            <section className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-white">
                  {platformLogo ? <img src={platformLogo} alt="Current platform logo" className="h-full w-full rounded-xl object-contain p-1" /> : <ImagePlus className="text-slate-400" size={22} />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-bold text-slate-900">Platform logo</h2>
                  <p className="text-xs leading-5 text-slate-600">Upload PNG, JPG, or WebP up to 2 MB. This brand appears on school sign-in and dashboard headers.</p>
                </div>
              </div>
              {logoMessage && <p role="status" className="mt-3 text-xs font-medium text-emerald-700">{logoMessage}</p>}
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadPlatformLogo} className="hidden" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingLogo} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                  {uploadingLogo ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
                  {uploadingLogo ? "Uploading…" : platformLogo ? "Replace logo" : "Upload logo"}
                </button>
                <button type="button" onClick={() => router.replace("/super-admin")} disabled={uploadingLogo} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 disabled:opacity-60">
                  Continue to Super Admin
                </button>
              </div>
            </section>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
                {error}
              </div>
            ) : null}

            <div>
              <label
                htmlFor="super-admin-email"
                className="block text-sm font-semibold text-slate-700"
              >
                Email
              </label>
              <input
                id="super-admin-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
                disabled={submitting}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:bg-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="super-admin-password"
                className="block text-sm font-semibold text-slate-700"
              >
                Password
              </label>
              <input
                id="super-admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                disabled={submitting}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:bg-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in as Super Admin"
              )}
            </button>
          </form>

          <p className="mt-7 text-center text-xs leading-5 text-slate-400">
            Authorized EduNexa platform administrators only.
          </p>
        </div>
      </div>
    </main>
  );
}

