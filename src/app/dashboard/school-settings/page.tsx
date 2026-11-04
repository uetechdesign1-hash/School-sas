"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AlertCircle, CalendarDays, CheckCircle2, ImagePlus, Loader2, Radio, School, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentSchoolId } from "@/lib/supabase/current-school";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

type SchoolRecord = { id: string; name: string; logo_url: string | null };

type AttendanceModel = "actual_calendar" | "30_day_fixed";

/**
 * Extract a readable message from Supabase/Postgres errors, which are often
 * plain objects (not Error instances) with message/details/hint/code fields.
 */
function getSupabaseErrorMessage(error: unknown): string {
  if (!error) return "Unknown database error.";

  if (error instanceof Error) return error.message;

  if (typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts = [
      typeof e.message === "string" ? e.message : "",
      typeof e.details === "string" ? `Details: ${e.details}` : "",
      typeof e.hint === "string" ? `Hint: ${e.hint}` : "",
      typeof e.code === "string" ? `Code: ${e.code}` : "",
    ].filter(Boolean);

    if (parts.length) return parts.join(" | ");

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown database error.";
    }
  }

  return String(error);
}

export default function SchoolSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [school, setSchool] = useState<SchoolRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim();
  const cloudinaryReady = Boolean(cloudName && uploadPreset);

  // Attendance model state
  const [attendanceModel, setAttendanceModel] = useState<AttendanceModel>("actual_calendar");
  const [settingsLoading, setSettingsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadSchool() {
      setLoading(true);
      setError("");
      try {
        const schoolId = await getCurrentSchoolId();
        const { data, error: schoolError } = await supabase
          .from("schools")
          .select("id,name,logo_url")
          .eq("id", schoolId)
          .maybeSingle();
        if (schoolError) {
          if (schoolError.message?.includes("logo_url")) {
            throw new Error("The school logo database setup is missing. In Supabase, run supabase/migrations/20261007120000_school_logo_cloudinary.sql, then reload this page.");
          }
          throw schoolError;
        }
        if (!data) throw new Error("The school profile could not be found.");
        if (!cancelled) setSchool(data as SchoolRecord);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the school profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadSchool();
    return () => { cancelled = true; };
  }, [supabase]);

  // Load attendance model when school loads
  useEffect(() => {
    let cancelled = false;
    async function loadAttendanceModel() {
      if (!school?.id) return;
      setSettingsLoading(true);
      setError("");
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "get_school_attendance_model",
          { p_school_id: school.id },
        );
        if (rpcError) throw rpcError;
        if (!cancelled) {
          setAttendanceModel(data === "30_day_fixed" ? "30_day_fixed" : "actual_calendar");
        }
      } catch (err) {
        if (!cancelled) {
          // If RPC doesn't exist yet, default to actual_calendar silently
          setAttendanceModel("actual_calendar");
        }
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    }
    void loadAttendanceModel();
    return () => { cancelled = true; };
  }, [supabase, school?.id]);

  async function saveAttendanceModel() {
    if (!school?.id) return;
    setSettingsSaving(true);
    setError("");
    setMessage("");
    try {
      console.log("Saving attendance model:", { schoolId: school.id, model: attendanceModel });
      const { data, error: rpcError } = await supabase.rpc(
        "update_school_attendance_model",
        { p_school_id: school.id, p_model: attendanceModel },
      );
      console.log("RPC result:", { data, error: rpcError });
      if (rpcError) throw rpcError;
      setMessage(`Attendance model saved: ${attendanceModel === "30_day_fixed" ? "30 days (fixed)" : "Actual month calendar"}.`);
    } catch (err) {
      const msg = getSupabaseErrorMessage(err);
      const isMissingFunction =
        msg?.includes("Could not find the function") ||
        msg?.includes("schema cache") ||
        msg?.includes("PGRST202");

      if (isMissingFunction) {
        const hint =
          "The attendance model migration has not been applied to this database. " +
          "Run supabase/migrations/20261103120000_add_attendance_model_setting.sql in Supabase, then retry.";
        console.error("Save attendance model error:", msg, {
          schoolId: school.id,
          model: attendanceModel,
          raw: err,
        });
        setError(hint);
      } else {
        console.error("Save attendance model error:", msg, {
          schoolId: school.id,
          model: attendanceModel,
          raw: err,
        });
        setError(msg || "Unable to save attendance model.");
      }
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveLogoUrl(logoUrl: string | null) {
    if (!school) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase.rpc("update_school_logo", {
        p_school_id: school.id,
        p_logo_url: logoUrl,
      });
      if (updateError) {
        if (updateError.code === "PGRST202" || updateError.message?.includes("update_school_logo")) {
          throw new Error("The school logo database function is missing. Apply supabase/migrations/20261007120000_school_logo_cloudinary.sql in Supabase, then try again.");
        }
        throw updateError;
      }
      setSchool({ ...school, logo_url: logoUrl });
      window.dispatchEvent(new CustomEvent("school-logo-updated", { detail: logoUrl }));
      setMessage(logoUrl ? "School logo saved and applied to the dashboard." : "School logo removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the school logo.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setMessage("");
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("This image is larger than 2 MB. Resize or compress it, then try again.");
      return;
    }
    if (!cloudName || !uploadPreset) {
      setError("Cloudinary is not configured yet. Add the two NEXT_PUBLIC_CLOUDINARY settings to your environment and restart the app.");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("upload_preset", uploadPreset);

      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
        method: "POST",
        body: form,
      });
      let result: { secure_url?: string; error?: { message?: string } };
      try {
        result = await response.json();
      } catch {
        throw new Error(`Cloudinary returned an unreadable response (HTTP ${response.status}). Check the Cloud Name and upload preset.`);
      }
      if (!response.ok || !result.secure_url) {
        const cloudinaryMessage = result.error?.message || "Cloudinary could not upload this image.";
        if (/preset/i.test(cloudinaryMessage) && /not found|invalid|unsigned|whitelist/i.test(cloudinaryMessage)) {
          throw new Error(`Cloudinary rejected the preset "${uploadPreset}". Confirm it exists in this Cloudinary account and is set to Unsigned.`);
        }
        if (/cloud name|unknown cloud/i.test(cloudinaryMessage)) {
          throw new Error("Cloudinary rejected the Cloud Name. Check NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME in .env.local and restart the dev server.");
        }
        throw new Error(cloudinaryMessage);
      }
      await saveLogoUrl(result.secure_url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload the school logo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <p className="text-sm font-semibold text-indigo-600">School settings</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">School Profile</h1>
          <p className="mt-2 text-sm text-slate-500">Add your school logo to personalize the dashboard.</p>
        </header>

        {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}
        {message && <div role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 size={18} />{message}</div>}

        {loading ? (
          <div className="flex min-h-52 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-500"><Loader2 className="mr-2 animate-spin" size={20} />Loading school profile…</div>
        ) : school && (
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 p-5 sm:p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><School size={20} /></span>
              <div><h2 className="font-bold text-slate-900">{school.name}</h2><p className="text-sm text-slate-500">School logo</p></div>
            </div>
            <div className="grid gap-6 p-5 sm:grid-cols-[220px_1fr] sm:p-6">
              <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                {school.logo_url ? <img src={school.logo_url} alt={`${school.name} logo preview`} className="max-h-40 max-w-full object-contain" /> : <div className="text-center text-slate-400"><ImagePlus className="mx-auto" size={36} /><p className="mt-2 text-sm">No logo uploaded</p></div>}
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Upload your school logo</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">Use a square logo around <strong>512 × 512 px</strong>, or a horizontal logo around <strong>512 × 256 px</strong>. A transparent PNG works well. JPG and WebP are also supported.</p>
                <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-500">
                  <li>Maximum file size: 2 MB</li>
                  <li>Supported formats: PNG, JPG, WebP</li>
                  <li>Keep important text and artwork away from the edges</li>
                </ul>
                {!cloudinaryReady && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Cloudinary settings are not loaded by this app session. Restart the local dev server after editing <code>.env.local</code>, or add the settings to your hosting environment and rebuild. No API key or secret is needed.</div>}
                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading || saving} className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60 ${cloudinaryReady ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-500 hover:bg-slate-600"}`}>
                    {uploading || saving ? <Loader2 className="animate-spin" size={17} /> : <Upload size={17} />}
                    {uploading ? "Uploading…" : saving ? "Saving…" : school.logo_url ? "Replace logo" : "Upload logo"}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading || saving} onChange={uploadLogo} className="hidden" />
                  {school.logo_url && <button type="button" onClick={() => void saveLogoUrl(null)} disabled={saving || uploading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Trash2 size={16} />Remove logo</button>}
                </div>
                <p className="mt-4 text-xs leading-5 text-slate-400">Uploads are stored in the school logo folder in Cloudinary. Your logo will appear in the dashboard header.</p>
              </div>
            </div>

            {/* Attendance Model Settings */}
            <div className="mt-6 border-t border-slate-100 pt-6 sm:grid-cols-[220px_1fr] sm:col-span-2">
              <div className="flex min-h-48 items-center justify-start rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700"><CalendarDays size={20} /></div>
                <div className="ml-4">
                  <h3 className="font-semibold text-slate-900">Attendance Days Model</h3>
                  <p className="mt-2 text-sm text-slate-600">Choose how working days per month are counted for payroll salary calculation.</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer rounded-xl border p-3 hover:bg-slate-50">
                  <input
                    type="radio"
                    name="attendance_model"
                    value="actual_calendar"
                    checked={attendanceModel === "actual_calendar"}
                    onChange={() => setAttendanceModel("actual_calendar")}
                    className="rounded-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <span className="block font-semibold text-slate-900">Follow actual month calendar</span>
                    <span className="text-xs text-slate-500">28/29/30/31 days depending on the month</span>
                  </span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer rounded-xl border p-3 hover:bg-slate-50">
                  <input
                    type="radio"
                    name="attendance_model"
                    value="30_day_fixed"
                    checked={attendanceModel === "30_day_fixed"}
                    onChange={() => setAttendanceModel("30_day_fixed")}
                    className="rounded-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <span className="block font-semibold text-slate-900">Fixed 30 days every month</span>
                    <span className="text-xs text-slate-500">Every month treated as exactly 30 days</span>
                  </span>
                </label>
              </div>
              <button
                type="button"
                onClick={saveAttendanceModel}
                disabled={settingsSaving || settingsLoading}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 bg-indigo-600 hover:bg-indigo-700"
              >
                {settingsSaving ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                {settingsSaving ? "Saving…" : "Save Attendance Model"}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
