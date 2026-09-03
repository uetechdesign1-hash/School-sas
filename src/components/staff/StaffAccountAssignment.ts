"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Link2,
  Loader2,
  UserRound,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Staff = {
  id: string;
  school_id: string;
  user_id: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  employee_no: string;
};

type SchoolUser = {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  full_name: string | null;
};

type Props = {
  staffId: string;
};

function staffName(staff: Staff) {
  return [staff.first_name, staff.middle_name, staff.last_name]
    .filter(Boolean)
    .join(" ");
}

export default function StaffAccountAssignment({
  staffId,
}: Props) {
  const supabase = createClient();

  const [staff, setStaff] = useState<Staff | null>(null);
  const [accounts, setAccounts] = useState<SchoolUser[]>([]);

  const [selectedUserId, setSelectedUserId] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void load();
  }, [staffId]);

  async function getCurrentSchool() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.assign("/login");
      return null;
    }

    const { data, error } = await supabase
      .from("school_users")
      .select("school_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data?.school_id) {
      throw new Error(
        "Your account is not assigned to an active school.",
      );
    }

    if (!["owner", "admin"].includes(String(data.role))) {
      throw new Error(
        "Only the school owner or administrator can assign staff accounts.",
      );
    }

    return data.school_id;
  }

  async function load() {
    try {
      setLoading(true);
      setError("");

      const schoolId = await getCurrentSchool();

      if (!schoolId) return;

      const { data: staffData, error: staffError } =
        await supabase
          .from("staff")
          .select(
            `
              id,
              school_id,
              user_id,
              first_name,
              middle_name,
              last_name,
              employee_no
            `,
          )
          .eq("id", staffId)
          .eq("school_id", schoolId)
          .maybeSingle();

      if (staffError) throw staffError;

      if (!staffData) {
        throw new Error("Staff member was not found.");
      }

      setStaff(staffData as Staff);

      setSelectedUserId(
        String(staffData.user_id || ""),
      );

      /*
       * Get active school memberships.
       *
       * We intentionally do not use auth.users directly from
       * the browser. Account identity stays behind the existing
       * school membership/profile model.
       */
      const { data: memberships, error: membershipError } =
        await supabase
          .from("school_users")
          .select(
            "id, user_id, role, is_active",
          )
          .eq("school_id", schoolId)
          .eq("is_active", true)
          .order("role");

      if (membershipError) {
        throw membershipError;
      }

      const userIds = [
        ...new Set(
          (memberships || []).map(
            (item) => item.user_id,
          ),
        ),
      ];

      let profiles: {
        id: string;
        full_name: string | null;
      }[] = [];

      if (userIds.length > 0) {
        const { data: profileData, error: profileError } =
          await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);

        if (profileError) {
          throw profileError;
        }

        profiles = profileData || [];
      }

      const profileMap = new Map(
        profiles.map((profile) => [
          profile.id,
          profile,
        ]),
      );

      const rows: SchoolUser[] = (memberships || []).map(
        (membership) => ({
          id: membership.id,
          user_id: membership.user_id,
          role: String(membership.role),
          is_active: Boolean(membership.is_active),
          full_name:
            profileMap.get(membership.user_id)
              ?.full_name || null,
        }),
      );

      setAccounts(rows);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load account assignment.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveAssignment() {
    if (!staff) return;

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      if (!selectedUserId) {
        throw new Error(
          "Please select a login account.",
        );
      }

      /*
       * Important:
       *
       * First verify that this user belongs to the same
       * school and has an active membership.
       */
      const { data: membership, error: membershipError } =
        await supabase
          .from("school_users")
          .select("user_id, school_id, is_active")
          .eq("user_id", selectedUserId)
          .eq("school_id", staff.school_id)
          .eq("is_active", true)
          .maybeSingle();

      if (membershipError) {
        throw membershipError;
      }

      if (!membership) {
        throw new Error(
          "The selected account is not an active member of this school.",
        );
      }

      /*
       * Check whether this login account is already attached
       * to another staff member.
       */
      const { data: existingStaff, error: existingError } =
        await supabase
          .from("staff")
          .select(
            "id, first_name, middle_name, last_name, employee_no",
          )
          .eq("school_id", staff.school_id)
          .eq("user_id", selectedUserId)
          .neq("id", staff.id)
          .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existingStaff) {
        throw new Error(
          `This login account is already assigned to ${[
            existingStaff.first_name,
            existingStaff.middle_name,
            existingStaff.last_name,
          ]
            .filter(Boolean)
            .join(" ")} (${existingStaff.employee_no}).`,
        );
      }

      const { error: updateError } = await supabase
        .from("staff")
        .update({
          user_id: selectedUserId,
        })
        .eq("id", staff.id)
        .eq("school_id", staff.school_id);

      if (updateError) {
        throw updateError;
      }

      setStaff((current) =>
        current
          ? {
              ...current,
              user_id: selectedUserId,
            }
          : current,
      );

      setOpen(false);

      const selectedAccount = accounts.find(
        (account) =>
          account.user_id === selectedUserId,
      );

      setSuccess(
        `${staffName(staff)} is now linked to ${
          selectedAccount?.full_name ||
          "the selected account"
        }.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to assign login account.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment() {
    if (!staff) return;

    const confirmed = window.confirm(
      `Remove the login account from ${staffName(staff)}? This will stop GPS attendance for this staff member until another account is assigned.`,
    );

    if (!confirmed) return;

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const { error } = await supabase
        .from("staff")
        .update({
          user_id: null,
        })
        .eq("id", staff.id)
        .eq("school_id", staff.school_id);

      if (error) throw error;

      setStaff((current) =>
        current
          ? {
              ...current,
              user_id: null,
            }
          : current,
      );

      setSelectedUserId("");

      setSuccess(
        "Login account removed from this staff member.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to remove login account.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2
            size={18}
            className="animate-spin"
          />
          Loading attendance account...
        </div>
      </section>
    );
  }

  if (!staff) return null;

  const assignedAccount = accounts.find(
    (account) =>
      account.user_id === staff.user_id,
  );

  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">

        <div className="border-b border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Link2 size={19} />
            </div>

            <div>
              <h2 className="font-bold text-slate-900">
                Attendance Login Account
              </h2>

              <p className="mt-0.5 text-xs text-slate-500">
                Link this staff member to their SchoolFlow login.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5">

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
              <CheckCircle2 size={17} />
              {success}
            </div>
          )}

          {staff.user_id && assignedAccount ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-600">
                  <UserRound size={20} />
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">
                    Account Linked
                  </p>

                  <p className="font-bold text-slate-900">
                    {assignedAccount.full_name ||
                      "School Account"}
                  </p>

                  <p className="text-xs text-slate-500">
                    Role: {assignedAccount.role}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  disabled={saving}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700"
                >
                  Change Account
                </button>

                <button
                  type="button"
                  onClick={() => void removeAssignment()}
                  disabled={saving}
                  className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">

              <div>
                <p className="font-bold text-amber-900">
                  No login account assigned
                </p>

                <p className="mt-1 text-sm text-amber-800">
                  This staff member cannot use GPS
                  check-in until a login account is linked.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                <Link2 size={16} />
                Assign Account
              </button>
            </div>
          )}
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">

          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">

            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <h3 className="font-bold text-slate-900">
                  Assign Login Account
                </h3>

                <p className="mt-1 text-xs text-slate-500">
                  {staffName(staff)} · {staff.employee_no}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              >
                <X size={19} />
              </button>
            </div>

            <div className="p-5">

              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                School Login Account
              </label>

              <select
                value={selectedUserId}
                onChange={(e) =>
                  setSelectedUserId(e.target.value)
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold"
              >
                <option value="">
                  Select an account
                </option>

                {accounts.map((account) => (
                  <option
                    key={account.user_id}
                    value={account.user_id}
                  >
                    {account.full_name ||
                      "Unnamed Account"}{" "}
                    — {account.role}
                  </option>
                ))}
              </select>

              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                Only an active account belonging to this
                school can be assigned. One login account
                cannot be assigned to multiple staff members.
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => void saveAssignment()}
                  disabled={saving || !selectedUserId}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {saving && (
                    <Loader2
                      size={16}
                      className="animate-spin"
                    />
                  )}

                  {saving
                    ? "Saving..."
                    : "Assign Account"}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  );
}