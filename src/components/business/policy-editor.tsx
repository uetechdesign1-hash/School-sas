"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Card, DataTable, ErrorBanner, Field, LoadingBlock, Modal, PageHeader, SuccessBanner, buttonClass, inputClass } from "@/components/business/ui";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { callRpc } from "@/lib/business/rpc";
import { formatDate, statusTone, titleCase } from "@/lib/business/format";
import type { MouTerms } from "@/lib/business/types";

export type PolicyKind = "privacy_policy" | "terms_and_conditions" | "mou_terms";

type Doc = MouTerms;

const META: Record<PolicyKind, { heading: string; description: string; table: "website_policies" | "mou_terms_versions"; publicPath?: string; publish: string; idArg: string }> = {
  privacy_policy: {
    heading: "Privacy policy",
    description: "Shown publicly at /privacy-policy. Each published version is kept permanently.",
    table: "website_policies",
    publicPath: "/privacy-policy",
    publish: "publish_website_policy",
    idArg: "p_policy_id",
  },
  terms_and_conditions: {
    heading: "Website terms & conditions",
    description: "Shown publicly at /terms-and-conditions. Separate from the contractual terms of a school MOU.",
    table: "website_policies",
    publicPath: "/terms-and-conditions",
    publish: "publish_website_policy",
    idArg: "p_policy_id",
  },
  mou_terms: {
    heading: "MOU terms",
    description: "Contractual terms printed on every MOU. A generated MOU keeps the exact version and text it was issued with.",
    table: "mou_terms_versions",
    publish: "publish_mou_terms",
    idArg: "p_terms_id",
  },
};

export function PolicyEditor({ kind }: { kind: PolicyKind }) {
  const meta = META[kind];
  const supabase = useMemo(() => createClient(), []);
  const action = useAction();
  const { data, error, loading, reload } = useAsyncData(async () => {
    let query = supabase.from(meta.table).select("*").order("version", { ascending: false });
    if (meta.table === "website_policies") query = query.eq("policy_type", kind);
    const result = await query;
    if (result.error) throw result.error;
    return (result.data ?? []) as Doc[];
  });
  const [editing, setEditing] = useState<{ id?: string; title: string; content: string; effective_date: string; readOnly: boolean } | null>(null);

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBanner message={error} />;

  const published = data.find((doc) => doc.status === "published");

  async function save() {
    if (!editing) return;
    const payload = { title: editing.title.trim(), content: editing.content, effective_date: editing.effective_date || null };
    const ok = await action.run(async () => {
      if (editing.id) {
        const { error: updateError } = await supabase.from(meta.table).update(payload).eq("id", editing.id);
        if (updateError) throw updateError;
      } else {
        const row: Record<string, unknown> = meta.table === "website_policies" ? { ...payload, policy_type: kind } : payload;
        const { error: insertError } = await supabase.from(meta.table).insert(row);
        if (insertError) throw insertError;
      }
      return true;
    }, editing.id ? "Draft saved." : "Draft created.");
    if (ok) {
      setEditing(null);
      await reload();
    }
  }

  return (
    <>
      <PageHeader
        title={meta.heading}
        description={meta.description}
        actions={
          <>
            {meta.publicPath ? <a href={meta.publicPath} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>View public page</a> : null}
            <button type="button" className={buttonClass()} onClick={() => setEditing({ title: published?.title ?? meta.heading, content: published?.content ?? "", effective_date: "", readOnly: false })}>New draft version</button>
          </>
        }
      />
      <ErrorBanner message={error || action.error} />
      <SuccessBanner message={action.success} />
      <Card>
        <DataTable
          rows={data}
          rowKey={(row) => row.id}
          empty="No versions yet."
          columns={[
            { header: "Version", cell: (row) => `v${row.version}` },
            { header: "Title", cell: (row) => row.title },
            { header: "Status", cell: (row) => <Badge tone={statusTone(row.status)}>{titleCase(row.status)}</Badge> },
            { header: "Effective", cell: (row) => formatDate(row.effective_date) },
            { header: "Published", cell: (row) => formatDate(row.published_at) },
            {
              header: "",
              cell: (row) => (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass("secondary", true)} onClick={() => setEditing({ id: row.id, title: row.title, content: row.content, effective_date: row.effective_date ?? "", readOnly: row.status !== "draft" })}>{row.status === "draft" ? "Edit" : "View"}</button>
                  {row.status === "draft" ? (
                    <>
                      <button type="button" className={buttonClass("primary", true)} disabled={action.busy} onClick={async () => { await action.run(() => callRpc(supabase, meta.publish, { [meta.idArg]: row.id }), `Version ${row.version} is now published; the previous version was archived.`); await reload(); }}>Publish</button>
                      <button type="button" className={buttonClass("ghost", true)} disabled={action.busy} onClick={async () => { await action.run(async () => { const { error: deleteError } = await supabase.from(meta.table).delete().eq("id", row.id); if (deleteError) throw deleteError; }, "Draft deleted."); await reload(); }}>Delete</button>
                    </>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
        <p className="mt-3 text-xs text-slate-500">Published versions cannot be edited. To change them, create a new draft and publish it.</p>
      </Card>

      <Modal
        wide
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.readOnly ? "View version" : editing?.id ? "Edit draft" : "New draft version"}
        footer={
          <>
            <button type="button" className={buttonClass("secondary")} onClick={() => setEditing(null)}>{editing?.readOnly ? "Close" : "Cancel"}</button>
            {editing?.readOnly ? null : <button type="button" className={buttonClass()} disabled={action.busy || !editing?.title.trim() || !editing?.content.trim()} onClick={save}>Save draft</button>}
          </>
        }
      >
        <ErrorBanner message={action.error} />
        {editing ? (
          <div className="space-y-4">
            <Field label="Title" required><input className={inputClass} value={editing.title} disabled={editing.readOnly} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <Field label="Effective date" hint="Defaults to the publish date."><input className={inputClass} type="date" value={editing.effective_date} disabled={editing.readOnly} onChange={(e) => setEditing({ ...editing, effective_date: e.target.value })} /></Field>
            <Field label="Content" required hint="Plain text. Blank lines separate paragraphs."><textarea className={`${inputClass} font-mono`} rows={16} value={editing.content} disabled={editing.readOnly} onChange={(e) => setEditing({ ...editing, content: e.target.value })} /></Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
