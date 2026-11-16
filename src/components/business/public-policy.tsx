import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

type PolicyType = "privacy_policy" | "terms_and_conditions";

type PublishedPolicy = {
  title: string;
  content: string;
  version: number;
  effective_date: string | null;
};

async function loadPublished(type: PolicyType): Promise<PublishedPolicy | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  // Anonymous client: these pages are public and must never depend on a session.
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await supabase
    .from("website_policies")
    .select("title, content, version, effective_date")
    .eq("policy_type", type)
    .eq("status", "published")
    .maybeSingle();
  return (data as PublishedPolicy | null) ?? null;
}

export async function PublicPolicyPage({ type, fallbackTitle }: { type: PolicyType; fallbackTitle: string }) {
  const policy = await loadPublished(type);
  const paragraphs = (policy?.content ?? "").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const effective = policy?.effective_date
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${policy.effective_date}T00:00:00`))
    : null;

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
        <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">← Back to home</Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">{policy?.title ?? fallbackTitle}</h1>
        {policy ? (
          <p className="mt-2 text-sm text-slate-500">
            Version {policy.version}
            {effective ? ` · Effective ${effective}` : ""}
          </p>
        ) : null}

        <div className="mt-8 space-y-5 text-slate-700">
          {paragraphs.length > 0 ? (
            paragraphs.map((block, index) => (
              <p key={index} className="whitespace-pre-line leading-7">{block}</p>
            ))
          ) : (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">This page has not been published yet.</p>
          )}
        </div>

        <nav className="mt-12 flex gap-6 border-t border-slate-200 pt-6 text-sm text-slate-500" aria-label="Legal">
          <Link href="/privacy-policy" className="hover:text-slate-900">Privacy Policy</Link>
          <Link href="/terms-and-conditions" className="hover:text-slate-900">Terms &amp; Conditions</Link>
        </nav>
      </div>
    </main>
  );
}
