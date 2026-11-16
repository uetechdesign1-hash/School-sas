"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, ErrorBanner, Field, LoadingBlock, PageHeader, SuccessBanner, buttonClass, inputClass } from "@/components/business/ui";
import { useAction, useAsyncData } from "@/components/business/hooks";
import type { CompanySettings } from "@/lib/business/types";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

type Form = {
  legal_company_name: string;
  brand_name: string;
  registered_address: string;
  email: string;
  mobile: string;
  website: string;
  gstin: string;
  authorized_signatory_name: string;
  authorized_signatory_designation: string;
  default_gst_rate: string;
  invoice_due_days: string;
};

const toForm = (row: CompanySettings): Form => ({
  legal_company_name: row.legal_company_name ?? "",
  brand_name: row.brand_name ?? "",
  registered_address: row.registered_address ?? "",
  email: row.email ?? "",
  mobile: row.mobile ?? "",
  website: row.website ?? "",
  gstin: row.gstin ?? "",
  authorized_signatory_name: row.authorized_signatory_name ?? "",
  authorized_signatory_designation: row.authorized_signatory_designation ?? "",
  default_gst_rate: String(row.default_gst_rate ?? 0),
  invoice_due_days: String(row.invoice_due_days ?? 15),
});

function AssetPreview({ path, label }: { path: string | null; label: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let active = true;
    async function run() {
      if (!path) {
        setUrl(null);
        return;
      }
      const { data } = await supabase.storage.from("company-assets").download(path);
      if (!active || !data) return;
      revoked = URL.createObjectURL(data);
      setUrl(revoked);
    }
    void run();
    return () => {
      active = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [supabase, path]);

  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={label} className="h-20 max-w-[220px] rounded-lg border border-slate-200 bg-white object-contain p-1" />
  ) : (
    <div className="flex h-20 w-44 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">No {label.toLowerCase()}</div>
  );
}

export function CompanySettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const action = useAction();
  const { data, error, loading, reload } = useAsyncData(async () => {
    const result = await supabase.from("company_settings").select("*").maybeSingle();
    if (result.error) throw result.error;
    return result.data as CompanySettings | null;
  });
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data && !form) setForm(toForm(data));
  }, [data, form]);

  if (loading && !data) return <LoadingBlock />;
  if (!data || !form) return <ErrorBanner message={error || "Company settings are not available."} />;

  const set = (key: keyof Form, value: string) => setForm((current) => (current ? { ...current, [key]: value } : current));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    await action.run(async () => {
      const { error: updateError } = await supabase
        .from("company_settings")
        .update({
          legal_company_name: form.legal_company_name.trim() || null,
          brand_name: form.brand_name.trim() || null,
          registered_address: form.registered_address.trim() || null,
          email: form.email.trim() || null,
          mobile: form.mobile.trim() || null,
          website: form.website.trim() || null,
          gstin: form.gstin.trim().toUpperCase() || null,
          authorized_signatory_name: form.authorized_signatory_name.trim() || null,
          authorized_signatory_designation: form.authorized_signatory_designation.trim() || null,
          default_gst_rate: Number(form.default_gst_rate || 0),
          invoice_due_days: Number(form.invoice_due_days || 15),
        })
        .eq("id", true);
      if (updateError) throw updateError;
    }, "Company settings saved. Documents already generated keep the branding they were issued with.");
    await reload();
  }

  async function upload(kind: "logo" | "signature", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!TYPES.includes(file.type)) return action.setError("Upload a PNG, JPEG or WebP image.");
    if (file.size > MAX_BYTES) return action.setError("The image must be 2 MB or smaller.");

    await action.run(async () => {
      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      // A new object name per upload keeps earlier documents' images intact.
      const path = `company/${kind}-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("company-assets").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: updateError } = await supabase
        .from("company_settings")
        .update(kind === "logo" ? { logo_path: path } : { signature_path: path })
        .eq("id", true);
      if (updateError) throw updateError;
    }, kind === "logo" ? "Company logo updated." : "Signature image updated.");
    await reload();
  }

  return (
    <>
      <PageHeader title="Company settings" description="This branding appears on every MOU, invoice and receipt." />
      <ErrorBanner message={error || action.error} />
      <SuccessBanner message={action.success} />

      <form onSubmit={save} className="space-y-6">
        <Card title="Company details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal company name" required><input className={inputClass} value={form.legal_company_name} onChange={(e) => set("legal_company_name", e.target.value)} /></Field>
            <Field label="Brand name"><input className={inputClass} value={form.brand_name} onChange={(e) => set("brand_name", e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Registered address" required><textarea className={inputClass} rows={2} value={form.registered_address} onChange={(e) => set("registered_address", e.target.value)} /></Field></div>
            <Field label="Email"><input className={inputClass} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
            <Field label="Mobile number"><input className={inputClass} inputMode="tel" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} /></Field>
            <Field label="Website"><input className={inputClass} value={form.website} onChange={(e) => set("website", e.target.value)} /></Field>
            <Field label="GSTIN" hint="15 characters, e.g. 29ABCDE1234F1Z5."><input className={inputClass} value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>
            <Field label="Authorised signatory name" required><input className={inputClass} value={form.authorized_signatory_name} onChange={(e) => set("authorized_signatory_name", e.target.value)} /></Field>
            <Field label="Designation"><input className={inputClass} value={form.authorized_signatory_designation} onChange={(e) => set("authorized_signatory_designation", e.target.value)} /></Field>
            <Field label="GST rate on invoices (%)" hint="Added on top of the contract amount. 0 for none."><input className={inputClass} type="number" min={0} max={100} step="0.01" value={form.default_gst_rate} onChange={(e) => set("default_gst_rate", e.target.value)} /></Field>
            <Field label="Invoice due (days after invoice date)"><input className={inputClass} type="number" min={0} max={365} value={form.invoice_due_days} onChange={(e) => set("invoice_due_days", e.target.value)} /></Field>
          </div>
          <div className="mt-5"><button type="submit" className={buttonClass()} disabled={action.busy}>{action.busy ? "Saving..." : "Save settings"}</button></div>
        </Card>
      </form>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Company logo">
          <AssetPreview path={data.logo_path} label="Logo" />
          <label className={`${buttonClass("secondary", true)} mt-4 cursor-pointer`}>
            Upload logo
            <input type="file" accept={TYPES.join(",")} className="sr-only" onChange={(e) => upload("logo", e)} disabled={action.busy} />
          </label>
          <p className="mt-2 text-xs text-slate-500">PNG, JPEG or WebP, up to 2 MB. Stored in a private bucket.</p>
        </Card>
        <Card title="Authorised signature image">
          <AssetPreview path={data.signature_path} label="Signature" />
          <label className={`${buttonClass("secondary", true)} mt-4 cursor-pointer`}>
            Upload signature
            <input type="file" accept={TYPES.join(",")} className="sr-only" onChange={(e) => upload("signature", e)} disabled={action.busy} />
          </label>
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">This is a visual signature only. Documents state that it is not a legally verified electronic signature. A compliant e-signing provider is not integrated.</p>
        </Card>
      </div>
    </>
  );
}
