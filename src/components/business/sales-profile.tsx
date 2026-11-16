"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, ErrorBanner, Field, LoadingBlock, PageHeader, SuccessBanner, buttonClass, inputClass } from "@/components/business/ui";
import { useAction, useAsyncData } from "@/components/business/hooks";
import { formatDate, titleCase } from "@/lib/business/format";
import type { SalesRep } from "@/lib/business/types";

export function SalesProfile() {
  const supabase = useMemo(() => createClient(), []);
  const { data, error, loading } = useAsyncData(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You are signed out.");
    const result = await supabase.from("sales_representatives").select("*").eq("user_id", user.id).maybeSingle();
    if (result.error) throw result.error;
    return result.data as SalesRep | null;
  });
  const action = useAction();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return action.setError("Password must contain at least 8 characters.");
    if (password !== confirm) return action.setError("Passwords do not match.");
    const ok = await action.run(async () => {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      return true;
    }, "Password updated.");
    if (ok) {
      setPassword("");
      setConfirm("");
    }
  }

  if (loading) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="My profile" description="Your account details are managed by Super Admin." />
      <ErrorBanner message={error} />
      {data ? (
        <Card title="Details" className="mb-6">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ["Name", data.full_name],
              ["Email", data.email],
              ["Mobile", data.mobile],
              ["Employee ID", data.employee_id ?? "-"],
              ["Address", data.address ?? "-"],
              ["Joining date", formatDate(data.joining_date)],
              ["Status", titleCase(data.status)],
            ].map(([name, value]) => (
              <div key={name} className="border-b border-slate-100 py-1.5"><dt className="text-xs text-slate-500">{name}</dt><dd className="font-medium text-slate-900">{value}</dd></div>
            ))}
          </dl>
        </Card>
      ) : null}
      <Card title="Change password">
        <form onSubmit={changePassword} className="max-w-sm space-y-4">
          <ErrorBanner message={action.error} />
          <SuccessBanner message={action.success} />
          <Field label="New password" required><input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Confirm password" required><input className={inputClass} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <button type="submit" className={buttonClass()} disabled={action.busy}>{action.busy ? "Saving..." : "Update password"}</button>
        </form>
      </Card>
    </>
  );
}
