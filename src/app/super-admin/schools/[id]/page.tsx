"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowLeft,
  Building2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

type School = {
  id: string;
  name: string;
  code: string | null;
  school_code: string | null;
  status: string;
  plan_code: string | null;
  student_limit: number | null;
  starts_on: string | null;
  expires_on: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

type SchoolMember = {
  userId: string;
  role: string;
  isActive: boolean;
  memberSince: string | null;
  email: string;
  lastSignInAt: string | null;
  fullName: string;
  loginId: string | null;
  phone: string | null;
  employeeNo: string | null;
  designation: string | null;
  staffStatus: string | null;
  isLinkedToStaffRecord: boolean;
};

type SchoolOwner = {
  userId: string | null;
  name: string;
  phone: string;
  email: string;
};

export default function SuperAdminSchoolPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();

  const schoolId =
    typeof params.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [accessVerified, setAccessVerified] = useState(false);

  const [school, setSchool] = useState<School | null>(null);
  const [owner, setOwner] = useState<SchoolOwner | null>(null);
  const [members, setMembers] = useState<SchoolMember[]>([]);

  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  // Delete staff user state
  const [deleteTarget, setDeleteTarget] = useState<SchoolMember | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // --------------------------------------------------
  // VERIFY SUPER ADMIN + LOAD PAGE
  // --------------------------------------------------

  useEffect(() => {
    let mounted = true;

    async function loadPage() {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          router.replace("/super-admin/login");
          return;
        }

        const {
          data: profile,
          error: profileError,
        } = await supabase
          .from("user_profiles")
          .select("full_name, platform_role, is_active")
          .eq("id", user.id)
          .maybeSingle();

        if (
          profileError ||
          !profile ||
          profile.platform_role !== "super_admin" ||
          profile.is_active !== true
        ) {
          await supabase.auth.signOut();

          router.replace("/super-admin/login");
          return;
        }

        if (!mounted) return;

        setAccessVerified(true);
      } catch (error) {
        console.error("SCHOOL PAGE LOAD ERROR:", error);

        if (mounted) {
          router.replace("/super-admin/login");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadPage();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the school data once access has been verified.
  useEffect(() => {
    if (!accessVerified) {
      return;
    }

    loadSchoolData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessVerified, schoolId]);


  // --------------------------------------------------
  // LOAD SCHOOL + STAFF MEMBERS
  // --------------------------------------------------

  async function loadSchoolData() {
    if (!schoolId) {
      setDataError("School ID is missing.");
      return;
    }

    setDataLoading(true);
    setDataError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          "Your login session has expired. Please log in again."
        );
      }

      const schoolResponse = await fetch(
        "/api/super-admin/schools/manage",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            action: "get",
            schoolId,
          }),
        }
      );

      const schoolResult = await schoolResponse.json();

      if (!schoolResponse.ok || !schoolResult?.success) {
        throw new Error(
          schoolResult?.error || "Unable to load school."
        );
      }

      setSchool((schoolResult.school || null) as School | null);
      setOwner((schoolResult.owner || null) as SchoolOwner | null);

      const usersResponse = await fetch(
        `/api/super-admin/schools/users?schoolId=${encodeURIComponent(schoolId)}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const usersResult = await usersResponse.json();

      if (!usersResponse.ok || !usersResult?.success) {
        throw new Error(
          usersResult?.error || "Unable to load staff members."
        );
      }

      setMembers((usersResult.members || []) as SchoolMember[]);
    } catch (error) {
      console.error("LOAD SCHOOL DATA ERROR:", error);

      setDataError(
        error instanceof Error
          ? error.message
          : "Unable to load school data."
      );
    } finally {
      setDataLoading(false);
    }
  }

  // --------------------------------------------------
  // DELETE STAFF USER
  // --------------------------------------------------

  function openDeleteMember(member: SchoolMember) {
    setDeleteError("");
    setSuccessMessage("");
    setDeleteTarget(member);
  }

  function closeDeleteMember() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError("");
  }

  async function handleDeleteMember() {
    if (!deleteTarget) return;

    setDeleting(true);
    setDeleteError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          "Your login session has expired. Please log in again."
        );
      }

      const response = await fetch("/api/super-admin/schools/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "delete",
          schoolId,
          userId: deleteTarget.userId,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Unable to delete the user.");
      }

      setDeleteTarget(null);
      setSuccessMessage(result.message || "User deleted successfully.");

      await loadSchoolData();
    } catch (error) {
      console.error("DELETE USER ERROR:", error);

      setDeleteError(
        error instanceof Error
          ? error.message
          : "Unable to delete the user."
      );
    } finally {
      setDeleting(false);
    }
  }


  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------

  if (loading || (!accessVerified && loading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="rounded-2xl bg-white px-8 py-6 shadow">
          <p className="flex items-center gap-3 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            Loading school...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* TOP BAR */}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/super-admin"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Super Admin
          </Link>

          <button
            type="button"
            onClick={loadSchoolData}
            disabled={dataLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-50"
          >
            {dataLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>

        {/* PAGE TITLE */}

        <div className="mt-6 flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
            <Building2 className="h-7 w-7" />
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {school?.name || "School"}
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              School ID:{" "}
              {school?.school_code ||
                school?.code ||
                "—"}
            </p>
          </div>

          {school?.status && (
            <span className="ml-auto rounded-full bg-blue-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
              {school.status}
            </span>
          )}
        </div>

        {/* MESSAGES */}

        {successMessage && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-medium text-emerald-700">
              {successMessage}
            </p>
          </div>
        )}

        {dataError && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-700">
              {dataError}
            </p>
          </div>
        )}

        {/* SCHOOL DATA */}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-5 w-5" />
            </div>

            <h2 className="text-lg font-bold text-slate-900">
              School Data
            </h2>
          </div>

          {dataLoading && !school ? (
            <p className="mt-5 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading school data...
            </p>
          ) : school ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoItem label="School Name" value={school.name} />
              <InfoItem
                label="School Code"
                value={school.school_code || school.code || "—"}
              />
              <InfoItem
                label="Status"
                value={school.status || "—"}
              />
              <InfoItem
                label="Plan"
                value={school.plan_code || "—"}
              />
              <InfoItem
                label="Student Limit"
                value={
                  school.student_limit
                    ? String(school.student_limit)
                    : "—"
                }
              />
              <InfoItem
                label="Valid From"
                value={formatDate(school.starts_on)}
              />
              <InfoItem
                label="Expires On"
                value={formatDate(school.expires_on)}
              />
              <InfoItem
                label="School Email"
                value={school.email || "—"}
              />
              <InfoItem
                label="School Phone"
                value={school.phone || "—"}
              />
              <InfoItem
                label="Address"
                value={
                  [school.address, school.city, school.state, school.postal_code]
                    .filter(Boolean)
                    .join(", ") || "—"
                }
              />
              <InfoItem
                label="Owner Name"
                value={owner?.name || "—"}
              />
              <InfoItem
                label="Owner Email"
                value={owner?.email || "—"}
              />
              <InfoItem
                label="Owner Phone"
                value={owner?.phone || "—"}
              />
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-500">
              School details are not available.
            </p>
          )}
        </section>


        {/* STAFF MEMBERS */}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Users className="h-5 w-5" />
              </div>

              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Staff Members
                </h2>

                <p className="mt-0.5 text-sm text-slate-500">
                  {members.length} login
                  {members.length === 1 ? "" : "s"} linked to this school
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Super Admin access
            </span>
          </div>

          {dataLoading && members.length === 0 ? (
            <p className="flex items-center gap-2 px-6 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading staff members...
            </p>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <UserRound className="h-6 w-6" />
              </div>

              <p className="mt-3 text-sm font-semibold text-slate-700">
                No staff logins yet
              </p>

              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Logins created for this school (owner and staff) will appear
                here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Name
                    </th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Email
                    </th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Role
                    </th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>


                <tbody className="divide-y divide-slate-100">
                  {members.map((member) => (
                    <tr key={member.userId} className="hover:bg-slate-50/60">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600">
                            {getInitials(member.fullName)}
                          </div>

                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {member.fullName}
                            </p>

                            {(member.employeeNo || member.designation) && (
                              <p className="text-xs text-slate-500">
                                {[member.employeeNo, member.designation]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-sm text-slate-600">
                        {member.email || "—"}
                        {member.loginId && (
                          <span className="mt-0.5 block text-xs text-slate-400">
                            Login ID: {member.loginId}
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            member.role === "owner"
                              ? "bg-purple-50 text-purple-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {member.role}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-sm text-slate-600">
                        {member.phone || "—"}
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            member.isActive
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {member.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openDeleteMember(member)}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>


        {/* DELETE USER MODAL */}

        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-xl font-bold text-slate-900">
                  Delete User
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  This action cannot be undone.
                </p>
              </div>

              <div className="px-6 py-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {deleteTarget.fullName}
                  </p>

                  <p className="mt-0.5 text-sm text-slate-500">
                    {deleteTarget.email || deleteTarget.userId}
                  </p>

                  <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Role: {deleteTarget.role}
                  </p>
                </div>

                <p className="mt-4 text-sm leading-6 text-slate-600">
                  The user will be removed from this school and the login will
                  be permanently deleted from Supabase Auth. The staff record
                  will stay, but it will no longer be linked to any login.
                </p>

                {deleteError && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-sm font-medium text-red-700">
                      {deleteError}
                    </p>
                  </div>
                )}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeDeleteMember}
                    disabled={deleting}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={handleDeleteMember}
                    disabled={deleting}
                    className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4" />
                        Delete User
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getInitials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "—";
  }

  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }

  return (
    parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
  ).toUpperCase();
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-1 break-words text-sm font-medium text-slate-800">
        {value}
      </p>
    </div>
  );
}

