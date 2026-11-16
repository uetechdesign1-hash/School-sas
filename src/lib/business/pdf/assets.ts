import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyBranding } from "@/lib/business/types";
import type { PdfAssets } from "@/lib/business/pdf/documents";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image."));
    reader.readAsDataURL(blob);
  });
}

async function download(client: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await client.storage.from("company-assets").download(path);
  if (error || !data) return null;
  return blobToDataUrl(data);
}

/** Loads the branding images captured by a document snapshot. */
export async function loadPdfAssets(
  client: SupabaseClient,
  company: Pick<CompanyBranding, "logo_path" | "signature_path">,
): Promise<PdfAssets> {
  const [logoDataUrl, signatureDataUrl] = await Promise.all([
    download(client, company.logo_path),
    download(client, company.signature_path),
  ]);
  return { logoDataUrl, signatureDataUrl };
}
